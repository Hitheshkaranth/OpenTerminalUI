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
const EMAIL = process.env.SHOT_EMAIL;
const PASSWORD = process.env.SHOT_PASSWORD;
if (!EMAIL || !PASSWORD) {
  console.error("Set SHOT_EMAIL and SHOT_PASSWORD to an account on the target instance.");
  process.exit(1);
}
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

async function waitForLoadedData(page, name, expectedText = [], timeout = 45000) {
  const expected = expectedText.filter(Boolean).map((text) => String(text));
  await page.waitForLoadState("domcontentloaded", { timeout: 45000 }).catch(() => {});
  await page.waitForLoadState("networkidle", { timeout: Math.min(timeout, 20000) }).catch(() => {});
  if (!expected.length) return;
  await page.waitForFunction(
    ({ expected: needles }) => {
      const body = document.body?.innerText || "";
      const hasExpected = needles.some((needle) => body.toLowerCase().includes(String(needle).toLowerCase()));
      const appShellLoading = /Loading OpenTerminalUI|Loading route|Loading dashboard/i.test(body);
      return hasExpected && !appShellLoading;
    },
    { expected },
    { timeout },
  ).catch(async () => {
    const body = ((await page.textContent("body").catch(() => "")) || "").replace(/\s+/g, " ").slice(0, 500);
    throw new Error(`${name} did not show expected loaded data (${expected.join(", ")}). Body: ${body}`);
  });
}

// Simple navigate + settle capture. fullPage captures the whole scrollable page.
async function capturePage(page, name, url, settle, fullPage = false, expectedText = []) {
  try {
    await page.goto(`${BASE}${url}`, { waitUntil: "domcontentloaded", timeout: 45000 });
    await waitForLoadedData(page, name, expectedText, Math.max(settle, 45000));
    await page.waitForTimeout(Math.min(2500, Math.max(1000, settle / 8)));
    await page.screenshot({ path: path.join(OUT_DIR, `${name}.png`), fullPage });
    console.log("  captured", name, fullPage ? "(full page)" : "");
  } catch (err) {
    console.error("  FAILED", name, "-", err.message);
  }
}

async function apiFetch(pathname, token, options = {}) {
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
    ...(options.headers || {}),
  };
  const resp = await fetch(`${BASE}${pathname}`, { ...options, headers });
  const text = await resp.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text;
  }
  if (!resp.ok) throw new Error(`${options.method || "GET"} ${pathname} failed: ${resp.status} ${text}`);
  return data;
}

