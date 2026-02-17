import { useMemo, useState } from "react";

import type { CorporateEvent } from "../types";
import { useStockEvents, useUpcomingEvents } from "../hooks/useStocks";

const TYPE_CLASS: Record<string, string> = {
  dividend: "border-emerald-500/40 text-emerald-300",
  bonus: "border-cyan-500/40 text-cyan-300",
  split: "border-cyan-500/40 text-cyan-300",
  rights: "border-cyan-500/40 text-cyan-300",
  board_meeting: "border-amber-500/40 text-amber-300",
  agm: "border-amber-500/40 text-amber-300",
  egm: "border-amber-500/40 text-amber-300",
  earnings: "border-blue-500/40 text-blue-300",
  buyback: "border-violet-500/40 text-violet-300",
  delisting: "border-red-500/40 text-red-300",
};

const FILTERS: Array<{ id: string; label: string; types?: string[] }> = [
  { id: "all", label: "All" },
  { id: "dividends", label: "Dividends", types: ["dividend", "bonus", "split", "rights"] },
  { id: "corporate", label: "Corporate", types: ["board_meeting", "agm", "egm", "buyback", "ipo", "merger"] },
  { id: "earnings", label: "Earnings", types: ["earnings"] },
  { id: "deals", label: "Deals", types: ["bulk_deal", "block_deal", "insider_trade"] },
];

function toDateLabel(raw: string): string {
  const dt = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime())) return raw;
  return dt.toLocaleDateString("en-US", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
}

function countdown(raw: string): string {
  const dt = new Date(`${raw}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime())) return "";
  const now = new Date();
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  const diff = Math.round((d - n) / (1000 * 60 * 60 * 24));
  if (diff === 0) return "today";
  if (diff === 1) return "tomorrow";
  if (diff > 1) return `in ${diff} days`;
  return "";
}

function EventCard({ evt }: { evt: CorporateEvent }) {
  const tone = TYPE_CLASS[evt.event_type] || "border-terminal-border text-terminal-accent";
  return (
    <div className="rounded border border-terminal-border bg-terminal-bg p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-xs text-terminal-muted">{toDateLabel(evt.event_date)}</div>
        <span className={`rounded border px-2 py-0.5 text-[10px] uppercase tracking-wide ${tone}`}>{evt.event_type.replace(/_/g, " ")}</span>
      </div>
      <div className="mt-1 text-sm font-semibold text-terminal-text">{evt.title}</div>
      <div className="mt-1 text-xs text-terminal-muted">{evt.description}</div>
      {evt.value && <div className="mt-2 text-xs text-terminal-accent">{evt.value}</div>}
    </div>
  );
}

export function EventsTimeline({ symbol }: { symbol: string }) {
  const [filter, setFilter] = useState("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [showPast, setShowPast] = useState(false);

  const filterTypes = FILTERS.find((x) => x.id === filter)?.types;
  const typeQuery = filterTypes?.join(",");

  const { data: upcoming = [], isLoading: upcomingLoading } = useUpcomingEvents(symbol, 90);
  const { data: events = [], isLoading } = useStockEvents(symbol, {
    types: typeQuery,
    from_date: fromDate || undefined,
    to_date: toDate || undefined,
  });

  const { upcomingFiltered, pastFiltered } = useMemo(() => {
    const all = filterTypes?.length ? events.filter((x) => filterTypes.includes(x.event_type)) : events;
    const today = new Date();
    const todayKey = Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate());
    const upcomingRows = upcoming
      .filter((x) => {
        if (filterTypes?.length && !filterTypes.includes(x.event_type)) return false;
        const dt = new Date(`${x.event_date}T00:00:00Z`);
        return Number.isFinite(dt.getTime()) && dt.getTime() >= todayKey;
      })
      .sort((a, b) => a.event_date.localeCompare(b.event_date));
    const pastRows = all
      .filter((x) => {
        const dt = new Date(`${x.event_date}T00:00:00Z`);
        return Number.isFinite(dt.getTime()) && dt.getTime() < todayKey;
      })
      .sort((a, b) => b.event_date.localeCompare(a.event_date));
    return { upcomingFiltered: upcomingRows, pastFiltered: pastRows };
  }, [events, filterTypes, upcoming]);

  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex flex-wrap items-center gap-2">
          {FILTERS.map((chip) => (
            <button
              key={chip.id}
              className={`rounded border px-2 py-1 text-xs ${filter === chip.id ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
              onClick={() => setFilter(chip.id)}
            >
              {chip.label}
            </button>
          ))}
        </div>
        <div className="flex flex-wrap items-end gap-2 text-xs">
          <label className="text-terminal-muted">
            From
            <input className="ml-2 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-text" type="date" value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
          </label>
          <label className="text-terminal-muted">
            To
            <input className="ml-2 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-text" type="date" value={toDate} onChange={(e) => setToDate(e.target.value)} />
          </label>
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Upcoming Events</div>
        {upcomingLoading ? <div className="text-xs text-terminal-muted">Loading upcoming events...</div> : null}
        {!upcomingLoading && upcomingFiltered.length === 0 ? <div className="text-xs text-terminal-muted">No upcoming events in the selected range.</div> : null}
        <div className="space-y-2 border-l border-terminal-border pl-3">
          {upcomingFiltered.map((evt) => (
            <div key={`${evt.symbol}-${evt.event_type}-${evt.event_date}-${evt.title}`}>
              <div className="mb-1 text-[11px] text-terminal-muted">{countdown(evt.event_date)}</div>
              <EventCard evt={evt} />
            </div>
          ))}
        </div>
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-sm font-semibold text-terminal-accent">Past Events</div>
          <button className="text-xs text-terminal-muted hover:text-terminal-text" onClick={() => setShowPast((v) => !v)}>
            {showPast ? "Collapse" : "Expand"}
          </button>
        </div>
        {isLoading ? <div className="text-xs text-terminal-muted">Loading event timeline...</div> : null}
        {showPast ? (
          <div className="space-y-2 border-l border-terminal-border pl-3">
            {pastFiltered.length === 0 ? <div className="text-xs text-terminal-muted">No past events.</div> : null}
            {pastFiltered.map((evt) => (
              <EventCard key={`${evt.symbol}-${evt.event_type}-${evt.event_date}-${evt.title}`} evt={evt} />
            ))}
          </div>
        ) : (
          <div className="text-xs text-terminal-muted">Hidden</div>
        )}
      </div>
    </div>
  );
}
