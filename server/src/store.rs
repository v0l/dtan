use crate::event::{Event, Filter};
use std::cmp::Reverse;
use std::collections::{BTreeSet, HashMap};
use std::sync::{Arc, RwLock};

type Key = (Reverse<i64>, String);

pub const DEFAULT_QUERY_LIMIT: usize = 500;

#[derive(Default)]
struct Inner {
    events: HashMap<String, Arc<Event>>,
    search: HashMap<String, String>,
    all: BTreeSet<Key>,
    by_kind: HashMap<u32, BTreeSet<Key>>,
    by_author: HashMap<String, BTreeSet<Key>>,
    by_tag: HashMap<(String, String), BTreeSet<Key>>,
    replaceable: HashMap<String, String>,
    max_events: usize,
}

#[derive(Clone)]
pub struct Store {
    inner: Arc<RwLock<Inner>>,
}

pub fn is_replaceable(kind: u32) -> bool {
    kind == 0 || kind == 3 || (10_000..20_000).contains(&kind)
}

pub fn is_addressable(kind: u32) -> bool {
    (30_000..40_000).contains(&kind)
}

fn replace_key(ev: &Event) -> Option<String> {
    if is_replaceable(ev.kind) {
        Some(format!("{}:{}", ev.kind, ev.pubkey))
    } else if is_addressable(ev.kind) {
        Some(format!("{}:{}:{}", ev.kind, ev.pubkey, ev.first_tag("d").unwrap_or("")))
    } else {
        None
    }
}

fn indexed_tags(ev: &Event) -> impl Iterator<Item = (String, String)> + '_ {
    ev.tags.iter().filter_map(|t| match (t.first(), t.get(1)) {
        (Some(n), Some(v)) if n.len() == 1 => Some((n.clone(), v.clone())),
        _ => None,
    })
}

impl Inner {
    fn insert(&mut self, ev: Event) -> bool {
        if self.events.contains_key(&ev.id) {
            return false;
        }
        if let Some(rk) = replace_key(&ev) {
            if let Some(old_id) = self.replaceable.get(&rk).cloned() {
                let old_created = self.events.get(&old_id).map(|e| e.created_at).unwrap_or(0);
                if old_created >= ev.created_at {
                    return false;
                }
                self.remove(&old_id);
            }
            self.replaceable.insert(rk, ev.id.clone());
        }
        let key: Key = (Reverse(ev.created_at), ev.id.clone());
        self.all.insert(key.clone());
        self.by_kind.entry(ev.kind).or_default().insert(key.clone());
        self.by_author.entry(ev.pubkey.clone()).or_default().insert(key.clone());
        for t in indexed_tags(&ev) {
            self.by_tag.entry(t).or_default().insert(key.clone());
        }
        if ev.kind == 2003 {
            self.search.insert(ev.id.clone(), ev.search_text());
        }
        self.events.insert(ev.id.clone(), Arc::new(ev));
        self.evict();
        true
    }

    fn remove(&mut self, id: &str) {
        let Some(ev) = self.events.remove(id) else { return };
        let key: Key = (Reverse(ev.created_at), ev.id.clone());
        self.all.remove(&key);
        self.search.remove(id);
        if let Some(s) = self.by_kind.get_mut(&ev.kind) {
            s.remove(&key);
        }
        if let Some(s) = self.by_author.get_mut(&ev.pubkey) {
            s.remove(&key);
        }
        for t in indexed_tags(&ev) {
            if let Some(s) = self.by_tag.get_mut(&t) {
                s.remove(&key);
                if s.is_empty() {
                    self.by_tag.remove(&t);
                }
            }
        }
        if let Some(rk) = replace_key(&ev) {
            if self.replaceable.get(&rk).map(String::as_str) == Some(id) {
                self.replaceable.remove(&rk);
            }
        }
    }

    fn evict(&mut self) {
        while self.max_events > 0 && self.events.len() > self.max_events {
            let victim = self
                .all
                .iter()
                .rev()
                .find(|(_, id)| self.events.get(id).is_some_and(|e| !is_replaceable(e.kind)))
                .map(|(_, id)| id.clone());
            match victim {
                Some(id) => self.remove(&id),
                None => return,
            }
        }
    }

    fn candidates<'a>(&'a self, f: &Filter) -> Vec<&'a BTreeSet<Key>> {
        let mut best: Option<(usize, Vec<&BTreeSet<Key>>)> = None;
        let mut consider = |sets: Vec<&'a BTreeSet<Key>>| {
            let size: usize = sets.iter().map(|s| s.len()).sum();
            if best.as_ref().map_or(true, |(b, _)| size < *b) {
                best = Some((size, sets));
            }
        };
        for (name, values) in &f.tags {
            if name.len() == 1 {
                consider(values.iter().filter_map(|v| self.by_tag.get(&(name.clone(), v.clone()))).collect());
            }
        }
        if let Some(authors) = &f.authors {
            consider(authors.iter().filter_map(|a| self.by_author.get(a)).collect());
        }
        if let Some(kinds) = &f.kinds {
            consider(kinds.iter().filter_map(|k| self.by_kind.get(k)).collect());
        }
        best.map(|(_, s)| s).unwrap_or_else(|| vec![&self.all])
    }

    fn query(&self, f: &Filter, cap: usize) -> Vec<Arc<Event>> {
        let limit = f.limit.unwrap_or(DEFAULT_QUERY_LIMIT).min(cap);
        if let Some(ids) = &f.ids {
            let mut out: Vec<Arc<Event>> =
                ids.iter().filter_map(|i| self.events.get(i)).filter(|e| f.matches(e, self.search.get(&e.id).map(String::as_str))).cloned().collect();
            out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
            out.truncate(limit);
            return out;
        }
        let sets = self.candidates(f);
        let mut merged: Vec<&Key> = Vec::new();
        if sets.len() == 1 {
            merged.extend(sets[0].iter());
        } else {
            let mut seen = BTreeSet::new();
            for s in &sets {
                for k in s.iter() {
                    seen.insert(k);
                }
            }
            merged.extend(seen);
        }
        let mut out = Vec::new();
        for (_, id) in merged {
            if out.len() >= limit {
                break;
            }
            if let Some(ev) = self.events.get(id) {
                if f.matches(ev, self.search.get(id).map(String::as_str)) {
                    out.push(ev.clone());
                }
            }
        }
        out
    }
}

