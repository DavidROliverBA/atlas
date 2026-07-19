import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { port: 5199, strictPort: true },
  preview: { port: 5199, strictPort: true },
  build: {
    // The only chunk left above the default 500 kB warning threshold is
    // elkjs's own pre-bundled worker (elk.bundled.js, ~1.4 MB) — a single
    // vendored file we can't split further, and it is dynamic-import()'d
    // only when the user clicks "Auto-layout", never part of the initial
    // page load. Raise the limit so the warning reflects that intent
    // instead of flagging an already-lazy chunk.
    chunkSizeWarningLimit: 1500,
    rollupOptions: {
      output: {
        // Split large, independently-cacheable vendor libraries out of the
        // main chunk. This doesn't reduce what the initial 2D canvas has to
        // download, but it keeps any single emitted chunk under Vite's size
        // warning threshold and lets the browser cache each vendor bundle
        // separately across deploys.
        manualChunks(id) {
          if (id.includes("node_modules/@xyflow/")) return "xyflow";
          if (id.includes("node_modules/framer-motion/")) return "framer-motion";
          if (id.includes("node_modules/@supabase/")) return "supabase";
        },
      },
    },
  },
});
