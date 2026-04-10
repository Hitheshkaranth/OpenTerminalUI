import { expect, test } from "@playwright/test";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

function buildFactorReturns(period: string) {
  const scale = period === "3M" ? 0.5 : 1;
  return {
    factors: {
      market: [{ date: "2025-01-01", return: 0.0012 * scale }, { date: "2025-01-02", return: 0.0008 * scale }],
      size: [{ date: "2025-01-01", return: -0.0004 * scale }, { date: "2025-01-02", return: 0.0003 * scale }],
      value: [{ date: "2025-01-01", return: 0.0006 * scale }, { date: "2025-01-02", return: 0.0002 * scale }],
      momentum: [{ date: "2025-01-01", return: 0.0009 * scale }, { date: "2025-01-02", return: 0.0005 * scale }],
      quality: [{ date: "2025-01-01", return: 0.0004 * scale }, { date: "2025-01-02", return: 0.0003 * scale }],
      low_vol: [{ date: "2025-01-01", return: -0.0002 * scale }, { date: "2025-01-02", return: 0.0001 * scale }],
    },
  };
}

test("factor attribution tab renders and period selection reloads data", async ({ page }) => {
  test.slow();
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

  let lastFactorPeriod = "1Y";

  await page.route("**/api/risk/summary**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ ewma_vol: 0.15, beta: 1.02, marginal_contribution: { RELIANCE: 0.12 } }) });
  });
  await page.route("**/api/risk/exposures**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ pca_factors: [{ factor: "PC1", variance_explained: 0.62 }], loadings: { RELIANCE: [0.81] } }) });
  });
  await page.route("**/api/risk/correlation**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ assets: ["RELIANCE"], matrix: [[1]] }) });
  });
  await page.route("**/api/risk/sector-concentration**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ sectors: { Energy: 100 }, industries: { Refining: 100 } }) });
  });
  await page.route("**/api/risk/factor-exposures**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        exposures: {
          market: { exposure: 1.08, t_stat: 3.2, confidence: 0.91 },
          size: { exposure: 0.34, t_stat: 1.9, confidence: 0.72 },
          value: { exposure: -0.28, t_stat: -1.5, confidence: 0.66 },
          momentum: { exposure: 0.52, t_stat: 2.4, confidence: 0.79 },
          quality: { exposure: 0.41, t_stat: 2.0, confidence: 0.74 },
          low_vol: { exposure: -0.22, t_stat: -1.2, confidence: 0.61 },
        },
      }),
    });
  });
  await page.route("**/api/risk/factor-attribution**", async (route) => {
    const period = new URL(route.request().url()).searchParams.get("period") || "1Y";
    lastFactorPeriod = period;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        total_return: period === "3M" ? 0.034 : 0.092,
        factor_contributions: {
          market: period === "3M" ? 0.018 : 0.048,
          size: period === "3M" ? 0.004 : 0.011,
          value: period === "3M" ? -0.003 : -0.007,
          momentum: period === "3M" ? 0.006 : 0.015,
          quality: period === "3M" ? 0.005 : 0.013,
          low_vol: period === "3M" ? -0.002 : -0.004,
        },
        alpha: period === "3M" ? 0.006 : 0.016,
        r_squared: period === "3M" ? 0.73 : 0.82,
      }),
    });
  });
  await page.route("**/api/risk/factor-history**", async (route) => {
    const period = new URL(route.request().url()).searchParams.get("period") || "1Y";
    const scale = period === "3M" ? 0.6 : 1;
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        series: {
          market: [{ date: "2025-01-01", exposure: 1.0 * scale }, { date: "2025-02-01", exposure: 1.1 * scale }],
          size: [{ date: "2025-01-01", exposure: 0.3 * scale }, { date: "2025-02-01", exposure: 0.35 * scale }],
          value: [{ date: "2025-01-01", exposure: -0.2 * scale }, { date: "2025-02-01", exposure: -0.25 * scale }],
          momentum: [{ date: "2025-01-01", exposure: 0.45 * scale }, { date: "2025-02-01", exposure: 0.5 * scale }],
          quality: [{ date: "2025-01-01", exposure: 0.4 * scale }, { date: "2025-02-01", exposure: 0.42 * scale }],
          low_vol: [{ date: "2025-01-01", exposure: -0.15 * scale }, { date: "2025-02-01", exposure: -0.18 * scale }],
        },
      }),
    });
  });
  await page.route("**/api/risk/factor-returns**", async (route) => {
    const period = new URL(route.request().url()).searchParams.get("period") || "1Y";
    lastFactorPeriod = period;
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(buildFactorReturns(period)) });
  });
  await page.route("**/api/quotes**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ market: "NASDAQ", quotes: [] }) });
  });
  await page.route("**/api/search**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.goto("/equity/risk");
  await expect(page.getByText("RISK ENGINE CONTROL")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "FACTOR ATTRIBUTION" }).click();
  await expect(page.getByTestId("factor-exposure-chart")).toBeVisible();
  await expect(page.getByTestId("factor-waterfall-chart")).toBeVisible();
  await expect(page.getByTestId("factor-history-chart")).toBeVisible();

  await expect(page.getByText("Market")).toBeVisible();
  await expect(page.getByText("Size")).toBeVisible();
  await expect(page.getByText("Value")).toBeVisible();
  await expect(page.getByText("Momentum")).toBeVisible();
  await expect(page.getByText("Quality")).toBeVisible();
  await expect(page.getByText("Low Vol")).toBeVisible();

  await page.getByRole("button", { name: "3M" }).click();
  await expect.poll(() => lastFactorPeriod).toBe("3M");
  await expect(page.getByText("+3.40%")).toBeVisible();
});
