/**
 * Development server — Express + Vite middleware mode for HMR + SSR.
 */
import fs from "node:fs/promises";
import express from "express";
import { createServer as createViteServer } from "vite";
import { renderPage } from "./ssr-render";
import { getSitemap } from "./sitemap";

const port = Number(process.env.PORT) || 5174;
const base = process.env.BASE || "/";
const siteUrl = (process.env.SITE_URL || "https://dtan.xyz").replace(/\/$/, "");

const vite = await createViteServer({
  server: { middlewareMode: true },
  appType: "custom",
  base,
});

const app = express();
app.use(vite.middlewares);

app.get("/sitemap.xml", async (req, res) => {
  try {
    const xml = await getSitemap(siteUrl);
    console.log(`[${req.method}] ${req.originalUrl} 200`);
    res.status(200).set({ "Content-Type": "application/xml; charset=utf-8" }).send(xml);
  } catch (err) {
    console.error(`[${req.method}] ${req.originalUrl} 500`, err);
    res.status(500).end("Internal Server Error");
  }
});

app.use("*all", async (req, res) => {
  try {
    const url = req.originalUrl;
    let template = await fs.readFile("./index.html", "utf-8");
    template = await vite.transformIndexHtml(url, template);

    const result = await renderPage(
      url,
      template,
      req.headers["accept-language"] as string | undefined,
      req.headers["cookie"] as string | undefined,
    );

    console.log(`[${req.method}] ${url} ${result.status}`);
    res
      .status(result.status)
      .set({ "Content-Type": "text/html" })
      .send(result.html);
  } catch (err) {
    console.error(`[${req.method}] ${req.originalUrl} 500`, err);
    res.status(500).end("Internal Server Error");
  }
});

const server = app.listen(port, () => {
  console.log(`Dev server running at http://localhost:${port}`);
});

function shutdown() {
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000);
}
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
