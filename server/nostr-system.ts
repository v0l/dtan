import { NostrSystem } from "@snort/system";
import { DefaultRelays } from "../src/const";

/**
 * Shared server-side Nostr system + relay connections, used by both the SSR
 * renderer and the sitemap generator so they don't each open their own set
 * of relay connections.
 */
export const system = new NostrSystem({});

// Connect eagerly in the background instead of blocking module load / the first
// caller on ALL relays. A single slow or hung relay (aggravated by SYN drops
// in the AVS/GSL scrubbing path) no longer stalls startup or first paint.
const relayConnectPromise = Promise.allSettled(
  DefaultRelays.map((r) =>
    system.ConnectToRelay(r, { read: true, write: false }).catch((e) => {
      console.error(`[ssr] failed to connect relay ${r}`, e);
    }),
  ),
);

/**
 * Wait for relays to be ready, bounded so a hung relay can't block a render.
 * Once relays have settled, this resolves instantly for every later call.
 */
export function waitForRelays(timeoutMs = 4000): Promise<void> {
  return Promise.race([
    relayConnectPromise as Promise<unknown>,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]).then(() => undefined);
}
