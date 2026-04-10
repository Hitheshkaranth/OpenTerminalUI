import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("options flow page renders summary, filters, heat bars, and row expansion", async ({ page }) => {
  const accessToken = makeJwt({
    sub: "e2e-user",
    email: "e2e@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });
  await page.addInitScript(
    ([at, rt]) => {
      localStorage.setItem("ot-access-token", at);
      localStorage.setItem("ot-refresh-token", rt);
    },
    [accessToken, refreshToken],
  );

  const unusual = {
    count: 3,
    flows: [
      {
        timestamp: "2026-04-05T10:30:00+00:00",
        symbol: "NIFTY",
        expiry: "2026-04-30",
        strike: 22500,
        option_type: "CE",
        volume: 25000,
        avg_volume: 8200,
        volume_ratio: 3.05,
        oi: 150000,
        oi_change: 4800,
        premium_value: 412500000,
        implied_vol: 18.4,
        sentiment: "bullish",
        heat_score: 82.4,
        spot_price: 22495,
        chain_context: {
          atm_strike: 22500,
          pcr_oi: 1.08,
          pcr_volume: 0.94,
          strike_row: {
            strike_price: 22500,
            ce: { oi: 150000, oi_change: 4800, volume: 25000, iv: 18.4, ltp: 165, bid: 164, ask: 166, greeks: { delta: 0.5, gamma: 0.1, theta: -0.1, vega: 0.2, rho: 0.1 } },
            pe: { oi: 142000, oi_change: 2100, volume: 9000, iv: 19.8, ltp: 152, bid: 151, ask: 153, greeks: { delta: -0.5, gamma: 0.1, theta: -0.1, vega: 0.2, rho: -0.1 } },
          },
        },
      },
      {
        timestamp: "2026-04-05T10:20:00+00:00",
        symbol: "NIFTY",
        expiry: "2026-04-30",
        strike: 22400,
        option_type: "PE",
        volume: 23000,
        avg_volume: 7600,
        volume_ratio: 3.02,
        oi: 132000,
        oi_change: 5100,
        premium_value: 368000000,
        implied_vol: 20.1,
        sentiment: "bearish",
        heat_score: 79.2,
        spot_price: 22495,
        chain_context: {
          atm_strike: 22500,
          pcr_oi: 1.08,
          pcr_volume: 0.94,
          strike_row: {
            strike_price: 22400,
            ce: { oi: 118000, oi_change: 1900, volume: 7000, iv: 17.1, ltp: 201, bid: 200, ask: 202, greeks: { delta: 0.6, gamma: 0.1, theta: -0.1, vega: 0.2, rho: 0.1 } },
            pe: { oi: 132000, oi_change: 5100, volume: 23000, iv: 20.1, ltp: 160, bid: 159, ask: 161, greeks: { delta: -0.4, gamma: 0.1, theta: -0.1, vega: 0.2, rho: -0.1 } },
          },
        },
      },
      {
        timestamp: "2026-04-05T10:10:00+00:00",
        symbol: "BANKNIFTY",
        expiry: "2026-05-07",
        strike: 48500,
        option_type: "CE",
        volume: 14000,
        avg_volume: 5200,
        volume_ratio: 2.69,
        oi: 104000,
        oi_change: 3100,
        premium_value: 289000000,
        implied_vol: 16.2,
        sentiment: "bullish",
        heat_score: 71.3,
        spot_price: 48420,
        chain_context: {
          atm_strike: 48500,
          pcr_oi: 0.92,
          pcr_volume: 0.88,
          strike_row: {
            strike_price: 48500,
            ce: { oi: 104000, oi_change: 3100, volume: 14000, iv: 16.2, ltp: 206.4, bid: 206, ask: 207, greeks: { delta: 0.5, gamma: 0.1, theta: -0.1, vega: 0.2, rho: 0.1 } },
            pe: { oi: 97000, oi_change: 1800, volume: 8000, iv: 17.4, ltp: 188.2, bid: 188, ask: 189, greeks: { delta: -0.5, gamma: 0.1, theta: -0.1, vega: 0.2, rho: -0.1 } },
          },
        },
      },
    ],
  };

  const summary1d = {
    total_premium: 1069500000,
    bullish_premium: 701500000,
    bearish_premium: 368000000,
    bullish_pct: 65.59,
    bearish_pct: 34.41,
    top_symbols: [
      { symbol: "NIFTY", premium: 780500000, flow_count: 2 },
      { symbol: "BANKNIFTY", premium: 289000000, flow_count: 1 },
    ],
    premium_by_hour: [
      { hour: "2026-04-05T09:00:00+00:00", bullish: 120000000, bearish: 64000000 },
      { hour: "2026-04-05T10:00:00+00:00", bullish: 581500000, bearish: 304000000 },
    ],
  };

  const summary5d = {
    ...summary1d,
    premium_by_hour: [
      { hour: "2026-04-01T09:00:00+00:00", bullish: 145000000, bearish: 55000000 },
      { hour: "2026-04-02T09:00:00+00:00", bullish: 182000000, bearish: 74000000 },
      { hour: "2026-04-03T09:00:00+00:00", bullish: 210000000, bearish: 96000000 },
      { hour: "2026-04-04T09:00:00+00:00", bullish: 250000000, bearish: 101000000 },
      { hour: "2026-04-05T09:00:00+00:00", bullish: 281500000, bearish: 118000000 },
    ],
  };

  await page.route("**/api/**", async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;

    if (pathname.includes("/fno/chain/") && pathname.endsWith("/expiries")) {
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ symbol: "NIFTY", expiries: ["2026-04-30", "2026-05-07"] }),
      });
      return;
    }

    if (pathname === "/api/fno/flow/unusual") {
      await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify(unusual) });
      return;
    }

    if (pathname === "/api/fno/flow/summary") {
      const period = url.searchParams.get("period");
      await route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify(period === "5d" ? summary5d : summary1d),
      });
      return;
    }

    await route.continue();
  });

  await page.goto("/fno/flow");

  const demoButton = page.getByRole("button", { name: />\s*DEMO ACCESS/i });
  if (await demoButton.isVisible().catch(() => false)) {
    await demoButton.click();
    await page.goto("/fno/flow");
  }

  await expect(page.getByText("Options Flow")).toBeVisible();
  await expect(page.getByText("Total Premium")).toBeVisible();
  await expect(page.getByText("$1069.50M")).toBeVisible();
  await expect(page.getByRole("button", { name: "Calls" })).toBeVisible();
  await expect(page.locator("[data-testid='flow-row']")).toHaveCount(3);

  await page.getByRole("button", { name: "Calls" }).click();
  await expect(page.locator("[data-testid='flow-row']")).toHaveCount(2);
  await expect(page.getByText("PE")).toHaveCount(0);

  await expect(page.locator("[data-testid='heat-score-bar']")).toHaveCount(2);

  await page.locator("[data-testid='flow-row']").first().click();
  await expect(page.getByText("Option Chain Context")).toBeVisible();
  await expect(page.getByRole("link", { name: "Open Full Chain" })).toBeVisible();
});
