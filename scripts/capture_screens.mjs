import { chromium } from "@playwright/test";
import fs from "node:fs";
const BASE = "http://127.0.0.1:8000";
const OUT = "../assets/screenshots/next"; // run from frontend/: node ../scripts/capture_screens.mjs [name,name]
const tok = fs.readFileSync("../.swarm/ot_v1/tok.txt", "utf8").trim();
const only = process.argv[2] ? process.argv[2].split(",") : null;

// [file name, route, section, description, optional pre-actions]
const SCREENS = [
  ["home", "/home", "Mission Control & Navigation", "Mission Control dashboard"],
  ["launchpad", "/equity/launchpad", "Mission Control & Navigation", "Launchpad workspace"],
  ["market-dashboard", "/equity/dashboard", "Mission Control & Navigation", "Market dashboard"],
  ["account", "/account", "Mission Control & Navigation", "Account settings and profile"],
  ["market-view", "/equity/stocks?ticker=AAPL", "Equity Research & Markets", "AAPL market chart view", { ticker: "AAPL" }],
  ["stock-detail", "/equity/security/AAPL?tab=overview", "Equity Research & Markets", "AAPL Security Hub", { rail: true }],
  ["security-hub-india", "/equity/security/RELIANCE?tab=overview", "Equity Research & Markets", "RELIANCE Security Hub", { rail: true }],
  ["financial-analysis", "/equity/security/RELIANCE?tab=financials", "Equity Research & Markets", "Financial statement analysis"],
  ["chart-workstation", "/equity/chart-workstation", "Equity Research & Markets", "Six-pane chart workstation"],
  ["multi-timeframe", "/equity/mta", "Equity Research & Markets", "Multi-timeframe analysis"],
  ["dom", "/equity/dom", "Equity Research & Markets", "Depth of market view"],
  ["time-and-sales", "/equity/tape", "Equity Research & Markets", "Time and sales tape"],
  ["split-compare", "/equity/compare?symbols=AAPL,MSFT", "Equity Research & Markets", "Multi-symbol split comparison"],
  ["market-heatmap", "/equity/heatmap", "Equity Research & Markets", "Market heatmap"],
  ["hotlists", "/equity/hotlists", "Equity Research & Markets", "Hotlists"],
  ["watchlist", "/equity/watchlist", "Equity Research & Markets", "Populated watchlist"],
  ["screener", "/equity/screener", "Equity Research & Markets", "Advanced screener after running a scan", { click: /Run Screen/i, wait: 12000 }],
  ["factor-dashboard", "/equity/factors", "Equity Research & Markets", "Factor dashboard"],
  ["relative-strength", "/equity/rs", "Equity Research & Markets", "Relative strength dashboard"],
  ["sector-rotation", "/equity/sector-rotation", "Equity Research & Markets", "Sector rotation dashboard"],
  ["dividends", "/equity/dividends", "Equity Research & Markets", "Dividend dashboard"],
  ["insider-activity", "/equity/insider", "Equity Research & Markets", "Insider activity monitor"],
  ["earnings-calendar", "/equity/earnings", "Equity Research & Markets", "Earnings calendar"],
  ["alpha-zoo", "/equity/alpha-zoo", "Quant Research & Backtesting", "Alpha Zoo factor library", { click: /^Evaluate$/i, wait: 60000 }],
  ["research-autopilot", "/equity/research-autopilot", "Quant Research & Backtesting", "Research Autopilot"],
  ["strategy-export", "/equity/strategy-export", "Quant Research & Backtesting", "Strategy export (Pine / MQL5)", { click: /^Generate$/i, wait: 8000 }],
  ["portfolio", "/equity/portfolio", "Portfolio, Risk & Trading", "Populated portfolio with holdings and risk metrics"],
  ["portfolio-lab", "/equity/portfolio/lab", "Portfolio, Risk & Trading", "Portfolio Lab"],
  ["portfolio-optimizer", "/backtesting/portfolio-optimizer", "Portfolio, Risk & Trading", "Portfolio optimizer", { click: /Run Optimize/i, wait: 25000 }],
  ["risk-dashboard", "/equity/risk", "Portfolio, Risk & Trading", "Risk dashboard"],
  ["correlation-dashboard", "/equity/correlation", "Portfolio, Risk & Trading", "Correlation matrix dashboard"],
  ["cockpit", "/equity/cockpit", "Portfolio, Risk & Trading", "Cockpit priority stack"],
  ["paper-trading", "/equity/paper", "Portfolio, Risk & Trading", "Populated paper trading workspace"],
  ["position-sizer", "/equity/position-sizer", "Portfolio, Risk & Trading", "Position sizing calculator"],
  ["trade-journal", "/equity/journal", "Portfolio, Risk & Trading", "Trade journal"],
  ["shadow-account", "/equity/shadow-account", "Portfolio, Risk & Trading", "Shadow account behavioural analytics"],
  ["alerts", "/equity/alerts", "Portfolio, Risk & Trading", "Alerts console and alert builder"],
  ["backtesting", "/backtesting", "Quant Research & Backtesting", "Backtesting workspace", { click: /^Run$/i, wait: 40000 }],
  ["model-lab", "/backtesting/model-lab", "Quant Research & Backtesting", "Model Lab"],
  ["model-governance", "/backtesting/model-governance", "Quant Research & Backtesting", "Model governance"],
  ["algorithm-framework", "/backtesting/algorithm-framework", "Quant Research & Backtesting", "Algorithm framework lab", { click: /Run Backtest/i, wait: 40000 }],
  ["stat-lab", "/equity/stat-lab", "Quant Research & Backtesting", "Statistical Lab", { click: /Run Forecast/i, wait: 25000 }],
  ["pair-trading", "/equity/pair-trading", "Quant Research & Backtesting", "Pair Trading Lab"],
  ["fno-option-chain", "/fno?symbol=AAPL", "Futures & Options", "F&O option chain"],
  ["fno-greeks", "/fno/greeks?symbol=AAPL", "Futures & Options", "F&O Greeks"],
  ["fno-futures", "/fno/futures?symbol=AAPL", "Futures & Options", "Futures analytics"],
  ["fno-oi", "/fno/oi?symbol=AAPL", "Futures & Options", "Open interest analysis"],
  ["fno-strategy", "/fno/strategy?symbol=AAPL", "Futures & Options", "Options strategy builder"],
  ["fno-pcr", "/fno/pcr?symbol=AAPL", "Futures & Options", "Put-call ratio dashboard"],
  ["fno-flow", "/fno/flow?symbol=AAPL", "Futures & Options", "Options flow dashboard"],
  ["fno-heatmap", "/fno/heatmap?symbol=AAPL", "Futures & Options", "F&O heatmap"],
  ["fno-expiry", "/fno/expiry?symbol=AAPL", "Futures & Options", "F&O expiry calendar"],
  ["option-greeks-calculator", "/equity/option-greeks", "Futures & Options", "Option Greeks calculator", { click: /Calculate Greeks/i, wait: 6000 }],
  ["commodities", "/equity/commodities", "Cross-Asset & Macro", "Commodities workspace"],
  ["forex", "/equity/forex", "Cross-Asset & Macro", "Forex workspace"],
  ["crypto", "/equity/crypto", "Cross-Asset & Macro", "Crypto workspace"],
  ["etf-analytics", "/equity/etf-analytics", "Cross-Asset & Macro", "ETF analytics"],
  ["mutual-funds", "/equity/mutual-funds", "Cross-Asset & Macro", "Mutual funds workspace"],
  ["bonds", "/equity/bonds", "Cross-Asset & Macro", "Bonds workspace"],
  ["yield-curve", "/equity/yield-curve", "Cross-Asset & Macro", "Yield curve dashboard"],
  ["bond-analytics", "/equity/bond-analytics", "Cross-Asset & Macro", "Bond analytics calculator", { click: /Calculate Analytics/i, wait: 6000 }],
  ["economic-terminal", "/equity/economics", "Cross-Asset & Macro", "Economic terminal"],
  ["data-quality", "/equity/data-quality", "Cross-Asset & Macro", "Data quality dashboard"],
  ["news-sentiment", "/equity/news?ticker=AAPL", "Intelligence, AI & Platform", "News and sentiment"],
  ["intelligence-timeline", "/equity/intelligence-timeline", "Intelligence, AI & Platform", "Intelligence timeline"],
  ["research", "/equity/research", "Intelligence, AI & Platform", "Research library"],
  ["oms-compliance", "/equity/oms", "Intelligence, AI & Platform", "OMS compliance dashboard"],
  ["ops-dashboard", "/equity/ops", "Intelligence, AI & Platform", "Operations dashboard"],
  ["plugins", "/equity/plugins", "Intelligence, AI & Platform", "Plugin manager"],
  ["settings", "/equity/settings", "Intelligence, AI & Platform", "Settings with Data Providers"],
  ["saved-views", "/equity/saved-views", "Intelligence, AI & Platform", "Saved views manager"],
  ["reports", "/reports", "Intelligence, AI & Platform", "Scheduled reports"],
];

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const ctx = await browser.newContext({ viewport: { width: 1680, height: 1050 }, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const state = { errors: [], failed: [] };
page.on("pageerror", (e) => state.errors.push(e.message.slice(0, 160)));
page.on("console", (m) => { if (m.type() === "error" && !/WebGL|THREE|favicon/.test(m.text())) state.errors.push(m.text().slice(0, 160)); });
page.on("response", (r) => { const u = r.url(); if (u.includes("/api/") && r.status() >= 400) state.failed.push(`${r.status()} ${u.replace(BASE, "").slice(0, 90)}`); });

await page.goto(BASE + "/login");
await page.evaluate((t) => {
  localStorage.setItem("ot-access-token", t); localStorage.setItem("ot-refresh-token", t);
  localStorage.setItem("ot:nav:expanded", "false");
  const cur = JSON.parse(localStorage.getItem("ui-settings") || '{"state":{}}'); cur.state = { ...cur.state, tickerTapeVisible: true }; localStorage.setItem("ui-settings", JSON.stringify(cur));
}, tok);

async function settle(extra = 1500) {
  await page.waitForLoadState("networkidle", { timeout: 25000 }).catch(() => {});
  const t0 = Date.now();
  while (Date.now() - t0 < 20000) {
    const loading = await page.evaluate(() => /(^|\s)(loading|fetching|running)(…|\.\.\.)?(\s|$)/i.test(document.body.innerText.slice(0, 20000)) && !/no data|unavailable/i.test(""));
    if (!loading) break;
    await page.waitForTimeout(700);
  }
  await page.waitForTimeout(extra);
}

const manifest = [];
for (const [name, route, section, desc, opts = {}] of SCREENS) {
  if (only && !only.includes(name)) continue;
  state.errors = []; state.failed = [];
  const t0 = Date.now();
  try {
    if (opts.ticker) await page.evaluate((tk) => { const s = JSON.parse(localStorage.getItem("stock-state") || '{"state":{}}'); s.state = { ...s.state, ticker: tk }; localStorage.setItem("stock-state", JSON.stringify(s)); }, opts.ticker);
    await page.goto(BASE + route, { waitUntil: "domcontentloaded", timeout: 30000 });
    await settle();
    if (opts.rail) { const b = page.getByRole("button", { name: /Show Context Rail/i }); if (await b.count()) { await b.click(); await settle(2500); } }
    else { const h = page.getByRole("button", { name: /Hide Context Rail/i }); if (await h.count()) { await h.click(); await page.waitForTimeout(400); } }
    if (opts.click) { const b = page.getByRole("button", { name: opts.click }).first(); if (await b.count()) { await b.click(); await page.waitForTimeout(opts.wait || 3000); await settle(1000); } }
    const text = await page.evaluate(() => document.body.innerText);
    const redirected = page.url().includes("/login");
    const errorText = (text.match(/[^\n]*(failed to|could not|unavailable|error:|something went wrong)[^\n]*/gi) || []).slice(0, 3).map((s) => s.trim().slice(0, 90));
    const emptyText = (text.match(/[^\n]*(no data|no holdings|no alerts|no entries|nothing scheduled|not configured|no results)[^\n]*/gi) || []).slice(0, 3).map((s) => s.trim().slice(0, 90));
    await page.screenshot({ path: `${OUT}/${name}.png` });
    manifest.push({ name, route, section, desc, ms: Date.now() - t0, redirected, pageErrors: [...new Set(state.errors)].slice(0, 4), failedApi: [...new Set(state.failed)].slice(0, 5), errorText, emptyText });
    console.log(`${name.padEnd(26)} ${String(Date.now() - t0).padStart(6)}ms  err=${new Set(state.errors).size} api4xx=${new Set(state.failed).size} ${redirected ? "REDIRECTED-TO-LOGIN" : ""} ${errorText[0] ? "| " + errorText[0].slice(0, 60) : ""}`);
  } catch (e) {
    manifest.push({ name, route, section, desc, ms: Date.now() - t0, crashed: e.message.slice(0, 120) });
    console.log(`${name.padEnd(26)} CRASH ${e.message.slice(0, 100)}`);
  }
}
const prev = fs.existsSync(`${OUT}/manifest.json`) ? JSON.parse(fs.readFileSync(`${OUT}/manifest.json`, "utf8")) : [];
const merged = only ? [...prev.filter((p) => !only.includes(p.name)), ...manifest] : manifest;
fs.writeFileSync(`${OUT}/manifest.json`, JSON.stringify(merged, null, 2));
await browser.close();
