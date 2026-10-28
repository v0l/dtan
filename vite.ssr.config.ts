import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  resolve: { alias: { "react-dom/server": "react-dom/server.browser" } },
  ssr: { noExternal: true, target: "webworker" },
  build: {
    ssr: "src/entry-server.tsx",
    outDir: "dist/ssr",
    emptyOutDir: true,
    minify: true,
    rollupOptions: {
      output: { format: "iife", name: "DtanSsr", inlineDynamicImports: true, entryFileNames: "render.js" },
    },
  },
});
