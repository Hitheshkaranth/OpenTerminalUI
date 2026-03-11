import { chromium, type FullConfig, type Page } from "@playwright/test";

function makeJwt(payload: Record<string, unknown>): string {
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return `x.${encoded}.y`;
}

async function warmProtectedRoute(
  page: Page,
  baseURL: string,
  path: string,
  readySelector: { text?: string; testId?: string; selector?: string },
) {
  await page.goto(`${baseURL}${path}`, { waitUntil: "domcontentloaded" });

  if (readySelector.selector) {
    await page.locator(readySelector.selector).first().waitFor({ state: "visible", timeout: 180_000 });
  } else if (readySelector.text) {
    await page.getByText(readySelector.text).waitFor({ state: "visible", timeout: 180_000 });
  } else if (readySelector.testId) {
    await page.getByTestId(readySelector.testId).waitFor({ state: "visible", timeout: 180_000 });
  }
}

export default async function globalSetup(config: FullConfig) {
  const firstProjectBaseUrl = config.projects[0]?.use?.baseURL;
  const baseURL = typeof firstProjectBaseUrl === "string" ? firstProjectBaseUrl : "http://127.0.0.1:4173";
  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const accessToken = makeJwt({
    sub: "e2e-user",
    email: "e2e@example.com",
    role: "trader",
    exp: Math.floor(Date.now() / 1000) + 3600,
  });
  const refreshToken = makeJwt({ exp: Math.floor(Date.now() / 1000) + 7200 });
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    await page.addInitScript(
      ([at, rt]) => {
        localStorage.setItem("ot-access-token", at);
        localStorage.setItem("ot-refresh-token", rt);
      },
      [accessToken, refreshToken],
    );

    await warmProtectedRoute(page, baseURL, "/backtesting", { text: "Backtesting Control Deck" });
    await warmProtectedRoute(page, baseURL, "/equity/chart-workstation", { testId: "chart-workstation" });
    await warmProtectedRoute(page, baseURL, "/equity/risk", { text: "RISK ENGINE CONTROL" });
    await warmProtectedRoute(page, baseURL, "/equity/oms", { text: "Order Ticket + Compliance" });
    await warmProtectedRoute(page, baseURL, "/equity/ops", { text: "Operational Workspace Control" });
    await warmProtectedRoute(page, baseURL, "/equity/screener", { selector: ".ot-type-panel-title" });
  } finally {
    await context.close();
    await browser.close();
  }
}
