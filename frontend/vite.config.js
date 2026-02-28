import { defineConfig } from "vite";

export default defineConfig({
  root: ".",
  build: {
    outDir: "dist"
  },
  server: {
    port: 5173,
    strictPort: true
  },
  preview: {
    // Railway healthcheck uses the public service domain as Host-header.
    // Allow all hosts in preview mode so container health checks pass.
    allowedHosts: true
  },
  test: {
    environment: "jsdom",
    coverage: {
      provider: "v8",
      reporter: ["text", "html"]
    }
  }
});
