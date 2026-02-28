import { useState, useMemo, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import {
  format, startOfMonth, endOfMonth, eachDayOfInterval, isSameDay,
  addMonths, subMonths, isToday, isWithinInterval, addHours
} from "date-fns";
import {
  ChevronLeft, ChevronRight, Filter, Globe, Activity, TrendingUp, TrendingDown,
  Minus, Info, Calendar as CalendarIcon, LayoutGrid
} from "lucide-react";
import { ResponsiveContainer, AreaChart, Area } from "recharts";

import { fetchEconomicCalendar, fetchMacroIndicators } from "../../api/client";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { EconomicEvent, MacroIndicator } from "../../types";

export function EconomicTerminal() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [view, setView] = useState<"calendar" | "macro">((searchParams.get("tab") as any) || "calendar");

  useEffect(() => {
    const tab = searchParams.get("tab");
    if (tab === "calendar" || tab === "macro") {
      setView(tab as any);
    }
  }, [searchParams]);

  const handleSetView = (newView: "calendar" | "macro") => {
    setView(newView);
    setSearchParams({ tab: newView });
  };

  const [currentMonth, setCurrentMonth] = useState(new Date());
  const [selectedEvent, setSelectedEvent] = useState<EconomicEvent | null>(null);

  // Filters
  const [filters, setFilters] = useState({
    countries: [] as string[],
    impacts: ["high", "medium", "low"],
    categories: [] as string[]
  });

  const startDate = format(startOfMonth(currentMonth), "yyyy-MM-dd");
  const endDate = format(endOfMonth(currentMonth), "yyyy-MM-dd");

  const { data: events, isLoading: loadingEvents } = useQuery({
    queryKey: ["econ-calendar", startDate, endDate],
    queryFn: () => fetchEconomicCalendar(startDate, endDate)
  });

  const { data: macro, isLoading: loadingMacro } = useQuery({
    queryKey: ["macro-indicators"],
    queryFn: fetchMacroIndicators,
    refetchInterval: 600_000
  });

  const filteredEvents = useMemo(() => {
    if (!events) return [];
    return events.filter(ev => {
      const countryMatch = filters.countries.length === 0 || filters.countries.includes(ev.country);
      const impactMatch = filters.impacts.includes(ev.impact);
      return countryMatch && impactMatch;
    });
  }, [events, filters]);

  const days = useMemo(() => {
    return eachDayOfInterval({
      start: startOfMonth(currentMonth),
      end: endOfMonth(currentMonth)
    });
  }, [currentMonth]);

  return (
    <div className="flex h-full flex-col gap-4 overflow-hidden bg-terminal-bg p-4 text-terminal-text">
      {/* Header / Tabs */}
      <div className="flex items-center justify-between border-b border-terminal-border pb-4">
        <div className="flex items-center gap-4">
          <h1 className="text-xl font-bold text-terminal-accent">ECONOMIC TERMINAL</h1>
          <div className="flex rounded border border-terminal-border p-0.5 bg-terminal-panel">
            <button
              onClick={() => handleSetView("calendar")}
              className={`flex items-center gap-2 px-4 py-1 text-xs font-bold rounded-sm transition-colors ${view === "calendar" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
            >
              <CalendarIcon size={14} /> CALENDAR
            </button>
            <button
              onClick={() => handleSetView("macro")}
              className={`flex items-center gap-2 px-4 py-1 text-xs font-bold rounded-sm transition-colors ${view === "macro" ? "bg-terminal-accent text-terminal-bg" : "text-terminal-muted hover:text-terminal-text"}`}
            >
              <LayoutGrid size={14} /> MACRO DASHBOARD
            </button>
          </div>
        </div>
      </div>

      <div className="flex-grow min-h-0 overflow-auto">
        {view === "calendar" ? (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-4 h-full">
            {/* Calendar Main View */}
            <div className="lg:col-span-3 flex flex-col gap-4 h-full">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <button onClick={() => setCurrentMonth(subMonths(currentMonth, 1))} className="text-terminal-muted hover:text-terminal-accent">
                    <ChevronLeft size={20} />
                  </button>
                  <h2 className="text-lg font-bold uppercase">{format(currentMonth, "MMMM yyyy")}</h2>
                  <button onClick={() => setCurrentMonth(addMonths(currentMonth, 1))} className="text-terminal-muted hover:text-terminal-accent">
                    <ChevronRight size={20} />
                  </button>
                </div>

                <div className="flex gap-2">
                  {["high", "medium", "low"].map(impact => (
                    <label key={impact} className="flex items-center gap-1 text-[10px] uppercase cursor-pointer">
                      <input
                        type="checkbox"
                        checked={filters.impacts.includes(impact)}
                        onChange={(e) => {
                          if (e.target.checked) setFilters(f => ({...f, impacts: [...f.impacts, impact]}));
                          else setFilters(f => ({...f, impacts: f.impacts.filter(i => i !== impact)}));
                        }}
                        className="hidden"
                      />
                      <div className={`h-2 w-2 rounded-full ${impact === 'high' ? 'bg-terminal-neg' : impact === 'medium' ? 'bg-orange-500' : 'bg-gray-500'} ${filters.impacts.includes(impact) ? 'ring-1 ring-offset-1 ring-terminal-accent' : 'opacity-30'}`} />
                      {impact}
                    </label>
                  ))}
                </div>
              </div>

              <div className="grid grid-cols-7 gap-px bg-terminal-border flex-grow overflow-auto border border-terminal-border">
                {["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"].map(d => (
                  <div key={d} className="bg-terminal-bg-accent p-2 text-center text-[10px] font-bold text-terminal-muted">{d}</div>
                ))}
                {days.map((day, idx) => {
                  const dayEvents = filteredEvents.filter(ev => isSameDay(new Date(ev.date), day));
                  const isUpcoming = dayEvents.some(ev => {
                    const evDate = new Date(`${ev.date}T${ev.time || '00:00:00'}`);
                    return isWithinInterval(evDate, { start: new Date(), end: addHours(new Date(), 24) });
                  });

                  return (
                    <div
                      key={idx}
                      className={`min-h-[100px] bg-terminal-bg p-2 transition-colors hover:bg-terminal-accent/5 ${isToday(day) ? 'ring-1 ring-inset ring-terminal-accent/50' : ''}`}
                    >
                      <div className="flex justify-between items-start mb-1">
                        <span className={`text-xs font-mono ${isToday(day) ? 'text-terminal-accent font-bold' : 'text-terminal-muted'}`}>
                          {format(day, "d")}
                        </span>
                        {isUpcoming && <div className="h-1.5 w-1.5 rounded-full bg-terminal-accent animate-pulse" title="Upcoming in 24h" />}
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {dayEvents.slice(0, 8).map((ev, i) => (
                          <button
                            key={i}
                            onClick={() => setSelectedEvent(ev)}
                            className={`h-2 w-2 rounded-full ${ev.impact === 'high' ? 'bg-terminal-neg' : ev.impact === 'medium' ? 'bg-orange-500' : 'bg-gray-500'}`}
                            title={ev.event_name}
                          />
                        ))}
                        {dayEvents.length > 8 && <span className="text-[8px] text-terminal-muted">+{dayEvents.length - 8}</span>}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Side Panel Detail */}
            <div className="flex flex-col gap-4 h-full overflow-hidden">
              <TerminalPanel title="EVENT DETAILS" className="flex-grow">
                {selectedEvent ? (
                  <div className="space-y-4 p-2 text-xs">
                    <div className="flex items-center gap-2 mb-2">
                      <div className={`h-2 w-2 rounded-full ${selectedEvent.impact === 'high' ? 'bg-terminal-neg' : selectedEvent.impact === 'medium' ? 'bg-orange-500' : 'bg-gray-500'}`} />
                      <span className="font-bold text-terminal-accent uppercase tracking-wider">{selectedEvent.impact} IMPACT</span>
                    </div>
                    <div>
                      <h3 className="text-sm font-bold text-terminal-text">{selectedEvent.event_name}</h3>
                      <p className="text-[10px] text-terminal-muted">{selectedEvent.country} | {selectedEvent.date} {selectedEvent.time}</p>
                    </div>

                    <div className="grid grid-cols-2 gap-2 border-t border-terminal-border pt-4">
                      <div className="rounded bg-terminal-bg-accent p-2">
                        <div className="text-[10px] text-terminal-muted uppercase">ACTUAL</div>
                        <div className="text-sm font-mono font-bold">{selectedEvent.actual ?? "--"}</div>
                      </div>
                      <div className="rounded bg-terminal-bg-accent p-2">
                        <div className="text-[10px] text-terminal-muted uppercase">FORECAST</div>
                        <div className="text-sm font-mono font-bold text-terminal-accent">{selectedEvent.forecast ?? "--"}</div>
                      </div>
                      <div className="rounded bg-terminal-bg-accent p-2">
                        <div className="text-[10px] text-terminal-muted uppercase">PREVIOUS</div>
                        <div className="text-sm font-mono font-bold">{selectedEvent.previous ?? "--"}</div>
                      </div>
                      <div className="rounded bg-terminal-bg-accent p-2">
                        <div className="text-[10px] text-terminal-muted uppercase">UNIT</div>
                        <div className="text-sm font-mono font-bold">{selectedEvent.unit || selectedEvent.currency || "--"}</div>
                      </div>
                    </div>

                    <div className="mt-4 p-2 rounded border border-terminal-border/50 bg-terminal-accent/5 italic text-[10px] text-terminal-muted">
                      <Info size={12} className="inline mr-1" />
                      Pro Tip: Watch for deviations from forecast for high volatility.
                    </div>
                  </div>
                ) : (
                  <div className="flex h-full items-center justify-center text-xs text-terminal-muted italic text-center p-4">
                    Select an event dot on the calendar to view details.
                  </div>
                )}
              </TerminalPanel>
            </div>
          </div>
        ) : (
          /* Macro Dashboard View */
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-4">
            {macro && Object.entries(macro).map(([region, indicators]) => (
              <TerminalPanel key={region} title={`${region.toUpperCase()} MACRO`}>
                <div className="flex flex-col gap-3 p-1">
                  {Object.entries(indicators as Record<string, MacroIndicator>).map(([name, data]) => {
                    const isImproving = name.includes('unemployment') ? data.value < data.last_value : data.value > data.last_value;
                    const isFlat = data.value === data.last_value;

                    return (
                      <div key={name} className="group rounded border border-terminal-border bg-terminal-bg p-3 transition-colors hover:border-terminal-accent/50">
                        <div className="flex justify-between items-start mb-2">
                          <div>
                            <div className="text-[10px] font-bold text-terminal-muted uppercase tracking-tighter">{name.replace('_', ' ')}</div>
                            <div className="flex items-baseline gap-2">
                              <span className="text-lg font-mono font-bold text-terminal-text">{data.value}%</span>
                              {!isFlat && (
                                <span className={isImproving ? "text-terminal-pos" : "text-terminal-neg"}>
                                  {isImproving ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                                </span>
                              )}
                            </div>
                          </div>
                          <div className="h-8 w-20">
                            <ResponsiveContainer width="100%" height="100%">
                              <AreaChart data={data.history}>
                                <Area
                                  type="monotone"
                                  dataKey="value"
                                  stroke={isImproving ? "#10B981" : "#EF4444"}
                                  fill={isImproving ? "#10B981" : "#EF4444"}
                                  fillOpacity={0.1}
                                  isAnimationActive={false}
                                />
                              </AreaChart>
                            </ResponsiveContainer>
                          </div>
                        </div>
                        <div className="text-[8px] text-terminal-muted uppercase">AS OF {data.date}</div>
                      </div>
                    );
                  })}
                </div>
              </TerminalPanel>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
