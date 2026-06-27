import { useState } from "react";
import { useNavigate } from "react-router-dom";

import { addWatchlistItem } from "../../../api/client";
import { ExportButton } from "../../../components/common/ExportButton";
import { DataGrid } from "../../../components/common/DataGrid";
import { TerminalPanel } from "../../../components/terminal/TerminalPanel";
import { useStockStore } from "../../../store/stockStore";
import { InlineBar } from "./InlineBar";
import { ScoreBadge } from "./ScoreBadge";
import { SparklineCell } from "./SparklineCell";
import { useScreenerContext } from "./ScreenerContext";

function toNum(value: unknown): number {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function getTicker(row: Record<string, unknown>): string {
  return String(row.ticker || row.symbol || "").toUpperCase();
}

function getMarket(row: Record<string, unknown>): string {
  const raw = String(row.market || row.exchange || row.country_code || "").toUpperCase();
  if (raw.includes("US") || raw.includes("NYSE") || raw.includes("NASDAQ") || raw.includes("AMEX")) return "US";
  return "India";
}

function factorScore(row: Record<string, unknown>, key: string): number {
  const factorScores = row.factor_scores as Record<string, unknown> | undefined;
  const scores = row.scores as Record<string, unknown> | undefined;
  const raw = row[key] ?? factorScores?.[key] ?? scores?.[key];
  if (typeof raw === "object" && raw && "value" in raw) return toNum((raw as { value?: unknown }).value);
  const n = toNum(raw);
  return n > 1 ? n : n * 100;
}

function compositeScore(row: Record<string, unknown>): number {
  return factorScore(row, "composite_score") || factorScore(row, "composite") || factorScore(row, "rank_score");
}

function factorChips(row: Record<string, unknown>): string[] {
  const explicit = row.factor_chips || row.chips;
  if (Array.isArray(explicit)) return explicit.map(String).filter(Boolean);
  return [
    ["VALUE", factorScore(row, "value")],
    ["MOM", factorScore(row, "momentum")],
    ["QUALITY", factorScore(row, "quality")],
    ["LOW-VOL", factorScore(row, "low_vol")],
  ].filter(([, value]) => Number(value) >= 60).map(([label]) => String(label));
}

function whyRanked(row: Record<string, unknown>): string {
  const explicit = row.why_ranked || row.why || row.explanation;
  if (Array.isArray(explicit)) return explicit.map(String).join("; ");
  if (explicit) return String(explicit);
  const chips = factorChips(row);
  return chips.length ? `Top drivers: ${chips.join(", ")}` : "Ranked by composite factor score and active screen filters.";
}

export function ResultsTable() {
  const navigate = useNavigate();
  const setTicker = useStockStore((state) => state.setTicker);
  const { result, selectedRow, setSelectedRow } = useScreenerContext();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const rows = result?.results || [];
  const selectedIndex = selectedRow ? rows.indexOf(selectedRow) : -1;

  const openChart = (row: Record<string, unknown>) => {
    const ticker = getTicker(row);
    if (!ticker) return;
    setTicker(ticker);
    navigate("/equity/chart-workstation");
  };

  const openSecurity = (row: Record<string, unknown>, tab: "overview" | "news") => {
    const ticker = getTicker(row);
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/security/${encodeURIComponent(ticker)}?tab=${tab}`);
  };

  const openBacktest = (row: Record<string, unknown>) => {
    const ticker = getTicker(row);
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/backtesting?symbol=${encodeURIComponent(ticker)}&market=${encodeURIComponent(getMarket(row))}&source=screener`, { state: { ticker, market: getMarket(row), screen: "screener", row } });
  };

  const openCompare = (row: Record<string, unknown>) => {
    const ticker = getTicker(row);
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/chart-workstation?symbol=${encodeURIComponent(ticker)}&compare=true&source=screener`, { state: { ticker, screen: "screener", compare: true, row } });
  };

  const openAlert = (row: Record<string, unknown>) => {
    const ticker = getTicker(row);
    if (!ticker) return;
    setTicker(ticker);
    navigate(`/equity/alerts?symbol=${encodeURIComponent(ticker)}&source=screener`, { state: { ticker, screen: "screener", row } });
  };

  const watch = async (row: Record<string, unknown>) => {
    const ticker = getTicker(row);
    if (!ticker) return;
    setActionMessage(null);
    try {
      await addWatchlistItem({ watchlist_name: "Default", ticker });
      setActionMessage(`${ticker} added to watchlist`);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Failed to add to watchlist");
    }
  };

  return (
    <TerminalPanel
      title="Results"
      subtitle={`Rows: ${rows.length}`}
      actions={<ExportButton source="screener_results" data={rows} />}
    >
      {actionMessage ? <div className="mb-2 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">{actionMessage}</div> : null}
      <DataGrid
        preset="screener"
        rows={rows}
        rowKey={(row, idx) => `${String(row.ticker || "row")}-${idx}`}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : undefined}
        onRowSelect={(idx) => setSelectedRow(rows[idx] || null)}
        onRowOpen={(idx) => setSelectedRow(rows[idx] || null)}
        rowActions={(row) => (
          <div className="flex flex-wrap gap-1">
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                openChart(row);
              }}
            >
              Chart
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                openSecurity(row, "overview");
              }}
            >
              Research
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                openSecurity(row, "news");
              }}
            >
              News
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                openBacktest(row);
              }}
            >
              Backtest
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                openCompare(row);
              }}
            >
              Compare
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                void watch(row);
              }}
            >
              Watch
            </button>
            <button
              type="button"
              className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] uppercase tracking-wide text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={(event) => {
                event.stopPropagation();
                openAlert(row);
              }}
            >
              Alert
            </button>
          </div>
        )}
        className="max-h-[52vh] xl:max-h-[56vh]"
        columns={[
          {
            key: "company",
            header: "Company",
            sortable: true,
            sortValue: (row) => String(row.company || row.company_name || row.ticker || ""),
            renderCell: (row) => String(row.company || row.company_name || row.ticker || "-"),
          },
          {
            key: "sector",
            header: "Sector",
            sortable: true,
            sortValue: (row) => String(row.sector || ""),
            renderCell: (row) => <span className="text-terminal-muted">{String(row.sector || "-")}</span>,
          },
          {
            key: "mcap",
            header: "MCap",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.market_cap),
            renderCell: (row) => toNum(row.market_cap).toLocaleString("en-IN", { maximumFractionDigits: 0 }),
          },
          {
            key: "pe",
            header: "PE",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.pe),
            renderCell: (row) => toNum(row.pe).toFixed(2),
          },
          {
            key: "roe",
            header: "ROE",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.roe),
            renderCell: (row) => toNum(row.roe).toFixed(2),
          },
          {
            key: "roce",
            header: "ROCE",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.roce),
            renderCell: (row) => (
              <div className="flex items-center justify-end gap-2">
                <InlineBar value={toNum(row.roce)} />
                <span>{toNum(row.roce).toFixed(1)}</span>
              </div>
            ),
          },
          {
            key: "spark",
            header: "1Y",
            renderCell: (row) => <SparklineCell values={Array.isArray(row.sparkline_price_1y) ? (row.sparkline_price_1y as number[]) : []} />,
          },
          {
            key: "composite",
            header: "Composite",
            align: "right",
            sortable: true,
            sortValue: (row) => compositeScore(row),
            renderCell: (row) => <ScoreBadge value={compositeScore(row)} max={100} label="C" />,
          },
          {
            key: "factor_chips",
            header: "Factors",
            renderCell: (row) => (
              <div className="flex flex-wrap gap-1">
                {factorChips(row).slice(0, 4).map((chip) => <span key={`${getTicker(row)}-${chip}`} className="rounded border border-terminal-border px-1 py-0.5 text-[10px] text-terminal-muted">{chip}</span>)}
              </div>
            ),
          },
          {
            key: "why",
            header: "Why Ranked",
            renderCell: (row) => <span className="block max-w-[240px] truncate text-terminal-muted" title={whyRanked(row)}>{whyRanked(row)}</span>,
          },
          {
            key: "score",
            header: "Score",
            align: "right",
            sortable: true,
            sortValue: (row) => factorScore(row, "quality"),
            renderCell: (row) => <ScoreBadge value={factorScore(row, "quality")} max={100} label="Q" />,
          },
        ]}
      />
    </TerminalPanel>
  );
}
