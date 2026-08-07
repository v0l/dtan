import { NostrLink, RequestBuilder, TaggedNostrEvent } from "@snort/system";
import { Categories, Category, TorrentKind } from "../src/const";
import { system, waitForRelays } from "./nostr-system";

export interface SitemapUrl {
  loc: string;
  lastmod?: string;
  changefreq?: "always" | "hourly" | "daily" | "weekly" | "monthly" | "yearly" | "never";
  priority?: number;
}

/** Cap on how many torrent detail pages get listed, keeps the file small and fast to build. */
const MaxTorrentUrls = 2000;
/** How long a relay fetch for sitemap data is allowed to run before we fall back to what we have. */
const FetchBudgetMs = 8000;

/** Query-id prefix, so the SSR renderer's query cleanup can skip sitemap queries. */
export const SitemapQueryPrefix = "sitemap:torrents:";

/** Serve the last-known-good sitemap for this long before treating it as fresh again. */
const SitemapTTL = 10 * 60_000; // 10 minutes

interface CacheEntry {
  xml: string;
  storedAt: number;
}

let cache: CacheEntry | undefined;
let regenerating = false;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Flatten the category tree (including nested sub-categories) into a de-duped list of tags. */
function collectCategoryTags(categories: Array<Category>): Array<string> {
  const tags = new Set<string>();
  const walk = (cat: Category) => {
    tags.add(cat.tag);
    cat.sub_category?.forEach(walk);
  };
  categories.forEach(walk);
  return [...tags];
}

function staticUrls(baseUrl: string): Array<SitemapUrl> {
  return [
    { loc: `${baseUrl}/`, changefreq: "hourly", priority: 1.0 },
    { loc: `${baseUrl}/categories`, changefreq: "weekly", priority: 0.6 },
    { loc: `${baseUrl}/relays`, changefreq: "monthly", priority: 0.2 },
    ...collectCategoryTags(Categories).map(
      (tag): SitemapUrl => ({
        loc: `${baseUrl}/search?tags=${tag}`,
        changefreq: "daily",
        priority: 0.5,
      }),
    ),
  ];
}

let queryCounter = 0;

async function fetchTorrentUrls(baseUrl: string): Promise<Array<SitemapUrl>> {
  await waitForRelays();

  // Unique id per run: a stable id can collide with a still-open query from a
  // previous run (or get cancelled by the SSR renderer's cleanup pass).
  const queryId = `${SitemapQueryPrefix}${queryCounter++}`;
  const rb = new RequestBuilder(queryId);
  rb.withFilter().kinds([TorrentKind]).limit(MaxTorrentUrls);

  // NOTE: QueryManager.fetch() rejects after ~30s if EOSE never arrives. We race
  // it against a shorter budget, so the loser must have a catch attached or it
  // becomes an unhandled rejection (which can take the server down).
  const fetchPromise = system.Fetch(rb).catch((e) => {
    console.error("[sitemap] relay fetch failed", e);
    return [] as Array<TaggedNostrEvent>;
  });

  const events = await Promise.race([
    fetchPromise,
    new Promise<Array<TaggedNostrEvent>>((resolve) => setTimeout(() => resolve([]), FetchBudgetMs)),
  ]);

  // Release the query so it doesn't linger open across regenerations.
  system.GetQuery(queryId)?.cancel();

  return events
    .sort((a, b) => b.created_at - a.created_at)
    .slice(0, MaxTorrentUrls)
    .map(
      (ev): SitemapUrl => ({
        loc: `${baseUrl}/e/${NostrLink.fromEvent(ev).encode()}`,
        lastmod: new Date(ev.created_at * 1000).toISOString(),
        changefreq: "monthly",
        priority: 0.7,
      }),
    );
}

function buildXml(urls: Array<SitemapUrl>): string {
  const body = urls
    .map((u) => {
      const parts = [`<loc>${xmlEscape(u.loc)}</loc>`];
      if (u.lastmod) parts.push(`<lastmod>${u.lastmod}</lastmod>`);
      if (u.changefreq) parts.push(`<changefreq>${u.changefreq}</changefreq>`);
      if (u.priority !== undefined) parts.push(`<priority>${u.priority.toFixed(1)}</priority>`);
      return `  <url>${parts.join("")}</url>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${body}\n</urlset>\n`;
}

async function generate(baseUrl: string): Promise<string> {
  const torrentUrls = await fetchTorrentUrls(baseUrl);
  return buildXml([...staticUrls(baseUrl), ...torrentUrls]);
}

function refreshInBackground(baseUrl: string) {
  if (regenerating) return;
  regenerating = true;
  void generate(baseUrl)
    .then((xml) => {
      cache = { xml, storedAt: Date.now() };
    })
    .catch((e) => console.error("[sitemap] background regeneration failed", e))
    .finally(() => {
      regenerating = false;
    });
}

/**
 * Get the sitemap XML for `baseUrl`.
 *
 * This NEVER blocks on relays: a cold cache is answered immediately with the
 * static URL set (always valid XML) while the full torrent list is fetched in
 * the background. Blocking here previously meant a ~12s response on the first
 * request after a restart, which crawlers (Google Search Console) report as
 * "Sitemap could not be read".
 */
export function getSitemap(baseUrl: string): string {
  const now = Date.now();

  if (!cache) {
    // Cold: cache the static-only sitemap so we always have something valid to
    // serve, and fill in torrents asynchronously.
    cache = { xml: buildXml(staticUrls(baseUrl)), storedAt: 0 };
    refreshInBackground(baseUrl);
    return cache.xml;
  }

  const age = now - cache.storedAt;
  if (age >= SitemapTTL) {
    refreshInBackground(baseUrl);
  }
  return cache.xml;
}

/** Warm the cache at server start so the first crawler hit gets a full sitemap. */
export function warmSitemap(baseUrl: string) {
  if (!cache) {
    cache = { xml: buildXml(staticUrls(baseUrl)), storedAt: 0 };
  }
  refreshInBackground(baseUrl);
}
