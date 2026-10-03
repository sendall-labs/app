import { test, expect } from "../fixtures/wallet";

const SHOTS = "docs/screenshots/sow2";

// The Mainnet confirmation step, rendered with sample data on the
// development-only preview page: nothing is signed or sent.
test("Mainnet approval stays locked until MAINNET is typed", async ({ context, baseURL }) => {
  const page = await context.newPage();
  await page.setViewportSize({ width: 900, height: 820 });
  await page.goto(`${baseURL}/preview/mainnet-gate`);
  const review = page.getByRole("region", { name: "Review before signing" });
  const approve = review.getByRole("button", { name: "Approve in wallet" });
  await expect(review.getByText("Mainnet (real funds)")).toBeVisible();
  await expect(approve).toBeDisabled();
  await review.screenshot({ path: `${SHOTS}/mainnet-gate-locked.png` });
  await review.getByLabel("Type MAINNET to confirm").fill("MAINNET");
  await expect(approve).toBeEnabled();
  await review.screenshot({ path: `${SHOTS}/mainnet-gate-confirmed.png` });
});
