use crate::mirror::Mirror;
use rquickjs::{Context, Function, Runtime};
use serde::Deserialize;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};
use std::sync::{mpsc, Arc, Mutex};
use std::time::SystemTime;

const MEMORY_LIMIT: usize = 256 * 1024 * 1024;
const STACK_LIMIT: usize = 4 * 1024 * 1024;
pub const SITE: &str = "DTAN.XYZ";
pub const DEFAULT_DESCRIPTION: &str = "Torrents on Nostr";

#[derive(Debug, Clone, Default, Deserialize, PartialEq)]
pub struct Head {
    pub title: Option<String>,
    pub description: Option<String>,
    pub path: Option<String>,
    #[serde(rename = "type")]
    pub kind: Option<String>,
    pub image: Option<String>,
    pub published: Option<String>,
    pub modified: Option<String>,
    pub noindex: Option<bool>,
}

#[derive(Debug, Clone, Deserialize)]
pub struct Output {
    pub html: String,
    pub status: u16,
    pub head: Head,
    pub data: Value,
    #[serde(default)]
    pub misses: Vec<Value>,
}

enum Call {
    Render(String),
    Categories,
}

struct Job {
    call: Call,
    reply: tokio::sync::oneshot::Sender<Result<String, String>>,
}

#[derive(Clone)]
pub struct Renderer {
    tx: mpsc::SyncSender<Job>,
}

fn modified(path: &Path) -> Option<SystemTime> {
    std::fs::metadata(path).and_then(|m| m.modified()).ok()
}

pub fn run_filters(mirror: &Mirror, handle: &tokio::runtime::Handle, filters_json: &str, misses: &Mutex<Vec<Value>>) -> String {
    let parsed: Vec<Value> = serde_json::from_str(filters_json).unwrap_or_default();
    let events = handle.block_on(mirror.query(&parsed));
    if events.is_empty() {
        misses.lock().unwrap().extend(parsed);
    }
    let mut out = String::from("[");
    for (i, ev) in events.iter().enumerate() {
        if i > 0 {
            out.push(',');
        }
        out.push_str(&ev.as_json());
    }
    out.push(']');
    out
}

struct Engine {
    _rt: Runtime,
    ctx: Context,
    loaded: Option<SystemTime>,
    misses: Arc<Mutex<Vec<Value>>>,
}

impl Engine {
    fn load(bundle: &Path, mirror: Mirror, handle: tokio::runtime::Handle) -> Result<Engine, String> {
        let source = std::fs::read_to_string(bundle).map_err(|e| format!("{}: {e}", bundle.display()))?;
        let rt = Runtime::new().map_err(|e| e.to_string())?;
        rt.set_memory_limit(MEMORY_LIMIT);
        rt.set_max_stack_size(STACK_LIMIT);
        let ctx = Context::full(&rt).map_err(|e| e.to_string())?;
        let misses: Arc<Mutex<Vec<Value>>> = Default::default();
        let m = misses.clone();
        ctx.with(|ctx| {
            let query = Function::new(ctx.clone(), move |filters: String| -> String { run_filters(&mirror, &handle, &filters, &m) }).map_err(|e| e.to_string())?;
            ctx.globals().set("relayQuery", query).map_err(|e| e.to_string())?;
            let log = Function::new(ctx.clone(), |level: String, msg: String| tracing::warn!("ssr {level}: {msg}")).map_err(|e| e.to_string())?;
            ctx.globals().set("hostLog", log).map_err(|e| e.to_string())?;
            ctx.eval::<(), _>(source.as_str()).map_err(|e| format!("loading {}: {e} {:?}", bundle.display(), ctx.catch()))?;
            ctx.globals().get::<_, Function>("ssrRender").map_err(|_| format!("{} does not define ssrRender", bundle.display()))?;
            Ok::<_, String>(())
        })?;
        Ok(Engine { _rt: rt, ctx, loaded: modified(bundle), misses })
    }

