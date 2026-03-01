import { expect, test } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

async function loginAndOpen(page: import("@playwright/test").Page, targetPath: string) {
  const accessToken = makeJwt({
    sub: "mobile-e2e-user",
    email: "mobile.e2e@example.com",
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
  await page.goto(targetPath);
  await expect(page).toHaveURL(new RegExp(targetPath.replace("/", "\\/")));
  await expect(page.getByPlaceholder(/Type ticker, command, or search/i)).toBeVisible();
}

async function dispatchTouch(
  page: import("@playwright/test").Page,
  selector: string,
  type: "touchstart" | "touchmove" | "touchend",
  x: number,
  y: number,
) {
  await page.evaluate(
    ({ selector, type, x, y }) => {
      const el = document.querySelector(selector);
      if (!el) return;
      const ev = new Event(type, { bubbles: true, cancelable: true }) as any;
      const point = { clientX: x, clientY: y };
      if (type === "touchend") {
        Object.defineProperty(ev, "changedTouches", { value: [point] });
      } else {
        Object.defineProperty(ev, "touches", { value: [point] });
      }
      el.dispatchEvent(ev);
    },
    { selector, type, x, y },
  );
}

test.describe("mobile interactions", () => {
  test.beforeEach(async ({}, testInfo) => {
    test.skip(testInfo.project.name !== "mobile-chromium", "Mobile-only interaction suite");
  });

  test("bottom nav switches views", async ({ page }) => {
    await loginAndOpen(page, "/equity/watchlist");

    await expect(page.locator("nav.fixed.bottom-0")).toBeVisible();
    await expect(page.getByText("Add to Watchlist")).toBeVisible();
    await page.locator("nav.fixed.bottom-0").getByRole("link", { name: "Watchlist" }).click();
    await expect(page.getByText("Add to Watchlist")).toBeVisible();

    await page.locator("nav.fixed.bottom-0").getByRole("link", { name: "Portfolio" }).click();
    await expect(page.getByText("Portfolio Movement & Historical Return")).toBeVisible();
  });

  test("watchlist pull-to-refresh hint appears", async ({ page }) => {
    await loginAndOpen(page, "/equity/watchlist");

    const rootSel = "div.space-y-3.p-4";
    await expect(page.locator(rootSel).first()).toBeVisible();
    await page.waitForTimeout(120);
    await dispatchTouch(page, rootSel, "touchstart", 120, 50);
    await dispatchTouch(page, rootSel, "touchmove", 120, 95);
    await expect(page.getByText("Pull to refresh")).toBeVisible();

    await dispatchTouch(page, rootSel, "touchmove", 120, 140);
    await expect(page.getByText("Release to refresh")).toBeVisible();
    await dispatchTouch(page, rootSel, "touchend", 120, 140);
  });

  test("portfolio swipe changes timeframe", async ({ page }) => {
    await loginAndOpen(page, "/equity/portfolio");

    const allBtn = page.getByRole("button", { name: "ALL" });
    const fiveYBtn = page.getByRole("button", { name: "5Y" });

    await expect(allBtn).toBeVisible();

    const chartSel = "div.h-\\[26rem\\]";
    await dispatchTouch(page, chartSel, "touchstart", 120, 120);
    await dispatchTouch(page, chartSel, "touchend", 240, 120);

    await expect(fiveYBtn).toHaveClass(/border-terminal-accent/);
    await expect(allBtn).not.toHaveClass(/border-terminal-accent/);
  });
});
