import { defineConfig } from "@playwright/test";
import path from "node:path";
import dotenv from "dotenv";

dotenv.config({ path: path.resolve(__dirname, ".env.test") });

export default defineConfig({
  testDir: "./e2e/tests",
  timeout: 90_000,
  // Extension automation drives one real, stateful wallet profile — tests
  // run one at a time rather than in parallel workers.
  fullyParallel: false,
  workers: 1,
  retries: 1,
  reporter: "list",
  globalSetup: "./e2e/setup/global-setup.ts",
  use: {
    baseURL: process.env.E2E_BASE_URL ?? "http://localhost:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
