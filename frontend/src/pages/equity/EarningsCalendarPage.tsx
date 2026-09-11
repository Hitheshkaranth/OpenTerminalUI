import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Filter, Search, X } from "lucide-react";
import { useQuery } from "@tanstack/react-query";

import { fetchEarningsCalendar } from "../../api/earnings";
import { TerminalInput } from "../../components/terminal/TerminalInput";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import type { EarningsDate } from "../../types";

const MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

const DAYS_IN_MONTH = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

function getMonthRange(year: number, month: number): { from: string; to: string } {
  const from = `${year}-${String(month + 1).padStart(2, "0")}-01`;
  const days = DAYS_IN_MONTH(year, month);
  const to = `${year}-${String(month + 1).padStart(2, "0")}-${String(days).padStart(2, "0")}`;
  return { from, to };
}

function formatTime(time: string): string {
  const lower = time.toLowerCase();
  if (lower.includes("pre")) return "Pre-Open";
  if (lower.includes("after")) return "After-Hours";
  if (lower.includes("pre-market")) return "Pre-Mkt";
  if (lower.includes("after-market")) return "After-Mkt";
  if (lower.includes("amc")) return "AMC";
  if (lower.includes("bmo")) return "BMO";
  if (lower.includes("pre") || lower.includes("before")) return "Pre-Mkt";
  if (lower.includes("after") || lower.includes("afternoon")) return "After";
  return "Market";
}

function timeBadge(time: string): string {
  const lower = time.toLowerCase();
  if (lower.includes("pre") || lower.includes("bmo") || lower.includes("before")) return "bg-terminal-info/10 text-terminal-info border-terminal-info/30";
  if (lower.includes("after") || lower.includes("amc") || lower.includes("afternoon")) return "bg-terminal-warn/10 text-terminal-warn border-terminal-warn/30";
  return "bg-terminal-border/40 text-terminal-text border-terminal-border";
}

