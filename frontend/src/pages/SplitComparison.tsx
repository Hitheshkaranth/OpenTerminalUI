import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

import { CrosshairSyncProvider } from "../contexts/CrosshairSyncContext";
import { TradingChart } from "../components/chart/TradingChart";
import { DenseTable } from "../components/terminal/DenseTable";
import { useStock, useStockHistory } from "../hooks/useStocks";
import { quickAddToFirstPortfolio } from "../shared/portfolioQuickAdd";
import type { ChartPoint } from "../types";

type Timeframe = "1D" | "1W" | "1M" | "3M" | "1Y";

const RANGE_BY_TIMEFRAME: Record<Timeframe, string> = {
  "1D": "1d",
  "1W": "5d",
  "1M": "1mo",
  "3M": "3mo",
  "1Y": "1y",
};

function readNumeric(snapshot: unknown, keys: string[]) {
  const row = (snapshot ?? {}) as Record<string, unknown>;
  for (const key of keys) {
    const value = Number(row[key]);
    if (Number.isFinite(value)) return value;
  }
  return 0;
}

function normalizeSeries(data: ChartPoint[]) {
  if (!data.length) return [];
  const base = data[0].c || 1;
  return data.map((p) => ({
    t: p.t,
    v: ((p.c - base) / base) * 100,
  }));
}

function OverlayChart({ leftData, rightData }: { leftData: ChartPoint[]; rightData: ChartPoint[] }) {
  const left = normalizeSeries(leftData);
  const right = normalizeSeries(rightData);
  const width = 800;
  const height = 180;
  const combined = [...left, ...right];
  const min = Math.min(...combined.map((p) => p.v), -1);
  const max = Math.max(...combined.map((p) => p.v), 1);
  const span = max - min || 1;
  const toPath = (rows: Array<{ t: number; v: number }>) =>
    rows
      .map((p, idx) => {
        const x = (idx / Math.max(rows.length - 1, 1)) * width;
        const y = height - ((p.v - min) / span) * height;
        return `${idx === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`;
      })
      .join(" ");

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-2">
      <div className="mb-2 ot-type-label text-terminal-accent">Relative Performance Overlay (%)</div>
      <svg viewBox={`0 0 ${width} ${height}`} className="h-44 w-full">
        <line x1={0} y1={height / 2} x2={width} y2={height / 2} stroke="var(--ot-color-border-default)" strokeDasharray="4 4" />
        <path d={toPath(left)} fill="none" stroke="var(--ot-color-accent-primary)" strokeWidth={2} />
        <path d={toPath(right)} fill="none" stroke="var(--ot-color-accent-info)" strokeWidth={2} />
      </svg>
    </div>
  );
}

