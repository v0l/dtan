use crate::mirror::{Mirror, TORRENT};
use crate::ssr::{assemble, escape_html, head_tags, Renderer};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use nostr::nips::nip19::{Nip19Event, ToBech32};
use nostr::prelude::*;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;

const SITEMAP_TORRENTS: usize = 2000;
const ON_DEMAND_TIMEOUT: Duration = Duration::from_secs(3);

pub struct App {
    pub mirror: Mirror,
    pub renderer: Option<Renderer>,
    pub dist: PathBuf,
    pub public_url: Option<String>,
}

pub type Shared = Arc<App>;

pub fn router(app: Shared) -> Router {
    let assets = ServeDir::new(app.dist.join("client")).append_index_html_on_directories(false);
    Router::new()
        .route("/sitemap.xml", get(sitemap))
        .fallback_service(assets.fallback(get(page).with_state(app.clone())))
        .layer(axum::middleware::map_response(cache_assets))
        .layer(CompressionLayer::new())
        .with_state(app)
}

async fn cache_assets(req_path: axum::extract::OriginalUri, mut res: Response) -> Response {
    if req_path.0.path().starts_with("/assets/") && res.status() == StatusCode::OK {
        res.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=31536000, immutable".parse().unwrap());
    }
    res
}

fn nevent(ev: &Event) -> Nip19Event {
    Nip19Event::new(ev.id).author(ev.pubkey).kind(ev.kind)
}

fn origin(app: &App, headers: &HeaderMap) -> String {
    if let Some(u) = &app.public_url {
        return u.trim_end_matches('/').to_string();
    }
    let host = headers.get(header::HOST).and_then(|h| h.to_str().ok()).unwrap_or("localhost");
    format!("http://{host}")
}

fn shell(app: &App) -> Option<String> {
    std::fs::read_to_string(app.dist.join("client/index.html")).ok()
}

fn plain_shell(shell: &str) -> String {
    shell.replace("<!--app-html-->", "")
}

fn html(status: u16, body: String) -> Response {
    let mut res = (StatusCode::from_u16(status).unwrap_or(StatusCode::OK), [(header::CONTENT_TYPE, "text/html; charset=utf-8")], body).into_response();
    if status == 200 {
        res.headers_mut().insert(header::CACHE_CONTROL, "public, max-age=30".parse().unwrap());
    }
    res
}

async fn page(State(app): State<Shared>, headers: HeaderMap, req: Request) -> Response {
    page_for(app, headers, req.uri().path_and_query().map(|p| p.to_string()).unwrap_or_else(|| "/".into())).await
}

fn is_lookup(filter: &Value) -> bool {
    filter.get("search").is_none()
}

async fn resolve_misses(app: &App, misses: &[Value]) -> bool {
    let mut blocking = Vec::new();
    for m in misses.iter().filter(|m| is_lookup(m)) {
        let only_profiles = m.get("kinds").and_then(Value::as_array).is_some_and(|k| k == &[json!(0)]);
        if only_profiles {
            if let Some(authors) = m.get("authors").and_then(Value::as_array) {
                app.mirror.want_profiles(authors.iter().filter_map(|a| a.as_str().and_then(|a| PublicKey::from_hex(a).ok())));
            }
        } else if app.mirror.should_try(&m.to_string()) {
            if let Some((filter, _)) = crate::mirror::parse_filter(m) {
                blocking.push(filter);
            }
        }
    }
    if blocking.is_empty() {
        return false;
    }
    app.mirror.fetch(blocking, ON_DEMAND_TIMEOUT).await > 0
}

pub async fn page_for(app: Shared, headers: HeaderMap, url: String) -> Response {
    let Some(shell_html) = shell(&app) else {
        return (StatusCode::INTERNAL_SERVER_ERROR, "client build missing").into_response();
    };
    let Some(renderer) = &app.renderer else {
        return html(200, plain_shell(&shell_html));
    };
    let mut out = match renderer.render(&url).await {
        Ok(o) => o,
        Err(e) => {
            tracing::error!("render {url}: {e}");
            return html(200, plain_shell(&shell_html));
        }
    };
    if !out.misses.is_empty() && resolve_misses(&app, &out.misses).await {
        match renderer.render(&url).await {
            Ok(o) => out = o,
            Err(e) => tracing::error!("re-render {url}: {e}"),
        }
    }
    let origin = origin(&app, &headers);
    let tags = head_tags(&out.head, &origin, out.status);
    html(out.status, assemble(&shell_html, &out.html, &tags, &out.data))
}

