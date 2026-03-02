import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 30000,
  webServer: {
    command: "npm run dev -- --port 4173 --strictPort",
    url: "http://localhost:4173",
    // Always start a dedicated test server with mock env.
    reuseExistingServer: false,
    env: {
      VITE_USE_MOCKS: "true"
    }
  },
  use: {
    baseURL: "http://localhost:4173",
    trace: "on-first-retry"
  }
});
