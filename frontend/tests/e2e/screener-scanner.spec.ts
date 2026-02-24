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

  await page.route("**/api/screener/presets", async (route) => {
    if (route.request().method() === "GET") {
      return route.fulfill({
        status: 200,
        contentType: "application/json",
        body: JSON.stringify({
          items: [
            {
              id: "p1",
              name: "20D High Breakout + RVOL",
              category: "technical",
              query: "Market Capitalization > 500",
              universe: "NSE:NIFTY200",
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            },
          ],
        }),
      });
    }
    return route.fulfill({ status: 200, contentType: "application/json", body: "{}" });
  });

  await page.route("**/api/screener/run-revamped", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        run_id: "r1",
        count: 1,
        results: [
          {
            ticker: "RELIANCE",
            company: "RELIANCE INDUSTRIES",
            sector: "Energy",
            market_cap: 1500000,
            pe: 25.4,
            roe: 18.2,
            roce: 16.5,
            scores: { quality_score: { value: 85 } },
          },
        ],
      }),
    });
  });

  await page.route("**/api/screener/screens", async (route) => {
    await route.fulfill({ status: 200, json: { items: [] } });
  });

  await page.route("**/api/screener/public", async (route) => {
    await route.fulfill({ status: 200, json: { items: [] } });
  });

  await page.route("**/api/v1/alerts/scanner-rules", async (route) => {
    await route.fulfill({ status: 200, contentType: "application/json", body: JSON.stringify({ status: "created", id: "a1" }) });
  });

  await page.goto("/equity/screener");
  await expect(page.getByText("Screener Library")).toBeVisible();
  await page.getByRole("button", { name: "20D High Breakout + RVOL" }).click();
  await expect(page.getByText("Results")).toBeVisible();
  await expect(page.getByRole("cell", { name: "RELIANCE" }).first()).toBeVisible();
});
