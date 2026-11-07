use reqwest::dns::{Addrs, Name, Resolve, Resolving};
use reqwest::Url;
use std::io::Read;
use std::net::{IpAddr, Ipv4Addr, Ipv6Addr, SocketAddr, ToSocketAddrs, UdpSocket};
use std::sync::{Arc, OnceLock};
use std::time::Duration;

const TIMEOUT: Duration = Duration::from_secs(4);
const MAX_BODY: u64 = 64 * 1024;
const UDP_PROTOCOL_ID: u64 = 0x41727101980;
const MAX_DEPTH: usize = 8;

pub type Counts = (u64, u64);

pub fn is_public(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => public_v4(v4),
        IpAddr::V6(v6) => public_v6(v6),
    }
}

fn public_v4(ip: Ipv4Addr) -> bool {
    let o = ip.octets();
    !(ip.is_private()
        || ip.is_loopback()
        || ip.is_link_local()
        || ip.is_unspecified()
        || ip.is_broadcast()
        || ip.is_documentation()
        || ip.is_multicast()
        || o[0] == 0
        || (o[0] == 100 && (64..128).contains(&o[1]))
        || (o[0] == 198 && (o[1] == 18 || o[1] == 19))
        || o[0] >= 240)
}

fn public_v6(ip: Ipv6Addr) -> bool {
    if let Some(v4) = ip.to_ipv4_mapped() {
        return public_v4(v4);
    }
    let s = ip.segments();
    !(ip.is_loopback() || ip.is_unspecified() || ip.is_multicast() || (s[0] & 0xfe00) == 0xfc00 || (s[0] & 0xffc0) == 0xfe80)
}

struct PublicOnly;

impl Resolve for PublicOnly {
    fn resolve(&self, name: Name) -> Resolving {
        Box::pin(async move {
            let addrs: Vec<SocketAddr> = tokio::net::lookup_host((name.as_str(), 0)).await?.filter(|a| is_public(a.ip())).collect();
            if addrs.is_empty() {
                return Err("no public address".into());
            }
            Ok(Box::new(addrs.into_iter()) as Addrs)
        })
    }
}

fn http_client() -> &'static reqwest::blocking::Client {
    static CLIENT: OnceLock<reqwest::blocking::Client> = OnceLock::new();
    CLIENT.get_or_init(|| {
        reqwest::blocking::Client::builder()
            .timeout(TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .dns_resolver(Arc::new(PublicOnly))
            .user_agent("dtan")
            .build()
            .expect("http client")
    })
}

pub fn normalize(tracker: &str) -> Option<Url> {
    if tracker.len() > 256 {
        return None;
    }
    let url = Url::parse(tracker.trim()).ok()?;
    if !matches!(url.scheme(), "http" | "https" | "udp") || url.host_str().is_none() {
        return None;
    }
    Some(url)
}

pub fn scrape_url(announce: &Url, info_hash: &[u8; 20]) -> Option<Url> {
    let path = announce.path();
    let (dir, last) = path.rsplit_once('/')?;
    if !last.starts_with("announce") {
        return None;
    }
    let mut url = announce.clone();
    url.set_path(&format!("{dir}/scrape{}", &last["announce".len()..]));
    let hash: String = info_hash.iter().map(|b| format!("%{b:02X}")).collect();
    let query = match announce.query() {
        Some(q) => format!("{q}&info_hash={hash}"),
        None => format!("info_hash={hash}"),
    };
    url.set_query(Some(&query));
    Some(url)
}

pub fn scrape(tracker: &str, info_hash: &[u8; 20]) -> Option<Counts> {
    let url = normalize(tracker)?;
    match url.scheme() {
        "udp" => udp_scrape(&url, info_hash),
        _ => http_scrape(&url, info_hash),
    }
}

fn literal_ip_is_public(url: &Url) -> bool {
    match url.host() {
        Some(url::Host::Ipv4(ip)) => public_v4(ip),
        Some(url::Host::Ipv6(ip)) => public_v6(ip),
        Some(url::Host::Domain(_)) => true,
        None => false,
    }
}

