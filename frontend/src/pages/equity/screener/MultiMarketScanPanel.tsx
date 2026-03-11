import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";

import { addPortfolioHolding, addWatchlistItem, fetchPortfolios, runScreenerScan, type ScreenerScanFilter } from "../../../api/client";
import { DenseTable } from "../../../components/terminal/DenseTable";
import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useStockStore } from "../../../store/stockStore";

type Preset = {
  id: string;
  label: string;
  filters: ScreenerScanFilter[];
  formula?: string;
};

type SavedScanTemplate = {
  markets: string[];
  limit: number;
  marketCapMin: string;
  peMax: string;
  sectorCsv: string;
  formulaMode: boolean;
  formula: string;
  rows: Array<Record<string, unknown>>;
  selectedSymbol: string;
};

const SCAN_TEMPLATE_STORAGE_KEY = "screener:scan:last-template:v2";

const PRESETS: Preset[] = [
  {
    id: "value",
    label: "Warren Buffett Value",
    filters: [
      { field: "pe_ratio", op: "lte", value: 15 },
      { field: "roe", op: "gte", value: 20 },
      { field: "debt_to_equity", op: "lte", value: 0.5 },
    ],
  },
  {
    id: "growth",
    label: "Growth Monsters",
    filters: [
      { field: "revenue_growth_yoy", op: "gte", value: 25 },
      { field: "earnings_growth_yoy", op: "gte", value: 25 },
    ],
  },
  {
    id: "dividend",
    label: "Dividend Kings",
    filters: [{ field: "dividend_yield", op: "gte", value: 3 }],
    formula: "DividendYield >= 3",
  },
  {
    id: "momentum",
    label: "Momentum Breakout",
    filters: [{ field: "price_change_3m", op: "gte", value: 20 }],
  },
  {
    id: "quality",
    label: "Quality at Fair Price",
    filters: [
      { field: "roe", op: "gte", value: 15 },
      { field: "pe_ratio", op: "lte", value: 25 },
      { field: "debt_to_equity", op: "lte", value: 1 },
    ],
  },
];

function parseFormulaToFilters(formula: string): ScreenerScanFilter[] {
  const text = formula.toUpperCase();
  const parts = text.split(/\bAND\b|\bOR\b|\(|\)/).map((p) => p.trim()).filter(Boolean);
  const out: ScreenerScanFilter[] = [];
  for (const part of parts) {
    const m = part.match(/^([A-Z_][A-Z0-9_]*)\s*(<=|>=|!=|=|<|>)\s*([0-9.]+)$/);
    if (!m) continue;
    const [, fieldRaw, opRaw, valueRaw] = m;
    const map: Record<string, string> = {
      PE: "pe_ratio",
      ROE: "roe",
      ROIC: "roe",
      DIVIDENDYIELD: "dividend_yield",
      MARKETCAP: "market_cap",
      DEBTTOEQUITY: "debt_to_equity",
    };
    const field = map[fieldRaw] || fieldRaw.toLowerCase();
    const op = opRaw === "=" ? "eq" : opRaw === "!=" ? "neq" : opRaw === "<" ? "lt" : opRaw === ">" ? "gt" : opRaw === "<=" ? "lte" : "gte";
    out.push({ field, op, value: Number(valueRaw) });
  }
  return out;
}

function highlightFormula(formula: string): string {
  return formula
    .replace(/(AND|OR|NOT|\(|\))/gi, "<span class='text-terminal-accent'>$1</span>")
    .replace(/\b(PE|ROE|ROIC|DIVIDENDYIELD|MARKETCAP|DEBTTOEQUITY)\b/gi, "<span class='text-blue-300'>$1</span>")
    .replace(/([<>]=?|!=|=)/g, "<span class='text-amber-300'>$1</span>")
    .replace(/(\d+(\.\d+)?)/g, "<span class='text-emerald-300'>$1</span>");
}

function getRowSymbol(row: Record<string, unknown>): string {
  return String(row.symbol || row.ticker || "").toUpperCase();
}

function getRowPrice(row: Record<string, unknown>): number {
  return Number(row.current_price ?? row.price ?? row.last_price ?? 0);
}

