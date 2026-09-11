import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Bell, Bookmark, Filter, GitCompareArrows, LineChart, ListChecks, Newspaper, Plus, Search, TestTube2, TrendingDown, TrendingUp } from "lucide-react";

import { addWatchlistItem, createScreenerAlert } from "../../../api/client";
import { useAgentStore } from "../../../agent/agentStore";
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

function firstNum(row: Record<string, unknown>, keys: string[]): number {
  for (const key of keys) {
    const value = toNum(row[key]);
    if (value !== 0) return value;
  }
  return 0;
}

function formatCompact(value: unknown): string {
  const n = toNum(value);
  if (!Number.isFinite(n) || n === 0) return "--";
  const abs = Math.abs(n);
  if (abs >= 1_00_00_00_000) return `${(n / 1_00_00_00_000).toFixed(1)}L Cr`;
  if (abs >= 1_00_00_000) return `${(n / 1_00_00_000).toFixed(1)}Cr`;
  if (abs >= 1_00_000) return `${(n / 1_00_000).toFixed(1)}L`;
  return n.toLocaleString("en-IN", { maximumFractionDigits: 0 });
}

function formatRatio(value: unknown): string {
  const n = toNum(value);
  if (!Number.isFinite(n) || n === 0) return "--";
  return n.toFixed(1);
}

function formatPct(value: unknown): string {
  const n = toNum(value);
  if (!Number.isFinite(n) || n === 0) return "--";
  return `${n.toFixed(1)}%`;
}

