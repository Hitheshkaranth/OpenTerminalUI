import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";

import { fetchQuotesBatch, getHistory } from "../api/client";
import { OverviewPanel } from "../components/analysis/OverviewPanel";
import { PeersComparison } from "../components/analysis/PeersComparison";
import { PromoterHoldingsCard } from "../components/analysis/PromoterHoldingsCard";
import { CapexTrackerCard } from "../components/analysis/CapexTrackerCard";
import { PythonLabWidget } from "../components/analysis/PythonLabWidget";
import { FinancialsTable } from "../components/analysis/FinancialsTable";
import { FinancialTrend } from "../components/analysis/FinancialTrend";
import { FundamentalMetricsPanel } from "../components/analysis/FundamentalMetricsPanel";
import { QuarterlyResults } from "../components/analysis/QuarterlyResults";
import { QuarterlyReportsSection } from "../components/analysis/QuarterlyReportsSection";
import { ScoreCard } from "../components/analysis/ScoreCard";
import { ShareholdingChart } from "../components/analysis/ShareholdingChart";
import { ShareholdingPanel } from "../components/ShareholdingPanel";
import { ValuationPanel } from "../components/analysis/ValuationPanel";
import { FuturesPanel } from "../components/market/FuturesPanel";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { CountryFlag } from "../components/common/CountryFlag";
import { InstrumentBadges } from "../components/common/InstrumentBadges";
import { EarningsDateBadge } from "../components/EarningsDateBadge";
import { EarningsTrendTable } from "../components/EarningsTrendTable";
import { EventsTimeline } from "../components/EventsTimeline";
import { QuarterlyFinancialsChart } from "../components/QuarterlyFinancialsChart";
import { useDeliverySeries, useEquityPerformance, useFinancials, useStock, useStockHistory, useStockReturns } from "../hooks/useStocks";
import { useNextEarnings } from "../hooks/useStocks";
import { useDisplayCurrency } from "../hooks/useDisplayCurrency";
import { useQuotesStore, useQuotesStream } from "../realtime/useQuotesStream";
import { ChartEngine } from "../shared/chart/ChartEngine";
import { SharedChartToolbar } from "../shared/chart/ChartToolbar";
import { IndicatorPanel } from "../shared/chart/IndicatorPanel";
import { chartPointsToBars } from "../shared/chart/chartUtils";
import type { ChartKind, ChartTimeframe, IndicatorConfig } from "../shared/chart/types";
import { useSettingsStore } from "../store/settingsStore";
import { useStockStore } from "../store/stockStore";

type TabId = "overview" | "financials" | "analysis" | "peers" | "valuation" | "shareholding" | "events" | "earnings";

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

function normalizeRealtimeMarketCode(value: string): "NSE" | "NASDAQ" {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "NSE" || raw === "BSE" || raw === "IN") return "NSE";
  return "NASDAQ";
}

