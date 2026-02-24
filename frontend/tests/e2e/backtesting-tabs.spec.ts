import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("backtesting tabs and compare panel render with mocked jobs", async ({ page }) => {
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

  await page.goto("/backtesting");
  await expect(page.getByText("Backtesting Control Deck")).toBeVisible();
  const vizPanel = page
    .locator("section")
    .filter({ has: page.locator(".ot-type-panel-title", { hasText: "Backtest Visualizations" }) })
    .first();

  const modelSelect = page.locator("label:has-text('Model') select");
  await expect(modelSelect).toContainText("Premarket + ORB Breakout");
  await modelSelect.selectOption("premarket_orb_breakout");
  await expect(page.getByText("breakout", { exact: true })).toBeVisible();

  await vizPanel.getByRole("button", { name: /^Equity Curve$/ }).scrollIntoViewIfNeeded();
  await vizPanel.getByRole("button", { name: /^Equity Curve$/ }).click();
  await expect(page.getByText("Run a backtest to see equity curve")).toBeVisible();

  await vizPanel.getByRole("button", { name: /^Drawdown$/ }).click();
  await expect(page.getByText("Run a backtest to see drawdown profile")).toBeVisible();

  await vizPanel.getByRole("button", { name: /^Monthly Returns$/ }).click();
  await expect(page.getByText("Run a backtest to see monthly return heatmap")).toBeVisible();

  await expect(page.getByText("Return Distribution")).toBeVisible();

  await vizPanel.getByRole("button", { name: /^Rolling Metrics$/ }).click();
  await expect(page.getByText("Run a backtest to see rolling metrics")).toBeVisible();

  await vizPanel.getByRole("button", { name: /^Trade Analysis$/ }).click();
  await expect(page.getByText("Run a backtest to see trade analytics")).toBeVisible();

  const compareTabButton = vizPanel.getByRole("button", { name: /Compare$/ });
  await compareTabButton.scrollIntoViewIfNeeded();
  await compareTabButton.click();
  await expect(page.getByRole("button", { name: "Run Comparison" })).toBeDisabled();
  await page.getByRole("button", { name: /\[TREND\] SMA Crossover/ }).click();
  await page.getByRole("button", { name: /\[TREND\] MACD Crossover/ }).click();
  await expect(page.getByRole("button", { name: "Run Comparison" })).toBeEnabled();
  await expect(page.getByText("Comparison Results")).toBeVisible();
});
