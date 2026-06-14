import { test, expect } from "@playwright/test";

const NEW_TABS = ["Factor / CAPM", "Autocorrelation", "Causality", "Regimes"] as const;

test("Statistical Lab shows the 4 new statsmodels tabs", async ({ page }) => {
  await page.goto("/equity/stat-lab", { waitUntil: "domcontentloaded" });

  // Header renders
  await expect(page.getByRole("heading", { name: "Statistical Lab" })).toBeVisible({ timeout: 30_000 });

  // All four new tab buttons are present and clickable, each revealing a config panel.
  for (const label of NEW_TABS) {
    const tab = page.getByRole("button", { name: label, exact: true });
    await expect(tab).toBeVisible();
    await tab.click();
    // Each tab shows its run button + the empty-state placeholder before running.
    await expect(page.getByText(/Run analysis to see results/i).first()).toBeVisible({ timeout: 10_000 });
    await page.screenshot({ path: `test-results/statlab-${label.replace(/[^a-z0-9]+/gi, "-").toLowerCase()}.png`, fullPage: true });
  }
});

test("Factor / CAPM tab runs against live data and renders results", async ({ page }) => {
  await page.goto("/equity/stat-lab", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("heading", { name: "Statistical Lab" })).toBeVisible({ timeout: 30_000 });

  await page.getByRole("button", { name: "Factor / CAPM", exact: true }).click();
  // Click the tab's run button (its label contains Run / Regress / CAPM).
  const runBtn = page.getByRole("button", { name: /run|regress|capm|analyze/i }).last();
  await runBtn.click();

  // Beta stat should appear once the regression completes (live yfinance call).
  await expect(page.getByText(/Beta/i).first()).toBeVisible({ timeout: 45_000 });
  await page.screenshot({ path: "test-results/statlab-capm-result.png", fullPage: true });
});