impl Store {
    pub fn new(max_events: usize) -> Store {
        Store { inner: Arc::new(RwLock::new(Inner { max_events, ..Default::default() })) }
    }

    pub fn insert(&self, ev: Event) -> bool {
        self.inner.write().unwrap().insert(ev)
    }

    pub fn len(&self) -> usize {
        self.inner.read().unwrap().events.len()
    }

    pub fn get(&self, id: &str) -> Option<Arc<Event>> {
        self.inner.read().unwrap().events.get(id).cloned()
    }

    pub fn query(&self, filters: &[Filter]) -> Vec<Arc<Event>> {
        let inner = self.inner.read().unwrap();
        let mut seen = std::collections::HashSet::new();
        let mut out = Vec::new();
        for f in filters {
            for ev in inner.query(f, usize::MAX) {
                if seen.insert(ev.id.clone()) {
                    out.push(ev);
                }
            }
        }
        out.sort_by(|a, b| b.created_at.cmp(&a.created_at).then_with(|| a.id.cmp(&b.id)));
        out
    }

    pub fn count_kind(&self, kind: u32) -> usize {
        self.inner.read().unwrap().by_kind.get(&kind).map_or(0, |s| s.len())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::testing::*;
    use serde_json::json;

    fn f(v: serde_json::Value) -> Vec<Filter> {
        vec![Filter::from_json(&v).unwrap()]
    }

    #[test]
    fn queries_return_newest_first_and_respect_limit() {
        let s = Store::new(0);
        for i in 0..20 {
            s.insert(torrent(1, 1000 + i, &format!("t{i}"), vec![]));
        }
        let got = s.query(&f(json!({"kinds": [2003], "limit": 5})));
        assert_eq!(got.len(), 5);
        assert_eq!(got[0].created_at, 1019);
        assert!(got.windows(2).all(|w| w[0].created_at >= w[1].created_at));
    }

    #[test]
    fn tag_author_and_search_filters_combine() {
        let s = Store::new(0);
        s.insert(torrent(1, 10, "Movie One", vec![vec!["t", "movie"]]));
        s.insert(torrent(1, 11, "Show One", vec![vec!["t", "tv"]]));
        s.insert(torrent(2, 12, "Movie Two", vec![vec!["t", "movie"]]));
        assert_eq!(s.query(&f(json!({"kinds":[2003], "#t": ["movie"]}))).len(), 2);
        let author = torrent(1, 0, "x", vec![]).pubkey;
        assert_eq!(s.query(&f(json!({"kinds":[2003], "#t": ["movie"], "authors": [author]}))).len(), 1);
        assert_eq!(s.query(&f(json!({"kinds":[2003], "search": "one*"}))).len(), 2);
        assert_eq!(s.query(&f(json!({"kinds":[2003], "search": "movie+two*"}))).len(), 1);
    }

    #[test]
    fn a_newer_profile_replaces_the_older_one_and_a_stale_one_is_ignored() {
        let s = Store::new(0);
        let old = signed(1, 10, 0, vec![], "{\"name\":\"old\"}");
        let new = signed(1, 20, 0, vec![], "{\"name\":\"new\"}");
        assert!(s.insert(old.clone()));
        assert!(s.insert(new.clone()));
        assert!(!s.insert(old));
        let got = s.query(&f(json!({"kinds":[0], "authors":[new.pubkey]})));
        assert_eq!(got.len(), 1);
        assert!(got[0].content.contains("new"));
        assert_eq!(s.len(), 1);
    }

    #[test]
    fn duplicates_are_ignored_and_ids_lookup_works() {
        let s = Store::new(0);
        let ev = torrent(1, 10, "a", vec![]);
        assert!(s.insert(ev.clone()));
        assert!(!s.insert(ev.clone()));
        assert_eq!(s.query(&f(json!({"ids": [ev.id.clone()]}))).len(), 1);
        assert_eq!(s.query(&f(json!({"ids": ["nope"]}))).len(), 0);
    }

    #[test]
    fn the_cap_evicts_the_oldest_events_but_keeps_profiles() {
        let s = Store::new(5);
        s.insert(signed(1, 1, 0, vec![], "{}"));
        for i in 0..10 {
            s.insert(torrent(2, 100 + i, "x", vec![]));
        }
        assert_eq!(s.len(), 5);
        assert_eq!(s.count_kind(0), 1);
        let got = s.query(&f(json!({"kinds":[2003]})));
        assert_eq!(got.last().unwrap().created_at, 106);
    }

    #[test]
    fn comments_are_found_by_their_e_tag() {
        let s = Store::new(0);
        let t = torrent(1, 10, "a", vec![]);
        s.insert(t.clone());
        s.insert(signed(2, 11, 1111, vec![vec!["e", &t.id]], "nice"));
        s.insert(signed(3, 12, 1111, vec![vec!["e", "other"]], "no"));
        assert_eq!(s.query(&f(json!({"kinds":[1111,9735], "#e": [t.id]}))).len(), 1);
    }
}
