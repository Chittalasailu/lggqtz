import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// In development the API runs on :8000; Vite proxies /api so the app uses relative URLs everywhere.
export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: { "/api": process.env.VITE_API_PROXY ?? "http://localhost:8000" },
  },
  build: {
    // Recharts (+ d3) is ~550 kB minified / 155 kB gzipped; keep it in its own cacheable chunk.
    chunkSizeWarningLimit: 600,
    rollupOptions: { output: { manualChunks: { charts: ["recharts"] } } },
  },
});
