use crate::tracker::{self, Counts};
use nostr_ssr::plugin::{JsFunction, Plugin};
use serde_json::{json, Value};
use std::collections::hash_map::DefaultHasher;
use std::collections::{HashMap, HashSet};
use std::hash::{Hash, Hasher};
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

const DEFAULT_TRACKERS: [&str; 5] = [
    "http://nyaa.tracker.wf:7777/announce",
    "http://tracker.opentrackr.org:1337/announce",
    "udp://tracker.opentrackr.org:1337/announce",
    "udp://open.stealth.si:80/announce",
    "udp://tracker.torrent.eu.org:451/announce",
];
const MAX_TRACKERS: usize = 10;
const MAX_INFLIGHT: usize = 8;
const RENDER_WAIT: Duration = Duration::from_millis(1500);
const ROUTE_WAIT: Duration = Duration::from_secs(6);

pub type Fetch = Arc<dyn Fn(&[String], &[u8; 20]) -> Option<Counts> + Send + Sync>;

#[derive(Clone, Copy)]
pub struct Timing {
    pub fresh: Duration,
    pub stale: Duration,
    pub negative: Duration,
    pub max_entries: usize,
}

impl Default for Timing {
    fn default() -> Self {
        Timing { fresh: Duration::from_secs(300), stale: Duration::from_secs(3600), negative: Duration::from_secs(120), max_entries: 5000 }
    }
}

struct Entry {
    at: Instant,
    counts: Option<Counts>,
}

struct Flight {
    done: Mutex<bool>,
    signal: Condvar,
}

impl Flight {
    fn wait(&self, budget: Duration) {
        let done = self.done.lock().unwrap();
        let _ = self.signal.wait_timeout_while(done, budget, |done| !*done).unwrap();
    }
}

#[derive(Default)]
struct State {
    entries: HashMap<String, Entry>,
    inflight: HashMap<String, Arc<Flight>>,
}

struct Core {
    fetch: Fetch,
    timing: Timing,
    state: Mutex<State>,
}

#[derive(Clone)]
pub struct SwarmPlugin {
    core: Arc<Core>,
}

impl SwarmPlugin {
    pub fn live() -> Self {
        Self::new(Arc::new(query_trackers), Timing::default())
    }

    pub fn new(fetch: Fetch, timing: Timing) -> Self {
        SwarmPlugin { core: Arc::new(Core { fetch, timing, state: Mutex::new(State::default()) }) }
    }

    pub fn stats(&self, info_hash: &str, trackers: &[String], wait: Duration) -> Option<Value> {
        let hash = parse_hash(info_hash)?;
        let trackers = tracker_set(trackers);
        let key = cache_key(&hash, &trackers);
        let timing = self.core.timing;

        let flight = {
            let mut state = self.core.state.lock().unwrap();
            let age_and_counts = state.entries.get(&key).map(|e| (e.at.elapsed(), e.counts));
            match age_and_counts {
                Some((age, counts)) if age < if counts.is_some() { timing.fresh } else { timing.negative } => return counts.map(render),
                Some((age, Some(counts))) if age < timing.stale => {
                    self.start(&mut state, key, hash, trackers);
                    return Some(render(counts));
                }
                _ => self.start(&mut state, key.clone(), hash, trackers),
            }
        };

        flight?.wait(wait);
        let state = self.core.state.lock().unwrap();
        state.entries.get(&key).and_then(|e| e.counts).map(render)
    }

    fn start(&self, state: &mut State, key: String, hash: [u8; 20], trackers: Vec<String>) -> Option<Arc<Flight>> {
        if let Some(flight) = state.inflight.get(&key) {
            return Some(flight.clone());
        }
        if state.inflight.len() >= MAX_INFLIGHT {
            return None;
        }
        let flight = Arc::new(Flight { done: Mutex::new(false), signal: Condvar::new() });
        state.inflight.insert(key.clone(), flight.clone());
        let core = self.core.clone();
        let spawned = flight.clone();
        std::thread::spawn(move || {
            let counts = (core.fetch)(&trackers, &hash);
            let mut state = core.state.lock().unwrap();
            state.entries.insert(key.clone(), Entry { at: Instant::now(), counts });
            state.inflight.remove(&key);
            evict(&mut state.entries, &core.timing);
            drop(state);
            *spawned.done.lock().unwrap() = true;
            spawned.signal.notify_all();
        });
        Some(flight)
    }
}

fn evict(entries: &mut HashMap<String, Entry>, timing: &Timing) {
    if entries.len() <= timing.max_entries {
        return;
    }
    entries.retain(|_, e| e.at.elapsed() < timing.stale);
    while entries.len() > timing.max_entries {
        let Some(oldest) = entries.iter().max_by_key(|(_, e)| e.at.elapsed()).map(|(k, _)| k.clone()) else { break };
        entries.remove(&oldest);
    }
}

