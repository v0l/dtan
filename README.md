# DTAN

**D**istributed **T**orrent **A**rchive on **N**ostr

This is a [NIP-35](https://github.com/nostr-protocol/nips/blob/master/35.md) client.

NIP-35 defines the event format as:

```json
{
  "kind": 2003,
  "content": "<long-description-pre-formatted>",
  "tags": [
    ["title", "<torrent-title>"],
    ["x", "<bittorrent-info-hash>"],
    ["file", "<file-name>", "<file-size-in-bytes>"],
    ["file", "<file-name>", "<file-size-in-bytes>"],
    ["tracker", "udp://mytacker.com:1337"],
    ["tracker", "http://1337-tracker.net/announce"],
    ["i", "tcat:video,movie,4k"],
    ["i", "newznab:2045"],
    ["i", "imdb:tt15239678"],
    ["i", "tmdb:movie:693134"],
    ["i", "ttvdb:movie:290272"],
    ["t", "movie"],
    ["t", "4k"]
  ]
}
```

## Future Plans

### Custom scraper relay

A relay which automatically clones torrent events from other relays.
Simple docker image which can easily be deployed anywhere and will add another replica of torrent metadata.

## Server-side rendering

`server/` is a Rust (axum) server that renders the React app to HTML inside an embedded QuickJS engine,
then the browser hydrates it. Torrent events live in an in-memory relay (`server/src/store.rs`) that is
filled from upstream relays in the background. The renderer calls it through a native `relayQuery`
function, so a page render makes no network calls and takes a few milliseconds. Unknown links
(a torrent not yet in memory) trigger one bounded upstream fetch, then a re-render, else a real 404.

The same process also speaks NIP-01 on `/` over WebSocket (REQ and EVENT), so it doubles as a relay.

```bash
bun install
bun run build            # dist/client (SPA) and dist/ssr/render.js (SSR bundle)
cd server && cargo run --release
```

Environment: `BIND` (0.0.0.0:3000), `DIST` (dist), `RELAYS` (comma separated), `MAX_EVENTS` (200000),
`BACKFILL` (5000), `SSR_WORKERS` (2), `PUBLIC_URL`, `SSR_BUNDLE`.
`bun run dev` still runs the plain SPA with Vite. `cargo test` needs `bun run build` first for the page tests.
