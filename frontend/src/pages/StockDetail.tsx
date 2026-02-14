import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";

import { fetchQuotesBatch } from "../api/client";
import { OverviewPanel } from "../components/analysis/OverviewPanel";
import { PeersComparison } from "../components/analysis/PeersComparison";
import { FinancialsTable } from "../components/analysis/FinancialsTable";
import { FinancialTrend } from "../components/analysis/FinancialTrend";
import { FundamentalMetricsPanel } from "../components/analysis/FundamentalMetricsPanel";
import { QuarterlyResults } from "../components/analysis/QuarterlyResults";
import { QuarterlyReportsSection } from "../components/analysis/QuarterlyReportsSection";
import { ScoreCard } from "../components/analysis/ScoreCard";
import { ShareholdingChart } from "../components/analysis/ShareholdingChart";
import { ValuationPanel } from "../components/analysis/ValuationPanel";
import { FuturesPanel } from "../components/market/FuturesPanel";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useFinancials, useStock, useStockHistory, useStockReturns } from "../hooks/useStocks";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { useQuotesStore, useQuotesStream } from "../realtime/useQuotesStream";
import { ChartEngine } from "../shared/chart/ChartEngine";
import { SharedChartToolbar } from "../shared/chart/ChartToolbar";
import { IndicatorPanel } from "../shared/chart/IndicatorPanel";
import { chartPointsToBars } from "../shared/chart/chartUtils";
import type { ChartKind, ChartTimeframe, IndicatorConfig } from "../shared/chart/types";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";

type TabId = "overview" | "financials" | "analysis" | "peers" | "valuation";

const TIMEFRAME_TO_INTERVAL: Record<ChartTimeframe, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "5d" },
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "1h", range: "3mo" },
  "4h": { interval: "1h", range: "6mo" },
  "1D": { interval: "1d", range: "1y" },
  "1W": { interval: "1wk", range: "5y" },
  "1M": { interval: "1mo", range: "max" },
};

function intervalToTimeframe(interval: string): ChartTimeframe {
  const value = interval.toLowerCase();
  if (value === "1m") return "1m";
  if (value === "5m") return "5m";
  if (value === "15m") return "15m";
  if (value === "1h") return "1h";
  if (value === "1wk") return "1W";
  if (value === "1mo") return "1M";
  return "1D";
}

