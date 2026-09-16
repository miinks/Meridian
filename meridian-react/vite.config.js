import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// The browser cannot call OpenSky directly, so /api/* is proxied to the Python
// backend (server.py), which handles OAuth token refresh and rate-limit headers.
const API_TARGET = process.env.MERIDIAN_API_TARGET || "http://127.0.0.1:8000";

export default defineConfig({
  plugins: [react()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
  preview: {
    host: "127.0.0.1",
    port: 5173,
    proxy: {
      "/api": {
        target: API_TARGET,
        changeOrigin: true,
      },
    },
  },
});
