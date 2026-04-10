import { expect, test } from "@playwright/test";

function makeSeries(interval: string, symbol: string) {
  const seed = symbol === "TCS" ? 4100 : 2850;
  const stepMap: Record<string, number> = {
    "1mo": 2_592_000,
    "1wk": 604_800,
    "1d": 86_400,
    "4h": 14_400,
    "1h": 3_600,
    "15m": 900,
    "5m": 300,
    "1m": 60,
  };
  const step = stepMap[interval] ?? 86_400;

  return Array.from({ length: 24 }, (_, index) => {
    const close = seed + index * 6 + (interval === "1m" ? 1 : 0);
    return {
      t: 1_708_000_000 + index * step,
      o: close - 5,
      h: close + 8,
      l: close - 9,
      c: close,
      v: 100_000 + index * 1_000,
    };
  });
}

test.describe("Multi-timeframe dashboard", () => {
  test.beforeEach(async ({ page }) => {
    await page.route("**/api/search**", async (route) => {
      const url = new URL(route.request().url());
      const q = (url.searchParams.get("q") || "").toUpperCase();
      const symbol = q.includes("TCS") ? "TCS" : "RELIANCE";
      await route.fulfill({
        json: {
          results: [{ ticker: symbol, name: symbol === "TCS" ? "Tata Consultancy Services" : "Reliance Industries", country_code: "IN" }],
        },
      });
    });

    const fulfillChart = async (route: Parameters<typeof page.route>[1] extends (arg: infer T) => any ? T : never) => {
      const url = new URL(route.request().url());
      const parts = url.pathname.split("/");
      const symbol = decodeURIComponent(parts[parts.length - 1] || "RELIANCE").toUpperCase();
      const interval = (url.searchParams.get("interval") || "1d").toLowerCase();
      await route.fulfill({
        json: {
          ticker: symbol,
          interval,
          currency: "INR",
          data: makeSeries(interval, symbol),
        },
      });
    };

    await page.route("**/api/chart/**", fulfillChart);
    await page.route("**/api/v3/chart/**", fulfillChart);

    await page.goto("/equity/mta", { waitUntil: "domcontentloaded" });
  });

  test("renders four panels, updates symbol and preset, and stacks on mobile", async ({ page }) => {
    await expect(page.getByTestId("mta-page")).toBeVisible();
    await expect(page.locator('[data-testid^="mta-panel-"]')).toHaveCount(4);

    await expect(page.getByTestId("mta-interval-long-term")).toHaveText("W");
    await expect(page.getByTestId("mta-interval-medium-term")).toHaveText("D");
    await expect(page.getByTestId("mta-interval-short-term")).toHaveText("4H");
    await expect(page.getByTestId("mta-interval-execution")).toHaveText("1H");

    await page.getByTestId("mta-symbol-input").fill("TCS");
    await page.getByText("TCS").click();
    await expect(page.locator('[data-testid^="mta-panel-"] >> text=TCS')).toHaveCount(4);

    await page.getByTestId("mta-preset-day-trade").click();
    await expect(page.getByTestId("mta-interval-long-term")).toHaveText("D");
    await expect(page.getByTestId("mta-interval-medium-term")).toHaveText("1H");
    await expect(page.getByTestId("mta-interval-short-term")).toHaveText("15m");
    await expect(page.getByTestId("mta-interval-execution")).toHaveText("5m");

    await expect(page.getByTestId("mta-trend-summary")).toBeVisible();
    await expect(page.locator('[data-testid^="mta-trend-arrow-"]')).toHaveCount(4);
    await expect(page.getByTestId("mta-crosshair-toggle")).toBeVisible();

    await page.setViewportSize({ width: 480, height: 900 });
    await page.reload({ waitUntil: "domcontentloaded" });
    await expect(page.locator('[data-testid^="mta-panel-"]')).toHaveCount(4);

    const firstBox = await page.getByTestId("mta-panel-long-term").boundingBox();
    const secondBox = await page.getByTestId("mta-panel-medium-term").boundingBox();
    expect(firstBox).not.toBeNull();
    expect(secondBox).not.toBeNull();
    expect((secondBox?.y ?? 0) > (firstBox?.y ?? 0) + 20).toBeTruthy();
  });
});

