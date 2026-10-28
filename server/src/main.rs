mod event;
mod nip19;
mod ssr;
mod store;
mod upstream;
mod web;

use std::path::PathBuf;
use std::sync::Arc;

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let _ = rustls::crypto::ring::default_provider().install_default();

    let dist = PathBuf::from(env("DIST", "dist"));
    let bind = env("BIND", "0.0.0.0:3000");
    let relays: Vec<String> = env("RELAYS", "wss://nos.lol,wss://relay.damus.io,wss://relay.primal.net,wss://relay.snort.social,wss://relay.dtan.xyz")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let max_events: usize = env("MAX_EVENTS", "200000").parse().expect("MAX_EVENTS");
    let backfill: usize = env("BACKFILL", "5000").parse().expect("BACKFILL");
    let workers: usize = env("SSR_WORKERS", "2").parse().expect("SSR_WORKERS");
    let public_url = std::env::var("PUBLIC_URL").ok().filter(|s| !s.is_empty());

    let store = store::Store::new(max_events);
    let upstream = upstream::Upstream::new(relays, store.clone(), backfill);
    upstream.start();
    let bundle = PathBuf::from(env("SSR_BUNDLE", &dist.join("ssr/render.js").to_string_lossy()));
    let renderer = ssr::Renderer::start(bundle, workers, store.clone());

    let app = Arc::new(web::App { store, upstream, renderer: Some(renderer), dist, public_url });
    let listener = tokio::net::TcpListener::bind(&bind).await.expect("bind");
    tracing::info!("listening on {bind}");
    axum::serve(listener, web::router(app)).await.expect("serve");
}
