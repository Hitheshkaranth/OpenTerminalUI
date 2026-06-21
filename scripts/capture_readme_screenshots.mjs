// Captures README screenshots of every major feature against the running app.
// Logs in as a real account so portfolio/watchlist pages show real data, drives
// interactive flows (6-chart workstation, a real backtest run), and waits for each
// page to fully settle before capturing.
//
// Run from the frontend/ directory (so "@playwright/test" resolves):
//   cd frontend && node ../scripts/capture_readme_screenshots.mjs
//
// Requires the app running at http://localhost:8000 (docker compose up).
import path from "node:path";
import fs from "node:fs/promises";
import { createRequire } from "node:module";

const require = createRequire(`${process.cwd()}/`);
const { chromium } = require("@playwright/test");

const BASE = process.env.SHOT_BASE_URL || "http://localhost:8000";
const EMAIL = process.env.SHOT_EMAIL || "karanth.hithesh@gmail.com";
const PASSWORD = process.env.SHOT_PASSWORD || "Flyvi12#";
const OUT_DIR = path.resolve(process.cwd(), "..", "assets", "screenshots");
const TICKER = "ICICIBANK"; // an actual holding in the account
const TICKER_US = "AAPL"; // a US holding (NASDAQ) for cross-market coverage
const TICKER_IN = "RELIANCE"; // an India holding (NSE) for cross-market coverage
const WORKSTATION_TICKERS = ["RELIANCE", "TCS", "INFY", "HDFCBANK", "ICICIBANK", "ITC"];

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function shoot(page, name) {
  await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
  console.log("  captured", name);
}

// Simple navigate + settle capture. fullPage captures the whole scrollable page.
async function capturePage(page, name, url, settle, fullPage = false) {
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(settle);
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage });
    console.log("  captured", name, fullPage ? "(full page)" : "");
  } catch (err) {
    console.error("  FAILED", name, "-", err.message);
  }
}

