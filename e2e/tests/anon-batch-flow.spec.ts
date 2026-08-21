import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

test("a wallet-less batch can be built, then claimed and signed only at Send", async ({ context, baseURL }) => {
  // Fresh anon session each run/retry — the wallet profile's cookies
  // otherwise persist across runs and eventually trip the per-anon-id
  // draft-batch cap (see MAX_UNCLAIMED_ANON_BATCHES in api/batches/route.ts).
  await context.clearCookies();

  // No wallet interaction until this point: create the batch, add a
  // recipient, and pass validation entirely anonymously.
  const appPage = await context.newPage();
  const createRes = await appPage.request.post(`${baseURL}/api/batches`, {
    data: { csvText: "destination,amount,memo\n", network: "TESTNET" },
  });
  expect(createRes.ok()).toBeTruthy();
  const { batch } = await createRes.json();

  await appPage.goto(`${baseURL}/batches/${batch.id}`);
  await expect(appPage.getByRole("button", { name: "Connect Wallet" })).toBeVisible();

  const textarea = appPage.locator("textarea").first();
  await textarea.click();
  await textarea.fill(`${WALLET_PUBLIC_KEY},1`);
  await expect(appPage.getByText("Ready", { exact: true })).toBeVisible({ timeout: 15_000 });

  await appPage.getByRole("button", { name: "Next →", exact: true }).click();
  await expect(appPage.getByRole("button", { name: /Sign & send/ })).toBeVisible();

  // This click is the first point a wallet is required — it should trigger
  // connect + SIWS login + the payment signature, in that order.
  await approveWalletFlow(context, appPage, () =>
    appPage.getByRole("button", { name: /Sign & send/ }).click()
  );

  await expect(appPage.getByText("Completed", { exact: true })).toBeVisible({ timeout: 30_000 });
  await expect(appPage.getByText("Sent", { exact: true })).toBeVisible();
  await expect(appPage.getByRole("button", { name: /Disconnect/ })).toBeVisible();
});