export function EarningsCalendarPage() {
  const now = new Date();
  const [currentMonth, setCurrentMonth] = useState(now.getMonth());
  const [currentYear, setCurrentYear] = useState(now.getFullYear());
  const [symbolFilter, setSymbolFilter] = useState("");

  const range = useMemo(() => getMonthRange(currentYear, currentMonth), [currentYear, currentMonth]);

  const { data: earnings = [], isLoading } = useQuery({
    queryKey: ["earnings-calendar", range.from, range.to, symbolFilter],
    queryFn: () => fetchEarningsCalendar({ from_date: range.from, to_date: range.to, symbols: symbolFilter ? [symbolFilter] : undefined }),
    staleTime: 60_000,
  });

  const prevMonth = () => {
    if (currentMonth === 0) {
      setCurrentMonth(11);
      setCurrentYear((y) => y - 1);
    } else {
      setCurrentMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (currentMonth === 11) {
      setCurrentMonth(0);
      setCurrentYear((y) => y + 1);
    } else {
      setCurrentMonth((m) => m + 1);
    }
  };

  const clearFilter = () => setSymbolFilter("");

  const sorted = useMemo(() => {
    return [...earnings].sort((a, b) => {
      if (a.symbol !== b.symbol) return a.symbol.localeCompare(b.symbol);
      return new Date(a.earnings_date).getTime() - new Date(b.earnings_date).getTime();
    });
  }, [earnings]);

  const groupedBySymbol = useMemo(() => {
    const map = new Map<string, EarningsDate[]>();
    for (const item of sorted) {
      const arr = map.get(item.symbol) || [];
      arr.push(item);
      map.set(item.symbol, arr);
    }
    return map;
  }, [sorted]);

  const entries = Array.from(groupedBySymbol.entries()).sort(([a], [b]) => a.localeCompare(b));

  return (
    <div className="min-h-full bg-[radial-gradient(circle_at_top_left,rgba(255,107,0,0.06),transparent_30rem)] p-3 md:p-5">
      <main className="mx-auto flex w-full max-w-[1400px] flex-col gap-4">
        <section className="rounded-md border border-terminal-border/70 bg-terminal-panel/95 p-4 shadow-[0_10px_30px_rgba(0,0,0,0.18)]">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <button
                type="button"
                onClick={prevMonth}
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg text-terminal-muted transition-colors hover:border-terminal-accent hover:text-terminal-accent"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <h2 className="text-lg font-semibold tracking-tight text-terminal-text sm:text-xl">
                {MONTHS[currentMonth]} {currentYear}
              </h2>
              <button
                type="button"
                onClick={nextMonth}
                className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg text-terminal-muted transition-colors hover:border-terminal-accent hover:text-terminal-accent"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>

            <div className="relative w-48 sm:w-64">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
              {!symbolFilter ? (
                <TerminalInput
                  tone="ui"
                  value={symbolFilter}
                  onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
                  className="pl-8 text-xs"
                  placeholder="Filter by symbol..."
                />
              ) : (
                <div className="relative">
                  <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-terminal-muted" aria-hidden="true" />
                  <input
                    className="h-8 w-full rounded-sm border border-terminal-border bg-terminal-bg pl-8 pr-7 font-sans text-xs text-terminal-text outline-none transition-colors placeholder:text-terminal-muted focus:border-terminal-accent"
                    value={symbolFilter}
                    onChange={(e) => setSymbolFilter(e.target.value.toUpperCase())}
                    placeholder="Filter by symbol..."
                    aria-label="Filter by symbol"
                  />
                  <button
                    type="button"
                    onClick={clearFilter}
                    className="absolute right-2 top-1/2 -translate-y-1/2 text-terminal-muted transition-colors hover:text-terminal-text"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              )}
            </div>
          </div>

          {isLoading ? (
            <div className="flex h-32 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg">
              <div className="text-xs text-terminal-muted">Loading earnings data...</div>
            </div>
          ) : sorted.length === 0 ? (
            <div className="flex h-32 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg">
              <div className="text-center">
                <Filter className="mx-auto mb-2 h-6 w-6 text-terminal-border" />
                <div className="text-sm text-terminal-muted">No earnings in this period</div>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex items-center gap-2 text-[10px] uppercase text-terminal-muted">
                <Filter className="h-3 w-3" />
                <span>{sorted.length} events across {entries.length} symbols</span>
              </div>

              {entries.map(([symbol, events]) => (
                <div key={symbol} className="rounded-sm border border-terminal-border bg-terminal-bg/50">
                  <div className="flex items-center gap-2 border-b border-terminal-border px-3 py-2">
                    <span className="inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-sm bg-terminal-accent/15 font-sans text-[10px] font-semibold text-terminal-accent">
                      {symbol.slice(0, 2)}
                    </span>
                    <span className="font-sans text-sm font-semibold text-terminal-text">{symbol}</span>
                    <span className="shrink-0 rounded-full border border-terminal-border px-2 py-0.5 font-sans text-[10px] text-terminal-muted">
                      {events.length} event{events.length > 1 ? "s" : ""}
                    </span>
                  </div>

                  <div className="overflow-x-auto">
                    <table className="w-full text-xs">
                      <thead>
                        <tr className="border-b border-terminal-border bg-terminal-bg">
                          <th className="px-3 py-1.5 text-left font-sans font-medium text-terminal-muted">Date</th>
                          <th className="px-3 py-1.5 text-left font-sans font-medium text-terminal-muted">Company</th>
                          <th className="px-3 py-1.5 text-right font-sans font-medium text-terminal-muted">Estimate EPS</th>
                          <th className="px-3 py-1.5 text-right font-sans font-medium text-terminal-muted">Actual EPS</th>
                          <th className="px-3 py-1.5 text-right font-sans font-medium text-terminal-muted">Surprise %</th>
                          <th className="hidden px-3 py-1.5 text-center font-sans font-medium text-terminal-muted sm:table-cell">Time</th>
                        </tr>
                      </thead>
                      <tbody>
                        {events.map((evt, idx) => {
                          const isPositive = (evt.eps_surprise_pct ?? 0) > 0;
                          const isNegative = (evt.eps_surprise_pct ?? 0) < 0;
                          const dateStr = new Date(evt.earnings_date).toLocaleDateString("en-IN", { day: "2-digit", month: "short" });
                          const estimateStr = evt.estimated_eps != null ? evt.estimated_eps.toFixed(2) : "--";
                          const actualStr = evt.actual_eps != null ? evt.actual_eps.toFixed(2) : "--";
                          const surpriseStr = evt.eps_surprise_pct != null ? `${evt.eps_surprise_pct > 0 ? "+" : ""}${evt.eps_surprise_pct.toFixed(2)}%` : "--";
                          return (
                            <tr key={idx} className={`border-b border-terminal-border/40 ${idx % 2 === 0 ? "bg-terminal-bg" : ""}`}>
                              <td className="whitespace-nowrap px-3 py-1.5 font-sans text-terminal-text">{dateStr}</td>
                              <td className="px-3 py-1.5 font-sans text-terminal-text" title={evt.company_name}>{evt.company_name}</td>
                              <td className="px-3 py-1.5 text-right font-sans text-terminal-muted">{estimateStr}</td>
                              <td className="px-3 py-1.5 text-right font-sans font-medium text-terminal-text">{actualStr}</td>
                              <td className={`px-3 py-1.5 text-right font-sans font-semibold ${isPositive ? "text-terminal-pos" : isNegative ? "text-terminal-neg" : "text-terminal-muted"}`}>
                                {surpriseStr}
                              </td>
                              <td className="hidden px-3 py-1.5 text-center sm:table-cell">
                                <span className={`inline-block rounded-sm border px-1.5 py-0.5 font-sans text-[10px] ${timeBadge(evt.time)}`}>
                                  {formatTime(evt.time)}
                                </span>
                              </td>
                            </tr>
                          );
                        })}
                      </tbody>
                    </table>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}