export function StockDetailPage() {
  const { ticker, interval, range, setInterval, setRange } = useStockStore();
  const { formatDisplayMoney } = useDisplayCurrency();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const realtimeMarket = normalizeRealtimeMarketCode(selectedMarket);
  const { subscribe, unsubscribe, isConnected, connectionState } = useQuotesStream(realtimeMarket);
  const ticksByToken = useQuotesStore((s) => s.ticksByToken);

  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [showIndicators, setShowIndicators] = useState(true);
  const [selectedIndicators, setSelectedIndicators] = useState<IndicatorConfig[]>([]);
  const [crosshair, setCrosshair] = useState<{ open: number; high: number; low: number; close: number; time: number } | null>(null);
  const [realtimeTick, setRealtimeTick] = useState<{ ltp: number; change_pct: number } | null>(null);
  const [tab, setTab] = useState<TabId>("overview");
  const [shareholdingTabLoaded, setShareholdingTabLoaded] = useState(false);
  const [financialPeriod, setFinancialPeriod] = useState<"annual" | "quarterly">("annual");
  const [showVolume, setShowVolume] = useState(true);
  const [showDeliveryOverlay, setShowDeliveryOverlay] = useState(false);
  const [extended, setExtended] = useState(false);
  const [snapshotTick, setSnapshotTick] = useState<{ ltp: number; change: number; change_pct: number } | null>(null);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [chartPoints, setChartPoints] = useState<Array<{ t: number; o: number; h: number; l: number; c: number; v: number; s?: string; ext?: boolean }>>([]);
  const [isBackfilling, setIsBackfilling] = useState(false);
  const [hasMoreHistory, setHasMoreHistory] = useState(true);
  const chartFullscreenRef = useRef<HTMLDivElement | null>(null);

  const { data: stock } = useStock(ticker);
  const { data: returnsData } = useStockReturns(ticker);
  const { data: performanceData } = useEquityPerformance(ticker);
  const { data: chart, isLoading: isChartLoading, error: chartError } = useStockHistory(ticker, range, interval, extended);
  const { data: deliverySeriesData } = useDeliverySeries(ticker, interval, range);
  const { data: financials, isLoading: isFinancialsLoading } = useFinancials(ticker, financialPeriod);
  const { data: nextEarnings } = useNextEarnings(ticker);

  useEffect(() => {
    setSnapshotTick(null);
    if (!ticker) return;
    subscribe([ticker]);
    return () => unsubscribe([ticker]);
  }, [realtimeMarket, subscribe, ticker, unsubscribe]);

  useEffect(() => {
    let active = true;
    if (!ticker) return;
    void (async () => {
      try {
        const payload = await fetchQuotesBatch([ticker], realtimeMarket);
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
  }, [realtimeMarket, ticker]);

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

  useEffect(() => {
    setChartPoints(chart?.data ?? []);
    setHasMoreHistory(true);
  }, [chart?.data, ticker, interval, range]);

  useEffect(() => {
    const onFullscreenChange = () => {
      const node = chartFullscreenRef.current;
      setIsFullscreen(Boolean(node && document.fullscreenElement === node));
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);
    return () => document.removeEventListener("fullscreenchange", onFullscreenChange);
  }, []);

  useEffect(() => {
    if (tab === "shareholding") {
      setShareholdingTabLoaded(true);
    }
  }, [tab]);

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
  const liveTick = ticker ? ticksByToken[`${realtimeMarket}:${ticker.toUpperCase()}`] : undefined;
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
  const stockClassification = stockForOverview?.classification;
  const ohlcForToolbar =
    crosshair ??
    (chartPoints.length
      ? (() => {
          const last = chartPoints[chartPoints.length - 1];
          return { open: last.o, high: last.h, low: last.l, close: last.c, time: last.t };
        })()
      : null);
  const deliveryOverlaySeries = useMemo(
    () =>
      (deliverySeriesData?.points ?? [])
        .map((row) => ({
          time: Math.floor(new Date(`${row.date}T00:00:00Z`).getTime() / 1000),
          value: Number(row.delivery_pct),
        }))
        .filter((row) => Number.isFinite(row.time) && Number.isFinite(row.value)),
    [deliverySeriesData?.points],
  );

  if (!ticker) return <div className="p-8 text-center text-terminal-muted">Select a stock to view details.</div>;

  const formatPct = (value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return "-";
    const sign = value > 0 ? "+" : "";
    return `${sign}${value.toFixed(2)}%`;
  };
  const pctColor = (value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return "text-terminal-muted";
    return value >= 0 ? "text-terminal-pos" : "text-terminal-neg";
  };
  const formatPrice = (value: number | null | undefined) => {
    if (value == null || Number.isNaN(value)) return "-";
    return formatDisplayMoney(value);
  };
  const mergePrependDedupe = (
    existing: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
    older: Array<{ t: number; o: number; h: number; l: number; c: number; v: number }>,
  ) => {
    const byTime = new Map<number, { t: number; o: number; h: number; l: number; c: number; v: number }>();
    for (const row of existing) byTime.set(Number(row.t), row);
    for (const row of older) {
      const ts = Number(row.t);
      if (!byTime.has(ts)) byTime.set(ts, row);
    }
    return Array.from(byTime.values()).sort((a, b) => a.t - b.t);
  };
  const backfillHistory = async (oldestTime: number) => {
    if (!ticker || isBackfilling || !hasMoreHistory) return;
    setIsBackfilling(true);
    try {
      const response = await getHistory(ticker, realtimeMarket, interval, range, 300, oldestTime);
      const older = response.data ?? [];
      setChartPoints((prev) => mergePrependDedupe(prev, older));
      if (!older.length || response.meta?.pagination?.has_more === false) {
        setHasMoreHistory(false);
      }
    } catch {
      setHasMoreHistory(false);
    } finally {
      setIsBackfilling(false);
    }
  };
  const fullscreenSupported = typeof document !== "undefined" && Boolean(document.fullscreenEnabled);
  const toggleFullscreen = async () => {
    const node = chartFullscreenRef.current;
    if (!node || !fullscreenSupported) return;
    if (document.fullscreenElement === node) {
      await document.exitFullscreen();
      return;
    }
    await node.requestFullscreen();
  };

  return (
    <div className="relative h-full space-y-3 overflow-y-auto px-3 py-2">
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_220px]">
        <div className="space-y-3">
          <div className="inline-flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-xs">
            <CountryFlag
              countryCode={stockClassification?.country_code || stockForOverview?.country_code}
              flagEmoji={stockClassification?.flag_emoji}
            />
            <span className="font-semibold">{ticker.toUpperCase()}</span>
            <InstrumentBadges
              exchange={stockClassification?.exchange || stockForOverview?.exchange}
              hasFutures={stockClassification?.has_futures}
              hasOptions={stockClassification?.has_options}
            />
            <EarningsDateBadge event={nextEarnings} />
          </div>
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
            extended={extended}
            onExtendedChange={setExtended}
          />
          <div
            ref={chartFullscreenRef}
            className={`${isFullscreen ? "h-screen w-screen bg-terminal-bg p-2" : "h-[calc(100vh-280px)] min-h-[350px] rounded border border-terminal-border bg-terminal-panel p-1"}`}
          >
            {isChartLoading ? (
              <div className="flex h-full items-center justify-center text-terminal-muted">Loading chart...</div>
            ) : chartPoints.length ? (
              <ChartEngine
                symbol={ticker}
                timeframe={timeframe}
                historicalData={chartPointsToBars(chartPoints)}
                market={realtimeMarket}
                activeIndicators={selectedIndicators}
                chartType={chartType}
                showVolume={showVolume}
                enableRealtime={true}
                onCrosshairOHLC={setCrosshair}
                onTick={setRealtimeTick}
                canRequestBackfill={hasMoreHistory && !isBackfilling}
                onRequestBackfill={(oldest) => backfillHistory(oldest)}
                showDeliveryOverlay={showDeliveryOverlay}
                deliverySeries={deliveryOverlaySeries}
                extendedHours={{
                  enabled: extended,
                  showPreMarket: true,
                  showAfterHours: true,
                  visualMode: "merged",
                  colorScheme: "dimmed"
                }}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-terminal-muted">
                {chartError ? "Failed to load chart" : "No chart data"}
              </div>
            )}
          </div>
          <TerminalPanel title="Performance Strip" className="rounded-sm">
            <div className="grid grid-cols-3 gap-2 text-xs md:grid-cols-6">
              {(["1D", "1W", "1M", "3M", "6M", "1Y"] as const).map((key) => {
                const value = performanceData?.period_changes_pct?.[key];
                return (
                  <div key={key} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
                    <div className="text-[10px] uppercase tracking-wide text-terminal-muted">{key}</div>
                    <div className={`mt-1 font-semibold tabular-nums ${pctColor(value)}`}>{formatPct(value)}</div>
                  </div>
                );
              })}
            </div>
            <div className="mt-3 grid grid-cols-1 gap-2 text-xs md:grid-cols-2">
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Day Range</div>
                <div className="mt-1 flex items-center justify-between tabular-nums">
                  <span>{formatPrice(performanceData?.day_range?.low)}</span>
                  <span className="text-terminal-muted">to</span>
                  <span>{formatPrice(performanceData?.day_range?.high)}</span>
                </div>
              </div>
              <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-2">
                <div className="text-[10px] uppercase tracking-wide text-terminal-muted">52W Range</div>
                <div className="mt-1 flex items-center justify-between tabular-nums">
                  <span>{formatPrice(performanceData?.range_52w?.low)}</span>
                  <span className="text-terminal-muted">to</span>
                  <span>{formatPrice(performanceData?.range_52w?.high)}</span>
                </div>
              </div>
            </div>
          </TerminalPanel>
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
              <button
                className={`rounded border px-2 py-0.5 text-[11px] ${showDeliveryOverlay ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
                onClick={() => setShowDeliveryOverlay((v) => !v)}
              >
                DELIVERY %
              </button>
              <button
                className={`rounded border px-2 py-0.5 text-[11px] ${isFullscreen ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"} ${fullscreenSupported ? "" : "cursor-not-allowed opacity-60"}`}
                onClick={() => {
                  void toggleFullscreen();
                }}
                disabled={!fullscreenSupported}
              >
                {isFullscreen ? "EXIT FS" : "FULLSCREEN"}
              </button>
            </div>
          </TerminalPanel>
          {showIndicators && <IndicatorPanel symbol={ticker} activeIndicators={selectedIndicators} onChange={setSelectedIndicators} templateScope="equity" />}
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
          {(["overview", "financials", "analysis", "peers", "valuation", "shareholding", "events", "earnings"] as TabId[]).map((t) => (
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
            <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
              <PromoterHoldingsCard ticker={ticker} />
              <CapexTrackerCard ticker={ticker} />
            </div>
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
            <PythonLabWidget />
          </div>
        )}

        {tab === "peers" && <PeersComparison ticker={ticker} />}
        {tab === "valuation" && <ValuationPanel ticker={ticker} />}
        {tab === "shareholding" && <ShareholdingPanel ticker={ticker} enabled={shareholdingTabLoaded} />}
        {tab === "events" && <EventsTimeline symbol={ticker} />}
        {tab === "earnings" && (
          <div className="space-y-4">
            <QuarterlyFinancialsChart symbol={ticker} />
            <EarningsTrendTable symbol={ticker} />
          </div>
        )}
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
