use nostr_memory::MemoryDatabase;
use nostr_relay_builder::LocalRelay;
use nostr_sdk::prelude::*;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::num::NonZeroUsize;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

pub const TORRENT: u16 = 2003;
pub const COMMENT: u16 = 1111;
pub const ZAP_RECEIPT: u16 = 9735;
const PAGE: usize = 500;
const PROFILE_BATCH: usize = 100;
const INTERACTION_BATCH: usize = 40;
const NEGATIVE_TTL: Duration = Duration::from_secs(600);

#[derive(Clone)]
pub struct Mirror {
    pub database: Arc<MemoryDatabase>,
    pub relay: LocalRelay,
    client: Client,
    pending_profiles: Arc<Mutex<HashSet<PublicKey>>>,
    tried: Arc<Mutex<HashMap<String, Instant>>>,
}

pub fn search_tokens(q: &str) -> Vec<String> {
    q.split(|c: char| c == '+' || c.is_whitespace())
        .map(|t| t.trim_end_matches('*').to_lowercase())
        .filter(|t| !t.is_empty())
        .collect()
}

fn search_text(ev: &Event) -> String {
    let mut text = ev.content.to_lowercase();
    for tag in ev.tags.iter() {
        if matches!(tag.kind().to_string().as_str(), "title" | "file" | "t") {
            if let Some(v) = tag.content() {
                text.push('\n');
                text.push_str(&v.to_lowercase());
            }
        }
    }
    text
}

pub fn parse_filter(raw: &Value) -> Option<(Filter, Option<String>)> {
    let mut obj = raw.as_object()?.clone();
    obj.remove("relays");
    let search = obj.remove("search").and_then(|s| s.as_str().map(str::to_string));
    let filter: Filter = serde_json::from_value(Value::Object(obj)).ok()?;
    Some((filter, search))
}

impl Mirror {
    pub fn new(max_events: usize, relay_port: Option<u16>) -> Mirror {
        let database = Arc::new(match NonZeroUsize::new(max_events) {
            Some(max) => MemoryDatabase::bounded(max),
            None => MemoryDatabase::unbounded(),
        });
        let mut builder = LocalRelay::builder().database(database.clone());
        if let Some(port) = relay_port {
            builder = builder.port(port);
        }
        let relay = builder.build();
        let client = Client::builder().database(database.clone()).build();
        Mirror { database, relay, client, pending_profiles: Default::default(), tried: Default::default() }
    }

