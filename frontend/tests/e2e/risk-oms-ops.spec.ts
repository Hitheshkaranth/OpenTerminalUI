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

  await page.route("**/api/risk/summary**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        ewma_vol: 0.15,
        beta: 1.02,
        marginal_contribution: { RELIANCE: 0.12 },
      }),
    });
  });
  await page.route("**/api/risk/exposures**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        pca_factors: [{ factor: "PC1", variance_explained: 0.62 }],
        loadings: { RELIANCE: [0.81] },
      }),
    });
  });
  await page.route("**/api/risk/correlation**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ assets: ["RELIANCE"], matrix: [[1]] }),
    });
  });
  await page.route("**/api/risk/sector-concentration**", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({ sectors: { Energy: 100 }, industries: { Refining: 100 } }),
    });
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
  await page.route("**/api/quotes**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ market: "NASDAQ", quotes: [] }) });
  });
  await page.route("**/api/search**", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ results: [] }) });
  });

  await page.goto("/equity/risk");
  await expect(page.getByText("RISK ENGINE CONTROL")).toBeVisible();
  await page.goto("/equity/oms");
  await expect(page.getByText("Order Ticket + Compliance")).toBeVisible();
  await page.goto("/equity/ops");
  await expect(page.getByText("Operational Workspace Control")).toBeVisible();
});
