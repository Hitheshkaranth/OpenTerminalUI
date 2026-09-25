import { useMemo } from "react";
import { terminalColors } from "../../../theme/terminal";

export type RobustnessData = {
  permutation_test: {
    metric: string;
    observed: number;
    p_value: number;
    percentile: number;
    n_permutations: number;
    null_mean: number;
    null_std: number;
    distribution: number[];
    interpretation: string;
  };
  multi_window: {
    n_windows: number;
    windows: {
      index: number;
      start: string;
      end: string;
      total_return: number;
      cagr: number;
      sharpe: number;
      max_drawdown: number;
    }[];
    coverage: {
      profitable_pct: number;
      positive_sharpe_pct: number;
    };
    consistency_score: number;
    interpretation: string;
  };
};

export function RobustnessPanel(props: {
  data: RobustnessData | null | undefined;
  loading?: boolean;
}): JSX.Element {
  const { data, loading } = props;

  if (loading) {
    return (
      <div className="flex h-[56vh] min-h-[360px] items-center justify-center rounded border border-terminal-border/40 bg-terminal-bg/50 text-center">
        <div>
          <div className="animate-pulse text-3xl">🎲</div>
          <div className="mt-2 text-xs text-terminal-muted">Running permutation test...</div>
        </div>
      </div>
    );
  }

  if (!data || !data.permutation_test || data.permutation_test.n_permutations === 0) {
    return (
      <div className="flex h-[56vh] min-h-[360px] items-center justify-center rounded border border-terminal-border/40 bg-terminal-bg/50 text-center">
        <div>
          <div className="text-3xl">🛡️</div>
          <div className="mt-2 text-xs text-terminal-muted">Run a backtest to assess robustness</div>
        </div>
      </div>
    );
  }

  const { permutation_test, multi_window } = data;

  const pValueColor =
    permutation_test.p_value < 0.05
      ? "text-terminal-pos"
      : permutation_test.p_value < 0.1
      ? "text-terminal-warning"
      : "text-terminal-muted";

  const histogram = useMemo(() => {
    if (!permutation_test.distribution || permutation_test.distribution.length === 0) return null;
    const dist = permutation_test.distribution;
    const bins = 40;
    const min = Math.min(...dist, permutation_test.observed);
    const max = Math.max(...dist, permutation_test.observed);
    const range = max - min || 1;
    const binSize = range / bins;
    const counts = new Array(bins).fill(0);

    dist.forEach((val) => {
      const b = Math.min(bins - 1, Math.floor((val - min) / binSize));
      counts[b]++;
    });

    const maxCount = Math.max(...counts);
    const observedBin = Math.min(bins - 1, Math.floor((permutation_test.observed - min) / binSize));

    return { counts, maxCount, observedBin, min, max };
  }, [permutation_test.distribution, permutation_test.observed]);

  return (
    <div className="space-y-4 overflow-auto">
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* Permutation Test Card */}
        <div className="flex flex-col rounded border border-terminal-border/40 bg-terminal-bg/50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-terminal-accent">
              Permutation Test (p-value)
            </h3>
            <span className="text-[10px] text-terminal-muted">n={permutation_test.n_permutations}</span>
          </div>

          <div className="mb-4 flex items-baseline gap-3">
            <div className={`text-4xl font-mono font-bold ${pValueColor}`}>
              {permutation_test.p_value.toFixed(3)}
            </div>
            <div className="text-[11px] leading-tight text-terminal-text">
              {permutation_test.interpretation}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 mb-4 text-[11px]">
            <div className="rounded border border-terminal-border/30 bg-terminal-bg/30 p-2">
              <div className="text-terminal-muted uppercase text-[9px]">Observed {permutation_test.metric}</div>
              <div className="text-terminal-text font-mono">{permutation_test.observed.toFixed(4)}</div>
            </div>
            <div className="rounded border border-terminal-border/30 bg-terminal-bg/30 p-2">
              <div className="text-terminal-muted uppercase text-[9px]">Null Distribution</div>
              <div className="text-terminal-text font-mono">
                {permutation_test.null_mean.toFixed(3)} ± {permutation_test.null_std.toFixed(3)}
              </div>
            </div>
            <div className="rounded border border-terminal-border/30 bg-terminal-bg/30 p-2">
              <div className="text-terminal-muted uppercase text-[9px]">Percentile</div>
              <div className="text-terminal-text font-mono">{permutation_test.percentile.toFixed(1)}th</div>
            </div>
            <div className="rounded border border-terminal-border/30 bg-terminal-bg/30 p-2">
              <div className="text-terminal-muted uppercase text-[9px]">Metric</div>
              <div className="text-terminal-text">{permutation_test.metric}</div>
            </div>
          </div>

          {/* Histogram */}
          <div className="mt-auto">
            <div className="mb-1 flex justify-between text-[9px] uppercase text-terminal-muted">
              <span>Null Distribution</span>
              <span>Observed marked with |</span>
            </div>
            <div className="relative flex h-20 items-end gap-[1px]">
              {histogram &&
                histogram.counts.map((count, i) => {
                  const height = (count / histogram.maxCount) * 100;
                  const isObserved = i === histogram.observedBin;
                  return (
                    <div
                      key={i}
                      className="flex-1 transition-all"
                      style={{
                        height: `${Math.max(2, height)}%`,
                        backgroundColor: isObserved ? terminalColors.accent : terminalColors.border,
                        opacity: isObserved ? 1 : 0.4,
                      }}
                      title={`Bin ${i}: ${count} samples`}
                    />
                  );
                })}
              {/* Vertical marker for observed */}
              {histogram && (
                <div
                  className="absolute top-0 bottom-0 w-[2px] bg-terminal-accent shadow-[0_0_8px_rgba(0,212,170,0.6)]"
                  style={{
                    left: `${(histogram.observedBin / 40) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="mt-1 flex justify-between text-[9px] font-mono text-terminal-muted">
              <span>{histogram?.min.toFixed(2)}</span>
              <span className="text-terminal-accent">Obs: {permutation_test.observed.toFixed(3)}</span>
              <span>{histogram?.max.toFixed(2)}</span>
            </div>
          </div>
        </div>

        {/* Multi-Window Analysis Card */}
        <div className="flex flex-col rounded border border-terminal-border/40 bg-terminal-bg/50 p-3">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-xs font-bold uppercase tracking-wider text-terminal-accent">
              Multi-Window Stability
            </h3>
            <span className="text-[10px] text-terminal-muted">Score: {multi_window.consistency_score.toFixed(2)}</span>
          </div>

          <div className="mb-4 flex items-baseline gap-4">
            <div className="text-center">
              <div className={`text-2xl font-mono font-bold ${multi_window.coverage.profitable_pct > 70 ? 'text-terminal-pos' : 'text-terminal-warning'}`}>
                {multi_window.coverage.profitable_pct.toFixed(0)}%
              </div>
              <div className="text-[9px] uppercase text-terminal-muted">Profitable</div>
            </div>
            <div className="text-center">
              <div className={`text-2xl font-mono font-bold ${multi_window.coverage.positive_sharpe_pct > 70 ? 'text-terminal-pos' : 'text-terminal-warning'}`}>
                {multi_window.coverage.positive_sharpe_pct.toFixed(0)}%
              </div>
              <div className="text-[9px] uppercase text-terminal-muted">Pos. Sharpe</div>
            </div>
            <div className="ml-2 flex-1 text-[11px] leading-tight text-terminal-text">
              {multi_window.interpretation}
            </div>
          </div>

          <div className="min-h-0 flex-1 overflow-auto rounded border border-terminal-border/20">
            <table className="w-full text-left text-[10px] font-mono">
              <thead className="sticky top-0 bg-terminal-panel text-terminal-muted">
                <tr className="border-b border-terminal-border/40">
                  <th className="px-2 py-1 uppercase">Window</th>
                  <th className="px-2 py-1 text-right uppercase">Return</th>
                  <th className="px-2 py-1 text-right uppercase">Sharpe</th>
                  <th className="px-2 py-1 text-right uppercase">MaxDD</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-terminal-border/20">
                {multi_window.windows.map((win) => (
                  <tr key={win.index} className="hover:bg-terminal-border/10">
                    <td className="px-2 py-1 text-terminal-muted">
                      {win.start} → {win.end}
                    </td>
                    <td className={`px-2 py-1 text-right font-bold ${win.total_return >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                      {(win.total_return * 100).toFixed(1)}%
                    </td>
                    <td className={`px-2 py-1 text-right ${win.sharpe >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                      {win.sharpe.toFixed(2)}
                    </td>
                    <td className="px-2 py-1 text-right text-terminal-neg">
                      {(win.max_drawdown * 100).toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
