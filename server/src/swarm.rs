use nostr_ssr::plugin::{JsFunction, Plugin};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::{Duration, Instant};

const CACHE_TTL: Duration = Duration::from_secs(30);
const NEGATIVE_TTL: Duration = Duration::from_secs(60);
const TRACKER_TIMEOUT: Duration = Duration::from_secs(4);
const MAX_TRACKERS: usize = 12;
const PEER_ID: &[u8; 20] = b"-DTAN123456789012345";
const PORT: u16 = 6881;

#[derive(Clone)]
pub struct SwarmPlugin {
    core: Arc<Core>,
}

struct Core {
    client: reqwest::blocking::Client,
    cache: Mutex<HashMap<String, (Instant, Duration, Value)>>,
}

impl SwarmPlugin {
    pub fn from_env() -> Self {
        let client = reqwest::blocking::Client::builder()
            .timeout(TRACKER_TIMEOUT)
            .build()
            .expect("http client");
        Self { core: Arc::new(Core { client, cache: Mutex::new(HashMap::new()) }) }
    }

    pub fn stats(&self, info_hash: &str, trackers: &[String]) -> Option<Value> {
        let key = info_hash.to_ascii_lowercase();
        let ih = hex_to_bytes(&key)?;
        {
            let cache = self.core.cache.lock().unwrap();
            if let Some((at, ttl, v)) = cache.get(&key) {
                if at.elapsed() < *ttl {
                    return Some(v.clone());
                }
            }
        }
        let http: Vec<String> = trackers
            .iter()
            .filter(|t| t.starts_with("http://") || t.starts_with("https://"))
            .take(MAX_TRACKERS)
            .cloned()
            .collect();
        let mut seeds: u64 = 0;
        let mut leeches: u64 = 0;
        let mut answered = 0;
        let clients: Vec<reqwest::blocking::Client> = (0..http.len()).map(|_| self.core.client.clone()).collect();
        let results: Vec<(u64, u64)> = std::thread::scope(|s| {
            let handles: Vec<_> = http
                .iter()
                .zip(clients.iter())
                .map(|(t, c)| s.spawn(move || announce(c, t, &ih)))
                .collect();
            handles.into_iter().filter_map(|h| h.join().ok().flatten()).collect()
        });
        for (cs, ls) in results {
            seeds += cs;
            leeches += ls;
            answered += 1;
        }
        let value = if answered > 0 {
            Some(json!({ "seeds": seeds, "leeches": leeches, "at": now_unix() }))
        } else {
            None
        };
        let ttl = if answered > 0 { CACHE_TTL } else { NEGATIVE_TTL };
        let stored = value.clone().unwrap_or(Value::Null);
        self.core.cache.lock().unwrap().insert(key.clone(), (Instant::now(), ttl, stored));
        tracing::debug!(key = %key, answered, seeds, leeches, "swarm stats");
        value
    }
}

fn now_unix() -> u64 {
    std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map(|d| d.as_secs()).unwrap_or(0)
}

