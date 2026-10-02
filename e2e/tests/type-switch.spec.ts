import { Keypair } from "@stellar/stellar-sdk";
import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

const SHOTS = "docs/screenshots/sow2";
const USDC_TESTNET_ISSUER = "GBBD47IF6LWK7P7MDEVSCWR7DPUWV3NY3DTQEVFL4NAT4AQH3ZLLFLA5";

test("failed USDC rows move to a claimable balance batch, and the type can be switched", async ({ context, baseURL }) => {
  test.setTimeout(150_000);
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  // Two recipients that cannot hold USDC today (their accounts do not exist).
  const rows = [Keypair.random().publicKey(), Keypair.random().publicKey()].map((a) => `${a},5`).join("\n");
  const res = await page.request.post(`${baseURL}/api/batches`, {
    data: { csvText: `destination,amount,memo\n${rows}\n`, network: "TESTNET", assetCode: "USDC", assetIssuer: USDC_TESTNET_ISSUER },
  });
  expect(res.ok()).toBeTruthy();
  const { batch } = await res.json();
  await page.goto(`${baseURL}/batches/${batch.id}`);

  await page.getByRole("button", { name: "2 Confirm" }).click({ timeout: 30_000 }).catch(() => {});
  const convert = page.getByRole("button", { name: "Send 2 as claimable balance" });
  await expect(convert).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/convert-failed-rows.png` });

  await approveWalletFlow(context, page, () => convert.click());
  await expect(page.getByRole("heading", { name: /Bulk claimable balance/ })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "Next →", exact: true }).click({ timeout: 60_000 });
  await expect(page.getByText(/No account yet/).first()).toBeVisible({ timeout: 60_000 });
  await expect(page.getByRole("radio", { name: "Claimable balance" })).toHaveAttribute("aria-checked", "true");
  await page.screenshot({ path: `${SHOTS}/converted-claimable-batch.png` });

  // Same list as payments: the checks flip back to failures.
  await page.getByRole("radio", { name: "Payment" }).click();
  await expect(page.getByRole("heading", { name: /Bulk payment/ })).toBeVisible({ timeout: 30_000 });
  await page.getByRole("button", { name: "2 Confirm" }).click({ timeout: 30_000 });
  await expect(page.getByText("Destination account does not exist").first()).toBeVisible({ timeout: 60_000 });
  await page.getByRole("radio", { name: "Claimable balance" }).click();
  await expect(page.getByRole("heading", { name: /Bulk claimable balance/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/type-switch.png` });
});
