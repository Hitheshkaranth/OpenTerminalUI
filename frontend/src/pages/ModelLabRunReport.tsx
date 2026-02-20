import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Scatter,
  ScatterChart,
  Tooltip,
  XAxis,
  YAxis,
  ZAxis,
} from "recharts";

import { getModelRunReport } from "../api/modelLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

function pct(value: number | undefined): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export function ModelLabRunReportPage() {
  const { runId = "" } = useParams();

  const reportQuery = useQuery({
    queryKey: ["model-lab", "report", runId],
    queryFn: () => getModelRunReport(runId),
    enabled: Boolean(runId),
    refetchInterval: 2000,
  });

  const mergedEquity = useMemo(() => {
    const report = reportQuery.data;
    if (!report) return [] as Array<{ date: string; equity: number; benchmark: number | null }>;
    const benchByDate = new Map(report.series.benchmark_curve.map((item) => [item.date, item.value]));
    return report.series.equity_curve.map((item) => ({
      date: item.date,
      equity: item.value,
      benchmark: benchByDate.get(item.date) ?? null,
    }));
  }, [reportQuery.data]);

  const drawdownRows = reportQuery.data?.series?.drawdown || [];
  const rollingRows = useMemo(() => {
    const rows30 = reportQuery.data?.series?.rolling_sharpe_30 || [];
    const rows90 = reportQuery.data?.series?.rolling_sharpe_90 || [];
    const size = Math.max(rows30.length, rows90.length);
    return Array.from({ length: size }, (_, idx) => ({
      idx,
      sharpe30: rows30[idx] ?? null,
      sharpe90: rows90[idx] ?? null,
    }));
  }, [reportQuery.data]);

  const worstDrawdowns = useMemo(
    () => [...drawdownRows].sort((a, b) => Number(a.value) - Number(b.value)).slice(0, 8),
    [drawdownRows],
  );

  const monthlyMap = useMemo(() => {
    const rows = reportQuery.data?.series?.monthly_returns || [];
    const map = new Map<string, number>();
    for (const row of rows) map.set(`${row.year}-${row.month}`, row.return_pct);
    const years = Array.from(new Set(rows.map((item) => item.year))).sort((a, b) => a - b);
    return { map, years };
  }, [reportQuery.data]);

  const histogramRows = useMemo(() => {
    const hist = reportQuery.data?.series?.returns_histogram;
    if (!hist) return [] as Array<{ bin: number; count: number }>;
    return hist.bins.map((bin, idx) => ({ bin, count: hist.counts[idx] || 0 }));
  }, [reportQuery.data]);

  if (!runId) return <div className="p-3 text-sm text-terminal-neg">Missing run id.</div>;

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Model Lab / Report" subtitle={runId}>
        {reportQuery.isLoading && <div className="text-xs text-terminal-muted">Loading report...</div>}
        {reportQuery.isError && <div className="text-xs text-terminal-neg">Failed to load report.</div>}
        {reportQuery.data && (
          <div className="flex items-center justify-between text-xs">
            <div>Status: <span className="text-terminal-accent">{reportQuery.data.status}</span></div>
            <div className="flex gap-2">
              {reportQuery.data.experiment_id && <Link className="rounded border border-terminal-border px-2 py-1" to={`/backtesting/model-lab/experiments/${reportQuery.data.experiment_id}`}>Experiment</Link>}
              <Link className="rounded border border-terminal-border px-2 py-1" to={`/backtesting/model-lab/compare?runs=${runId}`}>Compare</Link>
            </div>
          </div>
        )}
      </TerminalPanel>

      {reportQuery.data && (
        <>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4 xl:grid-cols-8 text-xs">
            <div className="rounded border border-terminal-border p-2">CAGR<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.cagr)}</span></div>
            <div className="rounded border border-terminal-border p-2">Sharpe<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.sharpe || 0).toFixed(2)}</span></div>
            <div className="rounded border border-terminal-border p-2">Sortino<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.sortino || 0).toFixed(2)}</span></div>
            <div className="rounded border border-terminal-border p-2">MaxDD<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.max_drawdown)}</span></div>
            <div className="rounded border border-terminal-border p-2">Vol<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.vol_annual)}</span></div>
            <div className="rounded border border-terminal-border p-2">Calmar<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.calmar || 0).toFixed(2)}</span></div>
            <div className="rounded border border-terminal-border p-2">WinRate<br /><span className="text-terminal-accent">{pct(reportQuery.data.metrics.win_rate)}</span></div>
            <div className="rounded border border-terminal-border p-2">Turnover<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.turnover || 0).toFixed(4)}</span></div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Equity vs Benchmark" subtitle="Line chart">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={mergedEquity}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="equity" stroke="#34d399" dot={false} strokeWidth={2} />
                    <Line dataKey="benchmark" stroke="#60a5fa" dot={false} strokeWidth={1.5} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Drawdown" subtitle="Area/line">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={drawdownRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Area dataKey="value" stroke="#f87171" fill="#f87171" fillOpacity={0.3} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Underwater" subtitle="Drawdown over time">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={drawdownRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Line dataKey="value" stroke="#fb923c" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Rolling Sharpe" subtitle="30/90 day">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={rollingRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="idx" />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="sharpe30" stroke="#a78bfa" dot={false} />
                    <Line dataKey="sharpe90" stroke="#38bdf8" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Monthly Returns Heatmap" subtitle="Simple grid">
              <div className="overflow-auto">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="px-1 py-1 text-left">Year</th>
                      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m) => <th key={m} className="px-1 py-1">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {monthlyMap.years.map((year) => (
                      <tr key={year} className="border-t border-terminal-border/40">
                        <td className="px-1 py-1">{year}</td>
                        {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
                          const value = monthlyMap.map.get(`${year}-${month}`);
                          const cls = value == null
                            ? "bg-terminal-border/20"
                            : value >= 0
                              ? "bg-terminal-pos/20 text-terminal-pos"
                              : "bg-terminal-neg/20 text-terminal-neg";
                          return <td key={`${year}-${month}`} className="px-1 py-1"><div className={`rounded px-1 py-0.5 text-center ${cls}`}>{value == null ? "-" : value.toFixed(1)}</div></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Returns Histogram" subtitle="Distribution">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={histogramRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="bin" hide />
                    <YAxis />
                    <Tooltip />
                    <Bar dataKey="count" fill="#22c55e" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Worst Drawdowns" subtitle="Top N">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="border-b border-terminal-border/40">
                    <th className="px-1 py-1 text-left">Date</th>
                    <th className="px-1 py-1 text-right">Drawdown</th>
                  </tr>
                </thead>
                <tbody>
                  {worstDrawdowns.map((row) => (
                    <tr key={row.date} className="border-t border-terminal-border/30">
                      <td className="px-1 py-1">{row.date}</td>
                      <td className="px-1 py-1 text-right text-terminal-neg">{pct(row.value)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TerminalPanel>

            <TerminalPanel title="Trades" subtitle="Audit table">
              <table className="min-w-full text-[11px]">
                <thead>
                  <tr className="border-b border-terminal-border/40">
                    <th className="px-1 py-1 text-left">Date</th>
                    <th className="px-1 py-1 text-left">Action</th>
                    <th className="px-1 py-1 text-right">Qty</th>
                    <th className="px-1 py-1 text-right">Price</th>
                  </tr>
                </thead>
                <tbody>
                  {((reportQuery.data as any).series?.trades || []).map((trade: any, idx: number) => (
                    <tr key={`${trade.date}-${idx}`} className="border-t border-terminal-border/30">
                      <td className="px-1 py-1">{trade.date}</td>
                      <td className="px-1 py-1">{trade.action}</td>
                      <td className="px-1 py-1 text-right">{Number(trade.quantity || 0).toFixed(2)}</td>
                      <td className="px-1 py-1 text-right">{Number(trade.price || 0).toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TerminalPanel>
          </div>

          <TerminalPanel title="Return vs MaxDD" subtitle="Risk-return scatter">
            <div className="h-72">
              <ResponsiveContainer width="100%" height="100%">
                <ScatterChart>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" dataKey="x" name="Return" />
                  <YAxis type="number" dataKey="y" name="MaxDD" />
                  <ZAxis type="number" dataKey="z" range={[100, 100]} />
                  <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                  <Scatter
                    name="Run"
                    data={[{ x: Number(reportQuery.data.metrics.total_return || 0), y: Number(reportQuery.data.metrics.max_drawdown || 0), z: 1 }]}
                    fill="#facc15"
                  />
                </ScatterChart>
              </ResponsiveContainer>
            </div>
          </TerminalPanel>
        </>
      )}
    </div>
  );
}
