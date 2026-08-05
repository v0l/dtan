import { renderToString } from "react-dom/server";
import { createStaticHandler, createStaticRouter, StaticRouterProvider } from "react-router-dom";
import { routes } from "../src/main";
import { NostrSystem } from "@snort/system";
import { SnortContext } from "@snort/system-react";
import { getHydrationScript } from "../src/ssr-hydration";
import { DefaultRelays, IsSSR } from "../src/const";

export interface SSRResult {
  html: string;
  status: number;
}

console.log(`ServerConfig:\n\tSSR=${IsSSR}\n\tRelays=${DefaultRelays.join(",")}`);

const system = new NostrSystem({});

// ---------------------------------------------------------------------------
// Relay connections
//
// Connect eagerly in the background instead of blocking module load / the first
// request on ALL relays. A single slow or hung relay (aggravated by SYN drops
// in the AVS/GSL scrubbing path) no longer stalls startup or first paint.
// waitForRelays() waits for them with a bounded timeout; once they settle it
// resolves instantly for every later request.
// ---------------------------------------------------------------------------
const relayConnectPromise = Promise.allSettled(
  DefaultRelays.map((r) =>
    system.ConnectToRelay(r, { read: true, write: false }).catch((e) => {
      console.error(`[ssr] failed to connect relay ${r}`, e);
    }),
  ),
);

/**
 * Wait for relays to be ready, bounded so a hung relay can't block a render.
 */
function waitForRelays(timeoutMs = 4000): Promise<void> {
  return Promise.race([
    relayConnectPromise as Promise<unknown>,
    new Promise((resolve) => setTimeout(resolve, timeoutMs)),
  ]).then(() => undefined);
}

// ---------------------------------------------------------------------------
// Rendered-HTML cache (stale-while-revalidate)
//
// Pages change slowly and most visitors hit the same handful of URLs, so we
// cache the fully-rendered HTML keyed by URL. Fresh hits return instantly;
// stale hits are served immediately while a fresh copy is re-rendered in the
// background. Only public (cookie-less) requests are cached — authed requests
// render differently and bypass the cache entirely.
// ---------------------------------------------------------------------------
interface CacheEntry {
  html: string;
  status: number;
  storedAt: number;
}

const CacheTTL = 60_000; // serve fresh up to 60s
const StaleTTL = 5 * 60_000; // serve stale while revalidating, up to 5 min
const MaxCacheSize = 200;

const htmlCache = new Map<string, CacheEntry>();
const revalidating = new Set<string>();
const DevMode = import.meta.env.DEV === true;

function cacheGet(key: string): { entry: CacheEntry; stale: boolean } | undefined {
  const entry = htmlCache.get(key);
  if (!entry) return undefined;
  const age = Date.now() - entry.storedAt;
  if (age > StaleTTL) {
    htmlCache.delete(key);
    return undefined;
  }
  return { entry, stale: age > CacheTTL };
}

function cachePut(key: string, value: CacheEntry) {
  if (MaxCacheSize > 0 && htmlCache.size >= MaxCacheSize) {
    // Simple LRU: evict the oldest entry.
    const oldest = htmlCache.keys().next().value as string | undefined;
    if (oldest) htmlCache.delete(oldest);
  }
  htmlCache.set(key, value);
}

export async function renderPage(
  url: string,
  template: string,
  acceptLanguage?: string | null,
  cookie?: string | null,
): Promise<SSRResult> {
  const isPublic = !cookie;
  const key = url;

  if (isPublic && !DevMode) {
    const hit = cacheGet(key);
    if (hit) {
      if (!hit.stale) {
        // Fresh cache hit — return immediately, no relay work at all.
        return { html: hit.entry.html, status: hit.entry.status };
      }
      // Stale: kick off a background revalidation for the *next* request and
      // serve the stale HTML now so this request is never blocked.
      if (!revalidating.has(key)) {
        revalidating.add(key);
        void renderFresh(key, template, acceptLanguage)
          .then((result) => {
            cachePut(key, { html: result.html, status: result.status, storedAt: Date.now() });
          })
          .catch((e) => console.error(`[ssr] background revalidate failed for ${key}`, e))
          .finally(() => revalidating.delete(key));
      }
      return { html: hit.entry.html, status: hit.entry.status };
    }
  }

  // Cold cache (or not public) — render synchronously and populate the cache.
  const result = await renderFresh(key, template, acceptLanguage, cookie);
  if (isPublic && !DevMode && result.status === 200 && result.html.length > 0) {
    cachePut(key, { html: result.html, status: result.status, storedAt: Date.now() });
  }
  return result;
}

/**
 * The actual two-pass SSR render. Bounded so a silent relay degrades gracefully
 * instead of hanging the request up to the library's 30s QueryFetchTimeout.
 */
async function renderFresh(
  url: string,
  template: string,
  acceptLanguage?: string | null,
  cookie?: string | null,
): Promise<SSRResult> {
  // Wait (bounded) for relays rather than blocking forever on a hung one.
  await waitForRelays();

  const handler = createStaticHandler(routes);

  const headers: Record<string, string> = { accept: "text/html" };
  if (acceptLanguage) headers["accept-language"] = acceptLanguage;
  if (cookie) headers["cookie"] = cookie;

  const fetchRequest = new Request(`http://localhost${url}`, {
    method: "GET",
    headers,
  });

  const context = await handler.query(fetchRequest);

  if (context instanceof Response) {
    return { html: "", status: context.status };
  }

  const router = createStaticRouter(handler.dataRoutes, context);

  const app = (
    <SnortContext.Provider value={system}>
      <StaticRouterProvider router={router} context={context} />
    </SnortContext.Provider>
  );

  // First pass: useRequestBuilder creates queries via system.Query(rb).
  // Component-level keepAlive options keep queries alive between requests,
  // so when the same page is requested again, QueryManager reuses existing
  // queries with cached data — no new relay requests needed.
  renderToString(app);

  // FetchAll starts any newly-registered queries and waits for EOSE.
  // For keepAlive'd queries with finished traces, this returns instantly.
  await Promise.race([
    system.FetchAll(),
    new Promise((resolve) => setTimeout(resolve, 5000)),
  ]);

  // Second pass: populate HTML with fetched data.
  const html = renderToString(app);

  // Cancel all queries that were touched during this render to start their
  // keepAlive countdown.  React doesn't call useSyncExternalStore's subscribe
  // during SSR, so cancel() never fires naturally.  Queries with a keepAlive
  // survive the 30s window and are reused next time; queries without keepAlive
  // get the default 1s TTL and are cleaned up by the QueryManager interval.
  const snapshot = system.takeSnapshot();
  for (const q of snapshot.queries) {
    system.GetQuery(q.id)?.cancel();
  }

  const hydrationScript = getHydrationScript(system);

  const resultHtml = template.replace("<!--app-html-->", html).replace("</head>", `${hydrationScript}</head>`);

  return { html: resultHtml, status: 200 };
}
