/**
 * Production server — Bun.serve with static file serving + SSR.
 */
import.meta.env.SSR = true;
import { renderPage } from "./ssr-render";
import { getSitemap, warmSitemap } from "./sitemap";
import path from "path";

const port = Number(process.env.PORT) || 4433;
const distPath = path.resolve(import.meta.dir, "../dist/client");
const templateHtml = await Bun.file(path.join(distPath, "index.html")).text();
const siteUrl = (process.env.SITE_URL || "https://dtan.xyz").replace(/\/$/, "");

function acceptsGzip(req: Request): boolean {
  const accept = req.headers.get("accept-encoding") ?? "";
  return accept.includes("gzip");
}

const server = Bun.serve({
  port,
  idleTimeout: 30,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    if (pathname === "/sitemap.xml") {
      // Synchronous + non-throwing: crawlers always get valid XML fast.
      const xml = getSitemap(siteUrl);
      return new Response(xml, {
        headers: {
          "Content-Type": "application/xml; charset=utf-8",
          "Cache-Control": "public, max-age=300",
        },
      });
    }

    const staticFilePath = path.join(distPath, pathname.split("?")[0]);
    const staticFile = Bun.file(staticFilePath);
    if (pathname !== "/" && (await staticFile.exists())) {
      return new Response(staticFile, {
        headers: {
          "Cache-Control": "public, max-age=31536000, immutable",
        },
      });
    }

    try {
      const result = await renderPage(
        url.pathname + url.search,
        templateHtml,
        req.headers.get("accept-language"),
        req.headers.get("cookie"),
      );

      const useGzip = acceptsGzip(req);
      if (useGzip) {
        const compressed = Bun.gzipSync(result.html);
        return new Response(compressed, {
          status: result.status,
          headers: {
            "Content-Type": "text/html",
            "Content-Encoding": "gzip",
          },
        });
      }

      return new Response(result.html, {
        status: result.status,
        headers: { "Content-Type": "text/html" },
      });
    } catch (err) {
      console.error(`[${req.method}] ${pathname} 500`, err);
      return new Response("Internal Server Error", { status: 500 });
    }
  },
});

// Build the sitemap up-front so the first crawler request is already complete.
warmSitemap(siteUrl);

console.log(`Server running at http://localhost:${server.port}`);

function shutdown() {
  server.stop(true);
  process.exit(0);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
