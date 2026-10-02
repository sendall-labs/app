import { Keypair } from "@stellar/stellar-sdk";
import { test, expect, approveWalletFlow, WALLET_PUBLIC_KEY } from "../fixtures/wallet";

test.skip(!WALLET_PUBLIC_KEY, "E2E_WALLET_PUBLIC_KEY not set — see .env.test.example");

const SHOTS = "docs/screenshots/sow2";

// 150 new accounts: two transactions on two channels behind one signature,
// so the live panel has more than one lane to show.
test("the live send panel follows a 150-recipient distribution to the end", async ({ context, baseURL }) => {
  test.setTimeout(180_000);
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 900 });

  const rows = Array.from({ length: 150 }, () => `${Keypair.random().publicKey()},1`).join("\n");
  const createRes = await page.request.post(`${baseURL}/api/batches`, {
    data: { csvText: `destination,amount,memo\n${rows}\n`, network: "TESTNET" },
  });
  expect(createRes.ok()).toBeTruthy();
  const { batch } = await createRes.json();

  await page.goto(`${baseURL}/batches/${batch.id}`);
  await page.getByRole("button", { name: "Next →", exact: true }).click({ timeout: 60_000 });
  const send = page.getByRole("button", { name: /Sign & send \(150\)/ });
  await expect(send).toBeVisible({ timeout: 60_000 });

  const panel = page.getByRole("region", { name: "Distribution progress" });
  // Watch the panel from the moment Send is clicked, alongside the wallet
  // popups, so mid-flight states are caught even on a fast network.
  const captured = new Set<string>();
  let watching = true;
  const watcher = (async () => {
    while (watching) {
      const text = (await panel.textContent({ timeout: 200 }).catch(() => null)) ?? "";
      if (!captured.has("wallet") && text.includes("Approve") === false && text.includes("Wallet approval") && !text.includes("Tx 1")) {
        await panel.screenshot({ path: `${SHOTS}/live-panel-start.png` }).catch(() => {});
        captured.add("wallet");
      }
      if (!captured.has("processing") && text.includes("Tx 1") && /Sending|Queued/.test(text)) {
        await panel.screenshot({ path: `${SHOTS}/live-panel-processing.png` }).catch(() => {});
        captured.add("processing");
      }
      if (text.includes("Distribution complete")) break;
      await page.waitForTimeout(100);
    }
  })();

  await approveWalletFlow(context, page, () => send.click());
  await expect(panel).toBeVisible();

  await expect(panel.getByText("Distribution complete")).toBeVisible({ timeout: 120_000 });
  await expect(panel.getByText("150 of 150 delivered on Testnet")).toBeVisible();
  await expect(panel.getByText("Confirmed")).toHaveCount(2);
  watching = false;
  await watcher;
  await panel.screenshot({ path: `${SHOTS}/live-panel-complete.png` });
  // Mid-flight frames are evidence, not the assertion: a fast ledger can
  // finish before a frame is taken.
  test.info().annotations.push({ type: "captured", description: [...captured].join(", ") || "final state only" });
  await page.screenshot({ path: `${SHOTS}/batch-page-after-send.png`, fullPage: true });
});
