import { test, expect } from "../fixtures/wallet";

const SHOTS = "docs/screenshots/sow2";

test("the sidebar starts a payment or a claimable balance distribution", async ({ context, baseURL }) => {
  await context.clearCookies();
  const page = await context.newPage();
  await page.setViewportSize({ width: 1280, height: 860 });
  await page.goto(`${baseURL}/home`);

  const sidebar = page.getByRole("complementary");
  await sidebar.getByRole("link", { name: "Bulk Claimable Balance" }).click();
  await expect(page.getByRole("heading", { name: /Bulk claimable balance/ })).toBeVisible({ timeout: 30_000 });
  await page.screenshot({ path: `${SHOTS}/sidebar-claimable-new.png` });

  await sidebar.getByRole("link", { name: "Bulk Payment" }).click();
  await expect(page.getByRole("heading", { name: /Bulk payment/ })).toBeVisible({ timeout: 30_000 });

  await sidebar.getByRole("link", { name: "Batches" }).click();
  await expect(page.getByRole("cell", { name: "Claimable" }).first()).toBeVisible();
  await expect(page.getByRole("cell", { name: "Payment" }).first()).toBeVisible();
  await page.screenshot({ path: `${SHOTS}/batches-list-types.png` });
});
