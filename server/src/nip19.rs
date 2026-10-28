use bech32::{Bech32, Hrp};

pub fn nevent(id: &str, author: &str, kind: u32) -> Option<String> {
    let id = hex::decode(id).ok().filter(|b| b.len() == 32)?;
    let author = hex::decode(author).ok().filter(|b| b.len() == 32)?;
    let mut data = vec![0u8, 32];
    data.extend(id);
    data.extend([2u8, 32]);
    data.extend(author);
    data.extend([3u8, 4]);
    data.extend(kind.to_be_bytes());
    bech32::encode::<Bech32>(Hrp::parse("nevent").ok()?, &data).ok()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn matches_the_link_encoder_used_by_the_pages() {
        let id = "aa".repeat(32);
        let author = "bb".repeat(32);
        let got = nevent(&id, &author, 2003).unwrap();
        assert_eq!(got, std::fs::read_to_string(concat!(env!("CARGO_MANIFEST_DIR"), "/testdata/nevent.txt")).unwrap().trim());
    }
}
