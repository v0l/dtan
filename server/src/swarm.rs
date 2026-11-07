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
const MAX_BATCH: usize = 100;
const RENDER_WAIT: Duration = Duration::from_millis(1500);
const ROUTE_WAIT: Duration = Duration::from_secs(6);

pub type Fetch = Arc<dyn Fn(&[String], &[[u8; 20]]) -> Vec<Option<Counts>> + Send + Sync>;

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
        self.stats_many(&[hash], trackers, wait).pop()?.map(render)
    }

    pub fn batch(&self, info_hashes: &[String], wait: Duration) -> Value {
        let mut seen = HashSet::new();
        let parsed: Vec<(String, [u8; 20])> = info_hashes
            .iter()
            .filter_map(|h| Some((h.to_ascii_lowercase(), parse_hash(h)?)))
            .filter(|(h, _)| seen.insert(h.clone()))
            .take(MAX_BATCH)
            .collect();
        let hashes: Vec<[u8; 20]> = parsed.iter().map(|(_, h)| *h).collect();
        let answers = self.stats_many(&hashes, &[], wait);
        let mut out = serde_json::Map::new();
        for ((hex, _), counts) in parsed.into_iter().zip(answers) {
            if let Some(counts) = counts {
                out.insert(hex, render(counts));
            }
        }
        Value::Object(out)
    }

    pub fn stats_many(&self, hashes: &[[u8; 20]], trackers: &[String], wait: Duration) -> Vec<Option<Counts>> {
        let trackers = tracker_set(trackers);
        let timing = self.core.timing;
        let keys: Vec<String> = hashes.iter().map(|h| cache_key(h, &trackers)).collect();

        let mut flights: Vec<Arc<Flight>> = Vec::new();
        {
            let mut state = self.core.state.lock().unwrap();
            let mut wanted: Vec<usize> = Vec::new();
            for (i, key) in keys.iter().enumerate() {
                let fresh = state.entries.get(key).is_some_and(|e| e.at.elapsed() < if e.counts.is_some() { timing.fresh } else { timing.negative });
                if !fresh {
                    wanted.push(i);
                }
            }
            let mut batch: Vec<usize> = Vec::new();
            for i in wanted {
                match state.inflight.get(&keys[i]) {
                    Some(flight) => flights.push(flight.clone()),
                    None => batch.push(i),
                }
            }
            if !batch.is_empty() && state.inflight.len() < MAX_INFLIGHT {
                let flight = Arc::new(Flight { done: Mutex::new(false), signal: Condvar::new() });
                for &i in &batch {
                    state.inflight.insert(keys[i].clone(), flight.clone());
                }
                flights.push(flight.clone());
                self.spawn(flight, batch.iter().map(|&i| keys[i].clone()).collect(), batch.iter().map(|&i| hashes[i]).collect(), trackers);
            }
        }

        let deadline = Instant::now() + wait;
        for flight in flights {
            flight.wait(deadline.saturating_duration_since(Instant::now()));
        }
        let state = self.core.state.lock().unwrap();
        keys.iter().map(|k| state.entries.get(k).and_then(|e| e.counts)).collect()
    }

    fn spawn(&self, flight: Arc<Flight>, keys: Vec<String>, hashes: Vec<[u8; 20]>, trackers: Vec<String>) {
        let core = self.core.clone();
        std::thread::spawn(move || {
            let mut answers = (core.fetch)(&trackers, &hashes);
            answers.resize(keys.len(), None);
            let mut state = core.state.lock().unwrap();
            for (key, counts) in keys.into_iter().zip(answers) {
                state.inflight.remove(&key);
                let keep_old = counts.is_none() && state.entries.get(&key).is_some_and(|e| e.counts.is_some() && e.at.elapsed() < core.timing.stale);
                if !keep_old {
                    state.entries.insert(key, Entry { at: Instant::now(), counts });
                }
            }
            evict(&mut state.entries, &core.timing);
            drop(state);
            *flight.done.lock().unwrap() = true;
            flight.signal.notify_all();
        });
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

fn query_trackers(trackers: &[String], hashes: &[[u8; 20]]) -> Vec<Option<Counts>> {
    let per_tracker: Vec<Vec<Option<Counts>>> = std::thread::scope(|scope| {
        let handles: Vec<_> = trackers.iter().map(|t| scope.spawn(move || tracker::scrape_many(t, hashes))).collect();
        handles.into_iter().map(|h| h.join().unwrap_or_default()).collect()
    });
    (0..hashes.len()).map(|i| combine(per_tracker.iter().map(|answers| answers.get(i).copied().flatten()))).collect()
}

fn split_list(list: &str, max: usize) -> Vec<String> {
    list.split(',').filter(|t| !t.is_empty()).take(max).map(String::from).collect()
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
        }, JsFunction {
            name: "swarmStatsBatch",
            handler: Arc::new({
                let plugin = self.clone();
                move |arg: &str| {
                    let input: Value = serde_json::from_str(arg).unwrap_or_default();
                    let hashes: Vec<String> = input
                        .get("info_hashes")
                        .and_then(Value::as_array)
                        .map(|a| a.iter().filter_map(|h| h.as_str().map(String::from)).collect())
                        .unwrap_or_default();
                    plugin.batch(&hashes, RENDER_WAIT).to_string()
                }
            }),
        }]
    }

    fn routes(&self) -> axum::Router {
        let plugin = self.clone();
        let batch = self.clone();
        axum::Router::new().route(
            "/batch",
            axum::routing::get(move |query: axum::extract::Query<HashMap<String, String>>| async move {
                let plugin = batch.clone();
                let out = tokio::task::spawn_blocking(move || {
                    let hashes = split_list(query.get("info_hash").map(String::as_str).unwrap_or(""), MAX_BATCH);
                    plugin.batch(&hashes, ROUTE_WAIT)
                })
                .await
                .unwrap_or(Value::Null);
                ([(axum::http::header::CACHE_CONTROL, "public, max-age=60")], axum::Json(out))
            }),
        )
        .route(
            "/stats",
            axum::routing::get(move |query: axum::extract::Query<HashMap<String, String>>| async move {
                let plugin = plugin.clone();
                let out = tokio::task::spawn_blocking(move || {
                    let hash = query.get("info_hash").map(String::as_str).unwrap_or("");
                    let trackers = split_list(query.get("trackers").map(String::as_str).unwrap_or(""), MAX_TRACKERS);
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

    fn fixed(counts: Option<Counts>, delay: Duration) -> (SwarmPlugin, Arc<AtomicUsize>) {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let fetch: Fetch = Arc::new(move |_, hashes| {
            c.fetch_add(1, Ordering::SeqCst);
            std::thread::sleep(delay);
            vec![counts; hashes.len()]
        });
        (SwarmPlugin::new(fetch, Timing::default()), calls)
    }

    fn timed(timing: Timing, fetch: impl Fn(&[String], &[[u8; 20]]) -> Option<Counts> + Send + Sync + 'static) -> SwarmPlugin {
        SwarmPlugin::new(Arc::new(move |trackers, hashes| hashes.iter().map(|_| fetch(trackers, hashes)).collect()), timing)
    }

    fn seeds(v: Option<Value>) -> Option<u64> {
        v.and_then(|v| v["seeds"].as_u64())
    }

    #[test]
    fn a_second_lookup_is_served_from_the_cache() {
        let (plugin, calls) = fixed(Some((10, 2)), Duration::ZERO);
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(10));
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(10));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn concurrent_cold_lookups_share_one_fetch() {
        let (plugin, calls) = fixed(Some((10, 2)), Duration::from_millis(200));
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
        let (plugin, calls) = fixed(Some((7, 1)), Duration::from_millis(300));
        assert_eq!(plugin.stats(HASH, &[], Duration::from_millis(20)), None);
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(7));
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn stale_numbers_are_served_at_once_while_a_refresh_runs() {
        let timing = Timing { fresh: Duration::from_millis(30), stale: Duration::from_secs(60), ..Timing::default() };
        let value = Arc::new(AtomicUsize::new(5));
        let v = value.clone();
        let plugin = timed(timing, move |_, _| Some((v.load(Ordering::SeqCst) as u64, 0)));
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(5));
        value.store(9, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(seeds(plugin.stats(HASH, &[], Duration::ZERO)), Some(5));
        std::thread::sleep(Duration::from_millis(100));
        assert_eq!(seeds(plugin.stats(HASH, &[], Duration::ZERO)), Some(9));
    }

    #[test]
    fn a_failed_refresh_keeps_the_stale_numbers() {
        let timing = Timing { fresh: Duration::from_millis(20), stale: Duration::from_secs(60), ..Timing::default() };
        let up = Arc::new(AtomicUsize::new(1));
        let u = up.clone();
        let plugin = timed(timing, move |_, _| (u.load(Ordering::SeqCst) == 1).then_some((5, 1)));
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(5));
        up.store(0, Ordering::SeqCst);
        std::thread::sleep(Duration::from_millis(40));
        plugin.stats(HASH, &[], LONG);
        std::thread::sleep(Duration::from_millis(60));
        assert_eq!(seeds(plugin.stats(HASH, &[], LONG)), Some(5));
    }

    #[test]
    fn no_answer_is_cached_briefly_then_retried() {
        let timing = Timing { negative: Duration::from_millis(60), ..Timing::default() };
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let plugin = timed(timing, move |_, _| {
            c.fetch_add(1, Ordering::SeqCst);
            None
        });
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        std::thread::sleep(Duration::from_millis(80));
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_caller_cannot_poison_the_numbers_another_tracker_list_sees() {
        let plugin = timed(Timing::default(), |trackers, _| trackers.iter().any(|t| t == "http://evil.example/announce").then_some((999_999, 0)));
        let evil = vec!["http://evil.example/announce".to_string()];
        assert_eq!(seeds(plugin.stats(HASH, &evil, LONG)), Some(999_999));
        assert_eq!(plugin.stats(HASH, &[], LONG), None);
    }

    #[test]
    fn an_empty_tracker_list_still_asks_the_default_trackers() {
        let seen = Arc::new(Mutex::new(Vec::new()));
        let s = seen.clone();
        let plugin = timed(Timing::default(), move |trackers, _| {
            *s.lock().unwrap() = trackers.to_vec();
            Some((1, 1))
        });
        plugin.stats(HASH, &[], LONG);
        assert!(seen.lock().unwrap().iter().any(|t| t.contains("nyaa.tracker.wf")));
    }

    #[test]
    fn the_cache_never_grows_past_its_limit() {
        let timing = Timing { max_entries: 5, ..Timing::default() };
        let plugin = timed(timing, |_, _| Some((1, 1)));
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
        let (plugin, calls) = fixed(Some((1, 1)), Duration::ZERO);
        for bad in ["", "abc", &"z".repeat(40), &"a".repeat(41)] {
            assert_eq!(plugin.stats(bad, &[], LONG), None);
        }
        assert_eq!(plugin.batch(&["nope".to_string(), "".to_string()], LONG), json!({}));
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
        let (plugin, calls) = fixed(Some((3, 3)), Duration::ZERO);
        plugin.stats(HASH, &[], LONG);
        plugin.stats(OTHER, &[], LONG);
        assert_eq!(calls.load(Ordering::SeqCst), 2);
    }

    #[test]
    fn a_list_is_fetched_in_one_round_and_only_the_answered_hashes_come_back() {
        let calls = Arc::new(AtomicUsize::new(0));
        let c = calls.clone();
        let plugin = SwarmPlugin::new(
            Arc::new(move |_, hashes| {
                c.fetch_add(1, Ordering::SeqCst);
                hashes.iter().map(|h| (h[19] != 9).then_some((h[19] as u64, 1))).collect()
            }),
            Timing::default(),
        );
        let hashes: Vec<String> = (1..=10u8).map(|n| format!("{:038x}{n:02x}", 0)).collect();
        let out = plugin.batch(&hashes, LONG);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
        assert_eq!(out.as_object().unwrap().len(), 9);
        assert_eq!(out[&hashes[2]]["seeds"], 3);
        assert!(out.get(&hashes[8]).is_none());
        plugin.batch(&hashes, LONG);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_list_reuses_what_a_detail_lookup_already_cached() {
        let (plugin, calls) = fixed(Some((3, 3)), Duration::ZERO);
        plugin.stats(HASH, &[], LONG);
        let out = plugin.batch(&[HASH.to_string(), HASH.to_ascii_uppercase()], LONG);
        assert_eq!(out.as_object().unwrap().len(), 1);
        assert_eq!(calls.load(Ordering::SeqCst), 1);
    }

    #[test]
    fn a_batch_is_capped() {
        let (plugin, _) = fixed(Some((1, 1)), Duration::ZERO);
        let hashes: Vec<String> = (0..500u32).map(|n| format!("{n:040x}")).collect();
        assert_eq!(plugin.batch(&hashes, LONG).as_object().unwrap().len(), MAX_BATCH);
    }
}