fn render((seeds, leeches): Counts) -> Value {
    json!({ "seeds": seeds, "leeches": leeches })
}

fn parse_hash(hex: &str) -> Option<[u8; 20]> {
    if hex.len() != 40 || !hex.bytes().all(|b| b.is_ascii_hexdigit()) {
        return None;
    }
    let mut out = [0u8; 20];
    for (i, b) in out.iter_mut().enumerate() {
        *b = u8::from_str_radix(&hex[i * 2..i * 2 + 2], 16).ok()?;
    }
    Some(out)
}

pub fn tracker_set(requested: &[String]) -> Vec<String> {
    let mut seen = HashSet::new();
    requested
        .iter()
        .map(String::as_str)
        .filter(|t| tracker::normalize(t).is_some())
        .chain(DEFAULT_TRACKERS)
        .filter(|t| seen.insert(t.to_string()))
        .take(MAX_TRACKERS)
        .map(String::from)
        .collect()
}

fn cache_key(hash: &[u8; 20], trackers: &[String]) -> String {
    let mut sorted: Vec<&String> = trackers.iter().collect();
    sorted.sort();
    let mut hasher = DefaultHasher::new();
    sorted.hash(&mut hasher);
    format!("{}:{:x}", hash.iter().map(|b| format!("{b:02x}")).collect::<String>(), hasher.finish())
}

pub fn combine(answers: impl IntoIterator<Item = Option<Counts>>) -> Option<Counts> {
    answers.into_iter().flatten().reduce(|(s, l), (cs, cl)| (s.max(cs), l.max(cl)))
}

fn query_trackers(trackers: &[String], hash: &[u8; 20]) -> Option<Counts> {
    let answers: Vec<Option<Counts>> = std::thread::scope(|scope| {
        let handles: Vec<_> = trackers.iter().map(|t| scope.spawn(move || tracker::scrape(t, hash))).collect();
        handles.into_iter().map(|h| h.join().ok().flatten()).collect()
    });
    combine(answers)
}

fn split_trackers(list: &str) -> Vec<String> {
    list.split(',').filter(|t| !t.is_empty()).take(MAX_TRACKERS).map(String::from).collect()
}

