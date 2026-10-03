import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

const SHOTS = "docs/screenshots/sow2";

test("after the claim window closes, unclaimed balances come back with one signature", async ({ context, baseURL }) => {
  test.setTimeout(240_000);
  // Seed a claimable distribution from the test wallet with a 40 s window
  // (the app only offers 7/30/90 days).
  const out = execFileSync("npx", ["tsx", path.resolve(__dirname, "../scripts/seed-expiring-claimables.ts"), "40"], { encoding: "utf8" });
  const { batchId, deadline } = JSON.parse(out.trim().split("\n").at(-1)!);

  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  await page.goto(`${baseURL}/home`);
  await approveWalletFlow(context, page, () => page.getByRole("button", { name: "Connect Wallet" }).last().click());
  await expect(page.getByRole("button", { name: /Disconnect/ }).last()).toBeVisible({ timeout: 30_000 });

  await page.waitForTimeout(Math.max(0, new Date(deadline).getTime() - Date.now()) + 8_000);
  await page.goto(`${baseURL}/batches/${batchId}`);
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none !important}" });
  const claims = page.getByRole("region", { name: "Claim status" });
  await expect(claims.getByText("Claimed 0 of 3")).toBeVisible({ timeout: 60_000 });
  await expect(claims.getByText("Claim window closed")).toBeVisible();
  await claims.screenshot({ path: `${SHOTS}/reclaim-available.png` });

  await claims.getByRole("button", { name: "Reclaim 3 unclaimed" }).click();
  const review = page.getByRole("region", { name: "Review before signing" });
  await expect(review.getByText("Reclaim unclaimed balances")).toBeVisible({ timeout: 60_000 });
  await review.screenshot({ path: `${SHOTS}/reclaim-review.png` });
  await approveWalletFlow(context, page, () => review.getByRole("button", { name: "Approve in wallet" }).click());

  await expect(claims.getByText("Reclaimed").locator("..").getByText("3")).toBeVisible({ timeout: 90_000 });
  await expect(page.getByText("Reclaimed").nth(1)).toBeVisible();
  await claims.screenshot({ path: `${SHOTS}/reclaim-done.png` });
});
