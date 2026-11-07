mod swarm;

use std::sync::Arc;
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::fmt().with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into())).init();
    let config = nostr_ssr::config::Config::load()?;
    let plugins: Vec<Arc<dyn nostr_ssr::plugin::Plugin>> = vec![Arc::new(swarm::SwarmPlugin::from_env())];
    nostr_ssr::serve::serve(config, plugins).await
}
