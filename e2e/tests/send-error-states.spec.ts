import { Keypair } from "@stellar/stellar-sdk";
import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

const SHOTS = "docs/screenshots/sow2";

async function batchWith(page: import("@playwright/test").Page, baseURL: string, csv: string) {
  const res = await page.request.post(`${baseURL}/api/batches`, { data: { csvText: `destination,amount,memo\n${csv}\n`, network: "TESTNET" } });
  expect(res.ok()).toBeTruthy();
  return (await res.json()).batch as { id: string };
}

test("preflight problems are listed before anything is signed", async ({ context, baseURL }) => {
  test.setTimeout(120_000);
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const exchange = Keypair.random().publicKey();
  const batch = await batchWith(page, baseURL!, `${Keypair.random().publicKey()},1\n${exchange},2,12345`);
  await page.goto(`${baseURL}/batches/${batch.id}`);
  await page.getByRole("button", { name: "Next →", exact: true }).click({ timeout: 60_000 });
  const send = page.getByRole("button", { name: /Sign & send \(2\)/ });
  await expect(send).toBeVisible({ timeout: 60_000 });

  await approveWalletFlow(context, page, () => send.click());
  const problems = page.getByRole("alert", { name: "Fix before sending" });
  await expect(problems).toBeVisible({ timeout: 60_000 });
  await expect(problems.getByText("Row 2")).toBeVisible();
  await expect(problems.getByText(/memo cannot be sent in bulk/)).toBeVisible();
  await problems.screenshot({ path: `${SHOTS}/preflight-problems.png` });
});

test("cancelling at review leaves the rows ready to send", async ({ context, baseURL }) => {
  test.setTimeout(120_000);
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });
  const batch = await batchWith(page, baseURL!, `${Keypair.random().publicKey()},1`);
  await page.goto(`${baseURL}/batches/${batch.id}`);
  await page.getByRole("button", { name: "Next →", exact: true }).click({ timeout: 60_000 });
  const send = page.getByRole("button", { name: /Sign & send \(1\)/ });
  await expect(send).toBeVisible({ timeout: 60_000 });

  await approveWalletFlow(context, page, () => send.click());
  const review = page.getByRole("region", { name: "Review before signing" });
  await expect(review).toBeVisible({ timeout: 60_000 });
  await review.getByRole("button", { name: "Cancel" }).click();
  await expect(review).toBeHidden();
  await expect(page.getByRole("button", { name: /Sign & send \(1\)/ })).toBeEnabled({ timeout: 15_000 });
});
