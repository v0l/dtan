mod mirror;
mod ssr;
mod web;

use std::path::PathBuf;
use std::sync::Arc;

fn env(name: &str, default: &str) -> String {
    std::env::var(name).unwrap_or_else(|_| default.to_string())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(tracing_subscriber::EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let _ = rustls::crypto::ring::default_provider().install_default();

    let dist = PathBuf::from(env("DIST", "dist"));
    let bind = env("BIND", "0.0.0.0:3000");
    let relays: Vec<String> = env("RELAYS", "wss://nos.lol,wss://relay.damus.io,wss://relay.primal.net,wss://relay.snort.social,wss://relay.dtan.xyz")
        .split(',')
        .map(|s| s.trim().to_string())
        .filter(|s| !s.is_empty())
        .collect();
    let max_events: usize = env("MAX_EVENTS", "200000").parse()?;
    let backfill: usize = env("BACKFILL", "5000").parse()?;
    let workers: usize = env("SSR_WORKERS", "2").parse()?;
    let relay_port: Option<u16> = std::env::var("RELAY_PORT").ok().and_then(|p| p.parse().ok());
    let public_url = std::env::var("PUBLIC_URL").ok().filter(|s| !s.is_empty());

    let mirror = mirror::Mirror::new(max_events, relay_port);
    if relay_port.is_some() {
        mirror.relay.run().await?;
        tracing::info!("relay on {}", mirror.relay.url().await);
    }
    let m = mirror.clone();
    tokio::spawn(async move {
        if let Err(e) = m.follow(&relays, backfill).await {
            tracing::error!("follow failed: {e}");
        }
        let events = m.len().await;
        tracing::info!(events, "initial sync complete");
    });

    let bundle = PathBuf::from(env("SSR_BUNDLE", &dist.join("ssr/render.js").to_string_lossy()));
    let renderer = ssr::Renderer::start(bundle, workers, mirror.clone());
    let app = Arc::new(web::App { mirror, renderer: Some(renderer), dist, public_url });
    let listener = tokio::net::TcpListener::bind(&bind).await?;
    tracing::info!("listening on {bind}");
    axum::serve(listener, web::router(app)).await?;
    Ok(())
}
