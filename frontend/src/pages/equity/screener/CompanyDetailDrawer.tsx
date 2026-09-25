import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { addWatchlistItem } from "../../../api/client";
import { TerminalBadge } from "../../../components/terminal/TerminalBadge";
import { TerminalButton } from "../../../components/terminal/TerminalButton";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useStockStore } from "../../../store/stockStore";
import { SparklineCell } from "./SparklineCell";
import { useScreenerContext } from "./ScreenerContext";

// Missing values render "—" (never "0"): a P/E of 0 is not a real reading.
function formatNum(value: unknown, { zeroIsMissing = false } = {}) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || (zeroIsMissing && n === 0)) return "—";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
}

// Screener market_cap is in the listing currency's base unit (INR / USD).
function formatMarketCap(value: unknown, market: string) {
  if (value == null || value === "") return "—";
  const n = Number(value);
  if (!Number.isFinite(n) || n <= 0) return "—";
  if (market === "US") {
    return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", notation: "compact", maximumFractionDigits: 2 }).format(n);
  }
  return `₹${(n / 1e7).toLocaleString("en-IN", { maximumFractionDigits: 0 })} Cr`;
}

function getTicker(row: Record<string, unknown> | null): string {
  return String(row?.ticker || row?.symbol || "").toUpperCase();
}

function getMarket(row: Record<string, unknown>): string {
  const raw = String(row.market || row.exchange || row.country_code || "").toUpperCase();
  if (raw.includes("US") || raw.includes("NYSE") || raw.includes("NASDAQ") || raw.includes("AMEX")) return "US";
  return "India";
}

function scoreValue(row: Record<string, unknown>, key: string): number {
  const factorScores = row.factor_scores as Record<string, unknown> | undefined;
  const scores = row.scores as Record<string, unknown> | undefined;
  const raw = row[key] ?? factorScores?.[key] ?? scores?.[key];
  const value = typeof raw === "object" && raw && "value" in raw ? Number((raw as { value?: unknown }).value) : Number(raw);
  if (!Number.isFinite(value)) return 0;
  return value > 1 ? value : value * 100;
}

function factorChips(row: Record<string, unknown>): string[] {
  const explicit = row.factor_chips || row.chips;
  if (Array.isArray(explicit)) return explicit.map(String).filter(Boolean);
  return [
    ["VALUE", scoreValue(row, "value")],
    ["MOM", scoreValue(row, "momentum")],
    ["QUALITY", scoreValue(row, "quality")],
    ["LOW-VOL", scoreValue(row, "low_vol")],
  ].filter(([, value]) => Number(value) >= 60).map(([label]) => String(label));
}

function whyRanked(row: Record<string, unknown>): string {
  const explicit = row.why_ranked || row.why || row.explanation;
  if (Array.isArray(explicit)) return explicit.map(String).join("; ");
  if (explicit) return String(explicit);
  const chips = factorChips(row);
  return chips.length ? `Top drivers: ${chips.join(", ")}` : "Ranked by composite factor score and active screen filters.";
}