async function captureWorkstation(page) {
  try {
    // Very tall viewport so the 3x2 grid (below the toolbar) gets real height
    // and each of the 6 charts renders at a usable size.
    await page.setViewportSize({ width: 1680, height: 2300 });
    await page.goto(`${BASE}/equity/chart-workstation`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    // Switch to a 3x2 grid so the workstation has capacity for 6 panels —
    // the add-chart placeholder only appears once layout capacity allows it.
    const layoutBtn = page.locator('[aria-label="Layout 3x2"]').first();
    if (await layoutBtn.count()) {
      await layoutBtn.click({ timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(2000);
    }
    // Grow to 6 chart panels.
    for (let i = 0; i < 5; i += 1) {
      const addBtn = page.locator('[data-testid="add-chart-btn"]').first();
      if (await addBtn.count()) {
        await addBtn.scrollIntoViewIfNeeded().catch(() => {});
        await addBtn.click({ timeout: 5000 }).catch(() => {});
        await page.waitForTimeout(1000);
      }
    }
    // Assign a ticker to each panel.
    const inputs = page.locator('[data-testid="ticker-search-input"]');
    const n = Math.min(await inputs.count(), WORKSTATION_TICKERS.length);
    for (let i = 0; i < n; i += 1) {
      try {
        const input = inputs.nth(i);
        await input.scrollIntoViewIfNeeded();
        await input.click({ timeout: 4000 });
        await input.fill(WORKSTATION_TICKERS[i]);
        await page.waitForTimeout(1400);
        await input.press("Enter");
        await page.waitForTimeout(1000);
      } catch { /* best effort per panel */ }
    }
    await page.waitForTimeout(16000); // let all 6 charts render
    // Screenshot just the chart grid element (the toolbar above is config noise).
    const grid = page.locator('[data-testid="chart-grid"]').first();
    if (await grid.count()) {
      await grid.scrollIntoViewIfNeeded().catch(() => {});
      await grid.screenshot({ path: path.join(OUT_DIR, "chart-workstation.png") });
    } else {
      await page.screenshot({ path: path.join(OUT_DIR, "chart-workstation.png"), fullPage: true });
    }
    console.log("  captured chart-workstation (6-pane grid)");
    await page.setViewportSize({ width: 1680, height: 1050 });
  } catch (err) {
    console.error("  FAILED chart-workstation -", err.message);
  }
}

async function captureBacktesting(page) {
  try {
    await page.goto(`${BASE}/backtesting`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(5000);
    // Fill the asset ticker if the field is empty.
    const assetInput = page.locator('input.uppercase').first();
    if (await assetInput.count()) {
      await assetInput.click({ timeout: 4000 }).catch(() => {});
      await assetInput.fill("RELIANCE").catch(() => {});
      await page.waitForTimeout(600);
      await page.keyboard.press("Escape").catch(() => {});
    }
    // Click the Run button.
    const runBtn = page.getByRole("button", { name: /^Run$/ }).first();
    if (await runBtn.count()) {
      await runBtn.click({ timeout: 5000 }).catch(() => {});
    }
    // Poll the Status: line until the job is done (or time out).
    const deadline = Date.now() + 90000;
    while (Date.now() < deadline) {
      const body = await page.textContent("body").catch(() => "");
      if (/Status:\s*DONE/i.test(body || "")) break;
      await page.waitForTimeout(3000);
    }
    await page.waitForTimeout(9000); // let result charts render
    await page.screenshot({ path: path.join(OUT_DIR, "backtesting.png"), fullPage: true });
    console.log("  captured backtesting (full page)");
  } catch (err) {
    console.error("  FAILED backtesting -", err.message);
  }
}

// The screener renders an empty score table until a scan is run, so navigate,
// trigger the scan (RUN SCAN / Run), and wait for rows before capturing.
async function captureScreener(page) {
  try {
    await page.setViewportSize({ width: 1680, height: 1050 });
    await page.goto(`${BASE}/equity/screener`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(7000);
    const runBtn = page.getByRole("button", { name: /run scan|^run$|run action/i }).first();
    if (await runBtn.count()) {
      await runBtn.scrollIntoViewIfNeeded().catch(() => {});
      await runBtn.click({ timeout: 5000, force: true }).catch(() => {});
    }
    await page.waitForTimeout(9000); // let results hydrate + render
    await page.screenshot({ path: path.join(OUT_DIR, "screener.png"), fullPage: false });
    console.log("  captured screener");
  } catch (err) {
    console.error("  FAILED screener -", err.message);
  }
}

const PAGES = [
  { name: "home", url: "/", settle: 9000 },
  // US (NASDAQ) coverage
  { name: "market-view", url: `/equity/security?ticker=${TICKER_US}&tab=chart`, settle: 14000 },
  { name: "stock-detail", url: `/equity/security?ticker=${TICKER_US}`, settle: 11000 },
  { name: "financial-analysis", url: `/equity/security?ticker=${TICKER_US}&tab=financials`, settle: 17000 },
  // India (NSE) coverage
  { name: "security-hub-india", url: `/equity/security?ticker=${TICKER_IN}`, settle: 12000 },
  { name: "factor-dashboard", url: "/equity/factors", settle: 11000 },
  { name: "portfolio", url: "/equity/portfolio", settle: 16000, fullPage: true },
  { name: "portfolio-lab", url: "/equity/portfolio/lab", settle: 13000 },
  { name: "model-lab", url: "/backtesting/model-lab", settle: 13000 },
  { name: "risk-dashboard", url: "/equity/risk", settle: 12000 },
  { name: "cockpit", url: "/equity/cockpit", settle: 12000 },
  // News + sentiment works for US names here (NSE news is unavailable in this env).
  { name: "news-sentiment", url: `/equity/news?ticker=${TICKER_US}`, settle: 15000 },
  { name: "intelligence-timeline", url: "/equity/intelligence-timeline", settle: 11000 },
  // US options have a live chain here; NSE F&O (NIFTY) is unavailable in this env.
  { name: "fno-option-chain", url: `/fno?symbol=${TICKER_US}`, settle: 16000 },
  { name: "watchlist", url: "/equity/watchlist", settle: 10000 },
  { name: "commodities", url: "/equity/commodities", settle: 9000 },
];

// Drives the AI Research Agent console (Ctrl/Cmd+J slide-over): opens it, optionally
// flips on Debate or Strategy Lab mode, submits a real prompt, waits for the streamed
// answer (polling for the mode's terminal text), then captures the panel.
async function captureAgent(page, { name, prompt, ticker, market, strategy = false, debate = false }) {
  try {
    await page.setViewportSize({ width: 1680, height: 1050 });
    const url = ticker ? `/equity/security?ticker=${ticker}` : "/";
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await page.waitForTimeout(6000);
    // The panel is always in the DOM (a slide-over translated off-screen when
    // closed), so open-state must be read from aria-hidden, not visibility.
    const panel = page.locator('[aria-label="Agent Console"]').first();
    const isOpen = async () => (await panel.getAttribute("aria-hidden").catch(() => "true")) === "false";
    for (let i = 0; i < 3 && !(await isOpen()); i += 1) {
      const launcher = page.getByRole("button", { name: /^agent$/i }).first();
      if (await launcher.count()) {
        await launcher.click({ timeout: 5000 }).catch(() => {});
      } else {
        await page.keyboard.press(process.platform === "darwin" ? "Meta+j" : "Control+j").catch(() => {});
      }
      await page.waitForTimeout(1200);
    }
    if (strategy) {
      const stratBtn = page.locator('[aria-label="Toggle strategy lab mode"]').first();
      if (await stratBtn.count()) await stratBtn.click({ timeout: 4000 }).catch(() => {});
    }
    if (debate) {
      const debateBtn = page.locator('[aria-label="Toggle multi-agent debate mode"]').first();
      if (await debateBtn.count()) await debateBtn.click({ timeout: 4000 }).catch(() => {});
    }
    const input = page.locator('[aria-label="Agent prompt"]').first();
    await input.waitFor({ state: "visible", timeout: 8000 });
    await input.scrollIntoViewIfNeeded().catch(() => {});
    await input.click({ timeout: 5000, force: true });
    await input.fill(prompt);
    await input.press("Enter");
    // Free-tier model latency is highly variable, so poll for completion rather
    // than waiting a fixed time: the console shows "Thinking…" while a turn is
    // pending. Wait until it clears and the mode's terminal text is present.
    const terminal = strategy
      ? /validated edge|Strategy Lab result/i
      : debate
        ? /DECISION:|CONVICTION/i
        : /\b(Valuation|verdict|Risk|Snapshot|P\/E|ROE)\b/i;
    const deadline = Date.now() + (debate ? 300000 : strategy ? 220000 : 120000);
    await page.waitForTimeout(6000);
    while (Date.now() < deadline) {
      const text = (await panel.textContent().catch(() => "")) || "";
      const thinking = /Thinking…|Thinking\.\.\./.test(text);
      if (!thinking && terminal.test(text)) break;
      await page.waitForTimeout(4000);
    }
    await page.waitForTimeout(4000);
    if (await panel.count()) {
      await panel.screenshot({ path: path.join(OUT_DIR, `${name}.png`) });
    } else {
      await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage: false });
    }
    console.log("  captured", name);
  } catch (err) {
    console.error("  FAILED", name, "-", err.message);
  }
}

async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const resp = await fetch(`${BASE}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!resp.ok) throw new Error(`Login failed: ${resp.status} ${await resp.text()}`);
  const { access_token, refresh_token } = await resp.json();
  if (!access_token) throw new Error("No access_token in login response");
  console.log("Logged in as", EMAIL);

  const browser = await chromium.launch({ args: ["--disable-gpu"] });
  const context = await browser.newContext({
    viewport: { width: 1680, height: 1050 },
    deviceScaleFactor: 2,
    serviceWorkers: "block",
  });
  await context.addInitScript(
    ([at, rt]) => {
      localStorage.setItem("ot-access-token", at);
      localStorage.setItem("ot-refresh-token", rt);
    },
    [access_token, refresh_token],
  );
  const page = await context.newPage();

  // Warm up + confirm we are authenticated (not bounced to /login).
  await page.goto(`${BASE}/`, { waitUntil: "domcontentloaded", timeout: 45000 });
  await sleep(6000);
  if (page.url().includes("/login")) throw new Error("Not authenticated — landed on /login");
  console.log("Authenticated session confirmed.");

  // SHOT_ONLY=name1,name2 limits the capture to specific screenshots.
  const only = (process.env.SHOT_ONLY || "").split(",").map((s) => s.trim()).filter(Boolean);
  const want = (name) => only.length === 0 || only.includes(name);

  for (const p of PAGES) {
    if (want(p.name)) await capturePage(page, p.name, p.url, p.settle, p.fullPage ?? false);
  }
  if (want("chart-workstation")) await captureWorkstation(page);
  if (want("backtesting")) await captureBacktesting(page);
  if (want("screener")) await captureScreener(page);
  if (want("ai-agent")) {
    await captureAgent(page, {
      name: "ai-agent",
      ticker: TICKER_US,
      market: "US",
      prompt: "Analyze AAPL: valuation, quality and momentum. Give a tight verdict with the numbers.",
    });
  }
  if (want("agent-debate")) {
    await captureAgent(page, {
      name: "agent-debate",
      ticker: TICKER_US,
      market: "US",
      debate: true,
      prompt: "AAPL",
    });
  }
  if (want("strategy-lab")) {
    await captureAgent(page, {
      name: "strategy-lab",
      ticker: TICKER_US,
      market: "US",
      strategy: true,
      prompt: "AAPL",
    });
  }

  await context.close();
  await browser.close();
  console.log("Done. Screenshots in", OUT_DIR);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
