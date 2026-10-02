import { Keypair } from "@stellar/stellar-sdk";
import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

const SHOTS = "docs/screenshots/sow2";

test("a claimable balance distribution goes out with one signature", async ({ context, baseURL }) => {
  test.setTimeout(150_000);
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  // Three recipients without accounts: a payment could not reach them.
  const rows = Array.from({ length: 3 }, () => `${Keypair.random().publicKey()},2`).join("\n");
  const res = await page.request.post(`${baseURL}/api/batches`, {
    data: { csvText: `destination,amount,memo\n${rows}\n`, network: "TESTNET", kind: "CLAIMABLE_BALANCE" },
  });
  expect(res.ok()).toBeTruthy();
  const { batch } = await res.json();
  await page.goto(`${baseURL}/batches/${batch.id}`);

  await page.getByRole("radio", { name: "7 days" }).click();
  await expect(page.getByRole("radio", { name: "7 days" })).toHaveAttribute("aria-checked", "true");
  await page.getByRole("button", { name: "Next →", exact: true }).click({ timeout: 60_000 });
  await expect(page.getByText(/No account yet/).first()).toBeVisible({ timeout: 60_000 });
  await page.screenshot({ path: `${SHOTS}/claimable-confirm.png` });

  const send = page.getByRole("button", { name: /Sign & send \(3\)/ });
  await approveWalletFlow(context, page, () => send.click());
  const review = page.getByRole("region", { name: "Review before signing" });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await expect(review.getByText("Claimable balances")).toBeVisible();
  await expect(review.getByText("Claim until")).toBeVisible();
  await expect(review.getByText("3 XLM")).toBeVisible(); // 3 balances x 2 claimants x 0.5 XLM
  await review.screenshot({ path: `${SHOTS}/claimable-review.png` });

  await approveWalletFlow(context, page, () => review.getByRole("button", { name: "Approve in wallet" }).click());
  const panel = page.getByRole("region", { name: "Distribution progress" });
  await expect(panel.getByText("Distribution complete")).toBeVisible({ timeout: 90_000 });
  await expect(panel.getByText("3 of 3 delivered on Testnet")).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/claimable-sent.png`, fullPage: true });
});
