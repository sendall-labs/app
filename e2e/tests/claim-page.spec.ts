import { execFileSync } from "node:child_process";
import path from "node:path";
import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

const SHOTS = "docs/screenshots/sow2";

test("a recipient claims from the public claim link with their own wallet", async ({ context, baseURL }) => {
  test.setTimeout(180_000);
  const out = execFileSync("npx", ["tsx", path.resolve(__dirname, "../scripts/seed-claim-for-wallet.ts")], { encoding: "utf8" });
  const { batchId } = JSON.parse(out.trim().split("\n").at(-1)!);

  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1100, height: 860 });
  await page.goto(`${baseURL}/claim?batch=${batchId}`);
  await page.addStyleTag({ content: "[data-sonner-toaster]{display:none !important}" });
  await expect(page.getByRole("heading", { name: "Claim your funds" })).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/claim-page-connect.png` });

  await approveWalletFlow(context, page, () => page.getByRole("button", { name: "Connect wallet" }).click());
  const waiting = page.getByRole("region", { name: "Waiting for you" });
  await expect(waiting.getByText(/from this distribution/)).toBeVisible({ timeout: 60_000 });
  await expect(waiting.getByText("5 XLM").first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/claim-page-list.png` });

  const claim = waiting.getByRole("button", { name: /^Claim \d+$/ });
  await approveWalletFlow(context, page, () => claim.click());
  await expect(waiting.getByText("Claimed.")).toBeVisible({ timeout: 60_000 });
  await expect(waiting.getByText(/from this distribution/)).toHaveCount(0);
  await page.screenshot({ path: `${SHOTS}/claim-page-done.png` });
});
