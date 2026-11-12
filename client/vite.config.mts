/// <reference types="vitest/config" />
// WHY vitest/config (not vite): it types the extra `test` field below.
import { defineConfig } from "vitest/config";
import react from "@vitejs/plugin-react";

// base "./": relative asset URLs, so the built app also loads from file://
// inside the packaged Electron app (no web server in production).
export default defineConfig({
  base: "./",
  plugins: [react()],
  server: { port: 5188, strictPort: true },
  test: {
    environment: "jsdom",
    include: ["tests/**/*.spec.{ts,tsx}"],
  },
});
