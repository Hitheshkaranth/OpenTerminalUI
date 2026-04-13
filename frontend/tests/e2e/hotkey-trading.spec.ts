import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

async function login(page: import("@playwright/test").Page) {
  const accessToken = makeJwt({
    sub: "hotkey-e2e-user",
    email: "hotkey@example.com",
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
}

test("ctrl+t opens paper hotkey trading widget and submits a mock buy order", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "chromium", "Desktop hotkey flow");

  let orderCount = 0;

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/paper/portfolios(?:\?.*)?$`), async (route) => {
    if (route.request().method() !== "GET") return route.fallback();
    await route.fulfill({
      json: {
        items: [{ id: "paper-1", name: "Desk Sim", initial_capital: 100000, current_cash: 75000, is_active: true }],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/paper/portfolios/paper-1/positions(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        items: [{ id: "pos-1", symbol: "NSE:RELIANCE", quantity: 5, avg_entry_price: 2480, mark_price: 2500, unrealized_pnl: 100 }],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/paper/portfolios/paper-1/orders(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        items: [
          {
            id: `order-${orderCount || 0}`,
            symbol: "NSE:RELIANCE",
            side: "buy",
            order_type: "market",
            quantity: 10,
            status: "filled",
            fill_price: 2500,
            fill_time: "2026-04-05T20:45:00Z",
          },
        ],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/depth/RELIANCE(?:\?.*)?$`), async (route) => {
    await route.fulfill({
      json: {
        symbol: "RELIANCE",
        market: "NSE",
        provider_key: "mock",
        as_of: "2026-04-05T20:45:00Z",
        mid_price: 2500,
        spread: 0.5,
        spread_pct: 0.02,
        tick_size: 0.05,
        levels: 5,
        total_bid_quantity: 500,
        total_ask_quantity: 450,
        total_bid_qty: 500,
        total_ask_qty: 450,
        last_price: 2500,
        last_qty: 25,
        imbalance: 0.12,
        bids: [{ price: 2499.75, quantity: 200, orders: 4 }],
        asks: [{ price: 2500.25, quantity: 180, orders: 3 }],
      },
    });
  });

  await page.context().route(new RegExp(String.raw`http://127\.0\.0\.1:\d+/api/paper/orders(?:\?.*)?$`), async (route) => {
    orderCount += 1;
    await route.fulfill({
      json: {
        id: `order-${orderCount}`,
        status: "filled",
        symbol: "NSE:RELIANCE",
        fill_price: 2500,
        fill_time: "2026-04-05T20:45:00Z",
      },
    });
  });

  await login(page);
  await page.goto("/equity/paper", { waitUntil: "domcontentloaded" });
  await page.getByPlaceholder(/Type ticker, command, or search/i).waitFor({ state: "visible", timeout: 15_000 });

  await page.keyboard.press(process.platform === "darwin" ? "Meta+T" : "Control+T");

  const widget = page.getByTestId("hotkey-panel-float");
  await expect(widget).toBeVisible();
  await expect(widget.getByText("Paper")).toBeVisible();
  await expect(widget.getByTestId("hotkey-symbol")).toContainText("RELIANCE");
  await expect(widget.locator("select")).toHaveValue("paper-1");

  await widget.getByLabel("Quantity").fill("10");
  await expect(widget.getByRole("button", { name: /BUY/i })).toBeEnabled();
  await widget.getByRole("button", { name: /BUY/i }).click();

  await expect(widget.getByText(/BUY 10/i)).toBeVisible();
  await expect(widget.locator("div").filter({ hasText: /^2,500\.00$/ }).first()).toBeVisible();
  await expect(widget.getByRole("button", { name: /SELL \(S\)/i })).toBeVisible();

  await page.keyboard.press(process.platform === "darwin" ? "Meta+T" : "Control+T");
  await expect(widget).toBeHidden();
});
