/// <reference types="vitest/config" />
import { defineConfig } from "vite";
import { fileURLToPath, URL } from "node:url";

// Single source of truth for both the dev server (Vite) and the
// headless test runner (Vitest). Directive 3 requires logic to be
// testable without a browser, so the test environment is "node".
export default defineConfig({
  base: "/pixel-dungeon/",
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
    },
  },
  test: {
    environment: "node",
    include: ["src/**/*.{test,spec}.ts"],
  },
});