    fn call(&self, name: &str, arg: &str) -> Result<String, String> {
        self.ctx.with(|ctx| {
            let f: Function = ctx.globals().get(name).map_err(|e| e.to_string())?;
            f.call((arg,)).map_err(|e| format!("{e} {:?}", ctx.catch()))
        })
    }

    fn run(&self, call: &Call) -> Result<String, String> {
        match call {
            Call::Categories => self.call("ssrCategories", ""),
            Call::Render(input) => {
                self.misses.lock().unwrap().clear();
                let out = self.call("ssrRender", input)?;
                let mut v: Value = serde_json::from_str(&out).map_err(|e| format!("render output: {e}"))?;
                v["misses"] = Value::Array(std::mem::take(&mut *self.misses.lock().unwrap()));
                Ok(v.to_string())
            }
        }
    }
}

impl Renderer {
    pub fn start(bundle: PathBuf, workers: usize, mirror: Mirror) -> Renderer {
        let handle = tokio::runtime::Handle::current();
        let (tx, rx) = mpsc::sync_channel::<Job>(64);
        let rx = Arc::new(Mutex::new(rx));
        for n in 0..workers.max(1) {
            let rx = rx.clone();
            let bundle = bundle.clone();
            let mirror = mirror.clone();
            let handle = handle.clone();
            std::thread::Builder::new()
                .name(format!("ssr-{n}"))
                .spawn(move || {
                    let mut engine: Option<Engine> = None;
                    loop {
                        let job = match rx.lock().unwrap().recv() {
                            Ok(j) => j,
                            Err(_) => return,
                        };
                        if engine.as_ref().map(|e| e.loaded != modified(&bundle)).unwrap_or(true) {
                            engine = match Engine::load(&bundle, mirror.clone(), handle.clone()) {
                                Ok(e) => Some(e),
                                Err(e) => {
                                    let _ = job.reply.send(Err(e));
                                    continue;
                                }
                            };
                        }
                        let result = engine.as_ref().map(|e| e.run(&job.call)).unwrap_or_else(|| Err("no engine".into()));
                        if result.is_err() {
                            engine = None;
                        }
                        let _ = job.reply.send(result);
                    }
                })
                .expect("spawn ssr worker");
        }
        Renderer { tx }
    }

    async fn submit(&self, call: Call) -> Result<String, String> {
        let (reply, rx) = tokio::sync::oneshot::channel();
        self.tx.try_send(Job { call, reply }).map_err(|e| format!("renderer busy: {e}"))?;
        rx.await.map_err(|e| e.to_string())?
    }

    pub async fn render(&self, url: &str) -> Result<Output, String> {
        let out = self.submit(Call::Render(json!({ "url": url }).to_string())).await?;
        serde_json::from_str(&out).map_err(|e| format!("render output: {e}"))
    }

    pub async fn categories(&self) -> Result<Vec<String>, String> {
        let out = self.submit(Call::Categories).await?;
        serde_json::from_str(&out).map_err(|e| e.to_string())
    }
}

pub fn escape_html(s: &str) -> String {
    s.replace('&', "&amp;").replace('<', "&lt;").replace('>', "&gt;").replace('"', "&quot;")
}

pub fn script_json(v: &Value) -> String {
    v.to_string().replace('<', "\\u003c").replace('>', "\\u003e").replace('&', "\\u0026").replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029")
}

fn absolute(origin: &str, path: &str) -> String {
    if path.starts_with("http://") || path.starts_with("https://") {
        path.to_string()
    } else {
        format!("{}{}", origin.trim_end_matches('/'), if path.starts_with('/') { path.to_string() } else { format!("/{path}") })
    }
}

