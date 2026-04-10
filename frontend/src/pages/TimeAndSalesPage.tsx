import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, ResponsiveContainer, Tooltip } from "recharts";

import { fetchChart } from "../api/client";
import { TimeAndSales } from "../components/market/TimeAndSales";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useStockStore } from "../store/stockStore";

function formatPrice(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

export function TimeAndSalesPage() {
  const ticker = useStockStore((state) => state.ticker);
  const stock = useStockStore((state) => state.stock);
  const setTicker = useStockStore((state) => state.setTicker);
  const loadTicker = useStockStore((state) => state.load);
  const activeTicker = (ticker || "RELIANCE").toUpperCase();

  useEffect(() => {
    setTicker(activeTicker);
    void loadTicker();
  }, [activeTicker, loadTicker, setTicker]);

  const chartQuery = useQuery({
    queryKey: ["tape-page", "sparkline", activeTicker],
    queryFn: () => fetchChart(activeTicker, "5m", "1mo"),
    staleTime: 30_000,
  });

  const sparklineData = useMemo(() => {
    return (chartQuery.data?.data ?? []).slice(-60).map((point) => ({
      time: new Date(Number(point.t) * 1000).toLocaleDateString([], { month: "short", day: "numeric" }),
      close: Number(point.c),
    }));
  }, [chartQuery.data?.data]);

  const latestSpark = sparklineData.length ? sparklineData[sparklineData.length - 1]?.close : 0;
  const lastPrice = Number(stock?.current_price ?? latestSpark ?? 0);
  const changePct = Number(stock?.change_pct ?? 0);
  const change = changePct !== -100 ? lastPrice - (lastPrice / (1 + changePct / 100)) : 0;
  const positive = change >= 0;

  return (
    <div className="h-full min-h-0 overflow-auto p-2">
      <div className="grid gap-2">
        <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-3">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <div className="text-[11px] uppercase tracking-[0.22em] text-terminal-muted">Tape Reader</div>
              <div className="mt-1 text-2xl font-semibold text-terminal-text">{activeTicker}</div>
            </div>
            <div className="text-right">
              <div className="font-mono text-2xl text-terminal-text">{formatPrice(lastPrice)}</div>
              <div className={`mt-1 font-mono text-sm ${positive ? "text-green-400" : "text-red-400"}`}>
                {positive ? "+" : ""}{formatPrice(change)} ({positive ? "+" : ""}{changePct.toFixed(2)}%)
              </div>
            </div>
          </div>
        </div>

        <div className="grid min-h-[780px] gap-2 xl:grid-cols-[1.85fr_1fr]">
          <TimeAndSales ticker={activeTicker} className="min-h-[780px]" />
          <TerminalPanel title="Micro Trend" subtitle={`${activeTicker} price sparkline`} bodyClassName="h-full min-h-[780px]">
            <div className="flex h-full min-h-[720px] flex-col gap-3">
              <div className="grid grid-cols-2 gap-2">
                <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Last</div>
                  <div className="mt-1 font-mono text-lg text-terminal-text">{formatPrice(lastPrice)}</div>
                </div>
                <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
                  <div className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">Change</div>
                  <div className={`mt-1 font-mono text-lg ${positive ? "text-green-400" : "text-red-400"}`}>
                    {positive ? "+" : ""}{changePct.toFixed(2)}%
                  </div>
                </div>
              </div>
              <div className="flex-1 rounded-sm border border-terminal-border bg-terminal-bg p-3">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={sparklineData}>
                    <defs>
                      <linearGradient id="tape-spark" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor={positive ? "#4ade80" : "#f87171"} stopOpacity={0.45} />
                        <stop offset="100%" stopColor={positive ? "#4ade80" : "#f87171"} stopOpacity={0.02} />
                      </linearGradient>
                    </defs>
                    <Tooltip
                      formatter={(value: number | string | undefined) => formatPrice(Number(value ?? 0))}
                      labelStyle={{ color: "#a8b3c7" }}
                      contentStyle={{
                        backgroundColor: "#111827",
                        borderColor: "#334155",
                        color: "#e5eefc",
                        fontSize: 12,
                      }}
                    />
                    <Area
                      type="monotone"
                      dataKey="close"
                      stroke={positive ? "#4ade80" : "#f87171"}
                      fill="url(#tape-spark)"
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </TerminalPanel>
        </div>
      </div>
    </div>
  );
}
