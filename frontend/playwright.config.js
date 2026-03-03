import { defineConfig } from "@playwright/test";

const isCI = Boolean(process.env.CI);

export default defineConfig({
  testDir: "./playwright/tests",
  timeout: 30000,
  reporter: isCI ? [["line"], ["html", { open: "never" }]] : "list",
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
    trace: isCI ? "on" : "on-first-retry",
    video: isCI ? "on" : "off",
    launchOptions: {
      slowMo: isCI ? 250 : 0
    }
  }
});
