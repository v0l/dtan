use crate::event::{Event, Filter};
use crate::nip19;
use crate::ssr::{assemble, escape_html, head_tags, Renderer};
use crate::store::Store;
use crate::upstream::Upstream;
use axum::extract::ws::{Message, WebSocket, WebSocketUpgrade};
use axum::extract::{Request, State};
use axum::http::{header, HeaderMap, StatusCode};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use axum::Router;
use serde_json::{json, Value};
use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;
use tower_http::compression::CompressionLayer;
use tower_http::services::ServeDir;

const SITEMAP_TORRENTS: usize = 2000;
const ON_DEMAND_TIMEOUT: Duration = Duration::from_secs(3);

pub struct App {
    pub store: Store,
    pub upstream: Upstream,
    pub renderer: Option<Renderer>,
    pub dist: PathBuf,
    pub public_url: Option<String>,
}

pub type Shared = Arc<App>;

pub fn router(app: Shared) -> Router {
    let assets = ServeDir::new(app.dist.join("client")).append_index_html_on_directories(false);
    Router::new()
        .route("/sitemap.xml", get(sitemap))
        .route("/", get(root))
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

async fn root(State(app): State<Shared>, ws: Result<WebSocketUpgrade, axum::extract::ws::rejection::WebSocketUpgradeRejection>, headers: HeaderMap, req: Request) -> Response {
    match ws {
        Ok(ws) => ws.on_upgrade(move |socket| relay_socket(socket, app)),
        Err(_) => page_for(app, headers, req.uri().path_and_query().map(|p| p.to_string()).unwrap_or_else(|| "/".into())).await,
    }
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
                app.upstream.want_profiles(authors.iter().filter_map(|a| a.as_str().map(str::to_string)));
            }
        } else if app.upstream.should_try(&m.to_string()) {
            blocking.push(m.clone());
        }
    }
    if blocking.is_empty() {
        return false;
    }
    app.upstream.fetch(blocking, ON_DEMAND_TIMEOUT).await > 0
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
        for tag in r.categories().await.unwrap_or_default() {
            urls.push((format!("{origin}/search?tags={tag}"), None, "daily", "0.5"));
        }
    }
    for ev in app.store.query(&[Filter { kinds: Some(vec![2003]), limit: Some(SITEMAP_TORRENTS), ..Default::default() }]) {
        if let Some(link) = nip19::nevent(&ev.id, &ev.pubkey, ev.kind) {
            let lastmod = chrono_iso(ev.created_at);
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

async fn relay_socket(mut socket: WebSocket, app: Shared) {
    while let Some(Ok(msg)) = socket.recv().await {
        let Message::Text(text) = msg else { continue };
        let Ok(Value::Array(parts)) = serde_json::from_str::<Value>(&text) else { continue };
        let reply = |v: Value| Message::text(v.to_string());
        match parts.first().and_then(Value::as_str) {
            Some("REQ") if parts.len() >= 2 => {
                let sub = parts[1].clone();
                let filters: Vec<Filter> = parts[2..].iter().filter_map(Filter::from_json).collect();
                for ev in app.store.query(&filters) {
                    if socket.send(reply(json!(["EVENT", sub, ev.as_ref()]))).await.is_err() {
                        return;
                    }
                }
                if socket.send(reply(json!(["EOSE", sub]))).await.is_err() {
                    return;
                }
            }
            Some("EVENT") if parts.len() >= 2 => {
                let ev: Option<Event> = serde_json::from_value(parts[1].clone()).ok();
                let (id, ok, why) = match ev {
                    Some(ev) if matches!(ev.kind, 0 | 2003 | 1111 | 9735) => {
                        let id = ev.id.clone();
                        let ok = app.upstream.ingest(ev);
                        (id, ok, if ok { "" } else { "duplicate or invalid" })
                    }
                    Some(ev) => (ev.id, false, "blocked: kind not accepted"),
                    None => (String::new(), false, "invalid: bad event"),
                };
                if socket.send(reply(json!(["OK", id, ok, why]))).await.is_err() {
                    return;
                }
            }
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::event::testing::*;
    use axum::body::{to_bytes, Body};
    use tower::ServiceExt;

    fn dist() -> PathBuf {
        PathBuf::from(concat!(env!("CARGO_MANIFEST_DIR"), "/../dist"))
    }

    fn app(renderer: bool) -> Option<Shared> {
        if !dist().join("client/index.html").exists() || (renderer && !dist().join("ssr/render.js").exists()) {
            eprintln!("skipping: run `bun run build` first");
            return None;
        }
        let store = Store::new(0);
        let upstream = Upstream::new(vec![], store.clone(), 10);
        let renderer = renderer.then(|| Renderer::start(dist().join("ssr/render.js"), 1, store.clone()));
        Some(Arc::new(App { store, upstream, renderer, dist: dist(), public_url: Some("https://dtan.xyz".into()) }))
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
        app.upstream.ingest(signed(1, 1_600_000_000, 0, vec![], "{\"name\":\"alice\"}"));
        app.upstream.ingest(t.clone());
        let (status, body) = get_page(app.clone(), "/").await;
        assert_eq!(status, 200);
        assert!(body.contains("Ubuntu Desktop ISO"), "torrent title is in the html");
        assert!(body.contains("2023-11-14"), "dates are rendered deterministically");
        assert!(body.contains("<title>DTAN.XYZ</title>"));
        assert!(body.contains("id=\"ssr-data\""));
        assert!(body.contains("rel=\"canonical\" href=\"https://dtan.xyz/\""));
        let link = nip19::nevent(&t.id, &t.pubkey, 2003).unwrap();
        let (status, detail) = get_page(app.clone(), &format!("/e/{link}")).await;
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
        let (status, _) = get_page(app, &format!("/e/{}", nip19::nevent(&"cc".repeat(32), &"dd".repeat(32), 2003).unwrap())).await;
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
    async fn the_sitemap_lists_stored_torrents() {
        let Some(app) = app(true) else { return };
        let t = torrent(1, 1_700_000_000, "x", vec![]);
        app.upstream.ingest(t.clone());
        let (status, xml) = get_page(app, "/sitemap.xml").await;
        assert_eq!(status, 200);
        assert!(xml.contains("<loc>https://dtan.xyz/categories</loc>"));
        assert!(xml.contains(&format!("/e/{}", nip19::nevent(&t.id, &t.pubkey, 2003).unwrap())));
        assert!(xml.contains("<lastmod>2023-11-14T22:13:20Z</lastmod>"));
    }

    #[tokio::test]
    async fn a_page_is_rendered_in_well_under_a_network_round_trip() {
        let Some(app) = app(true) else { return };
        for i in 0..300 {
            app.upstream.ingest(torrent(1, 1_700_000_000 + i, &format!("Torrent {i}"), vec![vec!["t", "movie"]]));
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
