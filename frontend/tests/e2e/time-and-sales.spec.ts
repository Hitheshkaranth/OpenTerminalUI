import { expect, test } from "@playwright/test";

test("time and sales page and security hub tape tab render", async ({ page }) => {
  const chartPayload = {
    symbol: "RELIANCE",
    interval: "1d",
    bars: 2,
    data: [
      { t: 1711929600, o: 2450, h: 2510, l: 2440, c: 2485, v: 1000000 },
      { t: 1712016000, o: 2485, h: 2525, l: 2475, c: 2500, v: 1100000 },
    ],
    meta: { warnings: [] },
  };

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/stocks/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        ticker: "RELIANCE",
        symbol: "RELIANCE",
        current_price: 2500,
        change_pct: 1.2,
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/v3/chart/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({ json: chartPayload });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/chart/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({ json: chartPayload });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/tape/RELIANCE/recent(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        trades: [
          { timestamp: "2026-04-05T12:00:01Z", price: 2500, quantity: 200, value: 500000, side: "buy" },
          { timestamp: "2026-04-05T12:00:00Z", price: 2499.5, quantity: 125, value: 312437.5, side: "sell" },
        ],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/tape/RELIANCE/summary(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        total_volume: 325,
        buy_volume: 200,
        sell_volume: 125,
        buy_pct: 61.5,
        large_trade_count: 1,
        avg_trade_size: 162.5,
        trades_per_min: 12.0,
      },
    });
  });

  await page.goto("/equity/tape", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Time & Sales")).toBeVisible();
  await expect(page.getByText("Total Volume")).toBeVisible();
  await expect(page.getByRole("button", { name: "Buys Only" })).toBeVisible();

  await page.getByRole("button", { name: "Buys Only" }).click();
  const buyRows = page.locator('[data-side="buy"]');
  await expect(buyRows.first()).toBeVisible();
  await expect(page.locator('[data-side="sell"]')).toHaveCount(0);

  await page.goto("/equity/security?ticker=RELIANCE", { waitUntil: "domcontentloaded" });
  await expect(page.getByRole("tab", { name: "Tape" })).toBeVisible();
  await page.getByRole("tab", { name: "Tape" }).click();
  await expect(page.getByText("Time & Sales")).toBeVisible();
  await expect(page.locator('[data-side="buy"], [data-side="sell"], [data-side="neutral"]').first()).toBeVisible();
});
