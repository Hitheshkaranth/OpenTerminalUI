import { useMemo, useState } from "react";

import { usePortfolioEarnings } from "../hooks/useStocks";

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function keyOf(y: number, m: number, d: number): string {
  return `${y}-${String(m + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

export function EarningsCalendar({ symbols }: { symbols: string[] }) {
  const [cursor, setCursor] = useState(() => monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState("");
  const { data = [], isLoading } = usePortfolioEarnings(symbols, 60);

  const byDate = useMemo(() => {
    const out: Record<string, typeof data> = {};
    for (const row of data) {
      const dt = new Date(`${row.earnings_date}T00:00:00Z`);
      if (!Number.isFinite(dt.getTime())) continue;
      const key = keyOf(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
      out[key] = out[key] || [];
      out[key].push(row);
    }
    return out;
  }, [data]);

  const cells = useMemo(() => {
    const y = cursor.getUTCFullYear();
    const m = cursor.getUTCMonth();
    const firstWeekday = new Date(Date.UTC(y, m, 1)).getUTCDay();
    const days = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    const list: Array<{ key: string; day: number | null }> = [];
    for (let i = 0; i < firstWeekday; i += 1) list.push({ key: `pad-${i}`, day: null });
    for (let d = 1; d <= days; d += 1) list.push({ key: keyOf(y, m, d), day: d });
    while (list.length % 7 !== 0) list.push({ key: `tail-${list.length}`, day: null });
    return list;
  }, [cursor]);

  const thisWeek = data.slice(0, 7);
  const selectedRows = selectedDate ? byDate[selectedDate] || [] : [];

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_280px]">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-terminal-accent">Earnings Calendar</div>
          <div className="flex gap-1">
            <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => setCursor((c) => addMonths(c, -1))}>Prev</button>
            <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => setCursor((c) => addMonths(c, 1))}>Next</button>
          </div>
        </div>
        <div className="mb-2 text-xs text-terminal-muted">{cursor.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
        <div className="grid grid-cols-7 gap-1 text-[11px] text-terminal-muted">{["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d}>{d}</div>)}</div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {cells.map((cell) => {
            if (cell.day == null) return <div key={cell.key} className="h-12" />;
            const rows = byDate[cell.key] || [];
            return (
              <button key={cell.key} onClick={() => setSelectedDate(cell.key)} className={`h-12 rounded border px-1 py-1 text-left ${selectedDate === cell.key ? "border-terminal-accent" : "border-terminal-border"}`}>
                <div className="text-[11px] text-terminal-text">{cell.day}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {rows.slice(0, 3).map((r) => (
                    <span key={`${cell.key}-${r.symbol}`} className="rounded bg-blue-500/30 px-1 text-[10px] text-blue-200">{r.symbol}</span>
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-sm font-semibold text-terminal-accent">This Week</div>
          {isLoading ? <div className="mt-2 text-xs text-terminal-muted">Loading earnings...</div> : null}
          {!isLoading && thisWeek.length === 0 ? <div className="mt-2 text-xs text-terminal-muted">No earnings in range.</div> : null}
          <div className="mt-2 space-y-2">
            {thisWeek.map((row) => (
              <div key={`${row.symbol}-${row.earnings_date}`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="font-semibold text-terminal-text">{row.symbol}</div>
                <div className="text-terminal-muted">{row.earnings_date} ({row.fiscal_quarter})</div>
                <div className="text-terminal-muted">Est EPS: {row.estimated_eps ?? "-"}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-sm font-semibold text-terminal-accent">Selected Date</div>
          {!selectedDate ? <div className="mt-2 text-xs text-terminal-muted">Select a date.</div> : null}
          {selectedDate && selectedRows.length === 0 ? <div className="mt-2 text-xs text-terminal-muted">No earnings for {selectedDate}.</div> : null}
          <div className="mt-2 space-y-2">
            {selectedRows.map((row) => (
              <div key={`${row.symbol}-${row.earnings_date}-sel`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="font-semibold text-terminal-text">{row.symbol}</div>
                <div className="text-terminal-muted">{row.fiscal_quarter} - {row.time.toUpperCase()}</div>
                <div className="text-terminal-muted">Est EPS: {row.estimated_eps ?? "-"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