    pub async fn query(&self, raw: &[Value]) -> Vec<Event> {
        let mut seen = HashSet::new();
        let mut out = Vec::new();
        for (mut filter, search) in raw.iter().filter_map(parse_filter) {
            let limit = filter.limit;
            if search.is_some() {
                filter.limit = None;
            }
            let Ok(events) = self.database.query(filter).await else { continue };
            let tokens = search.as_deref().map(search_tokens);
            let mut taken = 0;
            for ev in events.iter() {
                if limit.is_some_and(|l| taken >= l) {
                    break;
                }
                if let Some(tokens) = &tokens {
                    let text = search_text(ev);
                    if !tokens.iter().all(|t| text.contains(t.as_str())) {
                        continue;
                    }
                }
                if seen.insert(ev.id) {
                    out.push(ev.clone());
                    taken += 1;
                }
            }
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
        out
    }

    pub async fn count_kind(&self, kind: u16) -> usize {
        self.database.count(Filter::new().kind(Kind::from(kind))).await.unwrap_or(0)
    }

    pub async fn len(&self) -> usize {
        self.database.count(Filter::new()).await.unwrap_or(0)
    }

    async fn note_author(&self, ev: &Event) {
        if ev.kind.as_u16() != TORRENT && ev.kind.as_u16() != COMMENT {
            return;
        }
        let have = self.database.query(Filter::new().kind(Kind::Metadata).author(ev.pubkey).limit(1)).await.map(|e| !e.is_empty()).unwrap_or(false);
        if !have {
            self.pending_profiles.lock().unwrap().insert(ev.pubkey);
        }
    }

    pub fn want_profiles(&self, pubkeys: impl IntoIterator<Item = PublicKey>) {
        for pk in pubkeys {
            if self.should_try(&format!("profile:{pk}")) {
                self.pending_profiles.lock().unwrap().insert(pk);
            }
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

    pub async fn fetch(&self, filters: Vec<Filter>, timeout: Duration) -> usize {
        let before = self.len().await;
        let _ = self.client.fetch_events(filters).timeout(timeout).await;
        self.len().await.saturating_sub(before)
    }

    pub async fn follow(&self, urls: &[String], backfill: usize) -> anyhow::Result<()> {
        for url in urls {
            self.client.add_relay(url.as_str()).await?;
        }
        self.client.connect().and_wait(Duration::from_secs(15)).await;
        tokio::spawn(forward_to_relay(self.clone()));
        self.client.subscribe(vec![Filter::new().kinds([Kind::from(TORRENT), Kind::from(COMMENT), Kind::from(ZAP_RECEIPT)]).since(Timestamp::now())]).await?;
        self.backfill(Filter::new().kind(Kind::from(TORRENT)), backfill).await?;
        self.backfill(Filter::new().kind(Kind::from(COMMENT)).custom_tag(SingleLetterTag::uppercase(Alphabet::K), TORRENT.to_string()), backfill).await?;
        let me = self.clone();
        tokio::spawn(async move { me.profile_loop().await });
        let me = self.clone();
        tokio::spawn(async move { me.interaction_loop().await });
        Ok(())
    }

    async fn backfill(&self, base: Filter, total: usize) -> anyhow::Result<()> {
        let mut until: Option<Timestamp> = None;
        let mut fetched = 0;
        while fetched < total {
            let mut filter = base.clone().limit(PAGE);
            if let Some(u) = until {
                filter = filter.until(u);
            }
            let events = self.client.fetch_events(filter).timeout(Duration::from_secs(30)).await?;
            let mut oldest = Timestamp::max();
            for ev in events.iter() {
                oldest = oldest.min(ev.created_at);
            }
            if events.len() < PAGE {
                break;
            }
            fetched += events.len();
            until = Some(if until == Some(oldest) { oldest - 1 } else { oldest });
        }
        Ok(())
    }

    async fn profile_loop(&self) {
        loop {
            tokio::time::sleep(Duration::from_secs(2)).await;
            loop {
                let batch: Vec<PublicKey> = {
                    let mut pending = self.pending_profiles.lock().unwrap();
                    let take: Vec<PublicKey> = pending.iter().take(PROFILE_BATCH).copied().collect();
                    for pk in &take {
                        pending.remove(pk);
                    }
                    take
                };
                if batch.is_empty() {
                    break;
                }
                self.fetch(vec![Filter::new().kind(Kind::Metadata).authors(batch)], Duration::from_secs(8)).await;
            }
        }
    }

    async fn interaction_loop(&self) {
        loop {
            let newest = self.database.query(Filter::new().kind(Kind::from(TORRENT)).limit(300)).await.map(|e| e.to_vec()).unwrap_or_default();
            for chunk in newest.chunks(INTERACTION_BATCH) {
                let ids: Vec<String> = chunk.iter().map(|e| e.id.to_hex()).collect();
                let filter = Filter::new().kinds([Kind::from(COMMENT), Kind::from(ZAP_RECEIPT)]).custom_tags(SingleLetterTag::lowercase(Alphabet::E), ids);
                self.fetch(vec![filter], Duration::from_secs(8)).await;
            }
            tokio::time::sleep(Duration::from_secs(300)).await;
        }
    }
}

async fn forward_to_relay(mirror: Mirror) {
    let mut notifications = mirror.client.notifications();
    while let Some(n) = notifications.next().await {
        if let ClientNotification::Event { event, .. } = n {
            mirror.relay.notify_event((*event).clone());
            mirror.note_author(&event).await;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr_relay_builder::MockRelay;
    use serde_json::json;

    fn keys(n: u8) -> Keys {
        Keys::new(SecretKey::from_slice(&[n.max(1); 32]).unwrap())
    }

    fn torrent(n: u8, at: u64, title: &str, tags: Vec<Vec<&str>>) -> Event {
        let mut all = vec![vec!["title", title], vec!["x", "aabbccddeeff00112233445566778899aabbccdd"]];
        all.extend(tags);
        EventBuilder::new(Kind::from(TORRENT), "desc")
            .tags(all.into_iter().map(|t| Tag::parse(t).unwrap()))
            .custom_created_at(Timestamp::from_secs(at))
            .finalize(&keys(n))
            .unwrap()
    }

    async fn filled(events: &[Event]) -> Mirror {
        let m = Mirror::new(0, None);
        for ev in events {
            m.database.save_event(ev).await.unwrap();
        }
        m
    }

    #[tokio::test]
    async fn queries_filter_by_tag_author_and_limit_newest_first() {
        let m = filled(&[
            torrent(1, 10, "Movie One", vec![vec!["t", "movie"]]),
            torrent(1, 11, "Show One", vec![vec!["t", "tv"]]),
            torrent(2, 12, "Movie Two", vec![vec!["t", "movie"]]),
        ])
        .await;
        let got = m.query(&[json!({"kinds": [2003], "#t": ["movie"]})]).await;
        assert_eq!(got.iter().map(|e| e.created_at.as_secs()).collect::<Vec<_>>(), vec![12, 10]);
        let author = keys(1).public_key().to_hex();
        assert_eq!(m.query(&[json!({"kinds": [2003], "authors": [author], "limit": 1})]).await.len(), 1);
    }

    #[tokio::test]
    async fn search_matches_every_token_against_title_and_tags_as_the_web_app_sends_it() {
        let m = filled(&[torrent(1, 10, "Ubuntu 24.04 Desktop", vec![]), torrent(1, 11, "Debian Server", vec![])]).await;
        assert_eq!(m.query(&[json!({"kinds": [2003], "search": "ubuntu+desktop*"})]).await.len(), 1);
        assert_eq!(m.query(&[json!({"kinds": [2003], "search": "SERVER*"})]).await.len(), 1);
        assert_eq!(m.query(&[json!({"kinds": [2003], "search": "fedora*"})]).await.len(), 0);
    }

    #[tokio::test]
    async fn a_newer_profile_replaces_the_older_one() {
        let old = EventBuilder::new(Kind::Metadata, "{\"name\":\"old\"}").custom_created_at(Timestamp::from_secs(10)).finalize(&keys(1)).unwrap();
        let new = EventBuilder::new(Kind::Metadata, "{\"name\":\"new\"}").custom_created_at(Timestamp::from_secs(20)).finalize(&keys(1)).unwrap();
        let m = filled(&[old, new]).await;
        let got = m.query(&[json!({"kinds": [0], "authors": [keys(1).public_key().to_hex()]})]).await;
        assert_eq!(got.len(), 1);
        assert!(got[0].content.contains("new"));
    }

    #[tokio::test]
    async fn follow_backfills_past_one_page_then_streams_live_torrents() {
        let upstream = MockRelay::run().await.unwrap();
        for n in 1..=620u64 {
            upstream.add_event(torrent(1, 1_000_000 + n, &format!("t{n}"), vec![])).await.unwrap();
        }
        let m = Mirror::new(0, None);
        m.follow(&[upstream.url().await.to_string()], 5000).await.unwrap();
        assert_eq!(m.query(&[json!({"kinds": [2003], "limit": 1000})]).await.len(), 620);

        upstream.add_event(torrent(1, Timestamp::now().as_secs(), "live", vec![])).await.unwrap();
        tokio::time::timeout(Duration::from_secs(10), async {
            while m.len().await < 621 {
                tokio::time::sleep(Duration::from_millis(50)).await;
            }
        })
        .await
        .expect("live torrent reached the mirror");
    }

    #[tokio::test]
    async fn authors_of_new_torrents_get_their_profiles_fetched() {
        let upstream = MockRelay::run().await.unwrap();
        upstream.add_event(torrent(1, 100, "a", vec![])).await.unwrap();
        upstream.add_event(EventBuilder::new(Kind::Metadata, "{\"name\":\"alice\"}").custom_created_at(Timestamp::from_secs(90)).finalize(&keys(1)).unwrap()).await.unwrap();
        let m = Mirror::new(0, None);
        m.follow(&[upstream.url().await.to_string()], 100).await.unwrap();
        m.note_author(&torrent(1, 100, "a", vec![])).await;
        let profile = json!({"kinds": [0], "authors": [keys(1).public_key().to_hex()]});
        tokio::time::timeout(Duration::from_secs(10), async {
            while m.query(&[profile.clone()]).await.is_empty() {
                tokio::time::sleep(Duration::from_millis(100)).await;
            }
        })
        .await
        .expect("profile fetched");
    }

    #[tokio::test]
    async fn the_local_relay_serves_the_same_events_over_nostr() {
        let m = filled(&[torrent(1, 10, "served", vec![])]).await;
        m.relay.run().await.unwrap();
        let client = Client::default();
        client.add_relay(m.relay.url().await).await.unwrap();
        client.connect().and_wait(Duration::from_secs(5)).await;
        let got = client.fetch_events(Filter::new().kind(Kind::from(TORRENT))).timeout(Duration::from_secs(5)).await.unwrap();
        assert_eq!(got.len(), 1);
    }

    #[tokio::test]
    async fn a_missed_lookup_is_only_retried_after_the_negative_ttl() {
        let m = Mirror::new(0, None);
        assert!(m.should_try("ids:abc"));
        assert!(!m.should_try("ids:abc"));
        assert!(m.should_try("ids:def"));
    }
}