export function StockDetailPage() {
  const { ticker, interval, range, setInterval, setRange } = useStockStore();
  const { formatDisplayMoney } = useDisplayCurrency();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const { subscribe, unsubscribe, isConnected, connectionState } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);

  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [showIndicators, setShowIndicators] = useState(true);
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorConfig[]>([]);
  const [crosshair, setCrosshair] = useState<{ open: number; high: number; low: number; close: number; time: number } | null>(null);
  const [realtimeTick, setRealtimeTick] = useState<{ ltp: number; change_pct: number } | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [financialPeriod, setFinancialPeriod] = useState<"annual" | "quarterly">("annual");
  const [showVolume, setShowVolume] = useState(true);
  const [snapshotTick, setSnapshotTick] = useState<{ ltp: number; change: number; change_pct: number } | null>(null);

  const { data: stock } = useStock(ticker);
  const { data: returnsData } = useStockReturns(ticker);
  const { data: chart, isLoading: isChartLoading, error: chartError } = useStockHistory(ticker, range, interval);
  const { data: financials, isLoading: isFinancialsLoading } = useFinancials(ticker, financialPeriod);

  useEffect(() => {
    setSnapshotTick(null);
    if (!ticker) return;
    subscribe([ticker]);
    return () => unsubscribe([ticker]);
  }, [selectedMarket, subscribe, ticker, unsubscribe]);

  useEffect(() => {
    let active = true;
    if (!ticker) return;
    void (async () => {
      try {
        const payload = await fetchQuotesBatch([ticker], selectedMarket);
        if (!active) return;
        const row = payload.quotes?.[0];
        if (!row) return;
        const ltp = Number(row.last);
        if (!Number.isFinite(ltp)) return;
        setSnapshotTick({
          ltp,
          change: Number.isFinite(Number(row.change)) ? Number(row.change) : 0,
          change_pct: Number.isFinite(Number(row.changePct)) ? Number(row.changePct) : 0,
        });
      } catch {
        // Snapshot fallback can fail; UI still has /stocks snapshot and live ticks.
      }
    })();
    return () => {
      active = false;
    };
  }, [selectedMarket, ticker]);

  useEffect(() => {
    const storageKey = `chart:indicators:${ticker.toUpperCase()}`;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return;
      const parsed = JSON.parse(raw) as IndicatorConfig[];
      if (Array.isArray(parsed)) setSelectedIndicators(parsed);
    } catch {
      // ignore bad local storage payloads
    }
  }, [ticker]);

  useEffect(() => {
    const storageKey = `chart:indicators:${ticker.toUpperCase()}`;
    try {
      localStorage.setItem(storageKey, JSON.stringify(selectedIndicators));
    } catch {
      // ignore storage write failure
    }
  }, [selectedIndicators, ticker]);

  const stockForOverview = useMemo(
    () => ({
      ticker: ticker.toUpperCase(),
      ...(stock ?? {}),
    }),
    [stock, ticker],
  );
  const latestPrice =
    typeof stockForOverview?.current_price === "number"
      ? stockForOverview.current_price
      : Number.isFinite(Number(stockForOverview?.current_price))
      ? Number(stockForOverview?.current_price)
      : null;
  const changePct =
    typeof stockForOverview?.change_pct === "number"
      ? stockForOverview.change_pct
      : Number.isFinite(Number(stockForOverview?.change_pct))
      ? Number(stockForOverview?.change_pct)
      : null;
  const derivedChangeFromSnapshot =
    latestPrice !== null && changePct !== null && changePct > -100 ? latestPrice - latestPrice / (1 + changePct / 100) : null;
  const liveTick = ticker ? ticksByToken[`${selectedMarket}:${ticker.toUpperCase()}`] : undefined;
  const displayedLatestPrice = realtimeTick?.ltp ?? liveTick?.ltp ?? snapshotTick?.ltp ?? latestPrice;
  const displayedChange = liveTick?.change ?? snapshotTick?.change ?? derivedChangeFromSnapshot;
  const displayedChangePct = realtimeTick?.change_pct ?? liveTick?.change_pct ?? snapshotTick?.change_pct ?? changePct;
  const moveClass =
    displayedChangePct === null
      ? "text-terminal-muted"
      : displayedChangePct >= 0
      ? "text-terminal-pos"
      : "text-terminal-neg";
  const changeText =
    displayedChange === null
      ? "-"
      : `${displayedChange >= 0 ? "+" : ""}${displayedChange.toFixed(2)}`;
  const changePctText =
    displayedChangePct === null ? "-" : `${displayedChangePct >= 0 ? "+" : ""}${displayedChangePct.toFixed(2)}%`;
  const timeframe = intervalToTimeframe(interval);
  const ohlcForToolbar =
    crosshair ??
    (chart?.data?.length
      ? (() => {
          const last = chart.data[chart.data.length - 1];
          return { open: last.o, high: last.h, low: last.l, close: last.c, time: last.t };
        })()
      : null);

  if (!ticker) return <div className="p-8 text-center text-terminal-muted">Select a stock to view details.</div>;

  return (
    <div className="relative h-full space-y-3 overflow-y-auto px-3 py-2">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          <SharedChartToolbar
            symbol={ticker}
            ltp={displayedLatestPrice}
            changePct={displayedChangePct}
            ohlc={ohlcForToolbar}
            timeframe={timeframe}
            onTimeframeChange={(tf) => {
              const next = TIMEFRAME_TO_INTERVAL[tf];
              setInterval(next.interval);
              setRange(next.range);
            }}
            chartType={chartType}
            onChartTypeChange={setChartType}
            showIndicators={showIndicators}
            onToggleIndicators={() => setShowIndicators((v) => !v)}
          />
          <div className="h-[calc(100vh-280px)] min-h-[350px] rounded border border-terminal-border bg-terminal-panel p-1">
            {isChartLoading ? (
              <div className="flex h-full items-center justify-center text-terminal-muted">Loading chart...</div>
            ) : chart?.data?.length ? (
              <ChartEngine
                symbol={ticker}
                timeframe={timeframe}
                historicalData={chartPointsToBars(chart.data)}
                market={selectedMarket}
                activeIndicators={selectedIndicators}
                chartType={chartType}
                showVolume={showVolume}
                enableRealtime={true}
                onCrosshairOHLC={setCrosshair}
                onTick={setRealtimeTick}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-terminal-muted">
                {chartError ? "Failed to load chart" : "No chart data"}
              </div>
            )}
          </div>
        </div>

        <div className="space-y-4">
          <TerminalPanel title="Latest Price" className="rounded-sm">
            <div className="mt-1 text-xl font-bold text-terminal-accent tabular-nums">
              {displayedLatestPrice !== null ? formatDisplayMoney(displayedLatestPrice) : "-"}
            </div>
            <div className={`mt-1 text-sm font-semibold tabular-nums ${moveClass}`}>{changeText}</div>
            <div className={`mt-1 text-sm font-semibold tabular-nums ${moveClass}`}>{changePctText}</div>
            <div className="mt-2 flex items-center gap-2">
              <span className={`rounded border px-2 py-0.5 text-[11px] ${isConnected ? "border-terminal-pos text-terminal-pos" : "border-terminal-border text-terminal-muted"}`}>
                LIVE
              </span>
              <TerminalBadge variant={isConnected ? "live" : "mock"}>{connectionState.toUpperCase()}</TerminalBadge>
              <button
                className={`rounded border px-2 py-0.5 text-[11px] ${showVolume ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
                onClick={() => setShowVolume((v) => !v)}
              >
                VOLUME
              </button>
            </div>
          </TerminalPanel>
          {showIndicators && <IndicatorPanel symbol={ticker} activeIndicators={selectedIndicators} onChange={setSelectedIndicators} />}
          <FuturesPanel />
        </div>
      </div>

      {chart?.meta?.warnings?.map((w, i) => (
        <div key={i} className="rounded border border-terminal-warn bg-terminal-warn/10 p-3 text-sm text-terminal-warn">
          {w.message}
        </div>
      ))}

      <div className="border-b border-terminal-border">
        <nav className="-mb-px flex space-x-6" aria-label="Tabs">
          {(["overview", "financials", "analysis", "peers", "valuation"] as TabId[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`whitespace-nowrap border-b-2 px-1 py-3 text-sm font-medium transition-colors ${tab === t ? "border-terminal-accent text-terminal-accent" : "border-transparent text-terminal-muted hover:text-terminal-text"}`}
            >
              {t.charAt(0).toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </div>

      <div className="min-h-[300px] pb-4">
        {tab === "overview" && (
          <div className="space-y-6">
            <OverviewPanel
              stock={stockForOverview}
              momPct={returnsData?.["1m"] ?? null}
              qoqPct={returnsData?.["3m"] ?? null}
              yoyPct={returnsData?.["1y"] ?? null}
            />
            <ScoreCard ticker={ticker} />
            <div className="grid grid-cols-1 gap-6 md:grid-cols-2">
              <ShareholdingChart ticker={ticker} market={selectedMarket} />
              <FinancialTrend ticker={ticker} />
            </div>
          </div>
        )}

        {tab === "financials" && (
          <div className="space-y-6">
            <div className="mb-4 flex space-x-2">
              <button onClick={() => setFinancialPeriod("annual")} className={`rounded border px-3 py-1 text-sm ${financialPeriod === "annual" ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}>Annual</button>
              <button onClick={() => setFinancialPeriod("quarterly")} className={`rounded border px-3 py-1 text-sm ${financialPeriod === "quarterly" ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}>Quarterly</button>
            </div>
            <QuarterlyReportsSection symbol={ticker} market={selectedMarket} limit={8} />
            {isFinancialsLoading ? (
              <div className="py-10 text-center text-terminal-muted">Loading financials...</div>
            ) : financials ? (
              <>
                <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
                  <FinancialTrend ticker={ticker} />
                  {financialPeriod === "quarterly" && <QuarterlyResults ticker={ticker} />}
                </div>
                <div className="mt-6 space-y-6">
                  <FinancialsTable title="Income Statement" rows={financials.income_statement} period={financialPeriod} />
                  <FinancialsTable title="Balance Sheet" rows={financials.balance_sheet} period={financialPeriod} />
                  <FinancialsTable title="Cash Flow" rows={financials.cashflow} period={financialPeriod} />
                </div>
              </>
            ) : (
              <div className="py-10 text-center text-terminal-muted">No financial data found</div>
            )}
          </div>
        )}

        {tab === "analysis" && (
          <div className="space-y-6">
            <ScoreCard ticker={ticker} />
            <div className="grid grid-cols-1 gap-6">
              <QuarterlyResults ticker={ticker} />
              <ShareholdingChart ticker={ticker} market={selectedMarket} />
            </div>
            <FundamentalMetricsPanel ticker={ticker} />
          </div>
        )}

        {tab === "peers" && <PeersComparison ticker={ticker} />}
        {tab === "valuation" && <ValuationPanel ticker={ticker} />}
      </div>
      <Link
        to="/equity/stocks/about"
        className="fixed bottom-12 left-2 z-20 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1 text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-accent md:left-52"
      >
        About
      </Link>
    </div>
  );
}
