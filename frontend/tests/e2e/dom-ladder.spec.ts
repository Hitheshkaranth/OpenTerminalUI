import { expect, test } from "@playwright/test";

const depthPayload = {
  symbol: "RELIANCE",
  market: "IN",
  provider_key: "kite",
  as_of: "2026-04-05T12:00:00Z",
  mid_price: 100,
  spread: 0.1,
  spread_pct: 0.1,
  tick_size: 0.05,
  levels: 20,
  total_bid_quantity: 2350,
  total_ask_quantity: 2130,
  total_bid_qty: 2350,
  total_ask_qty: 2130,
  last_price: 100,
  last_qty: 150,
  imbalance: 0.049107,
  bids: [
    { price: 99.95, quantity: 120, size: 120, orders: 3, cumulative_qty: 120 },
    { price: 99.9, quantity: 170, size: 170, orders: 4, cumulative_qty: 290 },
    { price: 99.85, quantity: 210, size: 210, orders: 5, cumulative_qty: 500 },
    { price: 99.8, quantity: 260, size: 260, orders: 6, cumulative_qty: 760 },
    { price: 99.75, quantity: 310, size: 310, orders: 6, cumulative_qty: 1070 },
    { price: 99.7, quantity: 360, size: 360, orders: 7, cumulative_qty: 1430 },
    { price: 99.65, quantity: 420, size: 420, orders: 8, cumulative_qty: 1850 },
    { price: 99.6, quantity: 500, size: 500, orders: 9, cumulative_qty: 2350 },
  ],
  asks: [
    { price: 100.05, quantity: 110, size: 110, orders: 3, cumulative_qty: 110 },
    { price: 100.1, quantity: 150, size: 150, orders: 3, cumulative_qty: 260 },
    { price: 100.15, quantity: 190, size: 190, orders: 4, cumulative_qty: 450 },
    { price: 100.2, quantity: 240, size: 240, orders: 5, cumulative_qty: 690 },
    { price: 100.25, quantity: 290, size: 290, orders: 6, cumulative_qty: 980 },
    { price: 100.3, quantity: 340, size: 340, orders: 7, cumulative_qty: 1320 },
    { price: 100.35, quantity: 390, size: 390, orders: 8, cumulative_qty: 1710 },
    { price: 100.4, quantity: 420, size: 420, orders: 8, cumulative_qty: 2130 },
  ],
};

test("dom ladder renders and supports cumulative and auto-center controls", async ({ page }) => {
  await page.route("**/api/depth/**", async (route) => {
    await route.fulfill({ json: depthPayload });
  });

  await page.route("**/api/stocks/**", async (route) => {
    await route.fulfill({
      json: {
        ticker: "RELIANCE",
        symbol: "RELIANCE",
        current_price: 100,
        change_pct: 1.25,
      },
    });
  });

  await page.route("**/api/tape/RELIANCE/recent**", async (route) => {
    await route.fulfill({
      json: {
        trades: [
          { timestamp: "2026-04-05T12:00:01Z", price: 100.0, quantity: 200, side: "buy" },
          { timestamp: "2026-04-05T12:00:00Z", price: 99.95, quantity: 125, side: "sell" },
        ],
      },
    });
  });

  await page.route("**/api/tape/RELIANCE/summary**", async (route) => {
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

  await page.goto("/equity/dom", { waitUntil: "networkidle" });

  await expect(page.getByText("DOM Ladder")).toBeVisible();
  await expect(page.locator('[data-testid="dom-row"]').first()).toBeVisible();

  const bidCell = page.locator('[data-testid="dom-bid-cell"]').filter({ hasText: "120" }).first();
  const askCell = page.locator('[data-testid="dom-ask-cell"]').filter({ hasText: "110" }).first();
  await expect(bidCell).toBeVisible();
  await expect(askCell).toBeVisible();

  await expect(page.getByText("10.0 bps")).toBeVisible();

  const bidBefore = page.locator('[data-price="99.9"]').getByTestId("dom-bid-qty");
  await expect(bidBefore).toHaveText("170");

  await page.getByRole("button", { name: "Cumulative" }).click();
  await expect(page.locator('[data-price="99.9"]').getByTestId("dom-bid-qty")).toHaveText("290");

  const scrollTop = await page.getByTestId("dom-scroll-region").evaluate((node) => node.scrollTop);
  expect(scrollTop).toBeGreaterThan(0);
  await expect(page.locator('[data-price="100"]')).toBeVisible();
});
