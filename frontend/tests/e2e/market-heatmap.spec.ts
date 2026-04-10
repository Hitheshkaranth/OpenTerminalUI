import { expect, test } from "@playwright/test";

test("market heatmap renders, drills, and navigates", async ({ page }) => {
  await page.route("**/api/heatmap/treemap**", async (route) => {
    await route.fulfill({
      json: {
        market: "IN",
        group: "sector",
        period: "1d",
        size_by: "market_cap",
        total_value: 580,
        data: [
          {
            symbol: "RELIANCE",
            name: "Reliance Industries",
            sector: "Energy",
            industry: "Integrated Oil & Gas",
            market_cap: 240,
            price: 2950,
            change_pct: 2.15,
            volume: 1200000,
            turnover: 3540000000,
            value: 240,
          },
          {
            symbol: "ONGC",
            name: "ONGC",
            sector: "Energy",
            industry: "Integrated Oil & Gas",
            market_cap: 90,
            price: 310,
            change_pct: -1.2,
            volume: 980000,
            turnover: 303800000,
            value: 90,
          },
          {
            symbol: "INFY",
            name: "Infosys",
            sector: "Technology",
            industry: "IT Services",
            market_cap: 140,
            price: 1820,
            change_pct: 0.8,
            volume: 800000,
            turnover: 1456000000,
            value: 140,
          },
          {
            symbol: "TCS",
            name: "Tata Consultancy Services",
            sector: "Technology",
            industry: "IT Services",
            market_cap: 110,
            price: 4100,
            change_pct: 1.45,
            volume: 420000,
            turnover: 1722000000,
            value: 110,
          },
        ],
        groups: [
          {
            name: "Energy",
            group_by: "sector",
            size_metric: "market_cap",
            value: 330,
            children: [
              {
                symbol: "RELIANCE",
                name: "Reliance Industries",
                sector: "Energy",
                industry: "Integrated Oil & Gas",
                market_cap: 240,
                price: 2950,
                change_pct: 2.15,
                volume: 1200000,
                turnover: 3540000000,
                value: 240,
              },
              {
                symbol: "ONGC",
                name: "ONGC",
                sector: "Energy",
                industry: "Integrated Oil & Gas",
                market_cap: 90,
                price: 310,
                change_pct: -1.2,
                volume: 980000,
                turnover: 303800000,
                value: 90,
              },
            ],
          },
          {
            name: "Technology",
            group_by: "sector",
            size_metric: "market_cap",
            value: 250,
            children: [
              {
                symbol: "INFY",
                name: "Infosys",
                sector: "Technology",
                industry: "IT Services",
                market_cap: 140,
                price: 1820,
                change_pct: 0.8,
                volume: 800000,
                turnover: 1456000000,
                value: 140,
              },
              {
                symbol: "TCS",
                name: "Tata Consultancy Services",
                sector: "Technology",
                industry: "IT Services",
                market_cap: 110,
                price: 4100,
                change_pct: 1.45,
                volume: 420000,
                turnover: 1722000000,
                value: 110,
              },
            ],
          },
        ],
      },
    });
  });

  await page.goto("/equity/heatmap", { waitUntil: "domcontentloaded" });

  await expect(page.getByText("Market Heatmap")).toBeVisible();
  await expect(page.getByTestId("market-heatmap-svg")).toBeVisible();
  await expect(page.locator('[data-testid="heatmap-rect"]').first()).toBeVisible();

  await page.getByTestId("heatmap-period-1w").click();
  await expect(page.getByTestId("heatmap-period-1w")).toHaveClass(/text-terminal-accent/);

  await page.locator('[data-testid="heatmap-rect"]').first().hover();
  await expect(page.getByText("Reliance Industries")).toBeVisible();

  await page.getByText("Energy").click();
  await expect(page.getByRole("button", { name: "Energy" })).toBeVisible();

  await page.unroute("**/api/heatmap/treemap**");
  await page.route("**/api/stocks/RELIANCE*", async (route) => {
    await route.fulfill({
      json: {
        ticker: "RELIANCE",
        name: "Reliance Industries",
        current_price: 2950,
        change_pct: 2.15,
      },
    });
  });

  await page.locator('[data-testid="heatmap-rect"]').first().click();
  await expect(page).toHaveURL(/\/equity\/security\/RELIANCE$/);
});
