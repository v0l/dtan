use secp256k1::{schnorr::Signature, Secp256k1, XOnlyPublicKey};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use std::collections::BTreeMap;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct Event {
    pub id: String,
    pub pubkey: String,
    pub created_at: i64,
    pub kind: u32,
    pub tags: Vec<Vec<String>>,
    pub content: String,
    pub sig: String,
}

impl Event {
    pub fn compute_id(&self) -> String {
        let canonical = serde_json::json!([0, self.pubkey, self.created_at, self.kind, self.tags, self.content]);
        hex::encode(Sha256::digest(canonical.to_string().as_bytes()))
    }

    pub fn verify(&self) -> bool {
        if self.id.len() != 64 || self.pubkey.len() != 64 || self.sig.len() != 128 {
            return false;
        }
        if self.compute_id() != self.id {
            return false;
        }
        let (Ok(id), Ok(pk), Ok(sig)) = (hex::decode(&self.id), hex::decode(&self.pubkey), hex::decode(&self.sig)) else {
            return false;
        };
        let (Ok(pk), Ok(sig), Ok(id)) = (XOnlyPublicKey::from_slice(&pk), Signature::from_slice(&sig), <[u8; 32]>::try_from(id)) else {
            return false;
        };
        Secp256k1::verification_only().verify_schnorr(&sig, &id, &pk).is_ok()
    }

    pub fn tag_values<'a>(&'a self, name: &'a str) -> impl Iterator<Item = &'a str> {
        self.tags.iter().filter(move |t| t.first().map(String::as_str) == Some(name)).filter_map(|t| t.get(1).map(String::as_str))
    }

    pub fn first_tag<'a>(&'a self, name: &'a str) -> Option<&'a str> {
        self.tag_values(name).next()
    }

    pub fn search_text(&self) -> String {
        let mut text = self.content.to_lowercase();
        for t in &self.tags {
            if matches!(t.first().map(String::as_str), Some("title" | "file" | "t")) {
                if let Some(v) = t.get(1) {
                    text.push('\n');
                    text.push_str(&v.to_lowercase());
                }
            }
        }
        text
    }
}

#[derive(Debug, Clone, Default)]
pub struct Filter {
    pub ids: Option<Vec<String>>,
    pub authors: Option<Vec<String>>,
    pub kinds: Option<Vec<u32>>,
    pub since: Option<i64>,
    pub until: Option<i64>,
    pub limit: Option<usize>,
    pub search: Option<String>,
    pub tags: BTreeMap<String, Vec<String>>,
}

fn string_list(v: &Value) -> Option<Vec<String>> {
    Some(v.as_array()?.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
}

impl Filter {
    pub fn from_json(v: &Value) -> Option<Filter> {
        let obj = v.as_object()?;
        let mut f = Filter::default();
        for (k, val) in obj {
            match k.as_str() {
                "ids" => f.ids = string_list(val),
                "authors" => f.authors = string_list(val),
                "kinds" => f.kinds = Some(val.as_array()?.iter().filter_map(|x| x.as_u64().map(|n| n as u32)).collect()),
                "since" => f.since = val.as_i64(),
                "until" => f.until = val.as_i64(),
                "limit" => f.limit = val.as_u64().map(|n| n as usize),
                "search" => f.search = val.as_str().map(str::to_string),
                k if k.len() == 2 && k.starts_with('#') => {
                    if let Some(values) = string_list(val) {
                        f.tags.insert(k[1..].to_string(), values);
                    }
                }
                _ => {}
            }
        }
        Some(f)
    }

    pub fn matches(&self, ev: &Event, search_text: Option<&str>) -> bool {
        if self.ids.as_ref().is_some_and(|ids| !ids.iter().any(|i| i == &ev.id)) {
            return false;
        }
        if self.authors.as_ref().is_some_and(|a| !a.iter().any(|p| p == &ev.pubkey)) {
            return false;
        }
        if self.kinds.as_ref().is_some_and(|k| !k.contains(&ev.kind)) {
            return false;
        }
        if self.since.is_some_and(|s| ev.created_at < s) || self.until.is_some_and(|u| ev.created_at > u) {
            return false;
        }
        for (name, wanted) in &self.tags {
            if !ev.tag_values(name).any(|v| wanted.iter().any(|w| w == v)) {
                return false;
            }
        }
        match (&self.search, search_text) {
            (Some(q), Some(text)) => search_tokens(q).iter().all(|t| text.contains(t.as_str())),
            (Some(q), None) => {
                let text = ev.search_text();
                search_tokens(q).iter().all(|t| text.contains(t.as_str()))
            }
            _ => true,
        }
    }
}

pub fn search_tokens(q: &str) -> Vec<String> {
    q.split(|c: char| c == '+' || c.is_whitespace())
        .map(|t| t.trim_end_matches('*').to_lowercase())
        .filter(|t| !t.is_empty())
        .collect()
}

#[cfg(test)]
pub mod testing {
    use super::*;
    use secp256k1::{Keypair, Secp256k1};

    pub fn signed(secret: u8, created_at: i64, kind: u32, tags: Vec<Vec<&str>>, content: &str) -> Event {
        let secp = Secp256k1::new();
        let mut sk = [0u8; 32];
        sk[31] = secret.max(1);
        let kp = Keypair::from_seckey_slice(&secp, &sk).unwrap();
        let (pk, _) = kp.x_only_public_key();
        let mut ev = Event {
            id: String::new(),
            pubkey: hex::encode(pk.serialize()),
            created_at,
            kind,
            tags: tags.into_iter().map(|t| t.into_iter().map(str::to_string).collect()).collect(),
            content: content.to_string(),
            sig: String::new(),
        };
        ev.id = ev.compute_id();
        let msg = hex::decode(&ev.id).unwrap();
        ev.sig = hex::encode(secp.sign_schnorr_no_aux_rand(&msg, &kp).to_byte_array());
        ev
    }

    pub fn torrent(secret: u8, created_at: i64, title: &str, tags: Vec<Vec<&str>>) -> Event {
        let mut all = vec![vec!["title", title], vec!["x", "aabbccddeeff00112233445566778899aabbccdd"]];
        all.extend(tags);
        signed(secret, created_at, 2003, all, "desc")
    }
}

#[cfg(test)]
mod tests {
    use super::testing::*;
    use super::*;

    #[test]
    fn a_signed_event_verifies_and_a_tampered_one_does_not() {
        let ev = signed(1, 100, 1, vec![], "hi");
        assert!(ev.verify());
        let mut bad = ev.clone();
        bad.content = "changed".into();
        assert!(!bad.verify());
        let mut forged = ev.clone();
        forged.sig = "0".repeat(128);
        assert!(!forged.verify());
    }

    #[test]
    fn nip50_style_search_matches_every_token_as_a_prefix_of_title_or_content() {
        let ev = torrent(1, 100, "Ubuntu 24.04 Desktop", vec![]);
        let f = |q: &str| Filter::from_json(&serde_json::json!({"search": q})).unwrap();
        assert!(f("ubuntu+desktop*").matches(&ev, None));
        assert!(f("UBUNTU*").matches(&ev, None));
        assert!(!f("debian*").matches(&ev, None));
    }
}