fn http_scrape(announce: &Url, info_hash: &[u8; 20]) -> Option<Counts> {
    let url = scrape_url(announce, info_hash)?;
    if !literal_ip_is_public(&url) {
        return None;
    }
    let resp = http_client().get(url).send().ok()?;
    if !resp.status().is_success() {
        return None;
    }
    let mut body = Vec::new();
    resp.take(MAX_BODY).read_to_end(&mut body).ok()?;
    parse_scrape(&body, info_hash)
}

#[derive(Debug, PartialEq)]
enum Bencode<'a> {
    Int(i64),
    Bytes(&'a [u8]),
    List(Vec<Bencode<'a>>),
    Dict(Vec<(&'a [u8], Bencode<'a>)>),
}

impl<'a> Bencode<'a> {
    fn get(&self, key: &[u8]) -> Option<&Bencode<'a>> {
        match self {
            Bencode::Dict(items) => items.iter().find(|(k, _)| *k == key).map(|(_, v)| v),
            _ => None,
        }
    }

    fn int(&self) -> Option<u64> {
        match self {
            Bencode::Int(i) => u64::try_from(*i).ok(),
            _ => None,
        }
    }
}

fn parse_bencode(input: &[u8], depth: usize) -> Option<(Bencode<'_>, &[u8])> {
    if depth > MAX_DEPTH {
        return None;
    }
    match *input.first()? {
        b'i' => {
            let end = input.iter().position(|&b| b == b'e')?;
            let n = std::str::from_utf8(&input[1..end]).ok()?.parse().ok()?;
            Some((Bencode::Int(n), &input[end + 1..]))
        }
        b'l' => {
            let mut rest = &input[1..];
            let mut items = Vec::new();
            while *rest.first()? != b'e' {
                let (v, r) = parse_bencode(rest, depth + 1)?;
                items.push(v);
                rest = r;
            }
            Some((Bencode::List(items), &rest[1..]))
        }
        b'd' => {
            let mut rest = &input[1..];
            let mut items = Vec::new();
            while *rest.first()? != b'e' {
                let (k, r) = parse_bencode(rest, depth + 1)?;
                let Bencode::Bytes(k) = k else { return None };
                let (v, r) = parse_bencode(r, depth + 1)?;
                items.push((k, v));
                rest = r;
            }
            Some((Bencode::Dict(items), &rest[1..]))
        }
        b'0'..=b'9' => {
            let colon = input.iter().position(|&b| b == b':')?;
            let len: usize = std::str::from_utf8(&input[..colon]).ok()?.parse().ok()?;
            let end = colon.checked_add(1)?.checked_add(len)?;
            Some((Bencode::Bytes(input.get(colon + 1..end)?), &input[end..]))
        }
        _ => None,
    }
}

pub fn parse_scrape(body: &[u8], info_hash: &[u8; 20]) -> Option<Counts> {
    let (root, _) = parse_bencode(body, 0)?;
    let Bencode::Dict(files) = root.get(b"files")? else { return None };
    let entry = files.iter().find(|(k, _)| *k == info_hash).map(|(_, v)| v).or_else(|| (files.len() == 1).then(|| &files[0].1))?;
    Some((entry.get(b"complete")?.int()?, entry.get(b"incomplete")?.int()?))
}

fn transaction_id() -> u32 {
    use std::hash::{BuildHasher, Hasher};
    std::collections::hash_map::RandomState::new().build_hasher().finish() as u32
}

pub fn udp_connect_request(tx: u32) -> [u8; 16] {
    let mut buf = [0u8; 16];
    buf[..8].copy_from_slice(&UDP_PROTOCOL_ID.to_be_bytes());
    buf[12..].copy_from_slice(&tx.to_be_bytes());
    buf
}

pub fn parse_udp_connect(buf: &[u8], tx: u32) -> Option<u64> {
    if buf.len() < 16 || buf[..4] != 0u32.to_be_bytes() || buf[4..8] != tx.to_be_bytes() {
        return None;
    }
    Some(u64::from_be_bytes(buf[8..16].try_into().ok()?))
}