function formatPrice(value: unknown): string {
  const n = toNum(value);
  if (!Number.isFinite(n) || n === 0) return "--";
  return n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
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

function priceValue(row: Record<string, unknown>): number {
  return firstNum(row, ["last_price", "price", "current_price", "close"]);
}

function moveValue(row: Record<string, unknown>): number {
  const explicit = firstNum(row, ["returns_3m", "return_3m", "price_change_3m", "change_pct"]);
  if (explicit) return explicit;
  const values = sparklineValues(row);
  if (values.length < 2 || values[0] === 0) return 0;
  return ((values[values.length - 1] - values[0]) / values[0]) * 100;
}

function sparklineValues(row: Record<string, unknown>): number[] {
  const raw = row.sparkline_price_1y || row.price_history || row.trend;
  return Array.isArray(raw) ? raw.map(toNum).filter((value) => Number.isFinite(value) && value > 0) : [];
}

function rangePosition(row: Record<string, unknown>, price: number): number {
  const low = firstNum(row, ["low_52w", "week_52_low", "year_low", "fifty_two_week_low"]);
  const high = firstNum(row, ["high_52w", "week_52_high", "year_high", "fifty_two_week_high"]);
  if (!low || !high || !price || high <= low) return 0;
  return Math.max(0, Math.min(100, ((price - low) / (high - low)) * 100));
}

function trendLabel(move: number, position: number): string {
  if (position >= 80) return "near high";
  if (position > 0 && position <= 25) return "near low";
  if (move > 5) return "strong uptrend";
  if (move < -5) return "downtrend";
  return "range bound";
}

type ResultFilter = "all" | "quality" | "value" | "momentum" | "watchable";

const resultFilters: Array<{ id: ResultFilter; label: string }> = [
  { id: "all", label: "All" },
  { id: "quality", label: "Quality" },
  { id: "value", label: "Value" },
  { id: "momentum", label: "Momentum" },
  { id: "watchable", label: "Actionable" },
];

type ResultsTableProps = {
  framed?: boolean;
};

function ActionButton({
  label,
  icon: Icon,
  onClick,
}: {
  label: string;
  icon: typeof LineChart;
  onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      className="inline-flex h-7 w-7 items-center justify-center rounded-sm border border-terminal-border text-terminal-muted transition-colors hover:border-terminal-accent hover:bg-terminal-accent/10 hover:text-terminal-accent focus-visible:border-terminal-accent focus-visible:outline-none"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      <span className="sr-only">{label}</span>
    </button>
  );
}

function MarketMetricsCell({ row }: { row: Record<string, unknown> }) {
  const price = priceValue(row);
  const move = moveValue(row);
  const values = sparklineValues(row);
  const position = rangePosition(row, price);
  const MoveIcon = move >= 0 ? TrendingUp : TrendingDown;
  const tone = move >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  return (
    <div className="min-w-[210px] font-sans">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold text-terminal-text">{formatPrice(price)}</div>
          <div className="mt-1 text-[10px] uppercase text-terminal-muted">{trendLabel(move, position)}</div>
        </div>
        <div className={`inline-flex shrink-0 items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[11px] ${move >= 0 ? "border-terminal-pos/30 bg-terminal-pos/10 text-terminal-pos" : "border-terminal-neg/30 bg-terminal-neg/10 text-terminal-neg"}`}>
          <MoveIcon className="h-3 w-3" aria-hidden="true" />
          {move ? formatPct(move) : "--"}
        </div>
      </div>
      <div className="mt-2 flex items-center gap-3">
        <div className="w-[118px] shrink-0">
          <SparklineCell values={values} />
        </div>
        <div className="min-w-[68px] flex-1">
          <div className="mb-1 flex justify-between text-[10px] text-terminal-muted">
            <span>52W</span>
            <span className={tone}>{position ? `${position.toFixed(0)}%` : "--"}</span>
          </div>
          <div className="relative h-1.5 rounded-full bg-terminal-bg">
            <div className="absolute inset-y-0 left-0 rounded-full bg-terminal-border" style={{ width: `${position || 8}%` }} />
            {position ? (
              <div className="absolute top-1/2 h-3 w-1 -translate-y-1/2 rounded-full bg-terminal-accent" style={{ left: `calc(${position}% - 2px)` }} />
            ) : null}
          </div>
        </div>
      </div>
    </div>
  );
}

export function ResultsTable({ framed = true }: ResultsTableProps) {
  const navigate = useNavigate();
  const setTicker = useStockStore((state) => state.setTicker);
  const { result, selectedRow, setSelectedRow } = useScreenerContext();
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [searchText, setSearchText] = useState("");
  const [resultFilter, setResultFilter] = useState<ResultFilter>("all");
  const [saveAlertName, setSaveAlertName] = useState("");
  const [saveAlertOpen, setSaveAlertOpen] = useState(false);
  const [savingAlert, setSavingAlert] = useState(false);
  const [saveAlertRow, setSaveAlertRow] = useState<Record<string, unknown> | null>(null);
  const rows = result?.results || [];
  const visibleRows = useMemo(() => {
    const q = searchText.trim().toLowerCase();
    return rows.filter((row) => {
      const matchesSearch = !q || [row.company, row.company_name, row.ticker, row.symbol, row.sector]
        .some((value) => String(value || "").toLowerCase().includes(q));
      if (!matchesSearch) return false;
      if (resultFilter === "quality") return firstNum(row, ["roe", "roe_pct"]) >= 18 || firstNum(row, ["roce"]) >= 18 || factorScore(row, "quality") >= 60;
      if (resultFilter === "value") return firstNum(row, ["pe"]) > 0 && firstNum(row, ["pe"]) <= 25;
      if (resultFilter === "momentum") return firstNum(row, ["returns_3m", "return_3m", "price_change_3m", "change_pct"]) > 0 || factorScore(row, "momentum") >= 60;
      if (resultFilter === "watchable") return Boolean(getTicker(row)) && (factorChips(row).length > 0 || whyRanked(row).length > 0);
      return true;
    });
  }, [resultFilter, rows, searchText]);
  const selectedIndex = selectedRow ? visibleRows.indexOf(selectedRow) : -1;

  const resultStats = useMemo(() => {
    const sectors = new Map<string, number>();
    let totalRoe = 0;
    let roeCount = 0;
    for (const row of rows) {
      const sector = String(row.sector || "Unclassified");
      sectors.set(sector, (sectors.get(sector) || 0) + 1);
      const roe = firstNum(row, ["roe", "roe_pct"]);
      if (roe) {
        totalRoe += roe;
        roeCount += 1;
      }
    }
    const topSectors = Array.from(sectors.entries()).sort((a, b) => b[1] - a[1]).slice(0, 3);
    return {
      avgRoe: roeCount ? totalRoe / roeCount : 0,
      topSectors,
    };
  }, [rows]);

  const topRows = useMemo(
    () => [...visibleRows].sort((a, b) => compositeScore(b) - compositeScore(a)).slice(0, 4),
    [visibleRows],
  );

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

  const openSaveAlert = (row: Record<string, unknown>) => {
    setSaveAlertRow(row);
    setSaveAlertName(`${getTicker(row)} Screen`);
    setSaveAlertOpen(true);
  };

  const saveAlert = async () => {
    if (!saveAlertName.trim() || !saveAlertRow) return;
    setSavingAlert(true);
    try {
      const screenerConfig = { symbols: [getTicker(saveAlertRow)] } as Record<string, unknown>;
      await createScreenerAlert(saveAlertName.trim(), screenerConfig, undefined, getTicker(saveAlertRow));
      setActionMessage(`Alert "${saveAlertName}" created`);
      setSaveAlertOpen(false);
      setSaveAlertName("");
      setSaveAlertRow(null);
    } catch (error) {
      setActionMessage(error instanceof Error ? error.message : "Failed to create alert");
    } finally {
      setSavingAlert(false);
    }
  };

  const table = (
    <>
      <div className="mb-3 space-y-3">
        <div className="grid gap-2 md:grid-cols-[1fr_auto] md:items-center">
          <div className="grid gap-2 sm:grid-cols-3">
            <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
              <div className="font-sans text-[11px] text-terminal-muted">Showing</div>
              <div className="mt-1 font-sans text-lg font-semibold text-terminal-text">{visibleRows.length.toLocaleString("en-IN")} / {rows.length.toLocaleString("en-IN")}</div>
            </div>
            <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
              <div className="font-sans text-[11px] text-terminal-muted">Avg ROE</div>
              <div className="mt-1 font-sans text-lg font-semibold text-terminal-text">{resultStats.avgRoe ? `${resultStats.avgRoe.toFixed(1)}%` : "--"}</div>
            </div>
            <div className="rounded-md border border-terminal-border bg-terminal-bg/70 p-3">
              <div className="font-sans text-[11px] text-terminal-muted">Top sectors</div>
              <div className="mt-1 truncate font-sans text-sm font-semibold text-terminal-text">
                {resultStats.topSectors.length ? resultStats.topSectors.map(([sector]) => sector).join(", ") : "--"}
              </div>
            </div>
          </div>
          <div className="relative min-w-[240px]">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
            <input
              className="h-10 w-full rounded-sm border border-terminal-border bg-terminal-bg pl-9 pr-3 font-sans text-sm text-terminal-text outline-none transition-colors placeholder:text-terminal-muted focus:border-terminal-accent focus-visible:ring-1 focus-visible:ring-terminal-accent/40"
              value={searchText}
              onChange={(event) => setSearchText(event.target.value)}
              placeholder="Search results"
              aria-label="Search results"
            />
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 font-sans text-xs text-terminal-muted">
            <Filter className="h-3.5 w-3.5" aria-hidden="true" />
            Focus
          </div>
          {resultFilters.map((item) => (
            <button
              key={item.id}
              type="button"
              className={[
                "rounded-full border px-3 py-1 font-sans text-xs transition-colors",
                resultFilter === item.id
                  ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                  : "border-terminal-border bg-terminal-bg/70 text-terminal-muted hover:border-terminal-border-hover hover:text-terminal-text",
              ].join(" ")}
              onClick={() => setResultFilter(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>

        {topRows.length ? (
          <div className="grid gap-2 lg:grid-cols-4">
            {topRows.map((row) => {
              const ticker = getTicker(row);
              const move = firstNum(row, ["returns_3m", "return_3m", "price_change_3m", "change_pct"]);
              const MoveIcon = move >= 0 ? TrendingUp : TrendingDown;
              return (
                <button
                  key={`candidate-${ticker || String(row.company)}`}
                  type="button"
                  className={[
                    "rounded-md border p-3 text-left transition-colors",
                    selectedRow === row
                      ? "border-terminal-accent bg-terminal-accent/15"
                      : "border-terminal-border bg-terminal-bg/60 hover:border-terminal-border-hover hover:bg-terminal-bg",
                  ].join(" ")}
                  onClick={() => setSelectedRow(row)}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <div className="truncate font-sans text-sm font-semibold text-terminal-text">{String(row.company || row.company_name || ticker || "-")}</div>
                      <div className="mt-1 font-sans text-[11px] text-terminal-muted">{ticker || "--"} / {String(row.sector || "Unclassified")}</div>
                    </div>
                    <ScoreBadge value={compositeScore(row)} max={100} label="C" />
                  </div>
                  <div className="mt-3 flex items-center justify-between gap-2 font-sans text-xs">
                    <span className="text-terminal-muted">P/E {formatRatio(row.pe)}</span>
                    <span className={move >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
                      <MoveIcon className="mr-1 inline h-3.5 w-3.5" aria-hidden="true" />
                      {move ? formatPct(move) : "--"}
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        ) : null}

        {actionMessage ? <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">{actionMessage}</div> : null}

        {saveAlertOpen ? (
          <div className="rounded-md border border-terminal-border bg-terminal-panel p-3">
            <div className="flex items-center justify-between">
              <div className="text-sm font-semibold text-terminal-text">Save as Screener Alert</div>
              <button
                type="button"
                className="h-6 w-6 rounded-sm border border-terminal-border text-terminal-muted transition-colors hover:border-terminal-accent hover:text-terminal-accent"
                onClick={() => {
                  setSaveAlertOpen(false);
                  setSaveAlertName("");
                }}
              >
                ✕
              </button>
            </div>
            <input
              className="mt-2 h-9 w-full rounded-sm border border-terminal-border bg-terminal-bg px-2 font-sans text-sm text-terminal-text outline-none transition-colors placeholder:text-terminal-muted focus:border-terminal-accent"
              value={saveAlertName}
              onChange={(event) => setSaveAlertName(event.target.value)}
              placeholder="Alert name (e.g. AAPL Value Screen)"
              autoFocus
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  void saveAlert();
                }
              }}
            />
            <div className="mt-2 flex items-center gap-2">
              <button
                className="rounded-sm border border-terminal-accent bg-terminal-accent/15 px-3 py-1.5 text-xs text-terminal-accent transition-colors hover:bg-terminal-accent/20"
                onClick={() => {
                  void saveAlert();
                }}
                disabled={savingAlert || !saveAlertName.trim()}
              >
                {savingAlert ? "Saving..." : "Save Alert"}
              </button>
              <button
                className="rounded-sm border border-terminal-border px-3 py-1.5 text-xs text-terminal-muted transition-colors hover:border-terminal-border-hover hover:text-terminal-text"
                onClick={() => {
                  setSaveAlertOpen(false);
                  setSaveAlertName("");
                }}
              >
                Cancel
              </button>
            </div>
          </div>
        ) : null}
      </div>

      <DataGrid
        preset="screener"
        rows={visibleRows}
        rowKey={(row, idx) => `${String(row.ticker || "row")}-${idx}`}
        selectedIndex={selectedIndex >= 0 ? selectedIndex : undefined}
        onRowSelect={(idx) => setSelectedRow(visibleRows[idx] || null)}
        onRowOpen={(idx) => setSelectedRow(visibleRows[idx] || null)}
        emptyText={rows.length ? "No results match this focus. Clear search or choose All." : "Run a screen to see ranked stocks here."}
        rowActions={(row) => (
          <div className="flex flex-nowrap gap-1">
            <ActionButton
              label="Chart"
              icon={LineChart}
              onClick={(event) => {
                event.stopPropagation();
                openChart(row);
              }}
            />
            <ActionButton
              label="Research"
              icon={Search}
              onClick={(event) => {
                event.stopPropagation();
                openSecurity(row, "overview");
              }}
            />
            <ActionButton
              label="News"
              icon={Newspaper}
              onClick={(event) => {
                event.stopPropagation();
                openSecurity(row, "news");
              }}
            />
            <ActionButton
              label="Backtest"
              icon={TestTube2}
              onClick={(event) => {
                event.stopPropagation();
                openBacktest(row);
              }}
            />
            <ActionButton
              label="Screens"
              icon={ListChecks}
              onClick={(event) => {
                event.stopPropagation();
                void useAgentStore.getState().runScreenerFor(getTicker(row));
              }}
            />
            <ActionButton
              label="Compare"
              icon={GitCompareArrows}
              onClick={(event) => {
                event.stopPropagation();
                openCompare(row);
              }}
            />
            <ActionButton
              label="Watch"
              icon={Plus}
              onClick={(event) => {
                event.stopPropagation();
                void watch(row);
              }}
            />
            <ActionButton
              label="Alert"
              icon={Bell}
              onClick={(event) => {
                event.stopPropagation();
                openAlert(row);
              }}
            />
            <ActionButton
              label="Save as Alert"
              icon={Bookmark}
              onClick={(event) => {
                event.stopPropagation();
                openSaveAlert(row);
              }}
            />
          </div>
        )}
        className="max-h-[64vh] xl:max-h-[68vh]"
        tableClassName="text-[11px]"
        columns={[
          {
            key: "company",
            header: "Company",
            sortable: true,
            widthClassName: "min-w-[260px]",
            sortValue: (row) => String(row.company || row.company_name || row.ticker || ""),
            renderCell: (row) => (
              <div className="min-w-0">
                <div className="flex min-w-0 items-center gap-2">
                  <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg font-sans text-[10px] font-semibold text-terminal-accent">
                    {(getTicker(row) || "?").slice(0, 2)}
                  </span>
                  <div className="min-w-0">
                    <div className="truncate font-sans text-sm font-semibold text-terminal-text">{String(row.company || row.company_name || row.ticker || "-")}</div>
                    <div className="mt-0.5 flex items-center gap-2 font-sans text-[11px] text-terminal-muted">
                      <span>{getTicker(row) || "--"}</span>
                      <span aria-hidden="true">/</span>
                      <span>{String(row.sector || "Unclassified")}</span>
                    </div>
                  </div>
                </div>
              </div>
            ),
          },
          {
            key: "market_metrics",
            header: "Market Metrics",
            sortable: true,
            widthClassName: "min-w-[240px]",
            sortValue: (row) => priceValue(row),
            renderCell: (row) => <MarketMetricsCell row={row} />,
          },
          {
            key: "match",
            header: "Match",
            align: "right",
            sortable: true,
            sortValue: (row) => compositeScore(row),
            renderCell: (row) => (
              <div className="flex items-center justify-end gap-2">
                <div className="h-1.5 w-16 overflow-hidden rounded-full bg-terminal-bg">
                  <div
                    className="h-full rounded-full bg-terminal-accent"
                    style={{ width: `${Math.max(4, Math.min(100, compositeScore(row)))}%` }}
                  />
                </div>
                <ScoreBadge value={compositeScore(row)} max={100} label="C" />
              </div>
            ),
          },
          {
            key: "why",
            header: "Why it matches",
            widthClassName: "min-w-[300px]",
            renderCell: (row) => (
              <div className="min-w-0">
                <span className="block max-w-[360px] truncate font-sans text-xs text-terminal-text" title={whyRanked(row)}>{whyRanked(row)}</span>
                <div className="mt-1 flex flex-wrap gap-1">
                  {factorChips(row).slice(0, 3).map((chip) => (
                    <span key={`${getTicker(row)}-${chip}`} className="rounded-full border border-terminal-border bg-terminal-bg px-2 py-0.5 font-sans text-[10px] text-terminal-muted">{chip}</span>
                  ))}
                </div>
              </div>
            ),
          },
          {
            key: "mcap",
            header: "Market Cap",
            align: "right",
            sortable: true,
            sortValue: (row) => toNum(row.market_cap),
            renderCell: (row) => formatCompact(row.market_cap),
          },
          {
            key: "valuation_quality",
            header: "Valuation / Quality",
            align: "right",
            sortable: true,
            sortValue: (row) => firstNum(row, ["roe", "roe_pct"]),
            renderCell: (row) => (
              <div className="text-right font-sans">
                <div className="text-terminal-text">P/E {formatRatio(row.pe)}</div>
                <div className="text-[11px] text-terminal-muted">ROE {formatPct(row.roe ?? row.roe_pct)}</div>
              </div>
            ),
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
                <span>{formatRatio(row.roce)}</span>
              </div>
            ),
          },
          {
            key: "spark",
            header: "Trend",
            align: "right",
            sortable: true,
            sortValue: (row) => moveValue(row),
            renderCell: (row) => {
              const move = moveValue(row);
              return (
                <div className="text-right font-sans">
                  <div className={move >= 0 ? "text-sm font-semibold text-terminal-pos" : "text-sm font-semibold text-terminal-neg"}>
                    {move ? formatPct(move) : "--"}
                  </div>
                  <div className="mt-1 text-[10px] uppercase text-terminal-muted">1Y bias</div>
                </div>
              );
            },
          },
        ]}
      />
    </>
  );

  if (!framed) return table;

  return (
    <TerminalPanel
      title="Results"
      subtitle={`Rows: ${rows.length}`}
      actions={<ExportButton source="screener_results" data={rows} />}
    >
      {table}
    </TerminalPanel>
  );
}
