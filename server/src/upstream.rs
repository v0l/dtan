use crate::event::{Event, Filter};
use crate::store::Store;
use futures_util::{SinkExt, StreamExt};
use serde_json::{json, Value};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::Message;

const PROFILE_BATCH: usize = 100;
const INTERACTION_BATCH: usize = 40;
const NEGATIVE_TTL: Duration = Duration::from_secs(600);

#[derive(Clone)]
pub struct Upstream {
    relays: Arc<Vec<String>>,
    store: Store,
    backfill: usize,
    pending_profiles: Arc<Mutex<HashSet<String>>>,
    tried: Arc<Mutex<HashMap<String, Instant>>>,
    wake: mpsc::UnboundedSender<()>,
    wake_rx: Arc<Mutex<Option<mpsc::UnboundedReceiver<()>>>>,
}

fn filters_json(filters: &[Value]) -> Vec<Value> {
    filters.to_vec()
}

async fn read_events(url: &str, filters: Vec<Value>, wait: Duration, stop_at_eose: bool, mut on_event: impl FnMut(Event)) -> Result<(), String> {
    let (mut ws, _) = tokio::time::timeout(wait, tokio_tungstenite::connect_async(url))
        .await
        .map_err(|_| "connect timeout".to_string())?
        .map_err(|e| e.to_string())?;
    let mut req = vec![json!("REQ"), json!("s")];
    req.extend(filters_json(&filters));
    ws.send(Message::text(Value::Array(req).to_string())).await.map_err(|e| e.to_string())?;
    loop {
        let next = if stop_at_eose { tokio::time::timeout(wait, ws.next()).await.map_err(|_| "read timeout".to_string())? } else { ws.next().await };
        let Some(msg) = next else { return Ok(()) };
        match msg.map_err(|e| e.to_string())? {
            Message::Text(t) => {
                let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&t) else { continue };
                match parts.first().and_then(Value::as_str) {
                    Some("EVENT") if parts.len() >= 3 => {
                        if let Ok(ev) = serde_json::from_value::<Event>(parts[2].clone()) {
                            on_event(ev);
                        }
                    }
                    Some("EOSE") if stop_at_eose => {
                        let _ = ws.send(Message::text(json!(["CLOSE", "s"]).to_string())).await;
                        return Ok(());
                    }
                    Some("CLOSED") => return Err("closed by relay".into()),
                    _ => {}
                }
            }
            Message::Ping(p) => {
                let _ = ws.send(Message::Pong(p)).await;
            }
            Message::Close(_) => return Ok(()),
            _ => {}
        }
    }
}

impl Upstream {
    pub fn new(relays: Vec<String>, store: Store, backfill: usize) -> Upstream {
        let (wake, rx) = mpsc::unbounded_channel();
        Upstream {
            relays: Arc::new(relays),
            store,
            backfill,
            pending_profiles: Default::default(),
            tried: Default::default(),
            wake,
            wake_rx: Arc::new(Mutex::new(Some(rx))),
        }
    }

    pub fn ingest(&self, ev: Event) -> bool {
        if !ev.verify() {
            return false;
        }
        let kind = ev.kind;
        let pubkey = ev.pubkey.clone();
        let added = self.store.insert(ev);
        if added && (kind == 2003 || kind == 1111) {
            if self.store.query(&[Filter { kinds: Some(vec![0]), authors: Some(vec![pubkey.clone()]), limit: Some(1), ..Default::default() }]).is_empty() {
                self.pending_profiles.lock().unwrap().insert(pubkey);
                let _ = self.wake.send(());
            }
        }
        added
    }

    pub async fn fetch(&self, filters: Vec<Value>, timeout: Duration) -> usize {
        let mut tasks = Vec::new();
        for url in self.relays.iter().take(4).cloned() {
            let me = self.clone();
            let filters = filters.clone();
            tasks.push(tokio::spawn(async move {
                let mut n = 0;
                let _ = read_events(&url, filters, timeout, true, |ev| {
                    if me.ingest(ev) {
                        n += 1;
                    }
                })
                .await;
                n
            }));
        }
        let mut total = 0;
        for t in tasks {
            total += t.await.unwrap_or(0);
        }
        total
    }

    pub fn want_profiles(&self, pubkeys: impl IntoIterator<Item = String>) {
        let mut pending = self.pending_profiles.lock().unwrap();
        let before = pending.len();
        for pk in pubkeys {
            if self.should_try(&format!("profile:{pk}")) {
                pending.insert(pk);
            }
        }
        if pending.len() > before {
            let _ = self.wake.send(());
        }
    }

    pub fn should_try(&self, key: &str) -> bool {
        let mut tried = self.tried.lock().unwrap();
        tried.retain(|_, at| at.elapsed() < NEGATIVE_TTL);
        if tried.contains_key(key) {
            return false;
        }
        tried.insert(key.to_string(), Instant::now());
        true
    }

