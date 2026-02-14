import { useEffect, useMemo, useState } from "react";
import { useQueries } from "@tanstack/react-query";
import { Link } from "react-router-dom";

import { fetchIndicator, fetchQuotesBatch } from "../api/client";
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
import { ChartToolbar } from "../components/chart/ChartToolbar";
import { DrawingTools, type DrawMode } from "../components/chart/DrawingTools";
import { IndicatorPanel, type IndicatorId } from "../components/chart/IndicatorPanel";
import { TimeframeSelector } from "../components/chart/TimeframeSelector";
import { TradingChart } from "../components/chart/TradingChart";
import { FuturesPanel } from "../components/market/FuturesPanel";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useFinancials, useStock, useStockHistory, useStockReturns } from "../hooks/useStocks";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { useQuotesStore, useQuotesStream } from "../realtime/useQuotesStream";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";
import type { IndicatorResponse } from "../types";

type ChartMode = "candles" | "line" | "area";
type TabId = "overview" | "financials" | "analysis" | "peers" | "valuation";

const INDICATOR_CONFIG: Record<IndicatorId, { apiType: string; params: Record<string, number> }> = {
  sma20: { apiType: "sma", params: { period: 20 } },
  sma50: { apiType: "sma", params: { period: 50 } },
  sma200: { apiType: "sma", params: { period: 200 } },
  ema20: { apiType: "ema", params: { period: 20 } },
  ema50: { apiType: "ema", params: { period: 50 } },
  bollinger_bands: { apiType: "bollinger_bands", params: { period: 20, std_dev: 2 } },
  rsi: { apiType: "rsi", params: { period: 14 } },
  macd: { apiType: "macd", params: { fast: 12, slow: 26, signal: 9 } },
  volume: { apiType: "volume", params: {} },
  atr: { apiType: "atr", params: { period: 14 } },
};

export function StockDetailPage() {
  const { ticker, interval, range, setInterval, setRange } = useStockStore();
  const { formatDisplayMoney } = useDisplayCurrency();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const { subscribe, unsubscribe, isConnected, connectionState } = useQuotesStream(selectedMarket);
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);

  const [mode, setMode] = useState<ChartMode>("candles");
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorId[]>([]);
  const [tab, setTab] = useState<TabId>("overview");
  const [financialPeriod, setFinancialPeriod] = useState<"annual" | "quarterly">("annual");
  const [showVolume, setShowVolume] = useState(true);
  const [showHighLow, setShowHighLow] = useState(true);
  const [logarithmic, setLogarithmic] = useState(false);
  const [drawMode, setDrawMode] = useState<DrawMode>("none");
  const [clearDrawingsSignal, setClearDrawingsSignal] = useState(0);
  const [pendingTrendPoint, setPendingTrendPoint] = useState(false);
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

  const indicatorQueries = useQueries({
    queries: selectedIndicators.map((id) => ({
      queryKey: ["indicator", ticker, id, interval, range, INDICATOR_CONFIG[id]],
      queryFn: () => fetchIndicator(ticker, INDICATOR_CONFIG[id].apiType, interval, range, INDICATOR_CONFIG[id].params),
      enabled: Boolean(ticker),
      staleTime: 60 * 1000,
    })),
  });

  const overlays = useMemo(() => {
    const map: Record<string, IndicatorResponse | undefined> = {};
    selectedIndicators.forEach((id, index) => {
      const payload = indicatorQueries[index]?.data;
      if (payload?.data?.length) {
        map[id] = payload;
      }
    });
    return map;
  }, [indicatorQueries, selectedIndicators]);

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
  const displayedLatestPrice = liveTick?.ltp ?? snapshotTick?.ltp ?? latestPrice;
  const displayedChange = liveTick?.change ?? snapshotTick?.change ?? derivedChangeFromSnapshot;
  const displayedChangePct = liveTick?.change_pct ?? snapshotTick?.change_pct ?? changePct;
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

  if (!ticker) return <div className="p-8 text-center text-terminal-muted">Select a stock to view details.</div>;

  return (
    <div className="relative h-full space-y-3 overflow-y-auto px-3 py-2">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          <TerminalPanel className="rounded-sm" bodyClassName="px-2 py-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2">
            <TimeframeSelector interval={interval} onChange={(i, r) => { setInterval(i); setRange(r); }} />
            <ChartToolbar
              mode={mode}
              onModeChange={setMode}
              showVolume={showVolume}
              onToggleVolume={() => setShowVolume((v) => !v)}
              showHighLow={showHighLow}
              onToggleHighLow={() => setShowHighLow((v) => !v)}
              logarithmic={logarithmic}
              onToggleLogarithmic={() => setLogarithmic((v) => !v)}
            />
            </div>
          </TerminalPanel>
          <div className="h-[calc(100vh-280px)] min-h-[350px] rounded border border-terminal-border bg-terminal-panel p-1">
            {isChartLoading ? (
              <div className="flex h-full items-center justify-center text-terminal-muted">Loading chart...</div>
            ) : chart?.data?.length ? (
              <TradingChart
                ticker={ticker}
                data={chart.data}
                mode={mode}
                overlays={overlays}
                showVolume={showVolume}
                showHighLow={showHighLow}
                logarithmic={logarithmic}
                drawMode={drawMode}
                clearDrawingsSignal={clearDrawingsSignal}
                onPendingTrendPointChange={setPendingTrendPoint}
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
            </div>
          </TerminalPanel>
          <IndicatorPanel
            selected={selectedIndicators}
            onToggle={(id) => setSelectedIndicators((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]))}
          />
          <DrawingTools
            mode={drawMode}
            onModeChange={setDrawMode}
            pendingTrendPoint={pendingTrendPoint}
            onClear={() => {
              setPendingTrendPoint(false);
              setClearDrawingsSignal((v) => v + 1);
            }}
          />
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
        to="/stocks/about"
        className="fixed bottom-12 left-2 z-20 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1 text-[11px] uppercase tracking-wide text-terminal-muted hover:text-terminal-accent md:left-52"
      >
        About
      </Link>
    </div>
  );
}