pub fn head_tags(head: &Head, origin: &str, status: u16) -> String {
    let title = match &head.title {
        Some(t) if !t.is_empty() => format!("{t} | {SITE}"),
        _ => SITE.to_string(),
    };
    let description = head.description.clone().filter(|d| !d.is_empty()).unwrap_or_else(|| DEFAULT_DESCRIPTION.into());
    let og_title = head.title.clone().filter(|t| !t.is_empty()).unwrap_or_else(|| SITE.to_string());
    let mut out = vec![
        format!("<title>{}</title>", escape_html(&title)),
        format!("<meta name=\"description\" content=\"{}\" />", escape_html(&description)),
    ];
    let noindex = head.noindex.unwrap_or(false) || status >= 400;
    out.push(if noindex {
        "<meta name=\"robots\" content=\"noindex, follow\" />".to_string()
    } else {
        "<meta name=\"robots\" content=\"index, follow, max-image-preview:large\" />".to_string()
    });
    if let Some(path) = head.path.as_deref().filter(|_| status < 400 && !noindex) {
        let url = absolute(origin, path);
        out.push(format!("<link rel=\"canonical\" href=\"{}\" />", escape_html(&url)));
        out.push(format!("<meta property=\"og:url\" content=\"{}\" />", escape_html(&url)));
    }
    let kind = head.kind.clone().unwrap_or_else(|| "website".into());
    out.push(format!("<meta property=\"og:type\" content=\"{}\" />", escape_html(&kind)));
    out.push(format!("<meta property=\"og:site_name\" content=\"{SITE}\" />"));
    out.push(format!("<meta property=\"og:title\" content=\"{}\" />", escape_html(&og_title)));
    out.push(format!("<meta property=\"og:description\" content=\"{}\" />", escape_html(&description)));
    let image = head.image.clone().filter(|i| i.starts_with("http")).unwrap_or_else(|| absolute(origin, "/banner.jpg"));
    out.push(format!("<meta property=\"og:image\" content=\"{}\" />", escape_html(&image)));
    out.push("<meta name=\"twitter:card\" content=\"summary_large_image\" />".into());
    out.push(format!("<meta name=\"twitter:title\" content=\"{}\" />", escape_html(&og_title)));
    out.push(format!("<meta name=\"twitter:description\" content=\"{}\" />", escape_html(&description)));
    if kind == "article" {
        if let Some(p) = &head.published {
            out.push(format!("<meta property=\"article:published_time\" content=\"{}\" />", escape_html(p)));
        }
        if let Some(m) = &head.modified {
            out.push(format!("<meta property=\"article:modified_time\" content=\"{}\" />", escape_html(m)));
        }
    }
    if !noindex {
        if let Some(ld) = json_ld(head, origin, &og_title, &description, &kind) {
            out.push(format!("<script type=\"application/ld+json\">{}</script>", script_json(&ld)));
        }
    }
    out.join("\n    ")
}

fn json_ld(head: &Head, origin: &str, title: &str, description: &str, kind: &str) -> Option<Value> {
    let path = head.path.as_deref()?;
    let url = absolute(origin, path);
    if path == "/" {
        return Some(json!({
            "@context": "https://schema.org",
            "@type": "WebSite",
            "name": SITE,
            "url": url,
            "description": description,
            "potentialAction": {
                "@type": "SearchAction",
                "target": format!("{}/search?q={{search_term_string}}", origin.trim_end_matches('/')),
                "query-input": "required name=search_term_string"
            }
        }));
    }
    if kind == "article" {
        let mut ld = json!({
            "@context": "https://schema.org",
            "@type": "CreativeWork",
            "name": title,
            "description": description,
            "url": url,
            "publisher": { "@type": "Organization", "name": SITE }
        });
        if let Some(p) = &head.published {
            ld["datePublished"] = json!(p);
        }
        return Some(ld);
    }
    Some(json!({ "@context": "https://schema.org", "@type": "WebPage", "name": title, "description": description, "url": url }))
}

