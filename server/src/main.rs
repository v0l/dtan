mod swarm;
mod tracker;

use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let config = nostr_ssr::config::Config::load()?;
    let plugins: Vec<Arc<dyn nostr_ssr::plugin::Plugin>> = vec![Arc::new(swarm::SwarmPlugin::live())];
    nostr_ssr::serve::serve(config, plugins).await
}

#[cfg(test)]
mod header_tests {
    use axum::body::Body;
    use axum::http::Request;
    use nostr_ssr::config::Config;
    use nostr_ssr::engine::Renderer;
    use nostr_ssr::mirror::Mirror;
    use nostr_ssr::web::{router, App};
    use tower::ServiceExt;

    const SHELL: &str = "<html><head><title>x</title></head><body><div id=\"root\"><!--app-html--></div></body></html>";
    const BUNDLE: &str = r#"globalThis.ssrRender = (json) => JSON.stringify({ html: "<p>ok</p>", status: 200, head: { title: "T" }, data: {} });
globalThis.ssrPaths = () => "[]";"#;

    fn app() -> nostr_ssr::web::Shared {
        let dir = std::env::temp_dir().join(format!("dtan-headers-{}", std::process::id()));
        std::fs::create_dir_all(dir.join("client/assets")).unwrap();
        std::fs::create_dir_all(dir.join("ssr")).unwrap();
        std::fs::write(dir.join("client/index.html"), SHELL).unwrap();
        std::fs::write(dir.join("client/assets/a.js"), "x").unwrap();
        std::fs::write(dir.join("ssr/render.js"), BUNDLE).unwrap();
        let ssr_json = concat!(env!("CARGO_MANIFEST_DIR"), "/../ssr.json");
        let mut config: Config = serde_json::from_str(&std::fs::read_to_string(ssr_json).unwrap()).unwrap();
        config.dist = dir;
        let mirror = Mirror::new(0, None, &[]);
        let renderer = Renderer::start(config.bundle_path(), 1, mirror.clone());
        App::new(config, mirror, Some(renderer))
    }

    async fn headers_of(uri: &str) -> axum::http::HeaderMap {
        let res = router(app()).oneshot(Request::get(uri).body(Body::empty()).unwrap()).await.unwrap();
        res.headers().clone()
    }

    #[tokio::test]
    async fn pages_carry_the_csp_and_hardening_headers() {
        let csp = |h: &axum::http::HeaderMap| h["content-security-policy"].to_str().unwrap().to_string();
        for uri in ["/", "/e/nevent1qqsqqqqqqp20kauq3smf4kxh9494txhduuupcs7tjud08rknuza9m6qzyzzphuwav0vy4xryadstd7fq5vzzjqxs9rqnm2j63rn07c5920ujvqcyqqqq05c3keepf", "/assets/a.js"] {
            let h = headers_of(uri).await;
            let policy = csp(&h);
            assert!(policy.contains("frame-ancestors 'none'"), "{uri}");
            assert!(policy.contains("frame-src https://wt-player.pages.dev"), "{uri}");
            assert!(policy.contains("upgrade-insecure-requests"), "{uri}");
            assert_eq!(h["x-frame-options"], "DENY", "{uri}");
            assert_eq!(h["x-content-type-options"], "nosniff", "{uri}");
            assert_eq!(h["cross-origin-opener-policy"], "same-origin", "{uri}");
            assert_eq!(h["referrer-policy"], "strict-origin-when-cross-origin", "{uri}");
            assert!(h["permissions-policy"].to_str().unwrap().contains("autoplay=*"), "{uri}");
        }
    }
}
