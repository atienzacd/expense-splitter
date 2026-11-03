import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    // In development the API runs separately (npm run dev:server). In production
    // the server hosts these files, so the app and API share one origin.
    proxy: { "/api": "http://127.0.0.1:3000" },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./src/test/setup.ts"],
  },
});
