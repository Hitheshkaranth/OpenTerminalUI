import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FuturesPanel } from "../../components/market/FuturesPanel";
import { useStockHistory } from "../../hooks/useStocks";
import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { ChartEngine } from "../../shared/chart/ChartEngine";
import { SharedChartToolbar } from "../../shared/chart/ChartToolbar";
import { IndicatorPanel } from "../../shared/chart/IndicatorPanel";
import { chartPointsToBars } from "../../shared/chart/chartUtils";
import type { ChartKind, ChartTimeframe, IndicatorConfig } from "../../shared/chart/types";
import { useSettingsStore } from "../../store/settingsStore";
import { TerminalBadge } from "../../components/terminal/TerminalBadge";
import { useFnoContext } from "../FnoLayout";
import { fetchChainSummary } from "../api/fnoApi";

const TF_TO_INTERVAL_RANGE: Record<ChartTimeframe, { interval: string; range: string }> = {
  "1m": { interval: "1m", range: "5d" },
  "2m": { interval: "1m", range: "5d" },
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "30m": { interval: "30m", range: "1mo" },
  "1h": { interval: "1h", range: "3mo" },
  "4h": { interval: "1h", range: "6mo" },
  "1D": { interval: "1d", range: "1y" },
  "1W": { interval: "1wk", range: "5y" },
  "1M": { interval: "1mo", range: "max" },
};

export function FuturesPage() {
  const { symbol, expiry, market, setSymbol } = useFnoContext();
  const { formatDisplayMoney } = useDisplayCurrency();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [showIndicators, setShowIndicators] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([]);
  const [ohlc, setOhlc] = useState<{ open: number; high: number; low: number; close: number; time: number } | null>(null);
  const [tick, setTick] = useState<{ ltp: number; change_pct: number } | null>(null);
  const tfConfig = TF_TO_INTERVAL_RANGE[timeframe];
  // These are exchange index underlyings, not NSE-listed equity tickers.
  const historySymbol = ({ NIFTY: "^NSEI", BANKNIFTY: "^NSEBANK" } as Record<string, string>)[symbol] || symbol;
  const { data: chart, isLoading, isError, refetch } = useStockHistory(historySymbol, tfConfig.range, tfConfig.interval);
  useEffect(() => { setTick(null); setOhlc(null); }, [symbol, expiry]);
  // Must be memoized: inline chartPointsToBars() creates a new array reference every render,
  // which feeds an unstable seedBars into useRealtimeChart → infinite setBars loop.
  const chartBars = useMemo(() => (chart?.data?.length ? chartPointsToBars(chart.data) : []), [chart?.data]);
  // Realtime ticks only arrive while a feed is live; otherwise fall back to the last
  // bar the chart is drawing so the LATEST card agrees with the chart.
  const latest = useMemo(() => {
    if (tick && Number.isFinite(tick.ltp)) return tick;
    const last = chartBars[chartBars.length - 1];
    const prev = chartBars[chartBars.length - 2];
    if (!last || !Number.isFinite(last.close)) return null;
    const change_pct = prev && prev.close ? ((last.close - prev.close) / prev.close) * 100 : 0;
    return { ltp: last.close, change_pct };
  }, [tick, chartBars]);
  const summaryQuery = useQuery({
    queryKey: ["fno-summary-futures", symbol, expiry],
    queryFn: () => fetchChainSummary(symbol, expiry || undefined),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-3">
      <div className="px-1"><h1 className="text-lg font-semibold text-terminal-text">Futures desk · {symbol}</h1><p className="mt-1 text-xs text-terminal-muted">The chart shows underlying price history, not a selected futures contract. Contract quotes are listed separately.</p></div>
      <SharedChartToolbar
        symbol={symbol}
        ltp={latest?.ltp ?? null}
        changePct={latest?.change_pct ?? null}
        ohlc={ohlc}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        supportedTimeframes={["1m", "2m", "5m", "15m", "30m", "1h", "1D", "1W", "1M"]}
        chartType={chartType}
        onChartTypeChange={setChartType}
        showIndicators={showIndicators}
        onToggleIndicators={() => setShowIndicators((v) => !v)}
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_240px]">
        <div className="h-[460px] rounded border border-terminal-border bg-terminal-panel p-1">
          {isLoading ? (
            <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Loading underlying chart...</div>
          ) : isError ? (
            <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 text-xs text-terminal-muted"><p>Underlying history is unavailable for {symbol}.</p><button type="button" onClick={() => void refetch()} className="rounded border border-terminal-border px-3 py-2">Retry underlying history</button></div>
          ) : chartBars.length === 0 ? (
            <div className="flex h-full items-center justify-center text-xs text-terminal-neg">No valid chart bars for {symbol}</div>
          ) : (
            <ChartEngine
              symbol={historySymbol}
              timeframe={timeframe}
              historicalData={chartBars}
              chartType={chartType}
              showVolume={showVolume}
              enableRealtime={true}
              market={selectedMarket}
              activeIndicators={activeIndicators}
              onCrosshairOHLC={setOhlc}
              onTick={setTick}
              height={450}
            />
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Underlying price</div>
            <div className="mt-1 text-lg font-semibold text-terminal-accent">
              {latest ? formatDisplayMoney(latest.ltp) : "-"}
            </div>
            <div className={latest && latest.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
              {latest ? `${latest.change_pct >= 0 ? "+" : ""}${latest.change_pct.toFixed(2)}%` : "-"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <TerminalBadge variant="neutral">{tick ? "Tick received" : "Historical close"}</TerminalBadge>
              <button
                className={`rounded border px-2 py-0.5 text-[11px] ${showVolume ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
                onClick={() => setShowVolume((v) => !v)}
              >
                VOLUME
              </button>
            </div>
          </div>

        </div>
      </div>

      {market === "US" ? <p className="p-3 text-xs text-terminal-muted">The NFO futures chain supports Indian underlyings. US equity price history above is not a US futures contract.</p> : <FuturesPanel underlying={symbol} onUnderlyingChange={setSymbol} showUnderlyingChart={false} />}
      {showIndicators && <IndicatorPanel symbol={symbol} activeIndicators={activeIndicators} onChange={setActiveIndicators} templateScope="fno" />}
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">F&O Markers</div>
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-5">
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">ATM</div>
            <div>{typeof summaryQuery.data?.atm_strike === "number" ? formatDisplayMoney(summaryQuery.data.atm_strike) : "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">PCR</div>
            <div>{typeof summaryQuery.data?.pcr?.pcr_oi === "number" ? summaryQuery.data.pcr.pcr_oi.toFixed(2) : "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">Max Pain</div>
            <div>{typeof summaryQuery.data?.max_pain === "number" ? formatDisplayMoney(summaryQuery.data.max_pain) : "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">Support</div>
            <div>
              {summaryQuery.data?.support_resistance?.support?.slice(0, 2).map((v) => formatDisplayMoney(v)).join(", ") || "-"}
            </div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">Resistance</div>
            <div>
              {summaryQuery.data?.support_resistance?.resistance?.slice(0, 2).map((v) => formatDisplayMoney(v)).join(", ") || "-"}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
