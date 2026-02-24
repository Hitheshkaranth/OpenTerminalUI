type ComparisonBarsProps = {
  data: Array<{ label: string; left: number; right: number }>;
};

export function ComparisonBars({ data }: ComparisonBarsProps) {
  return (
    <div className="space-y-1 text-xs">
      {data.map((row) => (
        <div key={row.label} className="grid grid-cols-[120px_1fr_1fr] items-center gap-2">
          <span className="text-terminal-muted">{row.label}</span>
          <div className="h-2 rounded bg-terminal-bg">
            <div className="h-2 rounded bg-terminal-accent" style={{ width: `${Math.min(100, row.left)}%` }} />
          </div>
          <div className="h-2 rounded bg-terminal-bg">
            <div className="h-2 rounded bg-terminal-pos" style={{ width: `${Math.min(100, row.right)}%` }} />
          </div>
        </div>
      ))}
    </div>
  );
}
