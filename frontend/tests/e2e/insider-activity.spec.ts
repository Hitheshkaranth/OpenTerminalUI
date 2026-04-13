import { expect, test } from "@playwright/test";

test("insider activity page and security hub insider tab render", async ({ page }) => {
  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/insider/recent(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        trades: [
          {
            date: "2026-04-02",
            symbol: "RELIANCE",
            name: "Reliance Industries",
            insider_name: "Mukesh Ambani",
            designation: "Promoter",
            type: "buy",
            quantity: 100000,
            price: 2500,
            value: 250000000,
            post_holding_pct: 49.1,
          },
          {
            date: "2026-04-01",
            symbol: "INFY",
            name: "Infosys",
            insider_name: "Nandan Nilekani",
            designation: "Chairman",
            type: "sell",
            quantity: 50000,
            price: 1600,
            value: 80000000,
            post_holding_pct: 12.4,
          },
        ],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/insider/top-buyers(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        buyers: [
          {
            symbol: "RELIANCE",
            name: "Reliance Industries",
            total_value: 250000000,
            trade_count: 3,
            latest_date: "2026-04-02",
          },
        ],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/insider/top-sellers(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        sellers: [
          {
            symbol: "INFY",
            name: "Infosys",
            total_value: 80000000,
            trade_count: 2,
            latest_date: "2026-04-01",
          },
        ],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/insider/cluster-buys(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        clusters: [
          {
            symbol: "RELIANCE",
            name: "Reliance Industries",
            insider_count: 3,
            total_value: 250000000,
            insiders: [
              { name: "Mukesh Ambani", designation: "Promoter", value: 150000000, date: "2026-04-02" },
              { name: "Nita Ambani", designation: "Director", value: 60000000, date: "2026-04-02" },
              { name: "Isha Ambani", designation: "Director", value: 40000000, date: "2026-04-01" },
            ],
          },
        ],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/insider/stock/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        trades: [
          {
            date: "2026-04-02",
            symbol: "RELIANCE",
            insider_name: "Mukesh Ambani",
            designation: "Promoter",
            type: "buy",
            quantity: 100000,
            price: 2500,
            value: 250000000,
          },
        ],
        summary: {
          total_buys: 250000000,
          total_sells: 50000000,
          net_value: 200000000,
          insider_count: 3,
        },
      },
    });
  });

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

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/v3/chart/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({ json: chartPayload });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/chart/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({ json: chartPayload });
  });

  await page.goto("/equity/insider", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Insider Activity")).toBeVisible();
  await expect(page.getByText("Total Buy Value (30d)")).toBeVisible();
  await expect(page.getByText("Dense Table").first()).toBeVisible();

  await page.getByRole("tab", { name: "Cluster Buys" }).click();
  await expect(page.locator('[data-testid="cluster-buy-card"]').first()).toBeVisible();

  await page.getByRole("tab", { name: "Top Buyers" }).click();
  await expect(page.getByText("Value Ladder")).toBeVisible();
  await expect(page.getByText("Highest accumulated insider buy value over 90 days")).toBeVisible();

  await page.goto("/equity/security?ticker=RELIANCE", { waitUntil: "domcontentloaded" });
  await page.getByRole("tab", { name: "Insider" }).click();
  await expect(page.getByText("Insider Timeline")).toBeVisible();
  await expect(page.getByText("Insider Trades")).toBeVisible();
});