pub fn udp_scrape_request(connection: u64, tx: u32, info_hash: &[u8; 20]) -> [u8; 36] {
    let mut buf = [0u8; 36];
    buf[..8].copy_from_slice(&connection.to_be_bytes());
    buf[8..12].copy_from_slice(&2u32.to_be_bytes());
    buf[12..16].copy_from_slice(&tx.to_be_bytes());
    buf[16..].copy_from_slice(info_hash);
    buf
}

pub fn parse_udp_scrape(buf: &[u8], tx: u32) -> Option<Counts> {
    if buf.len() < 20 || buf[..4] != 2u32.to_be_bytes() || buf[4..8] != tx.to_be_bytes() {
        return None;
    }
    let seeders = u32::from_be_bytes(buf[8..12].try_into().ok()?) as u64;
    let leechers = u32::from_be_bytes(buf[16..20].try_into().ok()?) as u64;
    Some((seeders, leechers))
}

fn udp_scrape(url: &Url, info_hash: &[u8; 20]) -> Option<Counts> {
    let addr = (url.host_str()?, url.port()?).to_socket_addrs().ok()?.find(|a| is_public(a.ip()))?;
    let socket = UdpSocket::bind(if addr.is_ipv4() { "0.0.0.0:0" } else { "[::]:0" }).ok()?;
    socket.set_read_timeout(Some(TIMEOUT / 2)).ok()?;
    socket.connect(addr).ok()?;
    let mut buf = [0u8; 2048];

    let tx = transaction_id();
    socket.send(&udp_connect_request(tx)).ok()?;
    let n = socket.recv(&mut buf).ok()?;
    let connection = parse_udp_connect(&buf[..n], tx)?;

    let tx = transaction_id();
    socket.send(&udp_scrape_request(connection, tx, info_hash)).ok()?;
    let n = socket.recv(&mut buf).ok()?;
    parse_udp_scrape(&buf[..n], tx)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::net::TcpListener;

    const HASH: [u8; 20] = [0x4c, 0xab, 0x84, 0x03, 0x1a, 0xbd, 0x94, 0xce, 0x89, 0x2e, 0xbe, 0x53, 0x7d, 0x47, 0x22, 0x1f, 0x7c, 0x48, 0x85, 0xc8];

    fn files_body(hash: &[u8], inner: &str) -> Vec<u8> {
        let mut body = b"d5:filesd20:".to_vec();
        body.extend_from_slice(hash);
        body.extend_from_slice(inner.as_bytes());
        body.extend_from_slice(b"ee");
        body
    }

    #[test]
    fn a_scrape_response_gives_complete_and_incomplete_for_the_hash() {
        let body = files_body(&HASH, "d8:completei234e10:incompletei6e10:downloadedi615ee");
        assert_eq!(parse_scrape(&body, &HASH), Some((234, 6)));
    }

    #[test]
    fn field_order_does_not_matter() {
        let body = files_body(&HASH, "d8:completei254e10:downloadedi731e10:incompletei29ee");
        assert_eq!(parse_scrape(&body, &HASH), Some((254, 29)));
    }

    #[test]
    fn a_failure_reason_or_garbage_is_no_answer() {
        assert_eq!(parse_scrape(b"d14:failure reason25:info_hash is not 20 bytese", &HASH), None);
        assert_eq!(parse_scrape(b"<title>Invalid Request</title>", &HASH), None);
        assert_eq!(parse_scrape(b"", &HASH), None);
        assert_eq!(parse_scrape(&files_body(&HASH, "d8:completei-1e10:incompletei6ee"), &HASH), None);
    }

    #[test]
    fn a_response_for_another_hash_is_not_ours_unless_it_is_the_only_entry() {
        let other = [9u8; 20];
        let body = files_body(&other, "d8:completei1e10:incompletei2ee");
        assert_eq!(parse_scrape(&body, &HASH), Some((1, 2)));
        let mut two = b"d5:filesd20:".to_vec();
        two.extend_from_slice(&other);
        two.extend_from_slice(b"d8:completei1e10:incompletei2e20:");
        two.extend_from_slice(&[8u8; 20]);
        two.extend_from_slice(b"d8:completei3e10:incompletei4eee");
        assert_eq!(parse_scrape(&two, &HASH), None);
    }

    #[test]
    fn deeply_nested_input_is_refused() {
        let mut body = vec![b'l'; 100];
        body.extend(vec![b'e'; 100]);
        assert_eq!(parse_bencode(&body, 0), None);
    }

    #[test]
    fn announce_urls_become_scrape_urls_keeping_passkeys_and_queries() {
        let hash: String = HASH.iter().map(|b| format!("%{b:02X}")).collect();
        let url = |s: &str| scrape_url(&Url::parse(s).unwrap(), &HASH).map(|u| u.to_string());
        assert_eq!(url("http://nyaa.tracker.wf:7777/announce"), Some(format!("http://nyaa.tracker.wf:7777/scrape?info_hash={hash}")));
        assert_eq!(url("http://t.example/abc123/announce?k=v"), Some(format!("http://t.example/abc123/scrape?k=v&info_hash={hash}")));
        assert_eq!(url("http://t.example/tracker"), None);
    }

    #[test]
    fn udp_messages_follow_the_wire_format() {
        let connect = udp_connect_request(7);
        assert_eq!(&connect[..8], &0x41727101980u64.to_be_bytes());
        assert_eq!(&connect[8..12], &0u32.to_be_bytes());
        assert_eq!(&connect[12..], &7u32.to_be_bytes());

        let mut reply = Vec::new();
        reply.extend_from_slice(&0u32.to_be_bytes());
        reply.extend_from_slice(&7u32.to_be_bytes());
        reply.extend_from_slice(&0xdead_beef_u64.to_be_bytes());
        assert_eq!(parse_udp_connect(&reply, 7), Some(0xdead_beef));
        assert_eq!(parse_udp_connect(&reply, 8), None);

        let req = udp_scrape_request(0xdead_beef, 9, &HASH);
        assert_eq!(&req[..8], &0xdead_beef_u64.to_be_bytes());
        assert_eq!(&req[8..12], &2u32.to_be_bytes());
        assert_eq!(&req[12..16], &9u32.to_be_bytes());
        assert_eq!(&req[16..], &HASH);

        let mut scrape = Vec::new();
        scrape.extend_from_slice(&2u32.to_be_bytes());
        scrape.extend_from_slice(&9u32.to_be_bytes());
        scrape.extend_from_slice(&120u32.to_be_bytes());
        scrape.extend_from_slice(&5000u32.to_be_bytes());
        scrape.extend_from_slice(&33u32.to_be_bytes());
        assert_eq!(parse_udp_scrape(&scrape, 9), Some((120, 33)));
        assert_eq!(parse_udp_scrape(&scrape, 10), None);

        let mut error = Vec::new();
        error.extend_from_slice(&3u32.to_be_bytes());
        error.extend_from_slice(&9u32.to_be_bytes());
        error.extend_from_slice(b"nope");
        assert_eq!(parse_udp_scrape(&error, 9), None);
    }

    #[test]
    fn only_public_addresses_are_public() {
        for ip in ["127.0.0.1", "10.1.2.3", "192.168.0.1", "172.16.0.1", "169.254.169.254", "100.64.0.1", "0.0.0.0", "::1", "fc00::1", "fe80::1", "::ffff:10.0.0.1"] {
            assert!(!is_public(ip.parse().unwrap()), "{ip}");
        }
        for ip in ["1.1.1.1", "8.8.8.8", "2606:4700::1111"] {
            assert!(is_public(ip.parse().unwrap()), "{ip}");
        }
    }

    #[test]
    fn trackers_on_private_addresses_are_never_contacted() {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let port = listener.local_addr().unwrap().port();
        for host in ["127.0.0.1", "localhost", "[::1]"] {
            assert_eq!(scrape(&format!("http://{host}:{port}/announce"), &HASH), None, "{host}");
        }
        assert!(listener.accept().is_err(), "a connection reached the private listener");
    }

    #[test]
    fn only_tracker_schemes_are_accepted() {
        assert!(normalize("http://a.example/announce").is_some());
        assert!(normalize("udp://a.example:80/announce").is_some());
        assert!(normalize("file:///etc/passwd").is_none());
        assert!(normalize("ftp://a.example/announce").is_none());
        assert!(normalize("not a url").is_none());
        assert!(normalize(&format!("http://a.example/{}", "x".repeat(300))).is_none());
    }
}
