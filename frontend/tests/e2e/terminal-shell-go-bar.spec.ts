import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

async function loginAndOpen(page: import("@playwright/test").Page, targetPath: string) {
  const accessToken = makeJwt({
    sub: "terminal-shell-e2e-user",
    email: "terminal.shell@example.com",
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
  await page.goto(targetPath, { waitUntil: "domcontentloaded" });
  await expect(page.getByPlaceholder(/Type ticker, command, or search/i)).toBeVisible();
}

test.describe("Terminal shell + GO bar", () => {
  test("shell bars render and stack on desktop routes", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop stack validation");
    await loginAndOpen(page, "/equity/watchlist");

    const commandInput = page.getByPlaceholder(/Type ticker, command, or search/i);
    await expect(commandInput).toBeVisible();
    await expect(page.locator("div").filter({ hasText: /NIFTY 50/i }).first()).toBeVisible();
    await expect(page.getByText(/IST/).first()).toBeVisible();

    const cmdBox = await commandInput.boundingBox();
    const tickerText = page.locator("button").filter({ hasText: /NIFTY 50|S&P 500|SENSEX/i }).first();
    const tickerBox = await tickerText.boundingBox();
    expect(cmdBox).toBeTruthy();
    expect(tickerBox).toBeTruthy();
    if (cmdBox && tickerBox) {
      expect(tickerBox.y).toBeGreaterThanOrEqual(cmdBox.y + cmdBox.height - 2);
    }
  });

  test("Ctrl+G focuses GO bar and routes with command execution", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop keyboard workflow validation");
    await loginAndOpen(page, "/equity/dashboard");

    const commandInput = page.getByPlaceholder(/Type ticker, command, or search/i);
    await expect(commandInput).toBeVisible();
    await page.waitForTimeout(100);
    await page.locator("body").click();
    await page.keyboard.press("Control+g");
    await expect(commandInput).toBeFocused();

    await commandInput.fill("WL");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/equity\/watchlist/);

    await page.locator("body").click();
    await page.keyboard.press("Control+G");
    await expect(commandInput).toBeFocused();
    await commandInput.fill("AAPL GP");
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/equity\/security\/AAPL\?tab=chart/);
  });

  test("autocomplete keyboard navigation and escape behavior work", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop keyboard workflow validation");
    await loginAndOpen(page, "/equity/screener");

    const commandInput = page.getByPlaceholder(/Type ticker, command, or search/i);
    await expect(commandInput).toBeVisible();
    await page.waitForTimeout(100);
    await page.locator("body").click();
    await page.keyboard.press("Control+g");
    await expect(commandInput).toBeFocused();

    await commandInput.fill("po");
    await expect(page.getByText(/Suggestions/i)).toBeVisible();
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Escape");
    await expect(commandInput).not.toBeFocused();
  });

  test("mobile route keeps shell status visible without immediate crash", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only");
    await loginAndOpen(page, "/equity/watchlist");

    await expect(page.getByPlaceholder(/Type ticker, command, or search/i)).toBeVisible();
    await expect(page.getByText(/IST/).first()).toBeVisible();
    await expect(page.locator("nav.fixed.bottom-0")).toBeVisible();
  });

  test("priority route smoke pass with shell present", async ({ page }, testInfo) => {
    test.skip(testInfo.project.name !== "chromium", "Desktop route smoke");
    const routes = [
      "/equity/dashboard",
      "/equity/stocks",
      "/equity/portfolio",
      "/equity/risk",
      "/equity/ops",
      "/equity/screener",
      "/equity/watchlist",
    ];
    for (const route of routes) {
      await loginAndOpen(page, route);
      await expect(page.getByPlaceholder(/Type ticker, command, or search/i)).toBeVisible();
      await expect(page.getByText(/IST/).first()).toBeVisible();
    }
  });
});
