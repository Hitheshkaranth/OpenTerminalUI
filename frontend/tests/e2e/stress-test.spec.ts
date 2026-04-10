import { expect, test } from "@playwright/test";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

const predefinedScenarios = [
  {
    id: "gfc_2008",
    name: "2008 Global Financial Crisis",
    description: "Lehman collapse, credit freeze, equity meltdown",
    severity: "extreme",
    shocks: { equity: -0.4, rates: -0.02, volatility: 1.5, credit_spread: 0.04, gold: 0.15, fx_inr: -0.12 },
  },
  {
    id: "covid_2020",
    name: "2020 COVID Crash",
    description: "Pandemic selloff, March 2020",
    severity: "extreme",
    shocks: { equity: -0.35, rates: -0.015, volatility: 2.0, gold: 0.1, fx_inr: -0.06 },
  },
  {
    id: "rate_shock_200bps",
    name: "Rate Shock +200bps",
    description: "Sudden rate hike cycle, duration impact",
    severity: "high",
    shocks: { equity: -0.1, rates: 0.02, volatility: 0.3, credit_spread: 0.01 },
  },
  {
    id: "inr_depreciation",
    name: "INR Depreciation 10%",
    description: "Currency stress, capital outflows",
    severity: "medium",
    shocks: { equity: -0.08, fx_inr: -0.1, volatility: 0.2 },
  },
  {
    id: "tech_rotation",
    name: "Tech Sector Rotation",
    description: "Growth to value rotation, tech selloff",
    severity: "high",
    shocks: { equity: -0.05, sector_tech: -0.25, sector_value: 0.15 },
  },
  {
    id: "commodity_spike",
    name: "Commodity Price Spike",
    description: "Oil +50%, inflation surge",
    severity: "high",
    shocks: { equity: -0.12, rates: 0.01, gold: 0.2, crude_oil: 0.5 },
  },
];

