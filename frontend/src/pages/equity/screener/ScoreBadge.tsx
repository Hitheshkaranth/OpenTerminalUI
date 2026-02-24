type ScoreBadgeProps = {
  value?: number;
  max?: number;
  label?: string;
};

export function ScoreBadge({ value = 0, max = 100, label }: ScoreBadgeProps) {
  const pct = max > 0 ? (value / max) * 100 : value;
  const cls = pct >= 67 ? "border-terminal-pos text-terminal-pos bg-terminal-pos/10" : pct >= 34 ? "border-terminal-warn text-terminal-warn bg-terminal-warn/10" : "border-terminal-neg text-terminal-neg bg-terminal-neg/10";
  return <span className={`inline-flex items-center rounded-sm border px-2 py-0.5 text-[10px] uppercase tracking-wide ${cls}`}>{label ? `${label}:${value}` : value}</span>;
}