    pub fn start(&self) {
        for url in self.relays.iter().cloned() {
            let me = self.clone();
            tokio::spawn(async move { me.follow(url).await });
        }
        let me = self.clone();
        tokio::spawn(async move { me.profile_loop().await });
        let me = self.clone();
        tokio::spawn(async move { me.interaction_loop().await });
    }

    async fn follow(&self, url: String) {
        let mut delay = Duration::from_secs(2);
        loop {
            let started = Instant::now();
            let filters = vec![json!({"kinds": [2003], "limit": self.backfill}), json!({"kinds": [1111], "#K": ["2003"], "limit": self.backfill})];
            let result = read_events(&url, filters, Duration::from_secs(15), false, |ev| {
                self.ingest(ev);
            })
            .await;
            tracing::warn!("relay {url} disconnected: {result:?}");
            if started.elapsed() > Duration::from_secs(60) {
                delay = Duration::from_secs(2);
            }
            tokio::time::sleep(delay).await;
            delay = (delay * 2).min(Duration::from_secs(120));
        }
    }

    async fn profile_loop(&self) {
        let Some(mut rx) = self.wake_rx.lock().unwrap().take() else { return };
        while rx.recv().await.is_some() {
            tokio::time::sleep(Duration::from_millis(500)).await;
            while rx.try_recv().is_ok() {}
            loop {
                let batch: Vec<String> = {
                    let mut p = self.pending_profiles.lock().unwrap();
                    let take: Vec<String> = p.iter().take(PROFILE_BATCH).cloned().collect();
                    for k in &take {
                        p.remove(k);
                    }
                    take
                };
                if batch.is_empty() {
                    break;
                }
                self.fetch(vec![json!({"kinds": [0], "authors": batch})], Duration::from_secs(8)).await;
            }
        }
    }

    async fn interaction_loop(&self) {
        tokio::time::sleep(Duration::from_secs(20)).await;
        loop {
            let newest = self.store.query(&[Filter { kinds: Some(vec![2003]), limit: Some(300), ..Default::default() }]);
            for chunk in newest.chunks(INTERACTION_BATCH) {
                let ids: Vec<&str> = chunk.iter().map(|e| e.id.as_str()).collect();
                self.fetch(vec![json!({"kinds": [1111, 9735], "#e": ids})], Duration::from_secs(8)).await;
            }
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    }
}

#[cfg(test)]
pub mod mock {
    use crate::event::Event;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{json, Value};
    use tokio::net::TcpListener;
    use tokio_tungstenite::tungstenite::Message;

    pub async fn relay(events: Vec<Event>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let addr = listener.local_addr().unwrap();
        tokio::spawn(async move {
            while let Ok((stream, _)) = listener.accept().await {
                let events = events.clone();
                tokio::spawn(async move {
                    let Ok(mut ws) = tokio_tungstenite::accept_async(stream).await else { return };
                    while let Some(Ok(Message::Text(t))) = ws.next().await {
                        let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&t) else { continue };
                        if parts.first().and_then(Value::as_str) != Some("REQ") {
                            continue;
                        }
                        let sub = parts[1].clone();
                        let wanted: Vec<crate::event::Filter> = parts[2..].iter().filter_map(crate::event::Filter::from_json).collect();
                        for ev in &events {
                            if wanted.iter().any(|f| f.matches(ev, None)) {
                                let _ = ws.send(Message::text(json!(["EVENT", sub, ev]).to_string())).await;
                            }
                        }
                        let _ = ws.send(Message::text(json!(["EOSE", sub]).to_string())).await;
                    }
                });
            }
        });
        format!("ws://{addr}")
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::testing::*;

    #[tokio::test]
    async fn fetch_pulls_matching_events_from_a_relay_into_the_store_and_rejects_forged_ones() {
        let good = torrent(1, 100, "Ubuntu", vec![]);
        let profile = signed(1, 90, 0, vec![], "{\"name\":\"alice\"}");
        let mut forged = torrent(2, 101, "Forged", vec![]);
        forged.content = "tampered".into();
        let url = mock::relay(vec![good.clone(), profile, forged]).await;
        let store = Store::new(0);
        let up = Upstream::new(vec![url], store.clone(), 100);
        let n = up.fetch(vec![json!({"kinds": [2003]})], Duration::from_secs(3)).await;
        assert_eq!(n, 1);
        assert_eq!(store.len(), 1);
        assert!(store.get(&good.id).is_some());
    }

    #[tokio::test]
    async fn profiles_for_new_torrent_authors_are_queued_for_fetching() {
        let t = torrent(1, 100, "a", vec![]);
        let up = Upstream::new(vec![], Store::new(0), 10);
        assert!(up.ingest(t.clone()));
        assert!(up.pending_profiles.lock().unwrap().contains(&t.pubkey));
    }

    #[test]
    fn a_missed_lookup_is_only_retried_after_the_negative_ttl() {
        let up = Upstream::new(vec![], Store::new(0), 10);
        assert!(up.should_try("ids:abc"));
        assert!(!up.should_try("ids:abc"));
        assert!(up.should_try("ids:def"));
    }
}
