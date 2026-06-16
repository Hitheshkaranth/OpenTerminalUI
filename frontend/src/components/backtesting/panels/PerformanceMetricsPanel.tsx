import { terminalColors } from "../../../theme/terminal";

export type PerformanceMetricsPanelProps = {
  metrics: Record<string, number> | null | undefined;
  scenarios: {
    annual_return_mean: number;
    annual_volatility: number;
    current_equity: number;
    scenarios: { label: string; return_pct: number; projected_equity: number }[];
  } | null | undefined;
  fmtMoney: (v: number) => string;
};

function emptyState(icon: string, text: string) {
  return (
    <div className="flex h-[56vh] min-h-[360px] items-center justify-center rounded border border-terminal-border/40 bg-terminal-bg/50 text-center">
      <div>
        <div className="text-3xl">{icon}</div>
        <div className="mt-2 text-xs text-terminal-muted">{text}</div>
      </div>
    </div>
  );
}

function MetricCard({
  label,
  value,
  formatter,
  colorOverride,
}: {
  label: string;
  value: number | undefined;
  formatter: (v: number) => string;
  colorOverride?: string;
}) {
  const displayValue = value !== undefined ? formatter(value) : "-";
  const color = colorOverride || (value !== undefined && value > 0 ? "text-terminal-pos" : value !== undefined && value < 0 ? "text-terminal-neg" : "text-terminal-text");

  return (
    <div className="rounded border border-terminal-border/40 bg-terminal-bg/30 p-2">
      <div className="text-[10px] uppercase tracking-wider text-terminal-muted">{label}</div>
      <div className={`mt-1 text-sm font-semibold ${color}`}>{displayValue}</div>
    </div>
  );
}

const fmtPct = (v: number) => `${(v * 100).toFixed(2)}%`;
const fmtPctPlain = (v: number) => `${v.toFixed(2)}%`;
const fmt2dp = (v: number) => v.toFixed(2);

export function PerformanceMetricsPanel({ metrics, scenarios, fmtMoney }: PerformanceMetricsPanelProps): JSX.Element {
  if (!metrics || metrics.n_obs === 0) {
    return emptyState("*", "Run a backtest to see performance metrics");
  }

  const sections = [
    {
      title: "Returns",
      items: [
        { label: "Total Return", key: "total_return", fmt: fmtPct },
        { label: "CAGR", key: "cagr", fmt: fmtPct },
        { label: "Best Month", key: "best_month", fmt: fmtPctPlain },
        { label: "Worst Month", key: "worst_month", fmt: fmtPctPlain },
        { label: "Positive Months %", key: "positive_months_pct", fmt: fmtPctPlain, color: "text-terminal-text" },
        { label: "Avg Month", key: "avg_month", fmt: fmtPctPlain },
      ],
    },
    {
      title: "Risk",
      items: [
        { label: "Max Drawdown", key: "max_drawdown", fmt: fmtPct, color: "text-terminal-neg" },
        { label: "Volatility", key: "volatility", fmt: fmtPct, color: "text-terminal-warning" },
        { label: "Downside Dev", key: "downside_deviation", fmt: fmtPct, color: "text-terminal-warning" },
        { label: "Ulcer Index", key: "ulcer_index", fmt: fmt2dp, color: "text-terminal-text" },
        { label: "VaR 95% (Daily)", key: "var_95", fmt: fmtPct, color: "text-terminal-neg" },
        { label: "CVaR 95% (Daily)", key: "cvar_95", fmt: fmtPct, color: "text-terminal-neg" },
      ],
    },
    {
      title: "Ratios",
      items: [
        { label: "Sharpe", key: "sharpe", fmt: fmt2dp },
        { label: "Sortino", key: "sortino", fmt: fmt2dp },
        { label: "Calmar", key: "calmar", fmt: fmt2dp },
        { label: "Omega Ratio", key: "omega_ratio", fmt: fmt2dp },
        { label: "Tail Ratio", key: "tail_ratio", fmt: fmt2dp },
        { label: "Recovery Factor", key: "recovery_factor", fmt: fmt2dp },
      ],
    },
    {
      title: "Distribution",
      items: [
        { label: "Skew", key: "skew", fmt: fmt2dp, color: "text-terminal-text" },
        { label: "Kurtosis", key: "kurtosis", fmt: fmt2dp, color: "text-terminal-text" },
        { label: "Best Day", key: "best_day", fmt: fmtPctPlain },
        { label: "Worst Day", key: "worst_day", fmt: fmtPctPlain },
        { label: "Avg Up Day", key: "avg_up_day", fmt: fmtPctPlain },
        { label: "Avg Down Day", key: "avg_down_day", fmt: fmtPctPlain },
        { label: "Win Rate (Days)", key: "win_rate_days", fmt: fmtPctPlain, color: "text-terminal-text" },
      ],
    },
  ];

  return (
    <div className="space-y-6">
      <div className="grid grid-cols-1 gap-6 md:grid-cols-2 lg:grid-cols-4">
        {sections.map((section) => (
          <div key={section.title} className="space-y-2">
            <h3 className="text-xs font-bold uppercase tracking-widest text-terminal-accent">{section.title}</h3>
            <div className="grid grid-cols-2 gap-2">
              {section.items.map((item) => (
                <MetricCard
                  key={item.key}
                  label={item.label}
                  value={metrics[item.key]}
                  formatter={item.fmt}
                  colorOverride={item.color}
                />
              ))}
            </div>
          </div>
        ))}
      </div>

      {scenarios && scenarios.scenarios.length > 0 && (
        <div className="rounded border border-terminal-border/40 bg-terminal-bg/50 p-4">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-bold uppercase tracking-widest text-terminal-accent">Scenario Projections</h3>
            <div className="text-xs text-terminal-muted">
              Mean: <span className="text-terminal-text">{scenarios.annual_return_mean.toFixed(2)}%</span> ± <span className="text-terminal-text">{scenarios.annual_volatility.toFixed(2)}%</span>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
            {scenarios.scenarios.map((s) => {
              const isAverage = s.label.toLowerCase() === "average";
              return (
                <div
                  key={s.label}
                  className={`rounded border p-3 ${
                    isAverage
                      ? "border-terminal-accent bg-terminal-accent/10"
                      : "border-terminal-border/40 bg-terminal-bg/30"
                  }`}
                >
                  <div className={`text-[10px] uppercase tracking-wider ${isAverage ? "text-terminal-accent" : "text-terminal-muted"}`}>
                    {s.label}
                  </div>
                  <div className="mt-1 flex items-baseline justify-between">
                    <span className={`text-lg font-bold ${s.return_pct >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>
                      {s.return_pct >= 0 ? "+" : ""}{s.return_pct.toFixed(2)}%
                    </span>
                  </div>
                  <div className="mt-1 text-xs font-mono text-terminal-text">
                    {fmtMoney(s.projected_equity)}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
