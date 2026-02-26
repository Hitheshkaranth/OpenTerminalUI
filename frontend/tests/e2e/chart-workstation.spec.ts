import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test.describe("Multi-Chart Workstation E2E", () => {
  test.beforeEach(async ({ page }) => {
    const accessToken = makeJwt({
      sub: "e2e-user",
      email: "e2e@example.com",
      role: "trader",
      exp: Math.floor(Date.now() / 1000) + 3600,
    });
    const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });

    // Mock Auth + clear persisted workstation state so tests always start with 1 clean slot
    await page.addInitScript(
      ([at, rt]) => {
        localStorage.setItem("ot-access-token", at);
        localStorage.setItem("ot-refresh-token", rt);
        localStorage.removeItem("ot_chart_workstation");
      },
      [accessToken, refreshToken],
    );

    // Mock chart API — return {ticker, interval, currency, data:[]} as expected by fetchChart
    const sampleData = [
      { t: 1708740000, o: 2500, h: 2510, l: 2490, c: 2505, v: 100000 },
      { t: 1708743600, o: 2505, h: 2520, l: 2500, c: 2515, v: 120000 },
      { t: 1708747200, o: 2515, h: 2515, l: 2480, c: 2490, v: 90000 },
    ];
    const chartResponse = { ticker: "RELIANCE", interval: "1d", currency: "INR", data: sampleData };
    await page.route("**/api/v3/chart/**", async (route) => {
      await route.fulfill({ json: chartResponse });
    });
    await page.route("**/api/chart/**", async (route) => {
      await route.fulfill({ json: chartResponse });
    });

    await page.route("**/api/search**", async (route) => {
      await route.fulfill({
        json: {
          results: [{ ticker: "RELIANCE", name: "Reliance Industries", country_code: "IN" }],
        },
      });
    });

    await page.route("**/api/charts/batch**", async (route) => {
      await route.fulfill({ json: {} });
    });

    // Use domcontentloaded to avoid waiting for lazy chart resources on mobile
    await page.goto("/equity/chart-workstation", { waitUntil: "domcontentloaded" });
  });

  test("should load chart workstation and manage panels", async ({ page }) => {
    // 1. data-testid='chart-workstation' is visible
    const workstation = page.getByTestId("chart-workstation");
    await expect(workstation).toBeVisible();

    // 2. Page starts with exactly 1 visible panel in 1x1 layout
    const panels = page.locator('[data-testid^="chart-panel-"]');
    await expect(panels).toHaveCount(1);

    // 3. Expand layout first (1x1 has no visible capacity for an add slot/button)
    const layout2x2 = page.getByRole("button", { name: /Layout 2x2/i });
    await layout2x2.click();

    // 4. Add controls become visible once there is spare visible capacity
    const addChartBtn = page.getByTestId("add-chart-btn");
    await expect(addChartBtn).toBeVisible();
    const placeholder = page.getByTestId("add-chart-placeholder");
    await expect(placeholder).toBeVisible();

    // Clicking add-chart-btn adds a second panel
    await addChartBtn.scrollIntoViewIfNeeded();
    await addChartBtn.click();
    await expect(panels).toHaveCount(2);

    // 5. .layout-btn elements have count of 5
    const layoutBtns = page.locator(".layout-btn");
    await expect(layoutBtns).toHaveCount(5);

    // 6. remove-chart button (data-testid starts with 'remove-chart-') reduces panel count
    const removeBtn = page.locator('[data-testid^="remove-chart-"]').first();
    await removeBtn.scrollIntoViewIfNeeded();
    await removeBtn.click();
    await expect(panels).toHaveCount(1);

  });
});
