import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

test("create an address list, then start a batch from it", async ({ context, baseURL }) => {
  // Always start from a clean, unauthenticated slate — same as
  // anon-batch-flow.spec.ts. A leftover session cookie from a previous run
  // is exactly what made this test flaky: skip-if-already-connected checks
  // race WalletProvider's own session-restore fetch on a cold launch.
  await context.clearCookies();

  const page = await context.newPage();
  await page.goto(`${baseURL}/address-lists`);
  await expect(page.getByRole("button", { name: "Connect Wallet" }).first()).toBeVisible();

  await approveWalletFlow(context, page, () =>
    page.getByRole("button", { name: "Connect Wallet" }).first().click()
  );
  await expect(page.getByRole("button", { name: /Disconnect/ })).toBeVisible({ timeout: 15_000 });

  await page.getByRole("link", { name: "New list" }).click();
  await expect(page.getByRole("heading", { name: "New address list" })).toBeVisible();

  const listName = `E2E list ${Date.now()}`;
  await page.locator("#list-name").fill(listName);
  await page.getByRole("button", { name: "Show example" }).click();
  await page.getByRole("button", { name: "Create list" }).click();

  await expect(page.getByRole("heading", { name: listName })).toBeVisible({ timeout: 10_000 });
  await expect(page.getByText("2 addresses")).toBeVisible();

  await page.getByRole("button", { name: /Start batch from this list/ }).click();
  await expect(page).toHaveURL(/\/batches\/[^/]+$/, { timeout: 15_000 });
  await expect(page.getByRole("heading", { name: "Batch review" })).toBeVisible();
});
