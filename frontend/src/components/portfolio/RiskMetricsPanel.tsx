import type { PortfolioRiskMetrics } from "../../types";

function fmt(v: number | null | undefined, d = 2): string {
  if (v == null || !Number.isFinite(v)) return "-";
  return Number(v).toFixed(d);
}

export function RiskMetricsPanel({ metrics }: { metrics: PortfolioRiskMetrics | null }) {
  const m = metrics;
  const cards = [
    { label: "Sharpe", value: m?.sharpe_ratio, pct: false },
    { label: "Sortino", value: m?.sortino_ratio, pct: false },
    { label: "Max Drawdown", value: m?.max_drawdown, pct: true },
    { label: "Beta", value: m?.beta, pct: false },
    { label: "Alpha (Jensen)", value: m?.alpha, pct: true },
    { label: "Information Ratio", value: m?.information_ratio, pct: false },
  ];

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold text-terminal-accent">Risk Metrics</div>
      <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
        {cards.map((row) => (
          <div key={row.label} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
            <div className="text-terminal-muted">{row.label}</div>
            <div className="font-semibold text-terminal-text">
              {row.pct ? `${fmt((row.value ?? 0) * 100)}%` : fmt(row.value)}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
