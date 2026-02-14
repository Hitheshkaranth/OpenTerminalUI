import { useState } from "react";

import { FuturesPanel } from "../../components/market/FuturesPanel";
import { useStockHistory } from "../../hooks/useStocks";
import { ChartEngine } from "../../shared/chart/ChartEngine";
import { SharedChartToolbar } from "../../shared/chart/ChartToolbar";
import { chartPointsToBars } from "../../shared/chart/chartUtils";
import type { ChartKind, ChartTimeframe } from "../../shared/chart/types";
import { useSettingsStore } from "../../store/settingsStore";
import { useFnoContext } from "../FnoLayout";

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
  const { symbol } = useFnoContext();
  const selectedMarket = useSettingsStore((s) => s.selectedMarket);
  const [timeframe, setTimeframe] = useState<ChartTimeframe>("1D");
  const [chartType, setChartType] = useState<ChartKind>("candle");
  const [ohlc, setOhlc] = useState<{ open: number; high: number; low: number; close: number; time: number } | null>(null);
  const [tick, setTick] = useState<{ ltp: number; change_pct: number } | null>(null);
  const tfConfig = TF_TO_INTERVAL_RANGE[timeframe];
  const { data: chart, isLoading } = useStockHistory(symbol, tfConfig.range, tfConfig.interval);

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
        showIndicators={false}
        onToggleIndicators={() => {
          // future use
        }}
      />
      <div className="h-[420px] rounded border border-terminal-border bg-terminal-panel p-1">
        {isLoading || !chart?.data?.length ? (
          <div className="flex h-full items-center justify-center text-xs text-terminal-muted">Loading futures chart...</div>
        ) : (
          <ChartEngine
            symbol={symbol}
            timeframe={timeframe}
            historicalData={chartPointsToBars(chart.data)}
            chartType={chartType}
            showVolume={true}
            enableRealtime={true}
            market={selectedMarket}
            symbolIsFnO={true}
            activeIndicators={[]}
            onCrosshairOHLC={setOhlc}
            onTick={setTick}
            height={410}
          />
        )}
      </div>
      <FuturesPanel />
    </div>
  );
}
