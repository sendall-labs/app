// Product demo: records the screen during one continuous walkthrough of the
// Phase 2 features with a real Freighter wallet on Testnet. Captions and a
// cursor are drawn on the page so the video explains itself.
//   npx playwright test -c playwright.demo.config.ts && node e2e/demo/compose.mjs
// Needs ffmpeg and Screen Recording permission for the terminal app. Leave
// the screen alone while it runs.
import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import path from "node:path";
import { Keypair } from "@stellar/stellar-sdk";
import type { Page } from "@playwright/test";
import { test, expect, approveWalletFlow, demoPopups, onDemoPopup } from "../fixtures/wallet";
import { activateBrowser, fitWindow, installCursor, patchClicksToGlide, startScreenRecording } from "./screen";

const seed = (script: string, ...args: string[]) =>
  JSON.parse(execFileSync("npx", ["tsx", path.resolve(__dirname, "../scripts", script), ...args], { encoding: "utf8" }).trim().split("\n").at(-1)!);

async function caption(page: Page, text: string, hold = 2500) {
  await page.evaluate((t) => {
    let el = document.getElementById("demo-caption");
    if (!el) {
      el = document.createElement("div");
      el.id = "demo-caption";
      Object.assign(el.style, {
        position: "fixed",
        left: "50%",
        bottom: "28px",
        transform: "translateX(-50%)",
        zIndex: "99999",
        maxWidth: "860px",
        padding: "12px 20px",
        borderRadius: "14px",
        background: "rgba(10,10,12,0.88)",
        color: "#fff",
        font: "500 18px/1.4 system-ui, sans-serif",
        boxShadow: "0 8px 30px rgba(0,0,0,0.35)",
        textAlign: "center",
        pointerEvents: "none",
      });
      document.body.appendChild(el);
    }
    el.textContent = t;
  }, text);
  await page.waitForTimeout(hold);
}

// Waits on the network with nothing new on screen. compose.mjs cuts them
// down to a moment, so the video only shows what changes.
let startedAt = 0;
const skips: { start: number; end: number }[] = [];
async function quick<T>(fn: () => Promise<T>): Promise<T> {
  const start = Date.now();
  try {
    return await fn();
  } finally {
    skips.push({ start: (start - startedAt) / 1000, end: (Date.now() - startedAt) / 1000 });
  }
}

const hideToasts = (page: Page) => page.addStyleTag({ content: "[data-sonner-toaster],nextjs-portal{display:none !important}" });

