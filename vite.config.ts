import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

export default defineConfig({
  plugins: [
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
