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

/** Serve the last-known-good sitemap for this long before treating it as fresh again. */
const SitemapTTL = 10 * 60_000; // 10 minutes
/** Serve stale content (while regenerating in the background) up to this long. */
const SitemapStaleTTL = 60 * 60_000; // 1 hour

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

async function fetchTorrentUrls(baseUrl: string): Promise<Array<SitemapUrl>> {
  await waitForRelays();

  const rb = new RequestBuilder("sitemap:torrents");
  rb.withFilter().kinds([TorrentKind]).limit(MaxTorrentUrls);

  const events = await Promise.race([
    system.Fetch(rb),
    new Promise<Array<TaggedNostrEvent>>((resolve) => setTimeout(() => resolve([]), FetchBudgetMs)),
  ]);

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

/**
 * Get the sitemap XML for `baseUrl`, using a stale-while-revalidate cache so
 * requests never block on a full relay fetch of the latest torrents.
 */
export async function getSitemap(baseUrl: string): Promise<string> {
  const now = Date.now();

  if (cache) {
    const age = now - cache.storedAt;
    if (age < SitemapTTL) {
      return cache.xml;
    }
    if (age < SitemapStaleTTL) {
      if (!regenerating) {
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
      return cache.xml;
    }
  }

  const xml = await generate(baseUrl);
  cache = { xml, storedAt: Date.now() };
  return xml;
}