fn hex_to_bytes(s: &str) -> Option<[u8; 20]> {
    if s.len() != 40 || !s.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 20];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&s[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

fn pct(bytes: &[u8]) -> String {
    bytes.iter().map(|b| format!("%{b:02X}")).collect()
}

fn announce(client: &reqwest::blocking::Client, tracker: &str, info_hash: &[u8; 20]) -> Option<(u64, u64)> {
    let q = format!(
        "info_hash={}&peer_id={}&port={}&uploaded=0&downloaded=0&left=1&compact=1",
        pct(info_hash),
        pct(PEER_ID),
        PORT
    );
    let url = if tracker.contains('?') {
        format!("{tracker}&{q}")
    } else {
        format!("{tracker}?{q}")
    };
    let resp = client.get(&url).send().ok()?;
    if resp.status() != reqwest::StatusCode::OK {
        return None;
    }
    let body = resp.bytes().ok()?;
    parse_announce(&body)
}

fn parse_announce(body: &[u8]) -> Option<(u64, u64)> {
    if body.windows("failure reason".len()).any(|w| w == b"failure reason") {
        return None;
    }
    let complete = benc_int(body, b"complete")? as u64;
    let incomplete = benc_int(body, b"incomplete").unwrap_or(0) as u64;
    Some((complete, incomplete))
}

/// Reads a top-level integer value by key from a bencoded dictionary.
fn benc_int(body: &[u8], key: &[u8]) -> Option<i64> {
    let mut marker = Vec::with_capacity(key.len() + 4);
    marker.extend(key.len().to_string().bytes());
    marker.push(b':');
    marker.extend_from_slice(key);
    let i = body.windows(marker.len()).position(|w| w == marker.as_slice())?;
    let rest = &body[i + marker.len()..];
    if rest.first() != Some(&b'i') {
        return None;
    }
    let end = rest[1..].iter().position(|&b| b == b'e')?;
    let s = std::str::from_utf8(&rest[1..1 + end]).ok()?;
    s.parse().ok()
}

impl Plugin for SwarmPlugin {
    fn name(&self) -> &'static str {
        "swarm"
    }

    fn js_functions(&self) -> Vec<JsFunction> {
        let me = self.clone();
        vec![JsFunction {
            name: "swarmStats",
            handler: Arc::new(move |arg: &str| {
                let v: Value = serde_json::from_str(arg).unwrap_or_default();
                let info_hash = v.get("info_hash").and_then(Value::as_str).unwrap_or("");
                let trackers: Vec<String> = v
                    .get("trackers")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).collect())
                    .unwrap_or_default();
                serde_json::to_string(&me.stats(info_hash, &trackers).unwrap_or(Value::Null)).unwrap_or_else(|_| "null".into())
            }),
        }]
    }

    fn routes(&self) -> axum::Router {
        let me = self.clone();
        axum::Router::new().route(
            "/stats",
            axum::routing::get(move |query: axum::extract::Query<HashMap<String, String>>| async move {
                let me = me.clone();
                let q = query.0;
                let out = tokio::task::spawn_blocking(move || -> Value {
                    let info_hash = q.get("info_hash").cloned().unwrap_or_default();
                    let trackers = q
                        .get("trackers")
                        .cloned()
                        .unwrap_or_default()
                        .split(',')
                        .filter(|t| !t.is_empty())
                        .map(String::from)
                        .collect::<Vec<_>>();
                    me.stats(&info_hash, &trackers).unwrap_or(Value::Null)
                })
                .await
                .unwrap_or(Value::Null);
                axum::Json(out)
            }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_announce_responses_with_complete_and_incomplete() {
        // d8:completei269e10:downloadedi573e10:incompletei15e5:peers300:...
        let body = b"d8:completei269e10:downloadedi573e10:incompletei15e8:intervali1830e5:peers300:";
        assert_eq!(parse_announce(body), Some((269, 15)));
        let with_fail = b"d14:failure reason80:Your client forgot to send your torrent's info_hash. Please upgrade your client.e";
        assert_eq!(parse_announce(with_fail), None);
        let empty = b"e";
        assert_eq!(parse_announce(empty), None);
    }

    #[test]
    fn hex_conversion_requires_exactly_twenty_bytes() {
        assert!(hex_to_bytes(&"a".repeat(40)).is_some());
        assert!(hex_to_bytes("xyz").is_none());
        assert!(hex_to_bytes(&"z".repeat(40)).is_none());
    }

    #[test]
    fn benc_int_reads_the_integer_value_for_a_key() {
        let body = b"d8:completei12e10:incompletei34e";
        assert_eq!(benc_int(body, b"complete"), Some(12));
        assert_eq!(benc_int(body, b"incomplete"), Some(34));
        assert_eq!(benc_int(body, b"missing"), None);
    }
}