async fn sitemap(State(app): State<Shared>, headers: HeaderMap) -> Response {
    let origin = origin(&app, &headers);
    let mut urls: Vec<(String, Option<String>, &str, &str)> = vec![
        (format!("{origin}/"), None, "hourly", "1.0"),
        (format!("{origin}/categories"), None, "weekly", "0.6"),
        (format!("{origin}/relays"), None, "monthly", "0.2"),
    ];
    if let Some(r) = &app.renderer {
        for path in r.categories().await.unwrap_or_default() {
            urls.push((format!("{origin}{path}"), None, "daily", "0.5"));
        }
    }
    let newest = app.mirror.query(&[json!({"kinds": [TORRENT], "limit": SITEMAP_TORRENTS})]).await;
    for ev in newest {
        if let Ok(link) = nevent(&ev).to_bech32() {
            let lastmod = chrono_iso(ev.created_at.as_secs() as i64);
            urls.push((format!("{origin}/e/{link}"), Some(lastmod), "monthly", "0.7"));
        }
    }
    let body: String = urls
        .iter()
        .map(|(loc, lastmod, freq, prio)| {
            let lm = lastmod.as_ref().map(|l| format!("<lastmod>{l}</lastmod>")).unwrap_or_default();
            format!("  <url><loc>{}</loc>{lm}<changefreq>{freq}</changefreq><priority>{prio}</priority></url>\n", escape_html(loc))
        })
        .collect();
    let xml = format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<urlset xmlns=\"http://www.sitemaps.org/schemas/sitemap/0.9\">\n{body}</urlset>\n");
    ([(header::CONTENT_TYPE, "application/xml; charset=utf-8"), (header::CACHE_CONTROL, "public, max-age=300")], xml).into_response()
}

pub fn chrono_iso(secs: i64) -> String {
    let days = secs.div_euclid(86_400);
    let rem = secs.rem_euclid(86_400);
    let z = days + 719_468;
    let era = z.div_euclid(146_097);
    let doe = z.rem_euclid(146_097);
    let yoe = (doe - doe / 1460 + doe / 36_524 - doe / 146_096) / 365;
    let y = yoe + era * 400;
    let doy = doe - (365 * yoe + yoe / 4 - yoe / 100);
    let mp = (5 * doy + 2) / 153;
    let d = doy - (153 * mp + 2) / 5 + 1;
    let m = if mp < 10 { mp + 3 } else { mp - 9 };
    let y = if m <= 2 { y + 1 } else { y };
    format!("{y:04}-{m:02}-{d:02}T{:02}:{:02}:{:02}Z", rem / 3600, rem % 3600 / 60, rem % 60)
}

#[cfg(test)]
mod tests {
    use super::*;
        use axum::body::{to_bytes, Body};
    use nostr_database::NostrDatabase;
    use tower::ServiceExt;

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

    fn profile(n: u8, name: &str) -> Event {
        EventBuilder::new(Kind::Metadata, format!("{{\"name\":\"{name}\"}}")).custom_created_at(Timestamp::from_secs(1_600_000_000)).finalize(&keys(n)).unwrap()
    }

    fn link(ev: &Event) -> String {
        nevent(ev).to_bech32().unwrap()
    }

    fn dist() -> PathBuf {
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist"))
    }

    fn app(renderer: bool) -> Option<Shared> {
        if !dist().join("client/index.html").exists() || (renderer && !dist().join("ssr/render.js").exists()) {
            eprintln!("skipping: run `bun run build` first");
            return None;
        }
        let mirror = Mirror::new(0, None);
        let renderer = renderer.then(|| Renderer::start(dist().join("ssr/render.js"), 1, mirror.clone()));
        Some(Arc::new(App { mirror, renderer, dist: dist(), public_url: Some("https://dtan.xyz".into()) }))
    }

    async fn get_page(app: Shared, uri: &str) -> (u16, String) {
        let res = router(app).oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        let status = res.status().as_u16();
        (status, String::from_utf8(to_bytes(res.into_body(), usize::MAX).await.unwrap().to_vec()).unwrap())
    }

    #[test]
    fn unix_seconds_format_as_utc_iso() {
        assert_eq!(chrono_iso(0), "1970-01-01T00:00:00Z");
        assert_eq!(chrono_iso(1_709_164_800), "2024-02-29T00:00:00Z");
        assert_eq!(chrono_iso(1_700_000_000), "2023-11-14T22:13:20Z");
    }

    #[tokio::test]
    async fn a_missing_renderer_serves_the_plain_shell_with_200() {
        let Some(app) = app(false) else { return };
        let (status, body) = get_page(app, "/anything").await;
        assert_eq!(status, 200);
        assert!(body.contains("<div id=\"root\"></div>"));
    }