test("Sendall phase 2 demo", async ({ context, baseURL }) => {
  test.setTimeout(15 * 60_000);
  // Prepared before recording starts: a claimable balance waiting for this
  // wallet (recipient view), and one sent from it with a 4-minute window
  // that will have closed by the reclaim scene.
  const forRecipient = seed("seed-claim-for-wallet.ts");
  const expiring = seed("seed-expiring-claimables.ts", "240");

  await context.clearCookies();
  await installCursor(context);
  onDemoPopup((popup) => installCursor(popup));
  const page = context.pages()[0] ?? (await context.newPage());
  patchClicksToGlide(page.locator("body"));
  const bounds = await fitWindow(page);
  await page.goto(`${baseURL}/home`);
  await hideToasts(page);
  // Freighter opens its own welcome tab on startup; only the app tab and
  // the wallet's approval popups belong in the video.
  const closeWelcome = async (p: Page) => {
    await p.waitForLoadState().catch(() => {});
    if (p.url().includes("#welcome")) await p.close().catch(() => {});
  };
  for (const other of context.pages()) if (other !== page) await other.close().catch(() => {});
  context.on("page", (p) => void closeWelcome(p));
  await page.bringToFront();
  activateBrowser();
  await page.waitForTimeout(1000);
  const dir = process.env.DEMO_VIDEO_DIR!;
  const recording = await startScreenRecording(path.join(dir, "screen.mp4"));
  startedAt = recording.startedAt;
  try {
    await caption(page, "Sendall: bulk payments on Stellar. Phase 2 demo on Testnet.", 3500);

    await caption(page, "Connect the sender's wallet (Freighter).", 1500);
    await approveWalletFlow(context, page, () => page.getByRole("button", { name: "Connect Wallet" }).last().click());
    await expect(page.getByRole("button", { name: /Disconnect/ }).last()).toBeVisible({ timeout: 30_000 });

    // 1. Payments: 150 recipients, one signature, parallel transactions.
    await page.getByRole("complementary").getByRole("link", { name: "Bulk Payment" }).click();
    await expect(page.getByRole("heading", { name: /Bulk payment/ })).toBeVisible({ timeout: 30_000 });
    await hideToasts(page);
    await caption(page, "1. Bulk payment: paste a list of 150 recipients (new accounts, 1 XLM each).");
    const rows = Array.from({ length: 150 }, () => `${Keypair.random().publicKey()},1`).join("\n");
    await page.locator("textarea").first().fill(rows);
    await quick(() => expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 90_000 }));
    await caption(page, "Every account is checked on-chain before anything is signed.");
    await page.getByRole("button", { name: "Next →", exact: true }).click();
    const sendAll = page.getByRole("button", { name: /Sign & send \(150\)/ });
    await quick(() => expect(sendAll).toBeVisible({ timeout: 60_000 }));
    await page.waitForTimeout(1500);
    await approveWalletFlow(context, page, () => sendAll.click());
    const review = page.getByRole("region", { name: "Review before signing" });
    await expect(review).toBeVisible({ timeout: 60_000 });
    await caption(page, "Review: 150 recipients in 2 Stellar transactions, one wallet signature. Fees are covered by Sendall.", 4500);
    await approveWalletFlow(context, page, () => review.getByRole("button", { name: "Approve in wallet" }).click());
    const panel = page.getByRole("region", { name: "Distribution progress" });
    await caption(page, "Live: the authorization lands, then each transaction goes out from its own channel account.", 500);
    await expect(panel.getByText("Distribution complete")).toBeVisible({ timeout: 120_000 });
    await caption(page, "150 of 150 delivered. Every transaction links to the explorer.", 3500);
    await caption(page, "A PDF receipt is ready for the distribution.", 1000);
    const [receipt] = await Promise.all([page.waitForEvent("download"), page.getByRole("link", { name: "Download receipt (PDF)" }).click()]);
    await receipt.saveAs(path.resolve(process.env.DEMO_VIDEO_DIR!, "demo-receipt.pdf"));
    await page.waitForTimeout(1500);

    // 2. Claimable balances: recipients without an account or trustline.
    await page.getByRole("complementary").getByRole("link", { name: "Bulk Claimable Balance" }).click();
    await expect(page.getByRole("heading", { name: /Bulk claimable balance/ })).toBeVisible({ timeout: 30_000 });
    await hideToasts(page);
    await caption(page, "2. Bulk claimable balance: funds are set aside on-chain for recipients who cannot receive yet.", 3500);
    await page.locator("textarea").first().fill(Array.from({ length: 3 }, () => `${Keypair.random().publicKey()},2`).join("\n"));
    await page.getByRole("radio", { name: "7 days" }).click();
    await caption(page, "Recipients get 7 days to claim. After that, the sender can reclaim.");
    await quick(() => expect(page.getByText("Ready", { exact: true }).first()).toBeVisible({ timeout: 60_000 }));
    await page.getByRole("button", { name: "Next →", exact: true }).click();
    await quick(() => expect(page.getByText(/No account yet/).first()).toBeVisible({ timeout: 60_000 }));
    await caption(page, "No account or trustline needed today: these rows pass with a note.");
    await approveWalletFlow(context, page, () => page.getByRole("button", { name: /Sign & send \(3\)/ }).click());
    await expect(review).toBeVisible({ timeout: 60_000 });
    await caption(page, "The review shows the claim deadline and the reserve the balances lock (1 XLM each).", 4000);
    await approveWalletFlow(context, page, () => review.getByRole("button", { name: "Approve in wallet" }).click());
    await expect(panel.getByText("Distribution complete")).toBeVisible({ timeout: 120_000 });
    const claims = page.getByRole("region", { name: "Claim status" });
    await quick(() => expect(claims.getByText("Claimed 0 of 3")).toBeVisible({ timeout: 60_000 }));
    await claims.scrollIntoViewIfNeeded();
    await caption(page, "Claim status per recipient. Share the claim link with recipients.", 4000);

    // 3. Recipient view.
    await page.goto(`${baseURL}/claim?batch=${forRecipient.batchId}`);
    await hideToasts(page);
    await caption(page, "3. Recipient view: the public claim page. No Sendall account needed.", 3000);
    // The wallet session is already known in this browser: the page either
    // lists the balances straight away or connects silently on click.
    const waiting = page.getByRole("region", { name: "Waiting for you" });
    const connect = page.getByRole("button", { name: "Connect wallet" });
    await expect(waiting.or(connect)).toBeVisible({ timeout: 30_000 });
    if (await connect.isVisible()) await connect.click();
    await quick(() => expect(waiting.getByText(/from this distribution/)).toBeVisible({ timeout: 60_000 }));
    await caption(page, "The recipient claims with their own wallet; a missing trustline is added in the same step.", 3500);
    await approveWalletFlow(context, page, () => waiting.getByRole("button", { name: /^Claim \d+$/ }).click());
    await expect(waiting.getByText("Claimed.")).toBeVisible({ timeout: 60_000 });
    await caption(page, "Claimed.", 2500);

    // 4. Reclaim after the window closes.
    await page.goto(`${baseURL}/batches/${expiring.batchId}`);
    await hideToasts(page);
    const expClaims = page.getByRole("region", { name: "Claim status" });
    await quick(() => expect(expClaims.getByText("Claim window closed")).toBeVisible({ timeout: 240_000 }));
    await expClaims.scrollIntoViewIfNeeded();
    await caption(page, "4. When the claim window has closed, the sender takes back what was not claimed.", 3500);
    await expClaims.getByRole("button", { name: "Reclaim 3 unclaimed" }).click();
    const reclaimReview = page.getByRole("region", { name: "Review before signing" });
    await expect(reclaimReview).toBeVisible({ timeout: 60_000 });
    await caption(page, "One signature reclaims all of them.", 2500);
    await approveWalletFlow(context, page, () => reclaimReview.getByRole("button", { name: "Approve in wallet" }).click());
    await expect(expClaims.getByText("Reclaimed").locator("..").getByText("3")).toBeVisible({ timeout: 120_000 });
    await caption(page, "Reclaimed 3, with their reserve.", 3000);

    // 5. Mainnet safety.
    const mainnet = await page.request.post(`${baseURL}/api/batches`, {
      data: { csvText: `destination,amount,memo\n${Keypair.random().publicKey()},1\n`, network: "PUBLIC" },
    });
    const { batch: mainnetBatch } = await mainnet.json();
    await page.goto(`${baseURL}/batches/${mainnetBatch.id}`);
    await hideToasts(page);
    await caption(page, "5. Mainnet batches are marked as real funds, and the wallet must be on the same network.", 4000);
    await page.goto(`${baseURL}/preview/mainnet-gate`);
    await hideToasts(page);
    await caption(page, "Before a Mainnet approval, the sender types MAINNET to confirm.", 2000);
    await page.getByLabel("Type MAINNET to confirm").pressSequentially("MAINNET", { delay: 120 });
    await caption(page, "Sendall: one signature, parallel transactions, claimable balances, PDF receipts.", 4000);
  } finally {
    await recording.stop();
  }

  // Timeline for compose.mjs: the window to crop to, the wallet popups not
  // to cut into, and the waits to cut.
  const at = (ms: number) => (ms - startedAt) / 1000;
  writeFileSync(
    path.join(dir, "timeline.json"),
    JSON.stringify(
      {
        screen: path.join(dir, "screen.mp4"),
        window: bounds,
        popups: demoPopups.map((p) => ({ start: at(p.openedAt), end: p.closedAt ? at(p.closedAt) : null })),
        skips,
      },
      null,
      2
    )
  );
});
