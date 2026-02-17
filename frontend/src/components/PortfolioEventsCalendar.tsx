import { useMemo, useState } from "react";

import { usePortfolioEvents } from "../hooks/useStocks";
import type { CorporateEvent } from "../types";

const DOT: Record<string, string> = {
  dividend: "bg-emerald-400",
  bonus: "bg-cyan-400",
  split: "bg-cyan-400",
  board_meeting: "bg-amber-400",
  agm: "bg-amber-400",
  earnings: "bg-blue-400",
  buyback: "bg-violet-400",
  delisting: "bg-red-400",
};

function monthStart(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function dateKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}-${String(d.getUTCDate()).padStart(2, "0")}`;
}

function parseKey(raw: string): string {
  const dt = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime())) return raw;
  return dateKey(dt);
}

export function PortfolioEventsCalendar({ symbols, days = 30 }: { symbols: string[]; days?: number }) {
  const [cursor, setCursor] = useState(() => monthStart(new Date()));
  const [selectedDate, setSelectedDate] = useState<string>("");
  const { data = [], isLoading } = usePortfolioEvents(symbols, days);

  const byDate = useMemo(() => {
    const out: Record<string, CorporateEvent[]> = {};
    for (const evt of data) {
      const key = parseKey(evt.event_date);
      out[key] = out[key] || [];
      out[key].push(evt);
    }
    return out;
  }, [data]);

  const monthDays = useMemo(() => {
    const start = monthStart(cursor);
    const firstWeekDay = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1)).getUTCDay();
    const daysInMonth = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 0)).getUTCDate();
    const cells: Array<{ key: string; day: number | null }> = [];
    for (let i = 0; i < firstWeekDay; i += 1) cells.push({ key: `pad-${i}`, day: null });
    for (let d = 1; d <= daysInMonth; d += 1) {
      const key = dateKey(new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), d)));
      cells.push({ key, day: d });
    }
    while (cells.length % 7 !== 0) cells.push({ key: `tail-${cells.length}`, day: null });
    return cells;
  }, [cursor]);

  const selectedEvents = selectedDate ? byDate[selectedDate] || [] : [];
  const nextRows = data.slice(0, 10);

  return (
    <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1fr_280px]">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-terminal-accent">Portfolio Events Calendar</div>
          <div className="flex gap-1">
            <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => setCursor((c) => addMonths(c, -1))}>Prev</button>
            <button className="rounded border border-terminal-border px-2 py-1 text-xs text-terminal-muted" onClick={() => setCursor((c) => addMonths(c, 1))}>Next</button>
          </div>
        </div>
        <div className="mb-2 text-xs text-terminal-muted">{cursor.toLocaleDateString("en-US", { month: "long", year: "numeric", timeZone: "UTC" })}</div>
        <div className="grid grid-cols-7 gap-1 text-[11px] text-terminal-muted">
          {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => <div key={d} className="px-1">{d}</div>)}
        </div>
        <div className="mt-1 grid grid-cols-7 gap-1">
          {monthDays.map((cell) => {
            if (cell.day == null) return <div key={cell.key} className="h-12 rounded border border-transparent" />;
            const rows = byDate[cell.key] || [];
            return (
              <button
                key={cell.key}
                className={`h-12 rounded border px-1 py-1 text-left ${selectedDate === cell.key ? "border-terminal-accent" : "border-terminal-border"}`}
                onClick={() => setSelectedDate(cell.key)}
              >
                <div className="text-[11px] text-terminal-text">{cell.day}</div>
                <div className="mt-1 flex flex-wrap gap-1">
                  {rows.slice(0, 3).map((evt, idx) => (
                    <span key={`${cell.key}-${idx}`} className={`h-1.5 w-1.5 rounded-full ${DOT[evt.event_type] || "bg-terminal-accent"}`} />
                  ))}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      <div className="space-y-3">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-sm font-semibold text-terminal-accent">Next {days} Days</div>
          {isLoading ? <div className="mt-2 text-xs text-terminal-muted">Loading events...</div> : null}
          {!isLoading && nextRows.length === 0 ? <div className="mt-2 text-xs text-terminal-muted">No upcoming events.</div> : null}
          <div className="mt-2 space-y-2">
            {nextRows.map((evt) => (
              <div key={`${evt.symbol}-${evt.event_type}-${evt.event_date}-${evt.title}`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="font-semibold text-terminal-text">{evt.symbol}</div>
                <div className="text-terminal-muted">{evt.title}</div>
                <div className="text-terminal-muted">{evt.event_date}</div>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-sm font-semibold text-terminal-accent">Selected Date</div>
          {!selectedDate ? <div className="mt-2 text-xs text-terminal-muted">Select a date to view events.</div> : null}
          {selectedDate && selectedEvents.length === 0 ? <div className="mt-2 text-xs text-terminal-muted">No events on {selectedDate}.</div> : null}
          <div className="mt-2 space-y-2">
            {selectedEvents.map((evt) => (
              <div key={`${evt.symbol}-${evt.event_type}-${evt.event_date}-${evt.title}`} className="rounded border border-terminal-border bg-terminal-bg p-2 text-xs">
                <div className="font-semibold text-terminal-text">{evt.symbol} - {evt.event_type.replace(/_/g, " ")}</div>
                <div className="text-terminal-muted">{evt.title}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
