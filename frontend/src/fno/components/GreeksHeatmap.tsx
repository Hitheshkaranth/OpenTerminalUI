import type { StrikeData } from "../types/fno";

type Props = {
  rows: StrikeData[];
  side: "CE" | "PE";
};

function cellTone(value: number): string {
  const abs = Math.min(Math.abs(value), 1);
  const alpha = (0.08 + abs * 0.35).toFixed(2);
  return value >= 0 ? `rgba(0,193,118,${alpha})` : `rgba(255,77,79,${alpha})`;
}

export function GreeksHeatmap({ rows, side }: Props) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-0">
      <div className="max-h-[420px] overflow-auto">
        <table className="min-w-full text-xs">
          <thead className="sticky top-0 bg-terminal-panel">
            <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wide text-terminal-muted">
              <th className="px-2 py-2 text-left">Strike</th>
              <th className="px-2 py-2 text-right">Delta</th>
              <th className="px-2 py-2 text-right">Gamma</th>
              <th className="px-2 py-2 text-right">Theta</th>
              <th className="px-2 py-2 text-right">Vega</th>
              <th className="px-2 py-2 text-right">Rho</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const g = (side === "CE" ? row.ce?.greeks : row.pe?.greeks) || { delta: 0, gamma: 0, theta: 0, vega: 0, rho: 0 };
              return (
                <tr key={`${side}-${row.strike_price}`} className="border-b border-terminal-border/30">
                  <td className="px-2 py-1 font-semibold">{Number(row.strike_price).toFixed(0)}</td>
                  <td className="px-2 py-1 text-right" style={{ backgroundColor: cellTone(g.delta) }}>{g.delta.toFixed(4)}</td>
                  <td className="px-2 py-1 text-right" style={{ backgroundColor: cellTone(g.gamma) }}>{g.gamma.toFixed(4)}</td>
                  <td className="px-2 py-1 text-right" style={{ backgroundColor: cellTone(g.theta / 20) }}>{g.theta.toFixed(4)}</td>
                  <td className="px-2 py-1 text-right" style={{ backgroundColor: cellTone(g.vega / 20) }}>{g.vega.toFixed(4)}</td>
                  <td className="px-2 py-1 text-right" style={{ backgroundColor: cellTone(g.rho / 10) }}>{g.rho.toFixed(4)}</td>
                </tr>
              );
            })}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-2 py-3 text-center text-terminal-muted">No greek rows</td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
