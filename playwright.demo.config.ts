import { defineConfig } from "@playwright/test";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env.test") });
process.env.DEMO_VIDEO_DIR ??= path.resolve(__dirname, "test-results/demo-video");

// Records the product demo (e2e/demo) with real Freighter on Testnet.
//   npx playwright test -c playwright.demo.config.ts
export default defineConfig({
  testDir: "./e2e/demo",
  timeout: 15 * 60_000,
  workers: 1,
  retries: 0,
  reporter: "line",
  globalSetup: "./e2e/setup/global-setup.ts",
  // A click that cannot happen fails in 30 s instead of waiting out the
  // whole recording.
  use: { baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000", actionTimeout: 30_000 },
});