test("stress test tab renders scenarios and runs predefined plus custom analysis", async ({ page }) => {
  test.slow();

  const token = fakeJwt({
    sub: "u_e2e",
    email: "trader@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });

  let history = [
    {
      id: "seed-1",
      scenario_name: "Prior Run",
      run_date: new Date().toISOString(),
      total_impact_pct: -0.031,
    },
  ];

  await page.addInitScript((jwt) => {
    localStorage.setItem("ot-access-token", jwt);
    localStorage.setItem("ot-refresh-token", "dummy");
  }, token);

  await page.route("**/api/risk/summary**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ ewma_vol: 0.15, beta: 1.02, marginal_contribution: { AAPL: 0.12 } }),
    });
  });
  await page.route("**/api/risk/exposures**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ pca_factors: [{ factor: "PC1", variance_explained: 0.62 }] }),
    });
  });
  await page.route("**/api/risk/correlation**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assets: ["AAPL"], matrix: [[1]] }),
    });
  });
  await page.route("**/api/risk/sector-concentration**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sectors: { Technology: 100 } }),
    });
  });
  await page.route("**/api/risk/scenarios/predefined", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(predefinedScenarios) });
  });
  await page.route("**/api/risk/scenarios/history", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(history) });
  });
  await page.route("**/api/risk/scenarios/run", async (route) => {
    const body = route.request().postDataJSON() as { scenario_id?: string; custom_shocks?: Record<string, number> };
    const custom = Boolean(body.custom_shocks);
    const response = {
      scenario_name: custom ? "Custom Scenario" : "2008 Global Financial Crisis",
      total_impact_pct: custom ? -0.142 : -0.227,
      total_impact_value: custom ? -24500 : -40250,
      by_holding: [
        { symbol: "AAPL", sector: "Technology", weight: 0.35, current_value: 18000, impact_pct: custom ? -0.18 : -0.29, impact_value: custom ? -3240 : -5220, new_value: 14760 },
        { symbol: "JPM", sector: "Financials", weight: 0.25, current_value: 12800, impact_pct: custom ? -0.12 : -0.23, impact_value: custom ? -1536 : -2944, new_value: 9856 },
        { symbol: "RELIANCE.NS", sector: "Energy", weight: 0.28, current_value: 336000, impact_pct: custom ? -0.05 : -0.11, impact_value: custom ? -16800 : -36960, new_value: 299040 },
        { symbol: "XOM", sector: "Energy", weight: 0.12, current_value: 10350, impact_pct: custom ? 0.01 : -0.03, impact_value: custom ? 104 : -310, new_value: 10040 },
      ],
      by_sector: [
        { sector: "Technology", weight: 0.35, impact_pct: custom ? -0.18 : -0.29, impact_value: custom ? -3240 : -5220 },
        { sector: "Financials", weight: 0.25, impact_pct: custom ? -0.12 : -0.23, impact_value: custom ? -1536 : -2944 },
        { sector: "Energy", weight: 0.4, impact_pct: custom ? -0.05 : -0.1, impact_value: custom ? -16696 : -37270 },
      ],
      worst_holdings: [
        { symbol: "AAPL", sector: "Technology", current_value: 18000, impact_pct: custom ? -0.18 : -0.29, impact_value: custom ? -3240 : -5220 },
        { symbol: "JPM", sector: "Financials", current_value: 12800, impact_pct: custom ? -0.12 : -0.23, impact_value: custom ? -1536 : -2944 },
        { symbol: "RELIANCE.NS", sector: "Energy", current_value: 336000, impact_pct: custom ? -0.05 : -0.11, impact_value: custom ? -16800 : -36960 },
        { symbol: "XOM", sector: "Energy", current_value: 10350, impact_pct: custom ? 0.01 : -0.03, impact_value: custom ? 104 : -310 },
      ],
    };
    history = [
      {
        id: custom ? "custom-1" : "gfc-1",
        scenario_name: response.scenario_name,
        run_date: new Date().toISOString(),
        total_impact_pct: response.total_impact_pct,
      },
      ...history,
    ];
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(response) });
  });
  await page.route("**/api/risk/scenarios/monte-carlo", async (route) => {
    const paths = Array.from({ length: 100 }, (_, index) =>
      Array.from({ length: 22 }, (_unused, step) => -0.01 * step + index * 0.0002),
    );
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        percentiles: { p5: -0.28, p25: -0.18, p50: -0.12, p75: -0.06, p95: 0.03 },
        worst_case: -0.35,
        best_case: 0.08,
        paths,
      }),
    });
  });
  await page.route("**/api/search**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });
  await page.route("**/api/quotes**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ market: "NASDAQ", quotes: [] }) });
  });

  await page.goto("/equity/risk");
  await expect(page.getByText("RISK ENGINE CONTROL")).toBeVisible({ timeout: 90_000 });

  await page.getByRole("button", { name: "STRESS TEST" }).click();
  await expect(page.getByText("Scenario Library")).toBeVisible();
  await expect(page.getByText("2008 Global Financial Crisis")).toBeVisible();
  await expect(page.getByText("Custom Scenario").first()).toBeVisible();
  await expect(page.locator("text=Lehman collapse, credit freeze, equity meltdown")).toBeVisible();
  await expect(page.getByRole("button", { name: "Run" })).toHaveCount(6);

  const gfcCard = page.locator("div").filter({ has: page.getByText("2008 Global Financial Crisis") }).first();
  await gfcCard.getByRole("button", { name: "Run" }).click();
  await expect(page.getByText("Results Panel")).toBeVisible();
  await expect(page.getByText("-22.70%")).toBeVisible();
  await expect(page.getByTestId("impact-by-holding-chart")).toBeVisible();

  await page.getByRole("button", { name: "Configure" }).click();
  const equitySlider = page.getByLabel("Equity shock");
  await equitySlider.evaluate((element) => {
    const input = element as HTMLInputElement;
    input.value = "-30";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  });
  await page.getByRole("button", { name: "Run Custom Scenario" }).click();
  await expect(page.getByText("Custom Scenario")).toBeVisible();
  await expect(page.getByText("-14.20%")).toBeVisible();
});