async function seedDemoData(token) {
  const holdings = [
    { ticker: "AAPL", quantity: 12, avg_buy_price: 172, buy_date: "2025-02-03" },
    { ticker: "MSFT", quantity: 8, avg_buy_price: 406, buy_date: "2025-03-14" },
    { ticker: "RELIANCE", quantity: 20, avg_buy_price: 2850, buy_date: "2025-01-08" },
    { ticker: "TCS", quantity: 10, avg_buy_price: 3820, buy_date: "2025-04-11" },
  ];

  try {
    const portfolio = await apiFetch("/api/portfolio", token);
    const existing = new Set((portfolio?.items || []).map((row) => String(row.ticker || "").toUpperCase()));
    for (const holding of holdings) {
      if (!existing.has(holding.ticker)) {
        await apiFetch("/api/portfolio/holdings", token, { method: "POST", body: JSON.stringify(holding) });
      }
    }
  } catch (err) {
    console.warn("  seed warning: legacy portfolio", err.message);
  }

  try {
    const portfolios = await apiFetch("/api/portfolios", token);
    let demo = (portfolios?.items || []).find((row) => row.name === "README Demo Portfolio");
    if (!demo) {
      demo = await apiFetch("/api/portfolios", token, {
        method: "POST",
        body: JSON.stringify({
          name: "README Demo Portfolio",
          description: "Seeded holdings for README screenshots",
          benchmark_symbol: "SPY",
          currency: "USD",
          starting_cash: 25000,
        }),
      });
    }
    const current = await apiFetch(`/api/portfolios/${encodeURIComponent(demo.id)}/holdings`, token).catch(() => ({ items: [] }));
    const existing = new Set((current?.items || []).map((row) => String(row.symbol || "").toUpperCase()));
    for (const holding of holdings.slice(0, 3)) {
      if (!existing.has(holding.ticker)) {
        await apiFetch(`/api/portfolios/${encodeURIComponent(demo.id)}/holdings`, token, {
          method: "POST",
          body: JSON.stringify({
            symbol: holding.ticker,
            shares: holding.quantity,
            cost_basis_per_share: holding.avg_buy_price,
            purchase_date: holding.buy_date,
            notes: "README screenshot demo holding",
          }),
        });
      }
    }
  } catch (err) {
    console.warn("  seed warning: portfolio manager", err.message);
  }

  try {
    const watchlists = await apiFetch("/api/watchlists", token);
    const first = watchlists?.[0];
    if (first?.id) {
      const symbols = Array.from(new Set([...(first.symbols || []), "AAPL", "MSFT", "RELIANCE", "TCS", "SPY"]));
      await apiFetch(`/api/watchlists/${encodeURIComponent(first.id)}`, token, {
        method: "PUT",
        body: JSON.stringify({ symbols }),
      });
    }
  } catch (err) {
    console.warn("  seed warning: watchlist", err.message);
  }

  try {
    const paper = await apiFetch("/api/paper/portfolios", token);
    let demo = (paper?.items || []).find((row) => row.name === "README Paper Desk");
    if (!demo) {
      demo = await apiFetch("/api/paper/portfolios", token, {
        method: "POST",
        body: JSON.stringify({ name: "README Paper Desk", initial_capital: 100000 }),
      });
    }
    const orders = await apiFetch(`/api/paper/portfolios/${encodeURIComponent(demo.id)}/orders`, token).catch(() => ({ items: [] }));
    if (!(orders?.items || []).some((row) => String(row.symbol || "").includes("RELIANCE"))) {
      await apiFetch("/api/paper/orders", token, {
        method: "POST",
        body: JSON.stringify({
          portfolio_id: demo.id,
          symbol: "RELIANCE",
          side: "buy",
          order_type: "market",
          quantity: 5,
          slippage_bps: 5,
          commission: 20,
        }),
      }).catch((err) => console.warn("  seed warning: paper order", err.message));
    }
  } catch (err) {
    console.warn("  seed warning: paper portfolio", err.message);
  }

  try {
    const journal = await apiFetch("/api/journal?symbol=AAPL", token);
    if (!(journal?.entries || []).length) {
      await apiFetch("/api/journal", token, {
        method: "POST",
        body: JSON.stringify({
          symbol: "AAPL",
          direction: "LONG",
          entry_date: "2026-01-08T09:30:00Z",
          entry_price: 182,
          exit_date: "2026-02-12T15:30:00Z",
          exit_price: 196,
          quantity: 25,
          fees: 4.5,
          strategy: "Breakout continuation",
          setup: "Earnings drift",
          emotion: "Disciplined",
          notes: "README screenshot demo trade",
          tags: ["README", "Demo"],
          rating: 4,
        }),
      });
    }
  } catch (err) {
    console.warn("  seed warning: journal", err.message);
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
  { name: "home", url: "/", settle: 9000, expect: ["AAPL", "Portfolio"] },
  { name: "launchpad", url: "/equity/launchpad?symbol=AAPL", settle: 7000, expect: ["AAPL"] },
  // US (NASDAQ) coverage
  { name: "market-view", url: `/equity/security?ticker=${TICKER_US}&tab=chart`, settle: 14000, expect: [TICKER_US] },
  { name: "stock-detail", url: `/equity/security?ticker=${TICKER_US}`, settle: 11000, expect: [TICKER_US] },
  { name: "financial-analysis", url: `/equity/security?ticker=${TICKER_US}&tab=financials`, settle: 17000, expect: [TICKER_US, "Financial"] },
  // India (NSE) coverage
  { name: "security-hub-india", url: `/equity/security?ticker=${TICKER_IN}`, settle: 12000, expect: [TICKER_IN] },
  { name: "factor-dashboard", url: "/equity/factors", settle: 11000, expect: ["Factor"] },
  { name: "portfolio", url: "/equity/portfolio", settle: 16000, fullPage: true, expect: ["AAPL", "RELIANCE"] },
  { name: "portfolio-lab", url: "/equity/portfolio/lab", settle: 13000, expect: ["Portfolio"] },
  { name: "model-lab", url: "/backtesting/model-lab", settle: 13000, expect: ["RELIANCE"] },
  { name: "model-governance", url: "/backtesting/model-governance", settle: 8000, expect: ["Governance"] },
  { name: "algorithm-framework", url: "/backtesting/algorithm-framework", settle: 8000, expect: ["Alpha"] },
  { name: "portfolio-optimizer", url: "/backtesting/portfolio-optimizer", settle: 8000, expect: ["Portfolio"] },
  { name: "risk-dashboard", url: "/equity/risk?ticker=AAPL", settle: 12000, expect: ["Risk"] },
  { name: "cockpit", url: "/equity/cockpit?ticker=AAPL", settle: 12000, expect: ["AAPL"] },
  // News + sentiment works for US names here (NSE news is unavailable in this env).
  { name: "news-sentiment", url: `/equity/news?ticker=${TICKER_US}`, settle: 15000, expect: [TICKER_US] },
  { name: "intelligence-timeline", url: "/equity/intelligence-timeline?symbol=AAPL", settle: 11000, expect: ["AAPL"] },
  // US options have a live chain here; NSE F&O (NIFTY) is unavailable in this env.
  { name: "fno-option-chain", url: `/fno?symbol=${TICKER_US}`, settle: 16000, expect: [TICKER_US] },
  { name: "fno-greeks", url: `/fno/greeks?symbol=${TICKER_US}`, settle: 9000, expect: ["Greeks"] },
  { name: "fno-futures", url: `/fno/futures?symbol=${TICKER_US}`, settle: 9000, expect: ["Futures"] },
  { name: "fno-oi", url: `/fno/oi?symbol=${TICKER_US}`, settle: 9000, expect: ["OI Buildup", "CE vs PE OI"] },
  { name: "fno-strategy", url: `/fno/strategy?symbol=${TICKER_US}`, settle: 9000, expect: ["Strategy"] },
  { name: "fno-pcr", url: `/fno/pcr?symbol=${TICKER_US}`, settle: 9000, expect: ["PCR"] },
  { name: "fno-flow", url: `/fno/flow?symbol=${TICKER_US}`, settle: 9000, expect: ["Flow"] },
  { name: "fno-heatmap", url: `/fno/heatmap?symbol=${TICKER_US}`, settle: 9000, expect: ["Heatmap"] },
  { name: "fno-expiry", url: `/fno/expiry?symbol=${TICKER_US}`, settle: 9000, expect: ["Expiry"] },
  { name: "watchlist", url: "/equity/watchlist", settle: 10000, expect: ["AAPL", "MSFT"] },
  { name: "commodities", url: "/equity/commodities?symbol=GC=F", settle: 9000, expect: ["Gold"] },
  { name: "forex", url: "/equity/forex?pair=EURUSD", settle: 9000, expect: ["EUR/USD", "Majors Heatmap"] },
  { name: "crypto", url: "/equity/crypto?symbol=BTC", settle: 9000, expect: ["BTC"] },
  { name: "mutual-funds", url: "/equity/mutual-funds", settle: 9000, expect: ["Mutual"] },
  { name: "bonds", url: "/equity/bonds", settle: 9000, expect: ["Bond"] },
  { name: "yield-curve", url: "/equity/yield-curve", settle: 9000, expect: ["Yield"] },
  { name: "bond-analytics", url: "/equity/bond-analytics", settle: 7000, expect: ["Bond"] },
  { name: "etf-analytics", url: "/equity/etf-analytics?ticker=SPY", settle: 9000, expect: ["SPY"] },
  { name: "market-dashboard", url: "/equity/dashboard", settle: 9000, expect: ["Market", "Dashboard"] },
  { name: "market-heatmap", url: "/equity/heatmap", settle: 9000, expect: ["Heatmap"] },
  { name: "hotlists", url: "/equity/hotlists", settle: 9000, expect: ["Symbol"] },
  { name: "dividends", url: "/equity/dividends", settle: 9000, expect: ["Dividend"] },
  { name: "relative-strength", url: "/equity/rs", settle: 9000, expect: ["Relative"] },
  { name: "sector-rotation", url: "/equity/sector-rotation", settle: 9000, expect: ["Sector"] },
  { name: "insider-activity", url: "/equity/insider?symbol=AAPL", settle: 9000, expect: ["Insider"] },
  { name: "alerts", url: "/equity/alerts?ticker=AAPL", settle: 9000, expect: ["Alerts Console", "Create New Alert"] },
  { name: "paper-trading", url: "/equity/paper", settle: 9000, expect: ["README Paper Desk", "RELIANCE"] },
  { name: "position-sizer", url: "/equity/position-sizer?symbol=AAPL", settle: 7000, expect: ["Position"] },
  { name: "trade-journal", url: "/equity/journal?symbol=AAPL", settle: 9000, expect: ["AAPL"] },
  { name: "correlation-dashboard", url: "/equity/correlation?symbols=AAPL,MSFT,GOOGL", settle: 9000, expect: ["Correlation Dashboard", "Correlation Matrix"] },
  { name: "stat-lab", url: "/equity/stat-lab?symbol=AAPL", settle: 9000, expect: ["Statistical Lab", "Pairs & Cointegration"] },
  { name: "pair-trading", url: "/equity/pair-trading?symbol_a=AAPL&symbol_b=MSFT", settle: 9000, expect: ["Pair Trading Lab", "Pair Test"] },
  { name: "oms-compliance", url: "/equity/oms", settle: 9000, expect: ["OMS"] },
  { name: "ops-dashboard", url: "/equity/ops", settle: 9000, expect: ["Ops"] },
  { name: "plugins", url: "/equity/plugins", settle: 7000, expect: ["Plugin"] },
  { name: "settings", url: "/equity/settings", settle: 7000, expect: ["Settings"] },
  { name: "research", url: "/equity/research?q=AAPL", settle: 9000, expect: ["Research"] },
  { name: "multi-timeframe", url: "/equity/mta?symbol=AAPL", settle: 9000, expect: ["AAPL"] },
  { name: "dom", url: "/equity/dom?symbol=AAPL", settle: 9000, expect: ["AAPL"] },
  { name: "time-and-sales", url: "/equity/tape?symbol=AAPL", settle: 9000, expect: ["AAPL"] },
  { name: "split-compare", url: `/equity/compare?symbols=${TICKER_US},MSFT,GOOGL`, settle: 9000, expect: [TICKER_US, "MSFT"] },
  { name: "option-greeks-calculator", url: "/equity/option-greeks?symbol=AAPL", settle: 7000, expect: ["Greeks"] },
  { name: "economic-terminal", url: "/equity/economics", settle: 9000, expect: ["Economic"] },
  { name: "data-quality", url: "/equity/data-quality", settle: 7000, expect: ["Data"] },
  { name: "saved-views", url: "/equity/saved-views", settle: 7000, expect: ["Saved"] },
  { name: "account", url: "/account", settle: 7000, expect: [EMAIL] },
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
  await seedDemoData(access_token);
  console.log("Demo data seeded for portfolio, watchlist, paper trading, and journal screenshots.");

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
    if (want(p.name)) await capturePage(page, p.name, p.url, p.settle, p.fullPage ?? false, p.expect ?? []);
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