export function CompanyDetailDrawer() {
  const navigate = useNavigate();
  const setTicker = useStockStore((state) => state.setTicker);
  const { selectedRow, setSelectedRow } = useScreenerContext();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  if (!selectedRow) {
    return (
      <TerminalPanel title="Company Detail" subtitle="Select a row" className="h-full">
        <div className="text-xs text-terminal-muted">Choose a result row to inspect scores, chart, and snapshot metrics.</div>
      </TerminalPanel>
    );
  }

  const ticker = getTicker(selectedRow);
  const scoreEntries = Object.entries((selectedRow.scores as Record<string, unknown>) || {});

  const openSecurity = (tab: "overview" | "news") => {
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/security/${encodeURIComponent(ticker)}?tab=${tab}`);
  };

  const openChart = () => {
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/chart-workstation?symbol=${encodeURIComponent(ticker)}&source=screener`, { state: { ticker, screen: "screener", row: selectedRow } });
  };

  const openBacktest = () => {
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/backtesting?symbol=${encodeURIComponent(ticker)}&market=${encodeURIComponent(getMarket(selectedRow))}&source=screener`, { state: { ticker, market: getMarket(selectedRow), screen: "screener", row: selectedRow } });
  };

  const openCompare = () => {
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/chart-workstation?symbol=${encodeURIComponent(ticker)}&compare=true&source=screener`, { state: { ticker, compare: true, screen: "screener", row: selectedRow } });
  };

  const openAlert = () => {
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/alerts?symbol=${encodeURIComponent(ticker)}&source=screener`, { state: { ticker, screen: "screener", row: selectedRow } });
  };

  const addToWatchlist = async () => {
    if (!ticker) return;
    setActionMessage(null);
    try {
      await addWatchlistItem({ watchlist_name: "Default", ticker });
      setActionMessage(`${ticker} added to watchlist`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Failed to add symbol to watchlist");
    }
  };

  return (
    <TerminalPanel
      title={String(selectedRow.company || selectedRow.ticker || "Company")}
      subtitle={String(selectedRow.ticker || "-")}
      className="h-full"
      bodyClassName="space-y-2 overflow-auto max-h-[72vh]"
      actions={<TerminalButton variant="default" onClick={() => setSelectedRow(null)}>Close</TerminalButton>}
    >
      <div className="flex flex-wrap gap-1">
        {ticker ? <TerminalBadge variant="accent">{ticker}</TerminalBadge> : null}
        <TerminalBadge variant="neutral">{String(selectedRow.sector || "Unclassified")}</TerminalBadge>
        {selectedRow.exchange ? <TerminalBadge variant="info">{String(selectedRow.exchange)}</TerminalBadge> : null}
      </div>

      <div className="grid grid-cols-2 gap-2 rounded-sm border border-terminal-border bg-terminal-bg p-2 text-xs">
        <div>
          <div className="text-terminal-muted">Sector</div>
          <div>{String(selectedRow.sector || "-")}</div>
        </div>
        <div>
          <div className="text-terminal-muted">Market Cap</div>
          <div>{formatMarketCap(selectedRow.market_cap, getMarket(selectedRow))}</div>
        </div>
        <div>
          <div className="text-terminal-muted">PE</div>
          <div>{formatNum(selectedRow.pe, { zeroIsMissing: true })}</div>
        </div>
        <div>
          <div className="text-terminal-muted">ROE</div>
          <div>{formatNum(selectedRow.roe)}</div>
        </div>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <TerminalButton variant="accent" onClick={openChart} disabled={!ticker}>Open Chart</TerminalButton>
        <TerminalButton variant="default" onClick={() => openSecurity("overview")} disabled={!ticker}>Security Hub</TerminalButton>
        <TerminalButton variant="default" onClick={openBacktest} disabled={!ticker}>Backtest</TerminalButton>
        <TerminalButton variant="default" onClick={openCompare} disabled={!ticker}>Compare</TerminalButton>
        <TerminalButton variant="default" onClick={() => void addToWatchlist()} disabled={!ticker}>Add Watchlist</TerminalButton>
        <TerminalButton variant="default" onClick={openAlert} disabled={!ticker}>Create Alert</TerminalButton>
      </div>

      {actionMessage ? (
        <div className="rounded-sm border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">{actionMessage}</div>
      ) : null}

      <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Price Trend</div>
        <SparklineCell values={Array.isArray(selectedRow.sparkline_price_1y) ? (selectedRow.sparkline_price_1y as number[]) : []} width={240} height={60} />
      </div>

      <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Signal Layer</div>
        <div className="mb-2 flex flex-wrap gap-1">
          {factorChips(selectedRow).map((chip) => <TerminalBadge key={chip} variant="neutral">{chip}</TerminalBadge>)}
        </div>
        <div className="text-xs text-terminal-muted">{whyRanked(selectedRow)}</div>
      </div>

      <div className="rounded-sm border border-terminal-border bg-terminal-bg p-2">
        <div className="mb-1 text-[11px] uppercase tracking-wide text-terminal-muted">Model Scores</div>
        <div className="space-y-1 text-xs">
          {scoreEntries.map(([name, payload]) => (
            <div key={name} className="flex items-center justify-between border-b border-terminal-border/40 pb-1 last:border-b-0">
              <span>{name}</span>
              <TerminalBadge variant="neutral">{typeof payload === "object" && payload && "value" in payload ? String((payload as { value: unknown }).value) : "--"}</TerminalBadge>
            </div>
          ))}
        </div>
      </div>
    </TerminalPanel>
  );
}