    #[tokio::test]
    async fn the_home_page_is_rendered_from_the_in_memory_store_with_no_network() {
        let Some(app) = app(true) else { return };
        let t = torrent(1, 1_700_000_000, "Ubuntu Desktop ISO", vec![vec!["t", "application"]]);
        app.mirror.database.save_event(&profile(1, "alice")).await.unwrap();
        app.mirror.database.save_event(&t).await.unwrap();
        let (status, body) = get_page(app.clone(), "/").await;
        assert_eq!(status, 200);
        assert!(body.contains("Ubuntu Desktop ISO"), "torrent title is in the html");
        assert!(body.contains("2023-11-14"), "dates are rendered deterministically");
        assert!(body.contains("<title>DTAN.XYZ</title>"));
        assert!(body.contains("id=\"ssr-data\""));
        assert!(body.contains("rel=\"canonical\" href=\"https://dtan.xyz/\""));
        let detail_link = link(&t);
        let (status, detail) = get_page(app.clone(), &format!("/e/{detail_link}")).await;
        assert_eq!(status, 200);
        assert!(detail.contains("<title>Ubuntu Desktop ISO | DTAN.XYZ</title>"));
        assert!(detail.contains("alice"), "profile comes from the store");
        assert!(detail.contains("property=\"og:type\" content=\"article\""));
    }

    #[tokio::test]
    async fn unknown_routes_and_bad_links_are_real_404s() {
        let Some(app) = app(true) else { return };
        let (status, body) = get_page(app.clone(), "/nope/nothing").await;
        assert_eq!(status, 404);
        assert!(body.contains("noindex"));
        let (status, _) = get_page(app.clone(), "/e/garbage").await;
        assert_eq!(status, 404);
        let (status, _) = get_page(app, &format!("/e/{}", link(&torrent(9, 5, "never stored", vec![])))).await;
        assert_eq!(status, 404);
    }

    #[tokio::test]
    async fn built_assets_are_cached_immutably_and_pages_are_not() {
        let Some(app) = app(false) else { return };
        let asset = std::fs::read_dir(dist().join("client/assets")).unwrap().next().unwrap().unwrap().file_name();
        let res = router(app.clone()).oneshot(Request::get(format!("/assets/{}", asset.to_string_lossy())).body(Body::empty()).unwrap()).await.unwrap();
        assert_eq!(res.headers()[header::CACHE_CONTROL], "public, max-age=31536000, immutable");
        let res = router(app).oneshot(Request::get("/robots.txt").body(Body::empty()).unwrap()).await.unwrap();
        assert!(res.headers().get(header::CACHE_CONTROL).is_none_or(|v| !v.to_str().unwrap().contains("immutable")));
    }

    #[tokio::test]
    async fn category_paths_render_their_torrents_and_unknown_ones_are_404() {
        let Some(app) = app(true) else { return };
        let hd = torrent(1, 1_700_000_000, "Some HD Film", vec![vec!["t", "video"], vec!["i", "tcat:video,movie,hd"]]);
        app.mirror.database.save_event(&hd).await.unwrap();
        let (status, body) = get_page(app.clone(), "/video/movie/hd").await;
        assert_eq!(status, 200);
        assert!(body.contains("<title>Video &gt; Movies &gt; HD Movies | DTAN.XYZ</title>"));
        assert!(body.contains("Some HD Film"));
        assert!(body.contains("rel=\"canonical\" href=\"https://dtan.xyz/video/movie/hd\""));
        let (status, top) = get_page(app.clone(), "/video").await;
        assert_eq!(status, 200);
        assert!(top.contains("Some HD Film"));
        assert_eq!(get_page(app.clone(), "/video/nonsense").await.0, 404);
        assert_eq!(get_page(app, "/movie").await.0, 404);
    }

    #[tokio::test]
    async fn the_sitemap_lists_stored_torrents() {
        let Some(app) = app(true) else { return };
        let t = torrent(1, 1_700_000_000, "x", vec![]);
        app.mirror.database.save_event(&t).await.unwrap();
        let (status, xml) = get_page(app, "/sitemap.xml").await;
        assert_eq!(status, 200);
        assert!(xml.contains("<loc>https://dtan.xyz/categories</loc>"));
        assert!(xml.contains("<loc>https://dtan.xyz/video/movie/4k</loc>"));
        assert!(xml.contains(&format!("/e/{}", link(&t))));
        assert!(xml.contains("<lastmod>2023-11-14T22:13:20Z</lastmod>"));
    }

    #[tokio::test]
    async fn a_page_is_rendered_in_well_under_a_network_round_trip() {
        let Some(app) = app(true) else { return };
        for i in 0..300 {
            app.mirror.database.save_event(&torrent(1, 1_700_000_000 + i, &format!("Torrent {i}"), vec![vec!["t", "movie"]])).await.unwrap();
        }
        get_page(app.clone(), "/").await;
        let start = std::time::Instant::now();
        for _ in 0..10 {
            get_page(app.clone(), "/").await;
        }
        let per_page = start.elapsed() / 10;
        eprintln!("home page render: {per_page:?}");
        assert!(per_page < Duration::from_millis(200));
    }
}
