import { defineConfig, searchForWorkspaceRoot } from "vite";
import react from "@vitejs/plugin-react";
import { VitePWA } from "vite-plugin-pwa";

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: "autoUpdate",
      devOptions: {
        enabled: false,
        type: "module",
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
  },
});
