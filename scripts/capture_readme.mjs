// Capture the README screenshots from a running OpenTerminalUI.
//
//   cd frontend && OT_BASE=http://127.0.0.1:8000 OT_TOKEN_FILE=/path/to/jwt.txt node ../scripts/capture_readme.mjs [name,name]
//
// Each screen is shot only once it is fully loaded: network idle, and no skeleton, spinner, AI
// "thinking" orb or "Loading…" text left on screen (or a 45 s cap, reported as "not settled").
// Set OT_HEADLESS=1 to run without a visible browser window.
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Resolve Playwright from the working directory (frontend/), where it is installed, not from scripts/.
const require = createRequire(path.join(process.cwd(), "package.json"));
const playwright = await import(pathToFileURL(require.resolve("@playwright/test")).href);
const chromium = playwright.chromium ?? playwright.default.chromium;

const BASE = process.env.OT_BASE || "http://127.0.0.1:8000";
const OUT = path.resolve(process.env.OT_OUT || "../assets/readme");
const token = fs.readFileSync(process.env.OT_TOKEN_FILE || "../.ot-token", "utf8").trim();
const only = process.argv[2] ? new Set(process.argv[2].split(",")) : null;

// [file, route, options] — options: focus (text to scroll to the top), click (button name), wait (ms after click),
// agent (prompt to run in the agent console), generate (AI card title to generate), pre (route to open first).
const SCREENS = [
  ["dashboard", "/equity/dashboard", {}],
  ["mission-control", "/home", {}],
  ["security-hub", "/equity/security/NVDA?tab=overview", {}],
  ["ai-briefing", "/equity/stocks?ticker=AAPL", { generate: "AI Investment Briefing" }],
  ["filings-intelligence", "/equity/security/NVDA?tab=filings", { focus: "Growth & headwind drivers" }],
  ["business-metrics", "/equity/security/MSFT?tab=financials", { focus: "Business metrics" }],
  ["value-chain", "/equity/security/NVDA?tab=peers", { focus: "Value chain" }],
  ["agent", "/equity/security/MSFT?tab=overview", { agent: "Compare MSFT and GOOGL on P/E, revenue growth and net margin. Which looks cheaper?" }],
  ["chart", "/equity/security/TSLA?tab=chart", {}],
  ["screener", "/equity/screener", { click: /Run Screen/i, wait: 12000 }],
  ["heatmap", "/equity/heatmap", {}],
  ["options-strategy", "/fno/strategy?symbol=NVDA", { click: /^Apply$/i, wait: 4000 }],
  ["backtesting", "/backtesting", { pre: "/equity/stocks?ticker=AMZN", click: /^Run$/i, wait: 40000 }],
  ["commodities", "/equity/commodities?symbol=CL%3DF", {}],
  ["themes", "/equity/sector-rotation?view=themes", {}],
  ["crypto", "/equity/crypto", {}],
  ["launchpad", "/equity/launchpad", {}],
];

async function settle(page, maxMs = 45000) {
  await page.waitForLoadState("networkidle", { timeout: 20000 }).catch(() => {});
  const start = Date.now();
  let busy = 1;
  while (Date.now() - start < maxMs) {
    busy = await page.evaluate(() => {
      const onScreen = (e) => {
        const r = e.getBoundingClientRect();
        return r.width > 0 && r.height > 0 && r.bottom > 0 && r.top < innerHeight;
      };
      const loaders = [...document.querySelectorAll('.animate-pulse,.animate-spin,[aria-busy="true"],[role="status"] canvas')]
        // Live-status dots pulse forever by design; they are not loaders.
        .filter((e) => onScreen(e) && e.getBoundingClientRect().width > 12);
      const loadingText = [...document.querySelectorAll("body *")].filter(
        (e) => e.children.length === 0 && /^Loading\b/i.test((e.textContent || "").trim()) && onScreen(e),
      );
      return loaders.length + loadingText.length;
    });
    if (!busy) break;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(1500); // let charts finish their last paint
  return busy === 0;
}

async function banner(page, text) {
  await page.evaluate((t) => {
    let d = document.getElementById("capture-banner");
    if (!d) {
      d = document.createElement("div");
      d.id = "capture-banner";
      d.style.cssText = "position:fixed;bottom:8px;left:8px;z-index:2147483647;background:#FF6B00;color:#000;font:600 13px system-ui;padding:6px 14px;border-radius:4px;pointer-events:none";
      document.body.appendChild(d);
    }
    d.textContent = t;
    d.style.display = "block";
  }, text);
}
const hideBanner = (page) => page.evaluate(() => { const d = document.getElementById("capture-banner"); if (d) d.style.display = "none"; });

fs.mkdirSync(OUT, { recursive: true });
const browser = await chromium.launch(process.env.OT_HEADLESS ? {} : { channel: "chrome", headless: false });
const ctx = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1.5 });
await ctx.addInitScript((t) => {
  localStorage.setItem("ot-access-token", t);
  localStorage.setItem("ot-refresh-token", t);
}, token);
const page = await ctx.newPage();
const report = [];

for (const [name, route, opts] of SCREENS) {
  if (only && !only.has(name)) continue;
  const errors = [];
  const onError = (e) => errors.push(String(e).slice(0, 160));
  page.on("pageerror", onError);
  if (opts.pre) {
    // Load a symbol first so pages that follow the global ticker (backtesting) use it.
    await page.goto(BASE + opts.pre);
    await settle(page, 15000);
  }
  await page.goto(BASE + route);
  await banner(page, `Capturing ${name}…`);
  let settled = await settle(page);

  if (opts.click) {
    const b = page.getByRole("button", { name: opts.click }).first();
    if (await b.count()) {
      await b.click();
      await page.waitForTimeout(opts.wait || 3000);
      settled = await settle(page);
    }
  }
  if (opts.generate) {
    const card = page.locator("section", { hasText: opts.generate }).first();
    await card.scrollIntoViewIfNeeded();
    await card.getByRole("button", { name: /Generate|Regenerate/ }).click();
    await card.getByRole("button", { name: "Regenerate" }).waitFor({ timeout: 180000 });
    await card.evaluate((el) => el.scrollIntoView({ block: "start" }));
    await page.evaluate(() => window.scrollBy(0, -60));
    settled = await settle(page);
  }
  if (opts.agent) {
    await page.getByRole("button", { name: /Open agent console/ }).click();
    const box = page.getByLabel("Agent prompt");
    await box.fill(opts.agent);
    await box.press("Enter");
    await page.waitForTimeout(1500);
    await page.waitForFunction(() => !document.querySelector('.ot-agent-panel [role="status"]'), null, { timeout: 240000 });
    settled = await settle(page);
  }
  if (opts.focus) {
    const target = page.getByText(opts.focus, { exact: false }).first();
    if (await target.count()) {
      await target.evaluate((el) => el.scrollIntoView({ block: "start" }));
      await page.evaluate(() => window.scrollBy(0, -80));
      settled = await settle(page);
    }
  }

  await hideBanner(page);
  await page.screenshot({ path: path.join(OUT, `${name}.jpg`), type: "jpeg", quality: 82 });
  if (opts.agent) await page.getByRole("button", { name: "Close agent console" }).click().catch(() => {});
  page.off("pageerror", onError);
  report.push({ name, route, settled, errors });
  console.log(`${settled ? "ok " : "!! "} ${name.padEnd(22)} ${errors.length ? "page errors: " + errors.join(" | ") : ""}`);
}

fs.writeFileSync(path.join(OUT, "capture-report.json"), JSON.stringify(report, null, 2));
await browser.close();
