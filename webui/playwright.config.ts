import { defineConfig } from "@playwright/test"


/**
 * E2E config (A7). Runs the local-only flow against a dev server on a fixed
 * port. Offline-SW tests (e2e/offline.spec.ts) need a prod build + preview.
 */
export default defineConfig({
  testDir: "./e2e",
  timeout: 30_000,
  expect: { timeout: 10_000 },
  fullyParallel: false,
  use: {
    baseURL: "http://localhost:4321",
    headless: true,
  },
  webServer: {
    command: "APP_PORT=4321 npm run dev",
    url: "http://localhost:4321",
    reuseExistingServer: true,
    timeout: 120_000,
  },
})
