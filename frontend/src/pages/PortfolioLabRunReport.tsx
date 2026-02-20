import { useMemo } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { getPortfolioRunReport } from "../api/portfolioLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

function pct(value: number | undefined): string {
  if (!Number.isFinite(Number(value))) return "-";
  return `${(Number(value) * 100).toFixed(2)}%`;
}

export function PortfolioLabRunReportPage() {
  const { runId = "" } = useParams();

  const reportQuery = useQuery({
    queryKey: ["portfolio-lab", "report", runId],
    queryFn: () => getPortfolioRunReport(runId),
    enabled: Boolean(runId),
    refetchInterval: 2500,
  });

  const equityRows = useMemo(() => {
    const report = reportQuery.data;
    if (!report) return [] as Array<{ date: string; portfolio: number; benchmark: number | null }>;
    const benchmarkMap = new Map((report.series.benchmark_equity || []).map((row) => [row.date, row.value]));
    return (report.series.portfolio_equity || []).map((row) => ({
      date: row.date,
      portfolio: row.value,
      benchmark: benchmarkMap.get(row.date) ?? null,
    }));
  }, [reportQuery.data]);

  const contribRows = useMemo(() => {
    const rows = reportQuery.data?.series?.contribution_series || [];
    const cols = rows.length ? Object.keys(rows[0]).filter((key) => key !== "date") : [];
    const top = cols.slice(0, 10);
    return rows.map((row) => {
      const payload: Record<string, string | number> = { date: String(row.date || "") };
      let other = 0;
      for (const key of cols) {
        const value = Number(row[key] || 0);
        if (top.includes(key)) payload[key] = value;
        else other += value;
      }
      payload.other = other;
      return payload;
    });
  }, [reportQuery.data]);

  const heatmap = useMemo(() => {
    const rows = reportQuery.data?.series?.monthly_returns || [];
    const years = Array.from(new Set(rows.map((item) => item.year))).sort((a, b) => a - b);
    const map = new Map<string, number>();
    for (const item of rows) map.set(`${item.year}-${item.month}`, item.return_pct);
    return { years, map };
  }, [reportQuery.data]);

  const corrCells = useMemo(() => {
    const corr = reportQuery.data?.matrices?.correlation;
    if (!corr?.labels?.length) return [] as Array<{ x: number; y: number; value: number }>;
    const rows: Array<{ x: number; y: number; value: number }> = [];
    for (let i = 0; i < corr.labels.length; i += 1) {
      for (let j = 0; j < corr.labels.length; j += 1) {
        rows.push({ x: i, y: j, value: Number(corr.values?.[i]?.[j] ?? 0) });
      }
    }
    return rows;
  }, [reportQuery.data]);

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Portfolio Lab / Report" subtitle={runId}>
        <div className="flex items-center justify-between text-xs">
          <div>Status: <span className="text-terminal-accent">{reportQuery.data?.status || "loading"}</span></div>
          <div className="flex gap-2">
            {reportQuery.data?.portfolio_id && <Link className="rounded border border-terminal-border px-2 py-1" to={`/equity/portfolio/lab/portfolios/${reportQuery.data.portfolio_id}`}>Portfolio</Link>}
            <Link className="rounded border border-terminal-border px-2 py-1" to="/equity/portfolio/lab">All Portfolios</Link>
          </div>
        </div>
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
            <div className="rounded border border-terminal-border p-2">Turnover<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.turnover || 0).toFixed(4)}</span></div>
            <div className="rounded border border-terminal-border p-2">Beta<br /><span className="text-terminal-accent">{(reportQuery.data.metrics.beta || 0).toFixed(2)}</span></div>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Equity vs Benchmark" subtitle="Portfolio performance">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line dataKey="portfolio" stroke="#34d399" dot={false} />
                    <Line dataKey="benchmark" stroke="#60a5fa" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Drawdown + Underwater" subtitle="Risk profile">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={reportQuery.data.series.drawdown || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Area dataKey="value" stroke="#f87171" fill="#f87171" fillOpacity={0.35} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Rolling Sharpe 30/90" subtitle="Stability over time">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    <Line data={reportQuery.data.series.rolling_sharpe_30 || []} dataKey="value" name="Sharpe 30" stroke="#a78bfa" dot={false} />
                    <Line data={reportQuery.data.series.rolling_sharpe_90 || []} dataKey="value" name="Sharpe 90" stroke="#38bdf8" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Rolling Volatility" subtitle="Annualized">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={reportQuery.data.series.rolling_volatility || []}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Line dataKey="value" stroke="#f59e0b" dot={false} />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Contribution Over Time" subtitle="Top assets + other">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={contribRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    {contribRows.length > 0 && Object.keys(contribRows[0]).filter((k) => k !== "date").map((key) => (
                      <Area key={key} type="monotone" dataKey={key} stackId="1" strokeWidth={1} />
                    ))}
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Holdings + Turnover" subtitle="Latest weights and churn">
              <div className="grid grid-cols-1 gap-2">
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={reportQuery.data.tables.latest_weights || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="asset" />
                      <YAxis />
                      <Tooltip />
                      <Bar dataKey="weight" fill="#22c55e" />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
                <div className="h-36">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={reportQuery.data.series.turnover_series || []}>
                      <CartesianGrid strokeDasharray="3 3" />
                      <XAxis dataKey="date" hide />
                      <YAxis />
                      <Tooltip />
                      <Line dataKey="turnover" stroke="#facc15" dot={false} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </TerminalPanel>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Correlation Heatmap" subtitle="Asset return matrix">
              <div className="h-72 overflow-auto rounded border border-terminal-border/30 p-2">
                <div className="grid" style={{ gridTemplateColumns: `repeat(${Math.max(1, reportQuery.data.matrices.labels?.length || 1)}, minmax(24px, 1fr))` }}>
                  {corrCells.map((cell, idx) => {
                    const intensity = Math.min(1, Math.abs(cell.value));
                    const green = cell.value >= 0 ? Math.round(200 * intensity) : 40;
                    const red = cell.value < 0 ? Math.round(200 * intensity) : 40;
                    const bg = `rgb(${red},${green},60)`;
                    return <div key={idx} title={cell.value.toFixed(2)} style={{ backgroundColor: bg }} className="h-6 border border-terminal-border/20" />;
                  })}
                </div>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Monthly Returns Heatmap" subtitle="Calendar view">
              <div className="overflow-auto">
                <table className="min-w-full text-[11px]">
                  <thead>
                    <tr>
                      <th className="px-1 py-1 text-left">Year</th>
                      {["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"].map((m) => <th key={m} className="px-1 py-1">{m}</th>)}
                    </tr>
                  </thead>
                  <tbody>
                    {heatmap.years.map((year) => (
                      <tr key={year} className="border-t border-terminal-border/30">
                        <td className="px-1 py-1">{year}</td>
                        {Array.from({ length: 12 }, (_, idx) => idx + 1).map((month) => {
                          const value = heatmap.map.get(`${year}-${month}`);
                          const cls = value == null ? "bg-terminal-border/20" : value >= 0 ? "bg-terminal-pos/25 text-terminal-pos" : "bg-terminal-neg/25 text-terminal-neg";
                          return <td key={`${year}-${month}`} className="px-1 py-1"><div className={`rounded px-1 py-0.5 text-center ${cls}`}>{value == null ? "-" : value.toFixed(1)}</div></td>;
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </TerminalPanel>
          </div>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-3">
            <TerminalPanel title="Top Contributors" subtitle="Period contribution">
              <div className="space-y-1 text-xs">{(reportQuery.data.tables.top_contributors || []).map((row) => <div key={row.asset} className="flex justify-between"><span>{row.asset}</span><span>{pct(row.contribution)}</span></div>)}</div>
            </TerminalPanel>
            <TerminalPanel title="Top Detractors" subtitle="Period contribution">
              <div className="space-y-1 text-xs">{(reportQuery.data.tables.top_detractors || []).map((row) => <div key={row.asset} className="flex justify-between"><span>{row.asset}</span><span>{pct(row.contribution)}</span></div>)}</div>
            </TerminalPanel>
            <TerminalPanel title="Worst Drawdowns" subtitle="Top 10 events">
              <div className="space-y-1 text-xs">{(reportQuery.data.tables.worst_drawdowns || []).map((row) => <div key={row.date} className="flex justify-between"><span>{row.date}</span><span className="text-terminal-neg">{pct(row.drawdown)}</span></div>)}</div>
            </TerminalPanel>
          </div>
        </>
      )}
    </div>
  );
}
