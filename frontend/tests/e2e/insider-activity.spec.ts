import { expect, test } from "@playwright/test";

test("insider activity page and security hub insider tab render", async ({ page }) => {
  await page.goto("/equity/insider", { waitUntil: "networkidle" });

  await expect(page.getByText("Insider Activity")).toBeVisible();
  await expect(page.getByText("Total Buy Value (30d)")).toBeVisible();
  await expect(page.getByText("Dense Table").first()).toBeVisible();

  await page.getByRole("tab", { name: "Cluster Buys" }).click();
  await expect(page.locator('[data-testid="cluster-buy-card"]').first()).toBeVisible();

  await page.getByRole("tab", { name: "Top Buyers" }).click();
  await expect(page.getByText("Value Ladder")).toBeVisible();
  await expect(page.getByText("Highest accumulated insider buy value over 90 days")).toBeVisible();

  await page.goto("/equity/security?ticker=RELIANCE", { waitUntil: "networkidle" });
  await page.getByRole("tab", { name: "Insider" }).click();
  await expect(page.getByText("Insider Timeline")).toBeVisible();
  await expect(page.getByText("Insider Trades")).toBeVisible();
});
