import { useMemo, useState } from "react";

import { addPortfolioHolding, addWatchlistItem, fetchPortfolios, runScreenerScan, type ScreenerScanFilter } from "../../../api/client";
import { DenseTable } from "../../../components/terminal/DenseTable";
import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalInput } from "../../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";

type Preset = {
  id: string;
  label: string;
  filters: ScreenerScanFilter[];
  formula?: string;
};

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

export function MultiMarketScanPanel() {
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

  const runScan = async (preset?: Preset) => {
    setLoading(true);
    try {
      const payload = await runScreenerScan({
        markets,
        filters: formulaMode ? [...baseFilters, ...parseFormulaToFilters(formula)] : (preset?.filters ?? baseFilters),
        sort: { field: "market_cap", order: "desc" },
        limit,
        formula: formulaMode ? formula : preset?.formula,
      });
      setRows(payload.rows || []);
    } finally {
      setLoading(false);
    }
  };

  const onAddToWatchlist = async (symbol: string) => {
    if (!symbol) return;
    await addWatchlistItem({ watchlist_name: "Default", ticker: symbol });
  };

  const onAddToPortfolio = async (symbol: string, costHint?: number) => {
    if (!symbol) return;
    const portfolios = await fetchPortfolios();
    const target = portfolios[0];
    if (!target) return;
    const safeCost = Number.isFinite(Number(costHint)) && Number(costHint) > 0 ? Number(costHint) : 1;
    await addPortfolioHolding(target.id, {
      symbol,
      shares: 1,
      cost_basis_per_share: safeCost,
      purchase_date: new Date().toISOString().slice(0, 10),
      notes: "Added from Screener context menu",
    });
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
          <TerminalButton
            variant="default"
            onClick={() => {
              const saved = localStorage.getItem("screener:scan:last");
              if (!saved) return;
              const parsed = JSON.parse(saved) as { rows?: Array<Record<string, unknown>> };
              setRows(parsed.rows || []);
            }}
          >
            Load Template
          </TerminalButton>
          <TerminalButton
            variant="default"
            onClick={() => localStorage.setItem("screener:scan:last", JSON.stringify({ rows }))}
          >
            Save as Template
          </TerminalButton>
          {selectedSymbol ? (
            <TerminalButton variant="default" onClick={() => void onAddToWatchlist(selectedSymbol)}>
              Add {selectedSymbol} to Watchlist
            </TerminalButton>
          ) : null}
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

        <div className="flex items-center justify-between text-xs text-terminal-muted">
          <div className="inline-flex items-center gap-2">
            <TerminalBadge variant="neutral">{rows.length} results</TerminalBadge>
            <span>Sparkline + sortable dense table</span>
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
            setSelectedSymbol(String(row.symbol || row.ticker || "").toUpperCase());
          }}
          onAddToWatchlist={(row) => {
            const symbol = String(row.symbol || row.ticker || "").toUpperCase();
            if (symbol) void onAddToWatchlist(symbol);
          }}
          onAddToPortfolio={(row) => {
            const symbol = String(row.symbol || row.ticker || "").toUpperCase();
            const px = Number(row.current_price ?? row.price ?? row.last_price ?? 0);
            if (symbol) void onAddToPortfolio(symbol, px);
          }}
        />
      </div>
    </TerminalPanel>
  );
}
