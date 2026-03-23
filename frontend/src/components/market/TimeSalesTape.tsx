import { useEffect, useMemo, useRef, useState } from "react";

export type TimeSalesRow = {
  id: string;
  price: number;
  size: number;
  side: "buy" | "sell";
  ts: string;
};

type Props = {
  rows: TimeSalesRow[];
  compact?: boolean;
};

function formatTradeTime(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return raw;
  return parsed.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function TimeSalesTape({ rows, compact = false }: Props) {
  const [paused, setPaused] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const displayRows = useMemo(() => [...rows].reverse(), [rows]);

  useEffect(() => {
    if (paused) return;
    const node = containerRef.current;
    if (!node) return;
    node.scrollTop = node.scrollHeight;
  }, [displayRows, paused]);

  if (!rows.length) {
    return (
      <div className="flex h-full min-h-[220px] items-center justify-center rounded border border-terminal-border bg-terminal-bg text-[11px] text-terminal-muted">
        No tape yet
      </div>
    );
  }

  return (
    <div ref={containerRef} className="h-full min-h-[220px] overflow-auto rounded border border-terminal-border bg-terminal-bg">
      <div className="sticky top-0 grid grid-cols-[1fr_auto_auto_auto] gap-2 border-b border-terminal-border bg-terminal-panel px-3 py-2 text-[10px] uppercase tracking-[0.14em] text-terminal-muted">
        <span>Time</span>
        <span className="text-right">Price</span>
        <span className="text-right">Size</span>
        <button
          type="button"
          className={`justify-self-end rounded border px-2 py-0.5 text-[9px] tracking-[0.12em] ${
            paused
              ? "border-terminal-warn text-terminal-warn"
              : "border-terminal-border text-terminal-muted hover:text-terminal-text"
          }`}
          onClick={() => setPaused((value) => !value)}
        >
          {paused ? "Resume" : "Pause"}
        </button>
      </div>
      <div className="divide-y divide-terminal-border/60">
        {displayRows.map((row) => (
          <div
            key={row.id}
            className={`grid grid-cols-[1fr_auto_auto_auto] gap-2 px-3 py-2 ${compact ? "text-[10px]" : "text-[11px]"} ${row.side === "buy" ? "bg-emerald-500/4" : "bg-rose-500/4"}`}
          >
            <span className="text-terminal-muted">{formatTradeTime(row.ts)}</span>
            <span className={`text-right font-medium ${row.side === "buy" ? "text-terminal-pos" : "text-terminal-neg"}`}>
              {row.price.toFixed(row.price >= 1000 ? 1 : 2)}
            </span>
            <span className="text-right font-mono text-terminal-text">
              {row.size.toLocaleString("en-US", { maximumFractionDigits: 0 })}
            </span>
            <span className={`text-right text-[10px] uppercase tracking-[0.12em] ${row.side === "buy" ? "text-terminal-pos" : "text-terminal-neg"}`}>
              {row.side}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
