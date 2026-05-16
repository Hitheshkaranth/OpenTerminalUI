import { test } from "@playwright/test";
import path from "node:path";
import { fileURLToPath } from "node:url";

// Captures README screenshots of the main workspaces. Run with:
//   npx playwright test screenshots --project=chromium
const HERE = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(HERE, "..", "..", "..", "assets", "screenshots");

const PAGES: Array<{ name: string; url: string; settle?: number }> = [
  { name: "home", url: "/" },
  { name: "stock-detail", url: "/equity/security?ticker=RELIANCE" },
  { name: "news-sentiment", url: "/equity/news" },
  { name: "screener", url: "/equity/screener" },
  { name: "backtesting", url: "/backtesting" },
  { name: "risk-dashboard", url: "/equity/risk" },
  { name: "chart-workstation", url: "/equity/chart-workstation" },
];

for (const target of PAGES) {
  test(`screenshot ${target.name}`, async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 1000 });
    await page.goto(target.url, { waitUntil: "domcontentloaded" });
    // Let charts, queries and panels settle before capturing.
    await page.waitForTimeout(target.settle ?? 7000);
    await page.screenshot({
      path: path.join(OUT_DIR, `${target.name}.png`),
      fullPage: false,
    });
  });
}
