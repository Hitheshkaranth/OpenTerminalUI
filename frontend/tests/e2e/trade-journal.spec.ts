import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("trade journal flow creates a trade and renders analytics", async ({ page }) => {
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

  const entries: any[] = [];

  const computeStats = () => {
    const closed = entries.filter((entry) => entry.pnl != null);
    const wins = closed.filter((entry) => entry.pnl > 0);
    const losses = closed.filter((entry) => entry.pnl < 0);
    const totalPnl = closed.reduce((sum, entry) => sum + entry.pnl, 0);
    return {
      total_trades: entries.length,
      open_trades: entries.filter((entry) => entry.exit_price == null).length,
      closed_trades: closed.length,
      win_rate: closed.length ? (wins.length / closed.length) * 100 : 0,
      avg_win_pct: wins.length ? wins.reduce((sum, entry) => sum + entry.pnl_pct, 0) / wins.length : 0,
      avg_loss_pct: losses.length ? losses.reduce((sum, entry) => sum + entry.pnl_pct, 0) / losses.length : 0,
      profit_factor: losses.length ? wins.reduce((sum, entry) => sum + entry.pnl, 0) / Math.abs(losses.reduce((sum, entry) => sum + entry.pnl, 0)) : null,
      largest_win: wins.length ? Math.max(...wins.map((entry) => entry.pnl)) : 0,
      largest_loss: losses.length ? Math.min(...losses.map((entry) => entry.pnl)) : 0,
      expectancy: closed.length ? totalPnl / closed.length : 0,
      current_streak: wins.length ? 1 : 0,
      best_streak: wins.length ? 1 : 0,
      worst_streak: losses.length ? -1 : 0,
      total_pnl: totalPnl,
      avg_pnl: closed.length ? totalPnl / closed.length : 0,
      by_strategy: [
        {
          strategy: "breakout",
          count: entries.length,
          win_rate: entries.length ? 100 : 0,
          avg_pnl: entries.length ? totalPnl / entries.length : 0,
        },
      ],
      by_day_of_week: [{ day: "Tue", count: entries.length, avg_pnl: entries.length ? totalPnl / entries.length : 0 }],
      by_emotion: [{ emotion: "confident", count: entries.length, win_rate: entries.length ? 100 : 0 }],
    };
  };

  await page.route("**/api/journal/stats", async (route) => {
    await route.fulfill({ json: computeStats() });
  });

  await page.route("**/api/journal/equity-curve", async (route) => {
    const cumulative = entries.reduce((sum, entry) => sum + (entry.pnl ?? 0), 0);
    await route.fulfill({
      json: {
        points: entries.length ? [{ date: "2026-04-01", cumulative_pnl: cumulative }] : [],
      },
    });
  });

  await page.route("**/api/journal/calendar", async (route) => {
    const total = entries.reduce((sum, entry) => sum + (entry.pnl ?? 0), 0);
    await route.fulfill({
      json: {
        days: entries.length ? [{ date: "2026-04-01", pnl: total, trade_count: entries.length }] : [],
      },
    });
  });

  await page.route("**/api/journal", async (route) => {
    if (route.request().method() === "GET") {
      await route.fulfill({ json: { entries } });
      return;
    }

    if (route.request().method() === "POST") {
      const payload = route.request().postDataJSON() as any;
      const entryPrice = Number(payload.entry_price);
      const exitPrice = payload.exit_price == null ? null : Number(payload.exit_price);
      const quantity = Number(payload.quantity);
      const fees = Number(payload.fees || 0);
      const pnl = exitPrice == null ? null : (exitPrice - entryPrice) * quantity - fees;
      const pnlPct = pnl == null ? null : (pnl / (entryPrice * quantity)) * 100;
      const entry = {
        id: entries.length + 1,
        user_id: "e2e-user",
        symbol: payload.symbol,
        direction: payload.direction,
        entry_date: payload.entry_date,
        entry_price: entryPrice,
        exit_date: payload.exit_date,
        exit_price: exitPrice,
        quantity,
        pnl,
        pnl_pct: pnlPct,
        fees,
        strategy: payload.strategy ?? "breakout",
        setup: payload.setup ?? "bull-flag",
        emotion: payload.emotion ?? "confident",
        notes: payload.notes ?? "",
        tags: payload.tags ?? [],
        rating: payload.rating ?? 0,
        created_at: payload.entry_date,
        updated_at: payload.entry_date,
      };
      entries.unshift(entry);
      await route.fulfill({ json: { entry, status: "created" } });
    }
  });

  await page.goto("/equity/journal", { waitUntil: "domcontentloaded" });

  await page.getByTestId("add-trade-button").click();
  await page.getByTestId("journal-entry-form").getByPlaceholder("RELIANCE").fill("RELIANCE");
  await page.getByTestId("journal-entry-form").locator('input[type="datetime-local"]').first().fill("2026-04-01T09:15");
  await page.getByTestId("journal-entry-form").locator('input[type="number"]').nth(0).fill("2500");
  await page.getByTestId("journal-entry-form").locator('input[type="datetime-local"]').nth(1).fill("2026-04-01T15:20");
  await page.getByTestId("journal-entry-form").locator('input[type="number"]').nth(1).fill("2600");
  await page.getByTestId("journal-entry-form").locator('input[type="number"]').nth(2).fill("10");
  await page.getByRole("button", { name: /^Save$/i }).click();

  await expect(page.getByTestId("journal-card")).toContainText("RELIANCE");
  await expect(page.getByTestId("journal-pnl").first()).toContainText("+$1,000");

  await page.getByRole("tab", { name: "Analytics" }).click();
  await expect(page.getByTestId("journal-equity-curve")).toBeVisible();
  await expect(page.getByText("Total Trades")).toBeVisible();
  await expect(page.getByText("Win Rate")).toBeVisible();
  await expect(page.getByText("1")).toBeVisible();
});
