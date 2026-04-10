import { expect, test } from "@playwright/test";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("correlation dashboard renders matrix, rolling, and clusters", async ({ page }) => {
  const token = fakeJwt({
    sub: "u_e2e",
    email: "trader@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  await page.addInitScript((jwt) => {
    localStorage.setItem("ot-access-token", jwt);
    localStorage.setItem("ot-refresh-token", "dummy");
  }, token);

  await page.route("**/api/portfolio", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ items: [], summary: { total_cost: 0, total_value: 0, overall_pnl: 0 } }),
    });
  });

  await page.route("**/api/search**", async (route) => {
    const url = new URL(route.request().url());
    const q = (url.searchParams.get("q") || "").toUpperCase();
    const items = [
      { ticker: "RELIANCE", name: "Reliance Industries" },
      { ticker: "TCS", name: "Tata Consultancy Services" },
      { ticker: "HDFCBANK", name: "HDFC Bank" },
      { ticker: "INFY", name: "Infosys" },
      { ticker: "ICICIBANK", name: "ICICI Bank" },
    ].filter((item) => item.ticker.includes(q) || item.name.toUpperCase().includes(q));
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ results: items }),
    });
  });

  await page.route("**/api/correlation/matrix", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbols: ["RELIANCE", "TCS", "HDFCBANK", "INFY", "ICICIBANK"],
        matrix: [
          [1.0, 0.72, 0.31, 0.61, 0.28],
          [0.72, 1.0, 0.22, 0.83, 0.19],
          [0.31, 0.22, 1.0, 0.14, 0.77],
          [0.61, 0.83, 0.14, 1.0, 0.11],
          [0.28, 0.19, 0.77, 0.11, 1.0],
        ],
        period_start: "2025-01-01",
        period_end: "2025-12-31",
      }),
    });
  });

  await page.route("**/api/correlation/rolling", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        series: [
          { date: "2025-01-01", correlation: 0.72 },
          { date: "2025-02-01", correlation: 0.68 },
          { date: "2025-03-01", correlation: 0.41 },
          { date: "2025-04-01", correlation: 0.25 },
          { date: "2025-05-01", correlation: 0.54 },
        ],
        current: 0.54,
        avg: 0.52,
        min: 0.25,
        max: 0.72,
        regimes: [
          { start: "2025-01-01", end: "2025-02-01", avg_correlation: 0.7, label: "high" },
          { start: "2025-03-01", end: "2025-03-01", avg_correlation: 0.41, label: "medium" },
          { start: "2025-04-01", end: "2025-04-01", avg_correlation: 0.25, label: "low" },
          { start: "2025-05-01", end: "2025-05-01", avg_correlation: 0.54, label: "medium" },
        ],
      }),
    });
  });

  await page.route("**/api/correlation/clusters", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        clusters: [
          { cluster_id: 1, symbols: ["RELIANCE", "TCS", "INFY"], avg_intra_correlation: 0.72 },
          { cluster_id: 2, symbols: ["HDFCBANK", "ICICIBANK"], avg_intra_correlation: 0.77 },
        ],
        dendrogram: {
          distance: 0.23,
          children: [
            { name: "RELIANCE", distance: 0, children: [] },
            {
              distance: 0.17,
              children: [
                { name: "TCS", distance: 0, children: [] },
                { name: "INFY", distance: 0, children: [] },
              ],
            },
          ],
        },
      }),
    });
  });

  await page.goto("/equity/correlation", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Correlation Dashboard")).toBeVisible();
  await expect(page.getByTestId("correlation-matrix-heatmap")).toBeVisible();

  const input = page.getByTestId("correlation-symbol-input");
  await input.fill("REL");
  await page.getByRole("button", { name: /RELIANCE/i }).click();
  await input.fill("TCS");
  await page.getByRole("button", { name: /TCS/i }).click();
  await input.fill("HDF");
  await page.getByRole("button", { name: /HDFCBANK/i }).click();
  await input.fill("INF");
  await page.getByRole("button", { name: /INFY/i }).click();
  await input.fill("ICI");
  await page.getByRole("button", { name: /ICICIBANK/i }).click();

  await expect(page.locator('[data-testid="correlation-matrix-heatmap"] svg rect').first()).toBeVisible();

  await page.locator('[data-testid="correlation-matrix-heatmap"] svg rect').nth(1).click();
  await expect(page.getByText("Rolling Correlation")).toBeVisible();
  await expect(page.getByTestId("correlation-rolling-chart")).toBeVisible();

  await page.getByRole("button", { name: "Clusters" }).click();
  await expect(page.getByTestId("correlation-cluster-cards")).toBeVisible();
  await expect(page.getByText("Decorrelated Pairs")).toBeVisible();
});
