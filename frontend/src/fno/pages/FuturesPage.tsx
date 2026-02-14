import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { FuturesPanel } from "../../components/market/FuturesPanel";
import { useStockHistory } from "../../hooks/useStocks";
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
  "5m": { interval: "5m", range: "1mo" },
  "15m": { interval: "15m", range: "1mo" },
  "1h": { interval: "1h", range: "3mo" },
  "4h": { interval: "1h", range: "6mo" },
  "1D": { interval: "1d", range: "1y" },
  "1W": { interval: "1wk", range: "5y" },
  "1M": { interval: "1mo", range: "max" },
};

export function FuturesPage() {
  const { symbol, expiry } = useFnoContext();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [showIndicators, setShowIndicators] = useState(true);
  const [showVolume, setShowVolume] = useState(true);
  const [activeIndicators, setActiveIndicators] = useState<IndicatorConfig[]>([]);
  const [ohlc, setOhlc] = useState<{ open: number; high: number; low: number; close: number; time: number } | null>(null);
  const [tick, setTick] = useState<{ ltp: number; change_pct: number } | null>(null);
  const tfConfig = TF_TO_INTERVAL_RANGE[timeframe];
  const { data: chart, isLoading } = useStockHistory(symbol, tfConfig.range, tfConfig.interval);
  const summaryQuery = useQuery({
    queryKey: ["fno-summary-futures", symbol, expiry],
    queryFn: () => fetchChainSummary(symbol, expiry || undefined),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  return (
    <div className="space-y-3">
      <SharedChartToolbar
        symbol={symbol}
        ltp={tick?.ltp ?? null}
        changePct={tick?.change_pct ?? null}
        ohlc={ohlc}
        timeframe={timeframe}
        onTimeframeChange={setTimeframe}
        chartType={chartType}
        onChartTypeChange={setChartType}
        showIndicators={showIndicators}
        onToggleIndicators={() => setShowIndicators((v) => !v)}
      />
      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_240px]">
        <div className="h-[460px] rounded border border-terminal-border bg-terminal-panel p-1">
          {isLoading || !chart?.data?.length ? (
            <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Loading futures chart...</div>
          ) : (
            <ChartEngine
              symbol={symbol}
              timeframe={timeframe}
              historicalData={chartPointsToBars(chart.data)}
              chartType={chartType}
              showVolume={showVolume}
              enableRealtime={true}
              market={selectedMarket}
              symbolIsFnO={true}
              activeIndicators={activeIndicators}
              onCrosshairOHLC={setOhlc}
              onTick={setTick}
              height={450}
            />
          )}
        </div>
        <div className="space-y-3">
          <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Latest</div>
            <div className="mt-1 text-lg font-semibold text-terminal-accent">
              {tick?.ltp?.toLocaleString("en-IN", { maximumFractionDigits: 2 }) ?? "-"}
            </div>
            <div className={tick && tick.change_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>
              {tick ? `${tick.change_pct >= 0 ? "+" : ""}${tick.change_pct.toFixed(2)}%` : "-"}
            </div>
            <div className="mt-2 flex items-center gap-2">
              <TerminalBadge variant="live">F&O LIVE</TerminalBadge>
              <button
                className={`rounded border px-2 py-0.5 text-[11px] ${showVolume ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
                onClick={() => setShowVolume((v) => !v)}
              >
                VOLUME
              </button>
            </div>
          </div>
          {showIndicators && <IndicatorPanel symbol={symbol} activeIndicators={activeIndicators} onChange={setActiveIndicators} />}
          <FuturesPanel />
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">F&O Markers</div>
        <div className="grid grid-cols-1 gap-2 text-xs md:grid-cols-5">
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">ATM</div>
            <div>{summaryQuery.data?.atm_strike ?? "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">PCR</div>
            <div>{summaryQuery.data ? Number(summaryQuery.data.pcr?.pcr_oi || 0).toFixed(2) : "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">Max Pain</div>
            <div>{summaryQuery.data?.max_pain ?? "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">Support</div>
            <div>{summaryQuery.data?.support_resistance?.support?.slice(0, 2).join(", ") || "-"}</div>
          </div>
          <div>
            <div className="text-[10px] uppercase text-terminal-muted">Resistance</div>
            <div>{summaryQuery.data?.support_resistance?.resistance?.slice(0, 2).join(", ") || "-"}</div>
          </div>
        </div>
      </div>
    </div>
  );
}