impl Plugin for SwarmPlugin {
    fn name(&self) -> &'static str {
        "swarm"
    }

    fn js_functions(&self) -> Vec<JsFunction> {
        let plugin = self.clone();
        vec![JsFunction {
            name: "swarmStats",
            handler: Arc::new(move |arg: &str| {
                let input: Value = serde_json::from_str(arg).unwrap_or_default();
                let hash = input.get("info_hash").and_then(Value::as_str).unwrap_or("");
                let trackers: Vec<String> = input
                    .get("trackers")
                    .and_then(Value::as_array)
                    .map(|a| a.iter().filter_map(|t| t.as_str().map(String::from)).take(MAX_TRACKERS).collect())
                    .unwrap_or_default();
                plugin.stats(hash, &trackers, RENDER_WAIT).unwrap_or(Value::Null).to_string()
            }),
        }]
    }

    fn routes(&self) -> axum::Router {
        let plugin = self.clone();
        axum::Router::new().route(
            "/stats",
            axum::routing::get(move |query: axum::extract::Query<HashMap<String, String>>| async move {
                let plugin = plugin.clone();
                let out = tokio::task::spawn_blocking(move || {
                    let hash = query.get("info_hash").map(String::as_str).unwrap_or("");
                    let trackers = split_trackers(query.get("trackers").map(String::as_str).unwrap_or(""));
                    plugin.stats(hash, &trackers, ROUTE_WAIT).unwrap_or(Value::Null)
                })
                .await
                .unwrap_or(Value::Null);
                ([(axum::http::header::CACHE_CONTROL, "public, max-age=60")], axum::Json(out))
            }),
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};

    const HASH: &str = "4cab84031abd94ce892be537d47221f7c4885c88";
    const OTHER: &str = "0000000000000000000000000000000000000001";
    const LONG: Duration = Duration::from_secs(5);

    fn counting(counts: Option<Counts>, delay: Duration) -> (SwarmPlugin, Arc<AtomicUsize>, Arc<Mutex<Option<Option<Counts>>>>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let next = Arc::new(Mutex::new(None));
        let (c, n) = (calls.clone(), next.clone());
        let fetch: Fetch = Arc::new(move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(delay);
            n.lock().unwrap().take().unwrap_or(counts)
        });
        (SwarmPlugin::new(fetch, Timing::default()), calls, next)
    }

    fn timed(timing: Timing, fetch: Fetch) -> SwarmPlugin {
        SwarmPlugin::new(fetch, timing)
    }

    fn seeds(v: Option<Value>) -> Option<u64> {
        v.and_then(|v| v["seeds"].as_u64())
    }

    #[test]
    fn a_second_lookup_is_served_from_the_cache() {
        let (plugin, calls, _) = counting(Some((10, 2)), Duration::ZERO);
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(10));
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(10));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn concurrent_cold_lookups_share_one_fetch() {
        let (plugin, calls, _) = counting(Some((10, 2)), Duration::from_millis(200));
        let handles: Vec<_> = (0..8)
            .map(|_| {
                let p = plugin.clone();
                std::thread::spawn(move || seeds(p.stats(HASH, &[], LONG)))
            })
            .collect();
        for h in handles {
            assert_eq!(h.join().unwrap(), Some(10));
        }
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_slow_cold_lookup_returns_nothing_within_budget_then_fills_in() {
        let (plugin, calls, _) = counting(Some((7, 1)), Duration::from_millis(300));
        assert_eq!(plugin.stats(HASH, &[], Duration::from_millis(20)), None);
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(7));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stale_numbers_are_served_at_once_while_a_refresh_runs() {
        let timing = Timing { fresh: Duration::from_millis(30), stale: Duration::from_secs(60), ..Timing::default() };
        let value = Arc::new(AtomicUsize::new(5));
        let v = value.clone();
        let plugin = timed(timing, Arc::new(move |_, _| Some((v.load(Ordering::SeqCst) as u64, 0))));
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(5));
        value.store(9, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(seeds(plugin.stats(HASH, &[], Duration::ZERO)), Some(5));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(seeds(plugin.stats(HASH, &[], Duration::ZERO)), Some(9));
    }

    #[test]
    fn no_answer_is_cached_briefly_then_retried() {
        let timing = Timing { negative: Duration::from_millis(60), ..Timing::default() };
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let plugin = timed(timing, Arc::new(move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            None
        }));
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_caller_cannot_poison_the_numbers_another_tracker_list_sees() {
        let plugin = SwarmPlugin::new(
            Arc::new(|trackers, _| trackers.iter().any(|t| t == "http://evil.example/announce").then_some((999_999, 0))),
            Timing::default(),
        );
        let evil = vec!["http://evil.example/announce".to_string()];
        assert_eq!(seeds(plugin.stats(HASH, &evil, LONG)), Some(999_999));
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
    }

    #[test]
    fn an_empty_tracker_list_still_asks_the_default_trackers() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let plugin = SwarmPlugin::new(Arc::new(move |trackers, _| {
            *s.lock().unwrap() = trackers.to_vec();
            Some((1, 1))
        }), Timing::default());
        plugin.stats(HASH, &[], LONG);
        assert!(seen.lock().unwrap().iter().any(|t| t.contains("nyaa.tracker.wf")));
    }

    #[test]
    fn the_cache_never_grows_past_its_limit() {
        let timing = Timing { max_entries: 5, ..Timing::default() };
        let plugin = timed(timing, Arc::new(|_, _| Some((1, 1))));
        for n in 0..40u32 {
            plugin.stats(&format!("{n:040x}"), &[], LONG);
        }
        std::thread::sleep(Duration::from_millis(50));
        assert!(plugin.core.state.lock().unwrap().entries.len() <= 5);
    }

    #[test]
    fn counts_from_overlapping_swarms_are_not_added_together() {
        assert_eq!(combine([Some((245, 10)), Some((250, 8)), None]), Some((250, 10)));
        assert_eq!(combine([None, None]), None);
    }

    #[test]
    fn malformed_hashes_never_reach_a_tracker() {
        let (plugin, calls, _) = counting(Some((1, 1)), Duration::ZERO);
        for bad in ["", "abc", &"z".repeat(40), &"a".repeat(41)] {
            assert_eq!(plugin.stats(bad, &[], LONG), None);
        }
        assert_eq!(calls.load(Ordering::SeqCst), 0);
    }

    #[test]
    fn unusable_tracker_urls_are_dropped_and_the_list_is_capped_and_deduped() {
        let requested: Vec<String> = ["file:///etc/passwd", "garbage", "http://a.example/announce", "http://a.example/announce"]
            .into_iter()
            .map(String::from)
            .chain((0..30).map(|n| format!("http://t{n}.example/announce")))
            .collect();
        let set = tracker_set(&requested);
        assert!(set.len() <= MAX_TRACKERS);
        assert!(!set.iter().any(|t| t.starts_with("file") || t == "garbage"));
        assert_eq!(set.iter().filter(|t| *t == "http://a.example/announce").count(), 1);
    }

    #[test]
    fn different_hashes_are_cached_separately() {
        let (plugin, calls, _) = counting(Some((3, 3)), Duration::ZERO);
        plugin.stats(HASH, &[], LONG);
        plugin.stats(OTHER, &[], LONG);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }
}
