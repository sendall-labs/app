import { chromium } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const EXTENSION_PATH = path.resolve(__dirname, "../extensions/freighter");
const WALLET_PROFILE_DIR = path.resolve(__dirname, "../.wallet-profile");
const PASSWORD = process.env.E2E_WALLET_PASSWORD ?? "TestPassword123!";

/**
 * Runs once before the e2e suite: imports the test wallet (see
 * e2e/scripts/generate-wallet.mjs) into a real Freighter extension profile
 * so individual tests can reuse it instead of onboarding from scratch each
 * time (onboarding needs its own careful sequencing — see e2e/README.md).
 */
export default async function globalSetup(): Promise<void> {
  if (!fs.existsSync(path.join(EXTENSION_PATH, "manifest.json"))) {
    throw new Error(
      "Freighter extension not found at e2e/extensions/freighter. Run: ./e2e/scripts/download-freighter.sh"
    );
  }

  const mnemonic = process.env.E2E_WALLET_MNEMONIC;
  if (!mnemonic) {
    throw new Error(
      "E2E_WALLET_MNEMONIC is not set. Generate a test wallet with: node e2e/scripts/generate-wallet.mjs, " +
        "then copy the output into .env.test."
    );
  }

  if (fs.existsSync(path.join(WALLET_PROFILE_DIR, "Default"))) {
    // Already onboarded from a previous run — nothing to do. Delete
    // e2e/.wallet-profile to force re-onboarding (e.g. after changing the
    // test mnemonic).
    return;
  }

  const context = await chromium.launchPersistentContext(WALLET_PROFILE_DIR, {
    headless: false,
    args: [`--disable-extensions-except=${EXTENSION_PATH}`, `--load-extension=${EXTENSION_PATH}`],
  });

  let sw = context.serviceWorkers()[0];
  if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
  const extId = sw.url().split("/")[2];

  const page = await context.newPage();
  await page.goto(`chrome-extension://${extId}/index.html#/recover-account`);
  await page.waitForTimeout(500);
  await page.locator('input[placeholder="New password"]').fill(PASSWORD);
  await page.locator('input[placeholder="Confirm password"]').fill(PASSWORD);
  await page.getByTestId("account-creator-termsOfUse-input").check({ force: true });
  await page.getByTestId("account-creator-submit").click();
  await page.waitForTimeout(1000);

  const words = mnemonic.trim().split(/\s+/);
  for (let i = 0; i < words.length; i++) {
    await page.locator(`#MnemonicPhrase-${i + 1}`).fill(words[i]);
  }
  await page.getByRole("button", { name: "Import" }).click();
  // The import screen's own success transition is unreliable to wait on —
  // closing and reopening the extension page reliably lands on the
  // unlock/account screen once the import has actually completed.
  await page.waitForTimeout(2500);
  await page.close();

  const page2 = await context.newPage();
  await page2.goto(`chrome-extension://${extId}/index.html`);
  await page2.waitForTimeout(1000);
  const pwField = page2.locator('input[placeholder="Enter password"]');
  if (await pwField.isVisible().catch(() => false)) {
    await pwField.fill(PASSWORD);
    await page2.getByRole("button", { name: "Unlock" }).click();
    await page2.waitForTimeout(1200);
  }

  // Switch to Testnet (the network globe icon, top-left).
  await page2.mouse.click(337, 40);
  await page2.waitForTimeout(500);
  await page2.getByText("Testnet", { exact: true }).click();
  await page2.waitForTimeout(1000);

  await context.close();
}
