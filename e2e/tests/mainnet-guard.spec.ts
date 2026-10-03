import { Keypair } from "@stellar/stellar-sdk";
import { test, expect } from "../fixtures/wallet";

const SHOTS = "docs/screenshots/sow2";

test("a Mainnet batch says when sending there is not set up", async ({ context, baseURL }) => {
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  const res = await page.request.post(`${baseURL}/api/batches`, {
    data: { csvText: `destination,amount,memo\n${Keypair.random().publicKey()},1\n`, network: "PUBLIC" },
  });
  expect(res.ok()).toBeTruthy();
  const { batch } = await res.json();
  await page.goto(`${baseURL}/batches/${batch.id}`);
  await expect(page.getByRole("status").filter({ hasText: "Sending on Mainnet is not available yet" })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/mainnet-not-available.png` });
});
