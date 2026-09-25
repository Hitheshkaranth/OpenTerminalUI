import { useState, useMemo } from "react";
import { terminalColors } from "../../../theme/terminal";

type SweepResult = {
  params: Record<string, number>;
  sharpe: number;
  total_return: number;
  max_drawdown: number;
  cagr: number;
  win_rate: number;
  calmar: number;
  volatility: number;
};

type SweepData = {
  sweep: {
    strategy: string;
    sort_by: string;
    n_combos: number;
    warning: string | null;
    best: SweepResult | null;
    results: SweepResult[];
    heatmap: {
      x_param: string;
      y_param: string;
      x_values: number[];
      y_values: number[];
      z: number[][];
      metric: string;
    } | null;
  };
};

export function SweepPanel(props: { symbol: string; market: string }): JSX.Element {
  const { symbol, market } = props;

  const [strategy, setStrategy] = useState("sma_crossover");
  const [sortBy, setSortBy] = useState("sharpe");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [data, setData] = useState<SweepData | null>(null);

  // Parameter inputs
  const [fastValues, setFastValues] = useState("5,10,20,50");
  const [slowValues, setSlowValues] = useState("50,100,200");
  const [periodValues, setPeriodValues] = useState("10,14,20");
  const [oversoldValues, setOversoldValues] = useState("20,30,40");
  const [overboughtValues, setOverboughtValues] = useState("60,70,80");

  const parseList = (str: string) =>
    str
      .split(",")
      .map((v) => v.trim())
      .filter((v) => v !== "" && !isNaN(Number(v)))
      .map(Number);

  const runSweep = async () => {
    setLoading(true);
    setError(null);
    try {
      const paramGrid: Record<string, number[]> = {};
      if (strategy === "sma_crossover" || strategy === "ema_crossover") {
        paramGrid.fast = parseList(fastValues);
        paramGrid.slow = parseList(slowValues);
      } else if (strategy === "rsi_threshold") {
        paramGrid.period = parseList(periodValues);
        paramGrid.oversold = parseList(oversoldValues);
        paramGrid.overbought = parseList(overboughtValues);
      }

      const response = await fetch("/api/backtests/vectorized-sweep", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          symbol,
          market,
          strategy,
          param_grid: paramGrid,
          sort_by: sortBy,
          top_n: 100,
        }),
      });

      if (!response.ok) {
        throw new Error(`Error: ${response.statusText}`);
      }

      const result = await response.json();
      setData(result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sweep failed");
    } finally {
      setLoading(false);
    }
  };

  const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;

  const Heatmap = () => {
    if (!data?.sweep.heatmap) return null;
    const { heatmap } = data.sweep;
    const { x_param, y_param, x_values, y_values, z } = heatmap;

    // Find min/max for color scaling
    let min = Infinity;
    let max = -Infinity;
    z.forEach((row) =>
      row.forEach((val) => {
        if (val < min) min = val;
        if (val > max) max = val;
      })
    );

    const getBgColor = (val: number) => {
      if (max === min) return "rgba(0, 212, 170, 0.5)";
      const ratio = (val - min) / (max - min);
      // Interpolate between red (negative) and green (positive)
      // For simplicity, let's use a scale from red (low) to green (high)
      const r = Math.floor(255 * (1 - ratio));
      const g = Math.floor(212 * ratio);
      const b = Math.floor(170 * ratio);
      return `rgba(${r}, ${g}, ${b}, 0.8)`;
    };

    return (
      <div className="mt-4 rounded border border-terminal-border/40 bg-terminal-bg/30 p-3">
        <h3 className="mb-3 text-xs font-bold uppercase tracking-wider text-terminal-accent">
          Parameter Heatmap: {heatmap.metric} ({x_param} vs {y_param})
        </h3>
        <div className="overflow-auto">
          <div
            className="grid gap-1"
            style={{
              gridTemplateColumns: `auto repeat(${x_values.length}, minmax(40px, 1fr))`,
            }}
          >
            {/* Header row */}
            <div className="flex items-center justify-center text-[10px] font-bold text-terminal-muted italic">
              {y_param}\{x_param}
            </div>
            {x_values.map((x) => (
              <div key={x} className="flex items-center justify-center text-[10px] font-bold text-terminal-muted">
                {x}
              </div>
            ))}

            {/* Rows */}
            {y_values.map((y, yIdx) => (
              <>
                <div key={`y-${y}`} className="flex items-center justify-center text-[10px] font-bold text-terminal-muted">
                  {y}
                </div>
                {x_values.map((x, xIdx) => {
                  const val = z[yIdx][xIdx];
                  const isBest =
                    data.sweep.best &&
                    Number(data.sweep.best.params[x_param]) === x &&
                    Number(data.sweep.best.params[y_param]) === y;

                  return (
                    <div
                      key={`${x}-${y}`}
                      className={`flex h-10 items-center justify-center text-[10px] font-mono font-bold text-white shadow-inner transition-transform hover:scale-105 ${
                        isBest ? "ring-2 ring-terminal-accent ring-inset" : ""
                      }`}
                      style={{ backgroundColor: getBgColor(val) }}
                      title={`${x_param}=${x}, ${y_param}=${y}: ${val.toFixed(4)}`}
                    >
                      {val.toFixed(2)}
                    </div>
                  );
                })}
              </>
            ))}
          </div>
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      {/* Controls */}
      <div className="grid grid-cols-1 gap-3 rounded border border-terminal-border/40 bg-terminal-bg/50 p-3 md:grid-cols-4">
        <div className="space-y-1">
          <label className="text-[10px] font-bold uppercase text-terminal-muted">Strategy</label>
          <select
            className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
            value={strategy}
            onChange={(e) => setStrategy(e.target.value)}
          >
            <option value="sma_crossover">SMA Crossover</option>
            <option value="ema_crossover">EMA Crossover</option>
            <option value="rsi_threshold">RSI Threshold</option>
          </select>
        </div>

        {(strategy === "sma_crossover" || strategy === "ema_crossover") && (
          <>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-terminal-muted">Fast values</label>
              <input
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={fastValues}
                onChange={(e) => setFastValues(e.target.value)}
                placeholder="e.g. 5,10,20"
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-terminal-muted">Slow values</label>
              <input
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={slowValues}
                onChange={(e) => setSlowValues(e.target.value)}
                placeholder="e.g. 50,100,200"
              />
            </div>
          </>
        )}

        {strategy === "rsi_threshold" && (
          <>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-terminal-muted">Period values</label>
              <input
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                value={periodValues}
                onChange={(e) => setPeriodValues(e.target.value)}
              />
            </div>
            <div className="space-y-1">
              <label className="text-[10px] font-bold uppercase text-terminal-muted">Oversold / Overbought</label>
              <div className="flex gap-2">
                <input
                  className="w-1/2 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                  value={oversoldValues}
                  onChange={(e) => setOversoldValues(e.target.value)}
                />
                <input
                  className="w-1/2 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
                  value={overboughtValues}
                  onChange={(e) => setOverboughtValues(e.target.value)}
                />
              </div>
            </div>
          </>
        )}

        <div className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <label className="text-[10px] font-bold uppercase text-terminal-muted">Sort By</label>
            <select
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
              value={sortBy}
              onChange={(e) => setSortBy(e.target.value)}
            >
              <option value="sharpe">Sharpe</option>
              <option value="total_return">Total Return</option>
              <option value="calmar">Calmar</option>
              <option value="cagr">CAGR</option>
            </select>
          </div>
          <button
            className="rounded border border-terminal-accent bg-terminal-accent/10 px-4 py-1 text-xs font-bold uppercase text-terminal-accent hover:bg-terminal-accent/20 disabled:opacity-50"
            onClick={runSweep}
            disabled={loading}
          >
            {loading ? "Running..." : "Run Sweep"}
          </button>
        </div>
      </div>

      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}

      {!data && !loading && (
        <div className="flex h-[40vh] items-center justify-center rounded border border-terminal-border/20 bg-terminal-bg/20">
          <div className="text-center">
            <div className="text-4xl">🚀</div>
            <div className="mt-2 text-xs text-terminal-muted">Configure params and run sweep</div>
          </div>
        </div>
      )}

      {loading && (
        <div className="flex h-[40vh] items-center justify-center rounded border border-terminal-border/20 bg-terminal-bg/20">
          <div className="animate-pulse text-center">
            <div className="text-4xl">⚡</div>
            <div className="mt-2 text-xs text-terminal-muted">Crunching {strategy} combinations...</div>
          </div>
        </div>
      )}

      {data && (
        <div className="space-y-4">
          {/* Best result card */}
          {data.sweep.best && (
            <div className="rounded border border-terminal-pos/40 bg-terminal-pos/5 p-3">
              <div className="mb-2 text-xs font-bold uppercase text-terminal-pos">Optimal Configuration</div>
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <div>
                  <div className="text-[10px] uppercase text-terminal-muted">Parameters</div>
                  <div className="text-sm font-mono text-terminal-text">
                    {Object.entries(data.sweep.best.params)
                      .map(([k, v]) => `${k}:${v}`)
                      .join(", ")}
                  </div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-terminal-muted">Sharpe</div>
                  <div className="text-xl font-bold text-terminal-pos">{data.sweep.best.sharpe.toFixed(2)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-terminal-muted">Total Return</div>
                  <div className="text-xl font-bold text-terminal-pos">{fmtPct(data.sweep.best.total_return)}</div>
                </div>
                <div>
                  <div className="text-[10px] uppercase text-terminal-muted">Max Drawdown</div>
                  <div className="text-xl font-bold text-terminal-neg">{fmtPct(data.sweep.best.max_drawdown)}</div>
                </div>
              </div>
            </div>
          )}

          {data.sweep.warning && (
            <div className="rounded border border-terminal-warning/40 bg-terminal-warning/10 p-2 text-[10px] text-terminal-warning">
              ⚠️ {data.sweep.warning}
            </div>
          )}

          <Heatmap />

          {/* Results Table */}
          <div className="rounded border border-terminal-border/40 bg-terminal-bg/50 overflow-hidden">
            <div className="border-b border-terminal-border/40 bg-terminal-panel px-3 py-1 flex justify-between items-center">
              <span className="text-[10px] font-bold uppercase text-terminal-muted">Full Results ({data.sweep.n_combos} combos)</span>
            </div>
            <div className="max-h-[400px] overflow-auto">
              <table className="w-full text-left text-[11px]">
                <thead className="sticky top-0 bg-terminal-panel text-terminal-muted">
                  <tr className="border-b border-terminal-border/40">
                    <th className="px-3 py-2 uppercase">Params</th>
                    <th className="px-3 py-2 text-right uppercase">Sharpe</th>
                    <th className="px-3 py-2 text-right uppercase">Ret%</th>
                    <th className="px-3 py-2 text-right uppercase">CAGR%</th>
                    <th className="px-3 py-2 text-right uppercase">DD%</th>
                    <th className="px-3 py-2 text-right uppercase">Win%</th>
                    <th className="px-3 py-2 text-right uppercase">Calmar</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-terminal-border/10">
                  {data.sweep.results.map((res, i) => (
                    <tr key={i} className="hover:bg-terminal-border/5">
                      <td className="px-3 py-2 font-mono text-terminal-muted">
                        {Object.entries(res.params)
                          .map(([k, v]) => `${k[0]}:${v}`)
                          .join(", ")}
                      </td>
                      <td className={`px-3 py-2 text-right font-bold ${res.sharpe > 1 ? "text-terminal-pos" : "text-terminal-text"}`}>
                        {res.sharpe.toFixed(2)}
                      </td>
                      <td className={`px-3 py-2 text-right ${res.total_return >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                        {fmtPct(res.total_return)}
                      </td>
                      <td className="px-3 py-2 text-right text-terminal-text">{fmtPct(res.cagr)}</td>
                      <td className="px-3 py-2 text-right text-terminal-neg">{fmtPct(res.max_drawdown)}</td>
                      <td className="px-3 py-2 text-right text-terminal-text">{res.win_rate.toFixed(1)}%</td>
                      <td className="px-3 py-2 text-right text-terminal-text">{res.calmar.toFixed(2)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