fn strip_head_defaults(shell: &str) -> String {
    let mut s = shell.to_string();
    if let (Some(a), Some(b)) = (s.find("<title>"), s.find("</title>")) {
        s.replace_range(a..b + "</title>".len(), "");
    }
    let meta = regex::Regex::new(r#"<meta\s+(?:name|property)="(?:description|og:[a-z:_]+)"[^>]*>"#).unwrap();
    meta.replace_all(&s, "").into_owned()
}

pub fn assemble(shell: &str, body: &str, head: &str, data: &Value) -> String {
    let shell = strip_head_defaults(shell);
    let with_head = match shell.find("</head>") {
        Some(i) => format!("{}    {head}\n  {}", &shell[..i], &shell[i..]),
        None => shell,
    };
    let data_tag = format!("<script id=\"ssr-data\" type=\"application/json\">{}</script>", script_json(data));
    let marker = "<!--app-html-->";
    match with_head.find(marker) {
        Some(i) => format!("{}{body}</div>{data_tag}{}", &with_head[..i], with_head[i + marker.len()..].replacen("</div>", "", 1)),
        None => with_head,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const SHELL: &str = "<!doctype html>\n<html lang=\"en\">\n  <head>\n    <meta charset=\"utf-8\" />\n    <meta name=\"description\" content=\"old\" />\n    <meta property=\"og:url\" content=\"old\" />\n    <meta name=\"og:title\" content=\"old\" />\n    <title>Old</title>\n  </head>\n  <body>\n    <div id=\"root\"><!--app-html--></div>\n    <script type=\"module\" src=\"/assets/a.js\"></script>\n  </body>\n</html>";

    #[test]
    fn the_shell_gets_the_rendered_body_head_tags_and_data_once() {
        let head = Head { title: Some("Ubuntu".into()), description: Some("A \"q\" & <t>".into()), path: Some("/e/nevent1x".into()), kind: Some("article".into()), published: Some("2026-01-02T00:00:00Z".into()), ..Default::default() };
        let tags = head_tags(&head, "https://dtan.xyz", 200);
        let data = json!({ "queries": { "q": [{ "content": "</script><b>" }] } });
        let html = assemble(SHELL, "<main>hi</main>", &tags, &data);
        assert_eq!(html.matches("<title>").count(), 1);
        assert!(html.contains("<title>Ubuntu | DTAN.XYZ</title>"));
        assert!(!html.contains("content=\"old\""));
        assert!(html.contains("content=\"A &quot;q&quot; &amp; &lt;t&gt;\""));
        assert!(html.contains("<link rel=\"canonical\" href=\"https://dtan.xyz/e/nevent1x\" />"));
        assert!(html.contains("<meta property=\"article:published_time\" content=\"2026-01-02T00:00:00Z\" />"));
        assert!(html.contains("<div id=\"root\"><main>hi</main></div><script id=\"ssr-data\""));
        assert!(!html.contains("</script><b>"));
        assert!(html.contains("\\u003c/script\\u003e"));
        assert!(html.contains("<script type=\"module\" src=\"/assets/a.js\"></script>"));
    }

    #[test]
    fn indexable_pages_carry_json_ld_and_noindex_pages_do_not() {
        let home = Head { path: Some("/".into()), ..Default::default() };
        let tags = head_tags(&home, "https://dtan.xyz", 200);
        assert!(tags.contains("application/ld+json"));
        assert!(tags.contains("\"@type\":\"WebSite\""));
        assert!(tags.contains("SearchAction"));
        let torrent = Head { title: Some("T".into()), path: Some("/e/x".into()), kind: Some("article".into()), published: Some("2026-01-01T00:00:00Z".into()), ..Default::default() };
        let tags = head_tags(&torrent, "https://dtan.xyz", 200);
        assert!(tags.contains("\"@type\":\"CreativeWork\"") && tags.contains("datePublished"));
        let login = Head { path: Some("/login".into()), noindex: Some(true), ..Default::default() };
        assert!(!head_tags(&login, "https://dtan.xyz", 200).contains("ld+json"));
    }

    #[test]
    fn error_pages_are_noindex_without_canonical() {
        let head = Head { path: Some("/x".into()), ..Default::default() };
        let tags = head_tags(&head, "https://dtan.xyz", 404);
        assert!(tags.contains("noindex"));
        assert!(!tags.contains("canonical"));
    }
}
