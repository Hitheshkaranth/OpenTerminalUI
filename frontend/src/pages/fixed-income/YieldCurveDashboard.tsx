import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer,
  LineChart, Line, ReferenceLine
} from "recharts";
import {
  Calendar, Info, TrendingDown, TrendingUp, AlertTriangle, ArrowRight
} from "lucide-react";
import { format, parseISO, subDays } from "date-fns";

import { fetchYieldCurve, fetchHistoricalYieldCurve, fetch2s10sHistory } from "../../api/client";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";

export function YieldCurveDashboard() {
  const [compareDate, setCompareDate] = useState<string>("");
  const [historicalCurves, setHistoricalCurves] = useState<Array<{ date: string; data: any[] }>>([]);

  const { data: currentCurve, isLoading: loadingCurrent } = useQuery({
    queryKey: ["yield-curve"],
    queryFn: fetchYieldCurve,
    refetchInterval: 300_000, // 5 minutes
  });

  const { data: spread2s10s, isLoading: loadingSpread } = useQuery({
    queryKey: ["2s10s-history"],
    queryFn: fetch2s10sHistory,
    refetchInterval: 600_000,
  });

  const addComparison = async () => {
    if (!compareDate) return;
    if (historicalCurves.some(c => c.date === compareDate)) return;

    try {
      const hist = await fetchHistoricalYieldCurve(compareDate);
      setHistoricalCurves(prev => [...prev, { date: compareDate, data: hist.data }]);
    } catch (err) {
      console.error("Failed to fetch historical curve", err);
    }
  };

  const removeComparison = (date: string) => {
    setHistoricalCurves(prev => prev.filter(c => c.date !== date));
  };

  // Prepare chart data
  const chartData = useMemo(() => {
    if (!currentCurve?.data) return [];

    return currentCurve.data.map((point: any, idx: number) => {
      const item: any = {
        label: point.label,
        current: point.yield,
        order: point.order
      };

      historicalCurves.forEach(hist => {
        const histPoint = hist.data.find(h => h.label === point.label);
        if (histPoint) {
          item[hist.date] = histPoint.yield;
        }
      });

      return item;
    });
  }, [currentCurve, historicalCurves]);

  // Detect inversions
  const inversions = useMemo(() => {
    if (!currentCurve?.data) return [];
    const inv = [];
    for (let i = 0; i < currentCurve.data.length - 1; i++) {
      if (currentCurve.data[i].yield > currentCurve.data[i+1].yield) {
        inv.push({
          from: currentCurve.data[i].label,
          to: currentCurve.data[i+1].label,
          shortYield: currentCurve.data[i].yield,
          longYield: currentCurve.data[i+1].yield
        });
      }
    }
    return inv;
  }, [currentCurve]);

  const COLORS = ["#3B82F6", "#10B981", "#F59E0B", "#8B5CF6", "#EC4899"];

  if (loadingCurrent) {
    return (
      <div className="flex h-full items-center justify-center bg-terminal-bg text-terminal-accent">
        <div className="animate-pulse">LOADING YIELD CURVE...</div>
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-4 overflow-auto bg-terminal-bg p-4 text-terminal-text">
      {/* Header Section */}
      <div className="flex items-center justify-between border-b border-terminal-border pb-4">
        <div>
          <h1 className="text-xl font-bold text-terminal-accent">US TREASURY YIELD CURVE</h1>
          <p className="text-xs text-terminal-muted">As of {currentCurve?.date || "N/A"}</p>
        </div>

        <div className="flex items-center gap-2">
          <input
            type="date"
            className="rounded border border-terminal-border bg-terminal-bg p-1 text-xs text-terminal-text outline-none focus:border-terminal-accent"
            value={compareDate}
            onChange={(e) => setCompareDate(e.target.value)}
          />
          <button
            onClick={addComparison}
            className="rounded bg-terminal-accent/20 px-3 py-1 text-xs font-bold text-terminal-accent hover:bg-terminal-accent/30"
          >
            COMPARE
          </button>
        </div>
      </div>

      {/* Main Yield Curve Chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-4">
        <div className="lg:col-span-3">
          <TerminalPanel title="Yield Curve Visualization">
            <div className="h-[400px] w-full p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={chartData} margin={{ top: 10, right: 30, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="colorCurrent" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#3B82F6" stopOpacity={0.3}/>
                      <stop offset="95%" stopColor="#3B82F6" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                  <XAxis
                    dataKey="label"
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                  />
                  <YAxis
                    stroke="#9CA3AF"
                    fontSize={10}
                    tickLine={false}
                    axisLine={false}
                    domain={['dataMin - 0.5', 'dataMax + 0.5']}
                    unit="%"
                  />
                  <Tooltip
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', fontSize: '12px' }}
                    itemStyle={{ color: '#F3F4F6' }}
                  />

                  {/* Base Area for Current Curve */}
                  <Area
                    type="monotone"
                    dataKey="current"
                    stroke="#3B82F6"
                    strokeWidth={3}
                    fillOpacity={1}
                    fill="url(#colorCurrent)"
                    name="Current"
                    animationDuration={1000}
                  />

                  {/* Historical Curves */}
                  {historicalCurves.map((hist, idx) => (
                    <Area
                      key={hist.date}
                      type="monotone"
                      dataKey={hist.date}
                      stroke={COLORS[(idx + 1) % COLORS.length]}
                      strokeWidth={2}
                      strokeDasharray="5 5"
                      fill="none"
                      name={hist.date}
                    />
                  ))}
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </TerminalPanel>
        </div>

        {/* Comparison Legend & Controls */}
        <div className="flex flex-col gap-4">
          <TerminalPanel title="Comparison List">
            <div className="flex flex-col gap-2 p-3">
              <div className="flex items-center gap-2 text-xs">
                <div className="h-3 w-3 rounded-full bg-[#3B82F6]" />
                <span className="flex-grow text-terminal-text">Current Curve</span>
              </div>

              {historicalCurves.map((hist, idx) => (
                <div key={hist.date} className="flex items-center gap-2 text-xs">
                  <div className="h-3 w-3 rounded-full" style={{ backgroundColor: COLORS[(idx + 1) % COLORS.length] }} />
                  <span className="flex-grow text-terminal-text">{hist.date}</span>
                  <button
                    onClick={() => removeComparison(hist.date)}
                    className="text-terminal-neg hover:text-red-400"
                  >
                    ×
                  </button>
                </div>
              ))}

              {historicalCurves.length === 0 && (
                <p className="py-4 text-center text-xs text-terminal-muted italic">No historical curves added</p>
              )}
            </div>
          </TerminalPanel>

          <TerminalPanel title="Curve Inversions">
            <div className="flex flex-col gap-2 p-3">
              {inversions.length > 0 ? (
                inversions.map((inv, idx) => (
                  <div key={idx} className="rounded border border-terminal-neg/30 bg-terminal-neg/10 p-2">
                    <div className="flex items-center justify-between text-[10px] font-bold uppercase text-terminal-neg">
                      <span>Inversion Detected</span>
                      <TrendingDown size={10} />
                    </div>
                    <div className="mt-1 flex items-center justify-between text-xs">
                      <span className="text-terminal-text">{inv.from} vs {inv.to}</span>
                      <span className="font-mono text-terminal-neg">{(inv.shortYield - inv.longYield).toFixed(3)}%</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="py-2 text-center text-xs text-terminal-pos italic">No inversions detected</p>
              )}
            </div>
          </TerminalPanel>
        </div>
      </div>

      {/* Yield Table */}
      <TerminalPanel title="Yield Details">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="border-b border-terminal-border bg-terminal-bg-accent text-terminal-muted">
              <tr>
                <th className="px-4 py-2 font-medium">Maturity</th>
                <th className="px-4 py-2 font-medium">Series</th>
                <th className="px-4 py-2 text-right font-medium">Current Yield</th>
                <th className="px-4 py-2 text-right font-medium">1D Chg</th>
                <th className="px-4 py-2 text-right font-medium">1W Chg</th>
                <th className="px-4 py-2 text-right font-medium">1M Chg</th>
                <th className="px-4 py-2 text-right font-medium">1Y Chg</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-terminal-border/50">
              {currentCurve?.data.map((point: any) => (
                <tr key={point.series_id} className="hover:bg-terminal-accent/5">
                  <td className="px-4 py-2 font-bold text-terminal-accent">{point.label}</td>
                  <td className="px-4 py-2 text-terminal-muted">{point.series_id}</td>
                  <td className="px-4 py-2 text-right font-mono text-terminal-text">{point.yield.toFixed(3)}%</td>
                  <td className={`px-4 py-2 text-right font-mono ${Number(point.chg_1d) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {point.chg_1d != null ? (point.chg_1d * 100).toFixed(1) : "N/A"}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${Number(point.chg_1w) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {point.chg_1w != null ? (point.chg_1w * 100).toFixed(1) : "N/A"}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${Number(point.chg_1m) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {point.chg_1m != null ? (point.chg_1m * 100).toFixed(1) : "N/A"}
                  </td>
                  <td className={`px-4 py-2 text-right font-mono ${Number(point.chg_1y) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                    {point.chg_1y != null ? (point.chg_1y * 100).toFixed(1) : "N/A"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </TerminalPanel>

      {/* 2s10s Spread Chart */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <TerminalPanel title="10Y - 2Y Spread (Recession Indicator)">
            <div className="h-[250px] w-full p-4">
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={spread2s10s?.history}>
                  <defs>
                    <linearGradient id="colorSpread" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="5%" stopColor="#10B981" stopOpacity={0.2}/>
                      <stop offset="95%" stopColor="#10B981" stopOpacity={0}/>
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" vertical={false} />
                  <XAxis
                    dataKey="date"
                    stroke="#9CA3AF"
                    fontSize={8}
                    tickFormatter={(val) => format(parseISO(val), "MMM yy")}
                    minTickGap={50}
                  />
                  <YAxis stroke="#9CA3AF" fontSize={10} unit="%" />
                  <Tooltip
                    labelFormatter={(label) => format(parseISO(label), "PPP")}
                    contentStyle={{ backgroundColor: '#111827', borderColor: '#374151', fontSize: '12px' }}
                  />
                  <ReferenceLine y={0} stroke="#EF4444" strokeWidth={1} strokeDasharray="3 3" />
                  <Area
                    type="monotone"
                    dataKey="value"
                    stroke="#10B981"
                    strokeWidth={2}
                    fill="url(#colorSpread)"
                    name="10Y-2Y Spread"
                    animationDuration={1500}
                  />
                </AreaChart>
              </ResponsiveContainer>
            </div>
          </TerminalPanel>
        </div>

        <div className="flex flex-col gap-4">
          <div className="rounded border border-terminal-border bg-terminal-bg p-4 shadow-lg">
            <h3 className="text-xs font-bold uppercase text-terminal-muted">Current 2s10s Spread</h3>
            <div className="mt-2 flex items-baseline gap-2">
              <span className={`text-3xl font-bold font-mono ${(currentCurve?.spreads?.["2s10s"] ?? 0) >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                {(currentCurve?.spreads?.["2s10s"] || 0).toFixed(3)}%
              </span>
              <span className="text-xs text-terminal-muted">basis points</span>
            </div>
            <p className="mt-4 text-[10px] leading-relaxed text-terminal-muted italic">
              The 10Y-2Y spread is a primary recession indicator. When it drops below zero (inversion), it has historically preceded every US recession of the past 50 years.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
