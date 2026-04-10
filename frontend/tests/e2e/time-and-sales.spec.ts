import { expect, test } from "@playwright/test";

test("time and sales page and security hub tape tab render", async ({ page }) => {
  await page.goto("/equity/tape", { waitUntil: "networkidle" });

  await expect(page.getByText("Time & Sales")).toBeVisible();
  await expect(page.getByText("Total Volume")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buys Only" })).toBeVisible();

  await page.getByRole("button", { name: "Buys Only" }).click();
  const buyRows = page.locator('[data-side="buy"]');
  await expect(buyRows.first()).toBeVisible();
  await expect(page.locator('[data-side="sell"]')).toHaveCount(0);

  await page.goto("/equity/security?ticker=RELIANCE", { waitUntil: "networkidle" });
  await expect(page.getByRole("tab", { name: "Tape" })).toBeVisible();
  await page.getByRole("tab", { name: "Tape" }).click();
  await expect(page.getByText("Time & Sales")).toBeVisible();
  await expect(page.locator('[data-side="buy"], [data-side="sell"], [data-side="neutral"]').first()).toBeVisible();
});
