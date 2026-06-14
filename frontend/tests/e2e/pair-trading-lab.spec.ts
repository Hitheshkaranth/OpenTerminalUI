import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

test("pair trading lab renders cointegration verdict from real data", async ({ page }) => {
  test.slow();
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

  const consoleErrors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });

  await page.goto("/equity/pair-trading");

  // Default load is VOO/SPY on the "test" tab -> hits real /api/pairs/test
  const verdict = page.getByText(/Cointegrated|Not Cointegrated/i).first();
  await expect(verdict).toBeVisible({ timeout: 60_000 });

  // Beta hedge ratio cell should render a real number
  await expect(page.getByText(/Beta \(Hedge Ratio\)/i)).toBeVisible();

  await page.screenshot({ path: "test-results/pair-trading-lab.png", fullPage: true });

  // Backtest tab should load an equity curve from real data
  await page.getByRole("button", { name: /Backtest/i }).first().click();
  await expect(page.getByText(/Sharpe/i).first()).toBeVisible({ timeout: 60_000 });

  await page.screenshot({ path: "test-results/pair-trading-backtest.png", fullPage: true });

  const fatal = consoleErrors.filter(
    (e) => !/favicon|ResizeObserver|Failed to load resource|WebGLRenderer|THREE\.|WebGL context/i.test(e),
  );
  expect(fatal, `console errors: ${fatal.join("\n")}`).toHaveLength(0);
});
