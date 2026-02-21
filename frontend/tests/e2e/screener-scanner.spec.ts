import { expect, test } from "@playwright/test";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("screener run and scanner alert flow renders", async ({ page }) => {
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

  await page.route("**/api/v1/screener/presets", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "p1",
              name: "20D High Breakout + RVOL",
              universe: "NSE:NIFTY200",
              timeframe: "1d",
              liquidity_gate: { min_price: 50, min_avg_volume: 100000, min_avg_traded_value: 5000000 },
              rules: [{ type: "breakout_n_day_high", params: { n: 20, buffer_pct: 0.001, rvol_threshold: 2, near_trigger_pct: 0.003 } }],
              ranking: { mode: "default", params: {} },
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/v1/screener/run", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: "r1",
        count: 1,
        summary: { matches: 1 },
        rows: [
          {
            symbol: "RELIANCE",
            setup_type: "20D_BREAKOUT",
            score: 2.14,
            breakout_level: 2450.5,
            distance_to_trigger: 0.001,
            explain: { steps: [{ rule: "rvol_threshold", passed: true, value: 2.4, expected: ">=2.0" }] },
          },
        ],
      }),
    });
  });

  await page.route("**/api/v1/alerts/scanner-rules", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "created", id: "a1" }) });
  });

  await page.goto("/equity/screener");
  await expect(page.getByText("Screener Presets")).toBeVisible();
  await page.getByRole("button", { name: "Run Preset" }).click();
  await expect(page.getByText("Today's Setups")).toBeVisible();
  await expect(page.getByText("RELIANCE")).toBeVisible();
});
