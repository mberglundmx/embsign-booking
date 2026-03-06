import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist"
  },
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      "/api": {
        target: "http://127.0.0.1:8787",
        changeOrigin: true
      }
    }
  },
  preview: {
    // Allow all hosts in preview mode for Cloud preview URLs and local container checks.
    allowedHosts: true
  },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      // Unit-test coverage is enforced on core utility/API modules.
      include: ["src/api.js", "src/dateUtils.js", "src/tenant.js"],
      thresholds: {
        lines: 90,
        statements: 90,
        functions: 90
      }
    }
  }
});
