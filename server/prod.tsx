/**
 * Production server — Bun.serve with static file serving + SSR.
 */
import { renderPage } from "./ssr-render";
import path from "path";

const port = Number(process.env.PORT) || 0;
const distPath = path.resolve(import.meta.dir, "../dist/client");
const templateHtml = await Bun.file(path.join(distPath, "index.html")).text();

const server = Bun.serve({
  port,
  async fetch(req: Request) {
    const url = new URL(req.url);
    const pathname = url.pathname;

    const staticFilePath = path.join(distPath, pathname);
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

console.log(`Server running at http://localhost:${server.port}`);
