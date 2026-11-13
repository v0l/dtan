import { defineConfig, searchForWorkspaceRoot, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";
import { CSP } from "./src/csp";

/**
 * The Docker image gets its policy from nginx, but the nsite and Blossom copies
 * are static uploads that cannot set response headers, so the same policy is
 * injected into index.html at build time.
 *
 * `apply: "build"` keeps `bun run dev` working: Vite's dev HTML relies on an
 * inline react-refresh preamble and an HMR websocket, both of which this
 * policy blocks.
 */
function cspMeta(): Plugin {
  return {
    name: "dtan-csp-meta",
    apply: "build",
    transformIndexHtml() {
      return [
        {
          tag: "meta",
          attrs: { "http-equiv": "Content-Security-Policy", content: CSP },
          injectTo: "head-prepend" as const,
        },
        {
          tag: "meta",
          attrs: { name: "referrer", content: "strict-origin-when-cross-origin" },
          injectTo: "head-prepend" as const,
        },
      ];
    },
  };
}

export default defineConfig({
  plugins: [
    cspMeta(),
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
        type: "module",
      },
      workbox: {
        // Do not let the SW intercept navigation requests — they must reach
        // the SSR server so that server-rendered HTML is always served.
        // Without this the SW precaches index.html and serves it for every
        // navigation, which bypasses SSR entirely.
        navigateFallback: undefined,
        // Only precache JS/CSS/fonts/images — never HTML.
        navigateFallbackDenylist: [/./],
        // Exclude index.html from the precache manifest so the SW never
        // serves a stale HTML shell.
        globIgnores: ["**/index.html"],
        // Runtime-cache static assets only (js/css/fonts/images).
        runtimeCaching: [
          {
            urlPattern: /\.(?:js|css|woff2?|png|jpe?g|svg|ico)$/i,
            handler: "CacheFirst",
            options: {
              cacheName: "static-assets",
              expiration: { maxEntries: 100, maxAgeSeconds: 60 * 60 * 24 * 30 },
            },
          },
        ],
      },
    }),
  ],
  server: {
    fs: {
      strict: false,
    },
  },
  worker: {
    format: "es",
  }
});
