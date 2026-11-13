# Review notes: mptfire PRs #19-#27

All nine were landed on main unchanged as fast-forwards, in this order: #26, #20, #21, #22, #23, #24, #25, #27, #19. No fixes were needed on top of any of them, so there are no extra commits.

Checks after each landing: `bun test` (36 pass at the end), `bun run build`, and `cargo test` in `server/` for the Rust PRs (32 pass). `bun run check` fails on main before and after, from two unused-variable errors that predate the PRs (`wrap` in `src/element/text.tsx`, `Nip10` in `src/element/trending.tsx`). There is no lint script.

## How it deploys

- `.github/workflows/docker-build.yml` on push to main: builds `voidic/dtan:latest` (nginx, `Dockerfile`) and `voidic/dtan:latest-ssr` (`Dockerfile.ssr`, Rust server on the `voidic/nostr-ssr` base, amd64 and arm64).
- k8s: `~/git/v0l-k8s/v0l/dtan-ssr.yaml` runs `voidic/dtan:latest-ssr` with `imagePullPolicy: Always`, serving dtan.xyz. `dtan.yaml` runs the older nginx and relay images.
- To deploy: wait for the Docker build run on main to finish, then `kubectl -n v0l rollout restart deploy/dtan-ssr`.
- `nsite.yml` is a separate workflow and was already failing before these PRs.

## Per PR

### #26 CI least privilege
Changed on top: nothing. Unverified: the new workflow steps have not run on GitHub. The old `nsyte deploy ... --sec` step was replaced by a CLI load check, so the nsite publish no longer happens from CI (it was already failing). The grep guard behaves correctly locally.

### #20 swarm flight accounting
Changed on top: nothing. Both new tests pass. Unverified under real tracker load.

### #21 tracker egress hardening
Changed on top: nothing. Tests pass. Unverified against real udp trackers from the cluster. The resolver pool is 2 threads with a queue of 2, so a slow DNS can make udp scrapes fail closed (shown as no seeds).

### #22 refuse private torrents
Changed on top: nothing. Unverified in a browser: the file picker flow on `/new` was not exercised, only the unit tests.

### #23 metadata validation
Changed on top: nothing. Adds a `test` script. Unverified: the NIP-13 change lowers the displayed PoW to what the event id really has, so some existing badges may drop.

### #24 link hardening
Changed on top: nothing. Unverified: markdown links with unusual schemes now render as plain text, not checked against real events.

### #25 player iframe
Changed on top: nothing. The sandbox and `referrerPolicy` were confirmed on the live iframe in headless Chrome (`allow-scripts allow-same-origin allow-presentation`, `no-referrer`). Unverified: actual playback inside the sandbox, which needs the remote player and peers.

### #27 unverified zaps
Changed on top: nothing. Unverified against real zap receipts.

### #19 CSP
Changed on top: nothing. The policy matches the order of landing, so it covers the iframe origin (`https://wt-player.pages.dev`) from #25. The SSR image does not use `docker/nginx.conf`, so it gets the `<meta>` policy only: no `frame-ancestors`, `X-Frame-Options`, COOP or Permissions-Policy there. Add those at the ingress or in nostr-ssr if wanted. Home, torrent and search pages in headless Chrome logged no CSP violations (only a wasm "deprecated parameters" console message). Unverified: the nginx image itself was not run, and WebTorrent playback over `wss:` trackers under the CSP was not exercised.
