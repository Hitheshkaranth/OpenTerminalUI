import type { PortfolioCorrelationResponse } from "../../types";

function cellColor(v: number): string {
  const alpha = Math.min(0.85, Math.max(0.15, Math.abs(v)));
  if (v >= 0) return `rgba(0,193,118,${alpha})`;
  return `rgba(255,77,79,${alpha})`;
}

export function CorrelationHeatmap({ data }: { data: PortfolioCorrelationResponse | null }) {
  const symbols = data?.symbols ?? [];
  const flat = (data?.matrix ?? []).flat();
  if (!symbols.length || !flat.length) {
    return <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">No correlation data.</div>;
  }

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold text-terminal-accent">Correlation Matrix (Rolling)</div>
      <div className="overflow-auto">
        <div className="grid gap-1" style={{ gridTemplateColumns: `90px repeat(${symbols.length}, minmax(52px, 1fr))` }}>
          <div />
          {symbols.map((s) => (
            <div key={`h-${s}`} className="text-center text-[10px] text-terminal-muted">{s}</div>
          ))}
          {symbols.map((row) => (
            <div key={`row-${row}`} className="contents">
              <div key={`r-${row}`} className="pr-1 text-right text-[10px] text-terminal-muted">{row}</div>
              {symbols.map((col) => {
                const entry = flat.find((x) => x.x === col && x.y === row);
                const value = entry?.value ?? 0;
                return (
                  <div
                    key={`${row}-${col}`}
                    className="flex h-9 items-center justify-center rounded text-[10px] font-semibold text-black"
                    style={{ background: cellColor(value) }}
                    title={`${row}-${col}: ${value.toFixed(3)}`}
                  >
                    {value.toFixed(2)}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
