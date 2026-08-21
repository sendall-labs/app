import { test as base, chromium, type BrowserContext, type Page } from "@playwright/test";
import path from "node:path";
import fs from "node:fs";

const EXTENSION_PATH = path.resolve(__dirname, "../extensions/freighter");
const WALLET_PROFILE_DIR = path.resolve(__dirname, "../.wallet-profile");

export const WALLET_PASSWORD = process.env.E2E_WALLET_PASSWORD ?? "TestPassword123!";
export const WALLET_PUBLIC_KEY = process.env.E2E_WALLET_PUBLIC_KEY;

if (!fs.existsSync(path.join(EXTENSION_PATH, "manifest.json"))) {
  throw new Error(
    "Freighter extension not found — run e2e/scripts/download-freighter.sh first (see e2e/README.md)."
  );
}
if (!fs.existsSync(WALLET_PROFILE_DIR)) {
  throw new Error(
    "Wallet profile not found — the Playwright globalSetup (e2e/setup/global-setup.ts) should have created it. " +
      "If running a single test directly, run `npx playwright test` (not the test file alone) so globalSetup executes."
  );
}

/** Fills the password field and clicks Unlock if a lock screen is showing. */
export async function unlockIfNeeded(page: Page): Promise<void> {
  await page.waitForTimeout(500);
  const pwField = page.locator('input[placeholder="Enter password"]');
  if (await pwField.isVisible().catch(() => false)) {
    await pwField.fill(WALLET_PASSWORD);
    await page.getByRole("button", { name: "Unlock" }).click();
    await page.waitForTimeout(1000);
  }
}

/**
 * Approves whatever Freighter popup is showing: unlocks if needed, waits for
 * its primary action button to render (some screens simulate the tx before
 * showing Confirm), then clicks it.
 */
export async function approveFreighterPopup(popup: Page): Promise<void> {
  await popup.waitForLoadState().catch(() => {});
  await unlockIfNeeded(popup);

  let buttonTexts: (string | null)[] = [];
  for (let attempt = 0; attempt < 10; attempt++) {
    buttonTexts = await popup.getByRole("button").evaluateAll((els) => els.map((e) => e.textContent?.trim() ?? null));
    if (buttonTexts.some((t) => t && /^(Connect|Grant access|Sign|Approve|Confirm)$/i.test(t))) break;
    await popup.waitForTimeout(500);
  }

  const approveBtn = popup.getByRole("button", { name: /^(Connect|Grant access|Sign|Approve|Confirm)$/i }).last();
  if ((await approveBtn.count()) === 0) {
    throw new Error(`Freighter popup at ${popup.url()} had no recognized approve button (saw: ${JSON.stringify(buttonTexts)})`);
  }
  await approveBtn.click();
}

/**
 * Drives the full wallet-approval sequence a Sendall action can trigger:
 * the in-page Stellar Wallets Kit picker (pick Freighter) followed by
 * however many Freighter popups appear in a row (grant-access, sign-message,
 * sign-transaction — the exact set depends on whether this origin/session
 * was already trusted; it can also be zero, if the kit resolves the address
 * silently).
 *
 * `triggerClick` performs the action that starts the wallet interaction
 * (e.g. clicking "Sign & send").
 */
export async function approveWalletFlow(
  context: BrowserContext,
  appPage: Page,
  triggerClick: () => Promise<void>
): Promise<void> {
  const newPages: Page[] = [];
  const seen = new Set<Page>();
  const onPage = (p: Page) => {
    if (seen.has(p)) return;
    seen.add(p);
    newPages.push(p);
  };
  context.on("page", onPage);

  try {
    await triggerClick();

    // `Locator.isVisible()` checks the DOM at that exact instant — it does
    // not poll. The picker modal can take a beat to render, so `waitFor`
    // (which does poll) is what actually waits for it to show up.
    const picker = appPage.getByText("Freighter", { exact: true });
    const pickerAppeared = await picker
      .waitFor({ state: "visible", timeout: 6000 })
      .then(() => true)
      .catch(() => false);
    if (pickerAppeared) {
      await picker.click();
      await picker.waitFor({ state: "hidden", timeout: 5000 }).catch(async () => {
        await picker.click({ force: true });
      });
    }

    // Drain popups until none appear for a few seconds — the exact count
    // (grant-access / sign-message / sign-transaction) varies by whether
    // this browser session already trusts the origin.
    for (let i = 0; i < 6; i++) {
      const popup = await waitForNext(newPages, 15_000);
      if (!popup) return;
      await approveFreighterPopup(popup);
      await appPage.waitForTimeout(400);
    }
  } finally {
    context.off("page", onPage);
  }
}

async function waitForNext(queue: Page[], timeoutMs: number): Promise<Page | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    const next = queue.shift();
    if (next) return next;
    await new Promise((r) => setTimeout(r, 150));
  }
  return null;
}

type WalletFixtures = {
  context: BrowserContext;
  extensionId: string;
};

/**
 * A Playwright test fixture that launches a persistent Chromium context with
 * the real Freighter extension loaded, already unlocked against the wallet
 * imported by globalSetup. Use `approveWalletFlow` to click through whatever
 * approval popups a wallet action triggers.
 */
export const test = base.extend<WalletFixtures>({
  context: async ({}, use) => {
    const context = await chromium.launchPersistentContext(WALLET_PROFILE_DIR, {
      headless: false,
      colorScheme: "dark",
      // Fixed, not null — a null viewport makes every tab (including
      // Freighter's own fullscreen-mode page) inherit the actual OS window
      // size, which reflows Freighter's layout unpredictably. The window
      // itself is still maximized via --start-maximized below.
      viewport: { width: 1280, height: 800 },
      args: [
        `--disable-extensions-except=${EXTENSION_PATH}`,
        `--load-extension=${EXTENSION_PATH}`,
        "--start-maximized",
        // Belt and suspenders against the "restore pages?" prompt — the
        // real fix is always closing cleanly (see the try/finally below),
        // but this suppresses it even if a previous run didn't.
        "--disable-session-crashed-bubble",
        "--disable-translate",
      ],
    });

    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });

    // Freighter auto-opens its own tab on browser startup, plus Chromium's
    // default blank tab — unlock the Freighter one (so it's ready for
    // later approvals that reuse an existing unlocked session) then close
    // all but one, so a human watching sees a single tab, not three.
    // (Closing every page can take the whole headful browser process down
    // with it, so one is always left alive.)
    for (const page of context.pages()) {
      if (page.url().startsWith("chrome-extension://")) await unlockIfNeeded(page);
    }
    const extraPages = context.pages().slice(1);
    for (const page of extraPages) {
      await page.close().catch(() => {});
    }

    try {
      await use(context);
    } finally {
      // Always close, even if the test throws — an uncleanly-killed
      // Chromium process leaves the profile in a "didn't shut down
      // properly" state that shows a restore prompt on the next launch.
      await context.close();
    }
  },
  extensionId: async ({ context }, use) => {
    let sw = context.serviceWorkers()[0];
    if (!sw) sw = await context.waitForEvent("serviceworker", { timeout: 15_000 });
    await use(sw.url().split("/")[2]);
  },
});

export { expect } from "@playwright/test";
