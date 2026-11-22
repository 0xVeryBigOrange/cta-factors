import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// Relative base so the same build works on GitHub project pages
// (https://<user>.github.io/cta-factors/) and on `vite preview`.
export default defineConfig({
  plugins: [react()],
  base: "./",
  server: {
    host: "0.0.0.0",
    port: 5173,
    proxy: {
      "/yahoo": {
        target: "https://query1.finance.yahoo.com",
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/yahoo/, ""),
      },
    },
  },
  preview: {
    host: "0.0.0.0",
    port: 4173,
  },
  test: {
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