export function MultiMarketScanPanel() {
  const navigate = useNavigate();
  const setTicker = useStockStore((state) => state.setTicker);
  const [markets, setMarkets] = useState<string[]>(["NSE", "NYSE", "NASDAQ"]);
  const [limit, setLimit] = useState(100);
  const [marketCapMin, setMarketCapMin] = useState("1000000000");
  const [peMax, setPeMax] = useState("25");
  const [sectorCsv, setSectorCsv] = useState("");
  const [formulaMode, setFormulaMode] = useState(false);
  const [formula, setFormula] = useState("PE < 15 AND (ROE > 20 OR ROIC > 15) AND DividendYield > 2");
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [selectedSymbol, setSelectedSymbol] = useState<string>("");
  const [scanMessage, setScanMessage] = useState<string | null>(null);

  const baseFilters = useMemo(() => {
    const filters: ScreenerScanFilter[] = [];
    const cap = Number(marketCapMin);
    if (Number.isFinite(cap) && cap > 0) filters.push({ field: "market_cap", op: "gte", value: cap });
    const pe = Number(peMax);
    if (Number.isFinite(pe) && pe > 0) filters.push({ field: "pe_ratio", op: "lte", value: pe });
    const sectors = sectorCsv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
    if (sectors.length) filters.push({ field: "sector", op: "in", value: sectors });
    return filters;
  }, [marketCapMin, peMax, sectorCsv]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SCAN_TEMPLATE_STORAGE_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw) as Partial<SavedScanTemplate>;
      if (Array.isArray(parsed.markets) && parsed.markets.length) setMarkets(parsed.markets);
      if (typeof parsed.limit === "number" && Number.isFinite(parsed.limit)) setLimit(parsed.limit);
      if (typeof parsed.marketCapMin === "string") setMarketCapMin(parsed.marketCapMin);
      if (typeof parsed.peMax === "string") setPeMax(parsed.peMax);
      if (typeof parsed.sectorCsv === "string") setSectorCsv(parsed.sectorCsv);
      if (typeof parsed.formulaMode === "boolean") setFormulaMode(parsed.formulaMode);
      if (typeof parsed.formula === "string") setFormula(parsed.formula);
      if (Array.isArray(parsed.rows)) setRows(parsed.rows);
      if (typeof parsed.selectedSymbol === "string") setSelectedSymbol(parsed.selectedSymbol);
    } catch {
      // Ignore malformed local cache and keep defaults.
    }
  }, []);

  const runScan = async (preset?: Preset) => {
    setLoading(true);
    setScanMessage(null);
    try {
      const filters = formulaMode
        ? [...baseFilters, ...parseFormulaToFilters(formula)]
        : [...baseFilters, ...(preset?.filters ?? [])];
      const payload = await runScreenerScan({
        markets,
        filters,
        sort: { field: "market_cap", order: "desc" },
        limit,
        formula: formulaMode ? formula : preset?.formula,
      });
      const nextRows = payload.rows || [];
      setRows(nextRows);
      setSelectedSymbol(nextRows.length ? getRowSymbol(nextRows[0]) : "");
      setScanMessage(`Loaded ${nextRows.length} scan results`);
    } finally {
      setLoading(false);
    }
  };

  const onAddToWatchlist = async (symbol: string) => {
    if (!symbol) return;
    try {
      await addWatchlistItem({ watchlist_name: "Default", ticker: symbol });
      setScanMessage(`${symbol} added to watchlist`);
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Failed to add to watchlist");
    }
  };

  const onAddToPortfolio = async (symbol: string, costHint?: number) => {
    if (!symbol) return;
    try {
      const portfolios = await fetchPortfolios();
      const target = portfolios[0];
      if (!target) {
        setScanMessage("No portfolio available for quick add");
        return;
      }
      const safeCost = Number.isFinite(Number(costHint)) && Number(costHint) > 0 ? Number(costHint) : 1;
      await addPortfolioHolding(target.id, {
        symbol,
        shares: 1,
        cost_basis_per_share: safeCost,
        purchase_date: new Date().toISOString().slice(0, 10),
        notes: "Added from Screener context menu",
      });
      setScanMessage(`${symbol} added to portfolio ${target.name}`);
    } catch (error) {
      setScanMessage(error instanceof Error ? error.message : "Failed to add to portfolio");
    }
  };

  const saveTemplate = () => {
    const payload: SavedScanTemplate = {
      markets,
      limit,
      marketCapMin,
      peMax,
      sectorCsv,
      formulaMode,
      formula,
      rows,
      selectedSymbol,
    };
    localStorage.setItem(SCAN_TEMPLATE_STORAGE_KEY, JSON.stringify(payload));
    setScanMessage("Saved full scan setup");
  };

  const loadTemplate = () => {
    const raw = localStorage.getItem(SCAN_TEMPLATE_STORAGE_KEY);
    if (!raw) {
      setScanMessage("No saved scan setup found");
      return;
    }
    try {
      const parsed = JSON.parse(raw) as SavedScanTemplate;
      setMarkets(Array.isArray(parsed.markets) && parsed.markets.length ? parsed.markets : ["NSE", "NYSE", "NASDAQ"]);
      setLimit(typeof parsed.limit === "number" ? parsed.limit : 100);
      setMarketCapMin(parsed.marketCapMin || "1000000000");
      setPeMax(parsed.peMax || "25");
      setSectorCsv(parsed.sectorCsv || "");
      setFormulaMode(Boolean(parsed.formulaMode));
      setFormula(parsed.formula || "PE < 15 AND (ROE > 20 OR ROIC > 15) AND DividendYield > 2");
      setRows(Array.isArray(parsed.rows) ? parsed.rows : []);
      setSelectedSymbol(parsed.selectedSymbol || "");
      setScanMessage("Loaded saved scan setup");
    } catch {
      setScanMessage("Saved scan setup is invalid");
    }
  };

  const openChart = (symbol: string) => {
    if (!symbol) return;
    setTicker(symbol);
    navigate("/equity/chart-workstation");
  };

  const openSecurity = (symbol: string, tab: "overview" | "news") => {
    if (!symbol) return;
    setTicker(symbol);
    navigate(`/equity/security/${encodeURIComponent(symbol)}?tab=${tab}`);
  };

  return (
    <TerminalPanel title="Multi-Market EQS Scan" subtitle="NSE + NYSE + NASDAQ / custom formula mode">
      <div className="grid gap-2">
        <div className="flex flex-wrap items-center gap-2">
          {["NSE", "NYSE", "NASDAQ"].map((m) => (
            <label key={m} className="inline-flex items-center gap-1 text-xs text-terminal-muted">
              <input
                type="checkbox"
                checked={markets.includes(m)}
                onChange={(e) =>
                  setMarkets((prev) => (e.target.checked ? [...new Set([...prev, m])] : prev.filter((x) => x !== m)))
                }
              />
              {m}
            </label>
          ))}
          <TerminalInput
            value={limit}
            onChange={(e) => setLimit(Math.max(20, Math.min(500, Number(e.target.value) || 100)))}
            className="w-20"
            aria-label="Result limit"
          />
          <TerminalButton variant="accent" onClick={() => void runScan()}>
            {loading ? "Scanning..." : "Run Scan"}
          </TerminalButton>
          <TerminalButton variant="default" onClick={loadTemplate}>Load Setup</TerminalButton>
          <TerminalButton variant="default" onClick={saveTemplate}>Save Setup</TerminalButton>
        </div>

        <div className="grid gap-2 md:grid-cols-3">
          <TerminalInput value={marketCapMin} onChange={(e) => setMarketCapMin(e.target.value)} placeholder="Min Market Cap" />
          <TerminalInput value={peMax} onChange={(e) => setPeMax(e.target.value)} placeholder="Max P/E" />
          <TerminalInput value={sectorCsv} onChange={(e) => setSectorCsv(e.target.value)} placeholder="Sectors comma-separated" />
        </div>

        <div className="flex flex-wrap items-center gap-1">
          {PRESETS.map((preset) => (
            <TerminalButton key={preset.id} variant="default" onClick={() => void runScan(preset)}>
              {preset.label}
            </TerminalButton>
          ))}
          <label className="ml-2 inline-flex items-center gap-1 text-xs text-terminal-muted">
            <input type="checkbox" checked={formulaMode} onChange={(e) => setFormulaMode(e.target.checked)} />
            Formula mode
          </label>
        </div>

        {formulaMode ? (
          <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
            <div className="mb-1 text-[11px] text-terminal-muted">Custom formula</div>
            <textarea
              value={formula}
              onChange={(e) => setFormula(e.target.value)}
              className="h-16 w-full resize-none rounded border border-terminal-border bg-[#0D1117] px-2 py-1 font-mono text-[11px] text-terminal-text outline-none focus:border-terminal-accent"
            />
            <div className="mt-1 rounded border border-terminal-border bg-[#0B0F14] px-2 py-1 font-mono text-[11px]" dangerouslySetInnerHTML={{ __html: highlightFormula(formula) }} />
          </div>
        ) : null}

        {selectedSymbol ? (
          <div className="flex flex-wrap items-center gap-2 rounded border border-terminal-border bg-terminal-bg px-2 py-2 text-xs">
            <TerminalBadge variant="accent">{selectedSymbol}</TerminalBadge>
            <TerminalButton size="sm" variant="accent" onClick={() => openChart(selectedSymbol)}>Open Chart</TerminalButton>
            <TerminalButton size="sm" variant="default" onClick={() => openSecurity(selectedSymbol, "overview")}>Security Hub</TerminalButton>
            <TerminalButton size="sm" variant="default" onClick={() => openSecurity(selectedSymbol, "news")}>News</TerminalButton>
            <TerminalButton size="sm" variant="default" onClick={() => void onAddToWatchlist(selectedSymbol)}>Add Watchlist</TerminalButton>
            <TerminalButton size="sm" variant="default" onClick={() => void onAddToPortfolio(selectedSymbol)}>Add Portfolio</TerminalButton>
          </div>
        ) : null}

        <div className="flex items-center justify-between text-xs text-terminal-muted">
          <div className="inline-flex items-center gap-2">
            <TerminalBadge variant="neutral">{rows.length} results</TerminalBadge>
            <span>{markets.join(" / ")} scan board</span>
          </div>
          <TerminalButton
            variant="default"
            onClick={() => {
              for (const row of rows.slice(0, 25)) {
                const symbol = String(row.symbol || row.ticker || "").toUpperCase();
                if (symbol) void onAddToWatchlist(symbol);
              }
            }}
          >
            Add Top 25 to Watchlist
          </TerminalButton>
        </div>

        {scanMessage ? <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">{scanMessage}</div> : null}

        <DenseTable
          id="multi-market-scan-results"
          rows={rows}
          rowKey={(row, idx) => String(row.symbol || row.ticker || idx)}
          height={360}
          columns={[
            { key: "symbol", title: "Symbol", type: "text", frozen: true, width: 110, sortable: true, getValue: (r) => r.symbol || r.ticker },
            { key: "company_name", title: "Company", type: "text", width: 220, sortable: true, getValue: (r) => r.company_name || r.name },
            { key: "exchange", title: "Mkt", type: "text", width: 80, sortable: true, getValue: (r) => r.exchange || r.market },
            { key: "market_cap", title: "Mkt Cap", type: "large-number", align: "right", sortable: true, getValue: (r) => r.market_cap || r.mcap },
            { key: "pe_ratio", title: "P/E", type: "number", align: "right", sortable: true, getValue: (r) => r.pe_ratio || r.pe },
            { key: "roe", title: "ROE", type: "percent", align: "right", sortable: true, getValue: (r) => r.roe || r.roe_pct },
            { key: "price_change_3m", title: "3M %", type: "percent", align: "right", sortable: true, getValue: (r) => r.price_change_3m || r.returns_3m },
            { key: "sparkline", title: "1M", type: "sparkline", width: 96, getValue: (r) => (Array.isArray(r.sparkline) ? r.sparkline : []) },
          ]}
          onRowClick={(row) => {
            setSelectedSymbol(getRowSymbol(row));
          }}
          onRowOpenInChart={(row) => {
            const symbol = getRowSymbol(row);
            if (symbol) openChart(symbol);
          }}
          onAddToWatchlist={(row) => {
            const symbol = getRowSymbol(row);
            if (symbol) void onAddToWatchlist(symbol);
          }}
          onAddToPortfolio={(row) => {
            const symbol = getRowSymbol(row);
            const px = getRowPrice(row);
            if (symbol) void onAddToPortfolio(symbol, px);
          }}
          onViewDetails={(row) => {
            const symbol = getRowSymbol(row);
            if (symbol) openSecurity(symbol, "overview");
          }}
        />
      </div>
    </TerminalPanel>
  );
}
