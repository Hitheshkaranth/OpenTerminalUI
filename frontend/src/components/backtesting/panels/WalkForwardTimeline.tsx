import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

type WalkForwardWindow = {
  window: string;
  train_start: string;
  train_end: string;
  test_start: string;
  test_end: string;
  sharpe: number;
  total_return: number;
  max_drawdown: number;
};

type Props = {
  windows: WalkForwardWindow[];
};

export function WalkForwardTimeline({ windows }: Props) {
  if (!windows.length) {
    return (
      <div className="rounded border border-terminal-border/40 bg-terminal-bg/40 p-3 text-xs text-terminal-muted">
        No walk-forward windows available.
      </div>
    );
  }

  return (
    <div className="space-y-2">
      <div className="h-64 w-full rounded border border-terminal-border/40 bg-terminal-bg/40 p-2">
        <ResponsiveContainer>
          <LineChart data={windows} margin={{ top: 10, right: 14, left: 0, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#2a2f3a" />
            <XAxis dataKey="window" tick={{ fill: "#8e98a8", fontSize: 10 }} />
            <YAxis tick={{ fill: "#8e98a8", fontSize: 10 }} />
            <Tooltip
              contentStyle={{ background: "#0c0f14", border: "1px solid #2a2f3a", fontSize: 12 }}
              formatter={(v, name) => {
                const num = typeof v === "number" ? v : Number(v);
                if (!Number.isFinite(num)) return ["-", String(name)];
                if (name === "total_return" || name === "max_drawdown") {
                  return [`${(num * 100).toFixed(2)}%`, String(name)];
                }
                return [num.toFixed(3), String(name)];
              }}
            />
            <Line type="monotone" dataKey="sharpe" stroke="#38bdf8" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="total_return" stroke="#22c55e" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="max_drawdown" stroke="#ef4444" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <div className="max-h-56 overflow-auto rounded border border-terminal-border/40">
        <table className="min-w-full text-[11px]">
          <thead className="sticky top-0 bg-terminal-panel text-terminal-muted">
            <tr>
              <th className="px-2 py-1 text-left">Window</th>
              <th className="px-2 py-1 text-left">Train</th>
              <th className="px-2 py-1 text-left">Test</th>
              <th className="px-2 py-1 text-right">Sharpe</th>
              <th className="px-2 py-1 text-right">Return</th>
              <th className="px-2 py-1 text-right">Max DD</th>
            </tr>
          </thead>
          <tbody>
            {windows.map((w) => (
              <tr key={w.window} className="border-t border-terminal-border/30">
                <td className="px-2 py-1">{w.window}</td>
                <td className="px-2 py-1">
                  {w.train_start}
                  {" -> "}
                  {w.train_end}
                </td>
                <td className="px-2 py-1">
                  {w.test_start}
                  {" -> "}
                  {w.test_end}
                </td>
                <td className="px-2 py-1 text-right">{w.sharpe.toFixed(2)}</td>
                <td className="px-2 py-1 text-right">{(w.total_return * 100).toFixed(2)}%</td>
                <td className="px-2 py-1 text-right">{(w.max_drawdown * 100).toFixed(2)}%</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
