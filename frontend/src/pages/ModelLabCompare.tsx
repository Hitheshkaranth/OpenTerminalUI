import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation } from "@tanstack/react-query";
import {
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
} from "recharts";

import { compareModelRuns } from "../api/modelLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

export function ModelLabComparePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [inputRuns, setInputRuns] = useState(searchParams.get("runs") || "");

  const runIds = useMemo(
    () => inputRuns.split(",").map((row) => row.trim()).filter(Boolean).slice(0, 6),
    [inputRuns],
  );

  const compareMutation = useMutation({
    mutationFn: () => compareModelRuns(runIds),
  });

  const equityRows = useMemo(() => {
    const data = compareMutation.data;
    if (!data) return [] as Array<Record<string, number | string>>;
    const byDate = new Map<string, Record<string, number | string>>();
    for (const run of data.runs) {
      for (const point of run.series?.equity_curve || []) {
        const existing = byDate.get(point.date) || { date: point.date };
        existing[run.run_id] = point.value;
        byDate.set(point.date, existing);
      }
    }
    return Array.from(byDate.values());
  }, [compareMutation.data]);

  const drawdownRows = useMemo(() => {
    const data = compareMutation.data;
    if (!data) return [] as Array<Record<string, number | string>>;
    const byDate = new Map<string, Record<string, number | string>>();
    for (const run of data.runs) {
      for (const point of run.series?.drawdown || []) {
        const existing = byDate.get(point.date) || { date: point.date };
        existing[run.run_id] = point.value;
        byDate.set(point.date, existing);
      }
    }
    return Array.from(byDate.values());
  }, [compareMutation.data]);

  const scatterReturnDd = useMemo(
    () => (compareMutation.data?.summary || []).map((row) => ({ x: row.total_return, y: row.max_drawdown, run_id: row.run_id, pareto: row.pareto })),
    [compareMutation.data],
  );

  const scatterSharpeTurnover = useMemo(
    () => (compareMutation.data?.summary || []).map((row) => ({ x: row.sharpe, y: row.turnover, run_id: row.run_id, pareto: row.pareto })),
    [compareMutation.data],
  );

  const runCompare = () => {
    setSearchParams({ runs: runIds.join(",") });
    if (runIds.length >= 2) compareMutation.mutate();
  };

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Model Lab / Compare" subtitle="Multi-run comparison (up to 6)">
        <div className="flex flex-wrap items-center gap-2 text-xs">
          <input
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 md:w-[420px]"
            value={inputRuns}
            onChange={(e) => setInputRuns(e.target.value)}
            placeholder="run_id_1,run_id_2,run_id_3"
          />
          <button className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 text-terminal-accent" onClick={runCompare}>
            Compare
          </button>
          <Link className="rounded border border-terminal-border px-3 py-1" to="/backtesting/model-lab">Back to Model Lab</Link>
        </div>
        <div className="mt-2 text-[11px] text-terminal-muted">Need at least 2 run ids.</div>
      </TerminalPanel>

      {compareMutation.data && (
        <>
          <TerminalPanel title="Metric Comparison" subtitle="Pareto-highlighted table">
            <table className="min-w-full text-[11px]">
              <thead>
                <tr className="border-b border-terminal-border/40">
                  <th className="px-1 py-1 text-left">Run</th>
                  <th className="px-1 py-1 text-right">Return</th>
                  <th className="px-1 py-1 text-right">Sharpe</th>
                  <th className="px-1 py-1 text-right">Sortino</th>
                  <th className="px-1 py-1 text-right">MaxDD</th>
                  <th className="px-1 py-1 text-right">Turnover</th>
                  <th className="px-1 py-1 text-right">Pareto</th>
                </tr>
              </thead>
              <tbody>
                {compareMutation.data.summary.map((row) => (
                  <tr key={row.run_id} className={`border-t border-terminal-border/30 ${row.pareto ? "bg-terminal-accent/10" : ""}`}>
                    <td className="px-1 py-1">{row.run_id}</td>
                    <td className="px-1 py-1 text-right">{(row.total_return * 100).toFixed(2)}%</td>
                    <td className="px-1 py-1 text-right">{row.sharpe.toFixed(2)}</td>
                    <td className="px-1 py-1 text-right">{row.sortino.toFixed(2)}</td>
                    <td className="px-1 py-1 text-right">{(row.max_drawdown * 100).toFixed(2)}%</td>
                    <td className="px-1 py-1 text-right">{row.turnover.toFixed(4)}</td>
                    <td className="px-1 py-1 text-right">{row.pareto ? "Yes" : "No"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TerminalPanel>

          <div className="grid grid-cols-1 gap-3 xl:grid-cols-2">
            <TerminalPanel title="Stacked Equity Curves" subtitle="Run overlay">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={equityRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {runIds.map((runId) => (
                      <Line key={runId} type="monotone" dataKey={runId} strokeWidth={1.5} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Drawdown Curves" subtitle="Risk overlay">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={drawdownRows}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis dataKey="date" hide />
                    <YAxis />
                    <Tooltip />
                    <Legend />
                    {runIds.map((runId) => (
                      <Line key={`dd-${runId}`} type="monotone" dataKey={runId} strokeWidth={1.5} dot={false} />
                    ))}
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Return vs MaxDD" subtitle="Pareto emphasis">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name="Return" />
                    <YAxis type="number" dataKey="y" name="MaxDD" />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter data={scatterReturnDd.filter((row) => row.pareto)} fill="#facc15" name="Pareto" />
                    <Scatter data={scatterReturnDd.filter((row) => !row.pareto)} fill="#38bdf8" name="Other" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>

            <TerminalPanel title="Sharpe vs Turnover" subtitle="Efficiency map">
              <div className="h-72">
                <ResponsiveContainer width="100%" height="100%">
                  <ScatterChart>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" dataKey="x" name="Sharpe" />
                    <YAxis type="number" dataKey="y" name="Turnover" />
                    <Tooltip cursor={{ strokeDasharray: "3 3" }} />
                    <Scatter data={scatterSharpeTurnover.filter((row) => row.pareto)} fill="#facc15" name="Pareto" />
                    <Scatter data={scatterSharpeTurnover.filter((row) => !row.pareto)} fill="#34d399" name="Other" />
                  </ScatterChart>
                </ResponsiveContainer>
              </div>
            </TerminalPanel>
          </div>
        </>
      )}
    </div>
  );
}
