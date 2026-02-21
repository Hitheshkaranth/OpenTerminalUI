import { expect, test } from "@playwright/test";

function fakeJwt(payload: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: "none", typ: "JWT" })).toString("base64url");
  const body = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `${header}.${body}.sig`;
}

test("risk/oms/ops pages render with mocked APIs", async ({ page }) => {
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

  await page.route("**/api/risk/portfolio", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        symbols: ["RELIANCE"],
        portfolio_value: 1000000,
        confidence: 0.95,
        parametric: { var: 10000, es: 15000 },
        historical: { var: 9000, es: 14000 },
        rolling_covariance: [],
        factor_exposures: { market_beta: 1, momentum: 0.1, low_vol: 0.2, sector_tilt: 0.05 },
        scenarios: [{ id: "s1", name: "Equity -5%", pnl: -50000, post_value: 950000 }],
      }),
    });
  });
  await page.route("**/api/risk/scenarios", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/oms/orders", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/audit", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ items: [] }) });
  });
  await page.route("**/api/ops/feed-health", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ feed_state: "ok", ws_connected_clients: 1, ws_subscriptions: 10 }) });
  });
  await page.route("**/api/ops/kill-switch", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({ items: [{ id: "k1", scope: "orders", enabled: false, reason: "", updated_at: new Date().toISOString() }] }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ id: "k1", scope: "orders", enabled: true, reason: "x", updated_at: new Date().toISOString() }) });
  });

  await page.goto("/equity/risk");
  await expect(page.getByText("Portfolio Risk Dashboard")).toBeVisible();
  await page.goto("/equity/oms");
  await expect(page.getByText("Order Ticket + Compliance")).toBeVisible();
  await page.goto("/equity/ops");
  await expect(page.getByText("Ops Dashboard")).toBeVisible();
});