export function SplitComparisonPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [leftTicker, setLeftTicker] = useState((searchParams.get("left") || "AAPL").toUpperCase());
  const [rightTicker, setRightTicker] = useState((searchParams.get("right") || "MSFT").toUpperCase());
  const [timeframe, setTimeframe] = useState<Timeframe>((searchParams.get("tf") as Timeframe) || "3M");
  const [overlayInChart, setOverlayInChart] = useState(true);

  const range = RANGE_BY_TIMEFRAME[timeframe];
  const leftHistory = useStockHistory(leftTicker, range, "1d");
  const rightHistory = useStockHistory(rightTicker, range, "1d");
  const leftSnapshot = useStock(leftTicker);
  const rightSnapshot = useStock(rightTicker);

  const leftData = (leftHistory.data?.data ?? []) as ChartPoint[];
  const rightData = (rightHistory.data?.data ?? []) as ChartPoint[];

  const stats = useMemo(() => {
    const calc = (data: ChartPoint[]) => {
      if (!data.length) return { ret: 0, high: 0, low: 0, vol: 0 };
      const first = data[0].c || 1;
      const last = data[data.length - 1].c || first;
      const ret = ((last - first) / first) * 100;
      const high = Math.max(...data.map((d) => d.h));
      const low = Math.min(...data.map((d) => d.l));
      const vol = data.reduce((sum, d) => sum + (d.v || 0), 0);
      return { ret, high, low, vol };
    };
    return { left: calc(leftData), right: calc(rightData) };
  }, [leftData, rightData]);

  return (
    <div className="h-full min-h-0 overflow-auto p-3">
      <div className="mb-2 rounded border border-terminal-border bg-terminal-panel px-3 py-2">
        <div className="mb-2 flex flex-wrap items-end gap-2">
          <div>
            <label className="block text-[10px] uppercase text-terminal-muted">Left</label>
            <input
              value={leftTicker}
              onChange={(e) => setLeftTicker(e.target.value.toUpperCase())}
              className="w-28 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs ot-type-data outline-none focus:border-terminal-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-terminal-muted">Right</label>
            <input
              value={rightTicker}
              onChange={(e) => setRightTicker(e.target.value.toUpperCase())}
              className="w-28 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs ot-type-data outline-none focus:border-terminal-accent"
            />
          </div>
          <div>
            <label className="block text-[10px] uppercase text-terminal-muted">Timeframe</label>
            <select
              value={timeframe}
              onChange={(e) => setTimeframe(e.target.value as Timeframe)}
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none"
            >
              {Object.keys(RANGE_BY_TIMEFRAME).map((tf) => (
                <option key={tf} value={tf}>
                  {tf}
                </option>
              ))}
            </select>
          </div>
          <button
            type="button"
            onClick={() =>
              setSearchParams({
                left: leftTicker,
                right: rightTicker,
                tf: timeframe,
              })
            }
            className="rounded border border-terminal-accent bg-terminal-accent/10 px-2 py-1 text-xs text-terminal-accent"
          >
            Apply
          </button>
          <label className="inline-flex items-center gap-1 text-[11px] text-terminal-muted">
            <input type="checkbox" checked={overlayInChart} onChange={(e) => setOverlayInChart(e.target.checked)} />
            Overlay on left chart
          </label>
        </div>
        <div className="grid grid-cols-1 gap-2 text-[11px] md:grid-cols-2">
          <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
            <div className="ot-type-label text-terminal-muted">{leftTicker}</div>
            <div className="text-terminal-text">{leftSnapshot.data?.company_name || leftTicker}</div>
            <div className={stats.left.ret >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{stats.left.ret.toFixed(2)}%</div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-2 py-1">
            <div className="ot-type-label text-terminal-muted">{rightTicker}</div>
            <div className="text-terminal-text">{rightSnapshot.data?.company_name || rightTicker}</div>
            <div className={stats.right.ret >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{stats.right.ret.toFixed(2)}%</div>
          </div>
        </div>
      </div>

      <CrosshairSyncProvider enabled>
        <div className="grid min-h-[480px] grid-cols-1 gap-3 xl:grid-cols-2">
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-1 ot-type-label text-terminal-accent">{leftTicker}</div>
            <div className="h-[380px]">
              <TradingChart
                ticker={leftTicker}
                data={leftData}
                mode="candles"
                timeframe="1D"
                panelId="compare-left"
                crosshairSyncGroupId="split-compare"
                comparisonSeries={overlayInChart ? [{ symbol: rightTicker, data: rightData, color: "#4EA1FF" }] : []}
                onAddToPortfolio={(symbol, priceHint) => {
                  void quickAddToFirstPortfolio(symbol, priceHint, "Added from Split Comparison chart");
                }}
              />
            </div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-panel p-2">
            <div className="mb-1 ot-type-label text-terminal-accent">{rightTicker}</div>
            <div className="h-[380px]">
              <TradingChart
                ticker={rightTicker}
                data={rightData}
                mode="candles"
                timeframe="1D"
                panelId="compare-right"
                crosshairSyncGroupId="split-compare"
                onAddToPortfolio={(symbol, priceHint) => {
                  void quickAddToFirstPortfolio(symbol, priceHint, "Added from Split Comparison chart");
                }}
              />
            </div>
          </div>
        </div>
      </CrosshairSyncProvider>

      {!overlayInChart ? (
        <div className="mt-3">
          <OverlayChart leftData={leftData} rightData={rightData} />
        </div>
      ) : null}

      <div className="mt-3 rounded border border-terminal-border bg-terminal-panel p-2">
        <div className="mb-2 ot-type-label text-terminal-accent">Comparative Fundamentals</div>
        <DenseTable
          id={`split-compare-metrics-${leftTicker}-${rightTicker}`}
          height={360}
          rows={[
            {
              metric: "Price",
              left: readNumeric(leftSnapshot.data, ["current_price", "ltp", "last"]),
              right: readNumeric(rightSnapshot.data, ["current_price", "ltp", "last"]),
            },
            {
              metric: "Market Cap",
              left: readNumeric(leftSnapshot.data, ["market_cap", "mcap"]),
              right: readNumeric(rightSnapshot.data, ["market_cap", "mcap"]),
            },
            {
              metric: "P/E",
              left: readNumeric(leftSnapshot.data, ["pe", "pe_ratio"]),
              right: readNumeric(rightSnapshot.data, ["pe", "pe_ratio"]),
            },
            {
              metric: "Dividend Yield",
              left: readNumeric(leftSnapshot.data, ["dividend_yield"]),
              right: readNumeric(rightSnapshot.data, ["dividend_yield"]),
            },
            {
              metric: "52W High",
              left: readNumeric(leftSnapshot.data, ["52w_high", "high_52_week"]),
              right: readNumeric(rightSnapshot.data, ["52w_high", "high_52_week"]),
            },
            {
              metric: "52W Low",
              left: readNumeric(leftSnapshot.data, ["52w_low", "low_52_week"]),
              right: readNumeric(rightSnapshot.data, ["52w_low", "low_52_week"]),
            },
            {
              metric: `${timeframe} Return %`,
              left: stats.left.ret,
              right: stats.right.ret,
            },
            {
              metric: `${timeframe} Volume`,
              left: stats.left.vol,
              right: stats.right.vol,
            },
          ]}
          rowKey={(row) => String(row.metric)}
          columns={[
            { key: "metric", title: "Metric", type: "text", frozen: true, sortable: true, width: 180, getValue: (r) => r.metric },
            { key: "left", title: leftTicker, type: "large-number", align: "right", sortable: true, getValue: (r) => r.left },
            { key: "right", title: rightTicker, type: "large-number", align: "right", sortable: true, getValue: (r) => r.right },
            {
              key: "delta",
              title: "Delta",
              type: "large-number",
              align: "right",
              sortable: true,
              getValue: (r) => Number(r.left) - Number(r.right),
            },
            {
              key: "deltaPct",
              title: "Delta %",
              type: "percent",
              align: "right",
              sortable: true,
              getValue: (r) => {
                const denom = Number(r.right);
                if (!Number.isFinite(denom) || denom === 0) return 0;
                return ((Number(r.left) - denom) / Math.abs(denom)) * 100;
              },
            },
          ]}
        />
      </div>
    </div>
  );
}
