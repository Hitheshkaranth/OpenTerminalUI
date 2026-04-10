import { Fragment, useDeferredValue, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { TerminalBadge } from "../../components/terminal/TerminalBadge";
import { TerminalPanel } from "../../components/terminal/TerminalPanel";
import { fetchOptionsFlow, fetchOptionsFlowSummary } from "../api/fnoApi";
import { formatIndianCompact, type OptionsFlowItem } from "../types/fno";

type SortKey = "time" | "heat" | "premium";
type TypeFilter = "ALL" | "CE" | "PE";
type ChartWindow = "1d" | "5d";

function formatPremium(value: number): string {
  if (!Number.isFinite(value)) return "-";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  return `${formatIndianCompact(value)}`;
}

function formatTs(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function chartLabel(value: string, window: ChartWindow): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return window === "1d"
    ? date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
    : date.toLocaleDateString([], { month: "short", day: "numeric", hour: "2-digit" });
}

function heatBarColor(score: number): string {
  if (score >= 80) return "from-orange-500 to-red-500";
  if (score >= 55) return "from-cyan-400 to-orange-500";
  return "from-sky-500 to-cyan-300";
}

function rowId(flow: OptionsFlowItem): string {
  return `${flow.symbol}:${flow.expiry}:${flow.strike}:${flow.option_type}:${flow.timestamp}`;
}

export function OptionsFlowPage() {
  const [symbolInput, setSymbolInput] = useState("");
  const deferredSymbol = useDeferredValue(symbolInput.trim().toUpperCase());
  const [typeFilter, setTypeFilter] = useState<TypeFilter>("ALL");
  const [expiryFilter, setExpiryFilter] = useState("ALL");
  const [minPremium, setMinPremium] = useState(100_000);
  const [sortKey, setSortKey] = useState<SortKey>("time");
  const [chartWindow, setChartWindow] = useState<ChartWindow>("1d");
  const [expandedRowId, setExpandedRowId] = useState<string | null>(null);
  const [highlightedIds, setHighlightedIds] = useState<string[]>([]);
  const previousIdsRef = useRef<Set<string>>(new Set());

  const flowQuery = useQuery({
    queryKey: ["fno-flow", deferredSymbol, minPremium],
    queryFn: () => fetchOptionsFlow({ symbol: deferredSymbol || undefined, minPremium, limit: 100 }),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ["fno-flow-summary", chartWindow],
    queryFn: () => fetchOptionsFlowSummary(chartWindow),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  useEffect(() => {
    const flows = flowQuery.data?.flows ?? [];
    const currentIds = new Set(flows.map(rowId));
    if (previousIdsRef.current.size > 0) {
      const nextHighlights = flows.map(rowId).filter((id) => !previousIdsRef.current.has(id));
      if (nextHighlights.length) {
        setHighlightedIds(nextHighlights);
        window.setTimeout(() => setHighlightedIds([]), 2_500);
      }
    }
    previousIdsRef.current = currentIds;
  }, [flowQuery.data?.flows]);

  const expiryOptions = useMemo(() => {
    const items = new Set<string>();
    for (const flow of flowQuery.data?.flows ?? []) {
      if (flow.expiry) items.add(flow.expiry);
    }
    return ["ALL", ...Array.from(items).sort()];
  }, [flowQuery.data?.flows]);

  const flows = useMemo(() => {
    const list = (flowQuery.data?.flows ?? []).filter((flow) => {
      if (typeFilter !== "ALL" && flow.option_type !== typeFilter) return false;
      if (expiryFilter !== "ALL" && flow.expiry !== expiryFilter) return false;
      return true;
    });

    list.sort((a, b) => {
      if (sortKey === "heat") return b.heat_score - a.heat_score;
      if (sortKey === "premium") return b.premium_value - a.premium_value;
      return new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime();
    });
    return list;
  }, [expiryFilter, flowQuery.data?.flows, sortKey, typeFilter]);

  const summary = summaryQuery.data;
  const chartData = useMemo(
    () =>
      (summary?.premium_by_hour ?? []).map((point) => ({
        label: chartLabel(point.hour, chartWindow),
        bullish: point.bullish,
        bearish: point.bearish,
      })),
    [chartWindow, summary?.premium_by_hour],
  );

  const bullishPct = summary?.bullish_pct ?? 0;
  const bearishPct = summary?.bearish_pct ?? 0;
  const mostActive = summary?.top_symbols?.[0];

  return (
    <div className="space-y-3">
      <TerminalPanel title="Options Flow" subtitle="Unusual activity tracker" bodyClassName="space-y-3">
        <div className="grid gap-3 lg:grid-cols-4">
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Total Premium</div>
            <div className="mt-1 text-xl font-semibold text-terminal-text">{formatPremium(summary?.total_premium ?? 0)}</div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
            <div className="flex items-center justify-between text-[10px] uppercase tracking-wide text-terminal-muted">
              <span>Sentiment Split</span>
              <span>{bullishPct.toFixed(1)} / {bearishPct.toFixed(1)}</span>
            </div>
            <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-terminal-panel">
              <div className="h-full bg-emerald-500" style={{ width: `${Math.max(0, Math.min(100, bullishPct))}%` }} />
              <div className="h-full bg-red-500" style={{ width: `${Math.max(0, Math.min(100, bearishPct))}%` }} />
            </div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Most Active</div>
            <div className="mt-1 flex items-center gap-2">
              <TerminalBadge variant="accent" size="md">{mostActive?.symbol ?? "N/A"}</TerminalBadge>
              <span className="text-xs text-terminal-muted">{mostActive ? formatPremium(mostActive.premium) : "-"}</span>
            </div>
          </div>
          <div className="rounded border border-terminal-border bg-terminal-bg px-3 py-2">
            <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Flow Count</div>
            <div className="mt-1 text-xl font-semibold text-terminal-text">{flowQuery.data?.count ?? 0}</div>
          </div>
        </div>
      </TerminalPanel>

      <TerminalPanel title="Flow Tape" subtitle="Live every 60s" bodyClassName="space-y-3">
        <div className="grid gap-2 xl:grid-cols-[1.3fr_0.9fr_0.9fr_1.1fr_1fr]">
          <label className="text-[11px]">
            <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Symbol</span>
            <input
              value={symbolInput}
              onChange={(event) => setSymbolInput(event.target.value)}
              placeholder="Search symbol"
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
            />
          </label>

          <div className="text-[11px]">
            <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Type</span>
            <div className="flex gap-1">
              {([
                ["ALL", "All"],
                ["CE", "Calls"],
                ["PE", "Puts"],
              ] as const).map(([value, label]) => (
                <button
                  key={value}
                  className={`rounded border px-2 py-1 text-xs ${typeFilter === value ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
                  onClick={() => setTypeFilter(value)}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <label className="text-[11px]">
            <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Expiry</span>
            <select
              value={expiryFilter}
              onChange={(event) => setExpiryFilter(event.target.value)}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
            >
              {expiryOptions.map((item) => (
                <option key={item} value={item}>
                  {item === "ALL" ? "All expiries" : item}
                </option>
              ))}
            </select>
          </label>

          <label className="text-[11px]">
            <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Min Premium</span>
            <div className="space-y-1">
              <input
                type="range"
                min={0}
                max={2_000_000}
                step={50_000}
                value={minPremium}
                onChange={(event) => setMinPremium(Number(event.target.value))}
                className="w-full"
              />
              <input
                type="number"
                min={0}
                step={50_000}
                value={minPremium}
                onChange={(event) => setMinPremium(Number(event.target.value) || 0)}
                className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
              />
            </div>
          </label>

          <label className="text-[11px]">
            <span className="mb-1 block uppercase tracking-wide text-terminal-muted">Sort</span>
            <select
              value={sortKey}
              onChange={(event) => setSortKey(event.target.value as SortKey)}
              className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs outline-none focus:border-terminal-accent"
            >
              <option value="time">Time</option>
              <option value="heat">Heat Score</option>
              <option value="premium">Premium</option>
            </select>
          </label>
        </div>

        {flowQuery.isLoading ? <div className="text-sm text-terminal-muted">Loading options flow...</div> : null}
        {flowQuery.isError ? <div className="text-sm text-terminal-neg">Failed to load options flow.</div> : null}

        {!flowQuery.isLoading && !flowQuery.isError ? (
          <div className="overflow-x-auto rounded border border-terminal-border">
            <table className="min-w-full text-left text-xs">
              <thead className="bg-terminal-bg text-terminal-muted">
                <tr>
                  {["Time", "Symbol", "Expiry", "Strike", "Type", "Volume", "OI Chg", "Premium", "IV", "Heat Score", "Sentiment"].map((label) => (
                    <th key={label} className="px-3 py-2 font-medium uppercase tracking-wide">
                      {label}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {flows.map((flow) => {
                  const id = rowId(flow);
                  const expanded = expandedRowId === id;
                  const bullish = flow.sentiment === "bullish";
                  const highlight = highlightedIds.includes(id);
                  return (
                    <Fragment key={id}>
                      <tr
                        data-testid="flow-row"
                        className={[
                          "cursor-pointer border-t border-terminal-border transition-colors",
                          bullish ? "border-l-2 border-l-emerald-500 bg-emerald-500/5" : "border-l-2 border-l-red-500 bg-red-500/5",
                          highlight ? "animate-pulse" : "",
                        ].join(" ").trim()}
                        onClick={() => setExpandedRowId(expanded ? null : id)}
                      >
                        <td className="px-3 py-2">{formatTs(flow.timestamp)}</td>
                        <td className="px-3 py-2 font-medium text-terminal-text">{flow.symbol}</td>
                        <td className="px-3 py-2 text-terminal-muted">{flow.expiry}</td>
                        <td className="px-3 py-2">{flow.strike.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2">
                          <TerminalBadge variant={flow.option_type === "CE" ? "success" : "danger"}>{flow.option_type}</TerminalBadge>
                        </td>
                        <td className="px-3 py-2">{flow.volume.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2">{flow.oi_change.toLocaleString("en-IN")}</td>
                        <td className="px-3 py-2">{formatPremium(flow.premium_value)}</td>
                        <td className="px-3 py-2">{flow.implied_vol.toFixed(2)}</td>
                        <td className="px-3 py-2">
                          <div className="w-28" data-testid="heat-score-bar">
                            <div className="mb-1 flex items-center justify-between text-[10px] text-terminal-muted">
                              <span>{flow.heat_score.toFixed(1)}</span>
                              <span>{flow.volume_ratio.toFixed(1)}x</span>
                            </div>
                            <div className="h-2 overflow-hidden rounded-full bg-terminal-bg">
                              <div
                                className={`h-full rounded-full bg-gradient-to-r ${heatBarColor(flow.heat_score)}`}
                                style={{ width: `${Math.max(6, Math.min(100, flow.heat_score))}%` }}
                              />
                            </div>
                          </div>
                        </td>
                        <td className="px-3 py-2">
                          <TerminalBadge variant={bullish ? "success" : "danger"}>{flow.sentiment}</TerminalBadge>
                        </td>
                      </tr>
                      {expanded ? (
                        <tr key={`${id}:expanded`} className="border-t border-terminal-border bg-terminal-bg/50">
                          <td colSpan={11} className="px-3 py-3">
                            <div className="grid gap-3 lg:grid-cols-[1fr_1fr_auto]">
                              <div>
                                <div className="mb-2 text-[10px] uppercase tracking-wide text-terminal-muted">Option Chain Context</div>
                                <div className="grid gap-2 md:grid-cols-2">
                                  <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Spot / ATM</div>
                                    <div className="mt-1 text-sm text-terminal-text">
                                      {flow.spot_price?.toLocaleString("en-IN") ?? "-"} / {flow.chain_context?.atm_strike?.toLocaleString("en-IN") ?? "-"}
                                    </div>
                                  </div>
                                  <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-terminal-muted">PCR</div>
                                    <div className="mt-1 text-sm text-terminal-text">
                                      OI {flow.chain_context?.pcr_oi?.toFixed(2) ?? "-"} | Vol {flow.chain_context?.pcr_volume?.toFixed(2) ?? "-"}
                                    </div>
                                  </div>
                                  <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Call Leg</div>
                                    <div className="mt-1 text-sm text-terminal-text">
                                      Vol {flow.chain_context?.strike_row?.ce?.volume?.toLocaleString("en-IN") ?? "-"} | OI {flow.chain_context?.strike_row?.ce?.oi?.toLocaleString("en-IN") ?? "-"}
                                    </div>
                                  </div>
                                  <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2">
                                    <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Put Leg</div>
                                    <div className="mt-1 text-sm text-terminal-text">
                                      Vol {flow.chain_context?.strike_row?.pe?.volume?.toLocaleString("en-IN") ?? "-"} | OI {flow.chain_context?.strike_row?.pe?.oi?.toLocaleString("en-IN") ?? "-"}
                                    </div>
                                  </div>
                                </div>
                              </div>
                              <div className="rounded border border-terminal-border bg-terminal-panel px-3 py-2">
                                <div className="mb-2 text-[10px] uppercase tracking-wide text-terminal-muted">Signal Read</div>
                                <div className="space-y-1 text-sm text-terminal-text">
                                  <div>Avg Vol: {flow.avg_volume.toLocaleString("en-IN", { maximumFractionDigits: 0 })}</div>
                                  <div>Vol Ratio: {flow.volume_ratio.toFixed(2)}x</div>
                                  <div>Heat: {flow.heat_score.toFixed(2)}</div>
                                  <div>Premium: {formatPremium(flow.premium_value)}</div>
                                </div>
                              </div>
                              <div className="flex items-start">
                                <Link
                                  to={`/fno?symbol=${encodeURIComponent(flow.symbol)}`}
                                  className="rounded border border-terminal-accent px-3 py-2 text-xs text-terminal-accent hover:bg-terminal-accent/10"
                                >
                                  Open Full Chain
                                </Link>
                              </div>
                            </div>
                          </td>
                        </tr>
                      ) : null}
                    </Fragment>
                  );
                })}
                {!flows.length ? (
                  <tr>
                    <td colSpan={11} className="px-3 py-6 text-center text-terminal-muted">
                      No unusual activity found for the current filters.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        ) : null}
      </TerminalPanel>

      <TerminalPanel
        title="Premium Flow"
        subtitle="Bullish vs bearish premium over time"
        actions={
          <div className="flex gap-1">
            {(["1d", "5d"] as const).map((window) => (
              <button
                key={window}
                className={`rounded border px-2 py-1 text-[11px] ${chartWindow === window ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
                onClick={() => setChartWindow(window)}
              >
                {window === "1d" ? "Today" : "Last 5 Days"}
              </button>
            ))}
          </div>
        }
      >
        <div className="h-[320px] w-full">
          <ResponsiveContainer>
            <AreaChart data={chartData} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
              <defs>
                <linearGradient id="bullishFlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#10b981" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#10b981" stopOpacity={0.05} />
                </linearGradient>
                <linearGradient id="bearishFlow" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#ef4444" stopOpacity={0.45} />
                  <stop offset="95%" stopColor="#ef4444" stopOpacity={0.05} />
                </linearGradient>
              </defs>
              <CartesianGrid stroke="rgba(148, 163, 184, 0.12)" vertical={false} />
              <XAxis dataKey="label" tick={{ fill: "#94a3b8", fontSize: 11 }} />
              <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(value) => formatIndianCompact(Number(value))} />
              <Tooltip
                contentStyle={{ background: "#111827", border: "1px solid rgba(148,163,184,0.2)" }}
                formatter={(value) => formatPremium(Number(value ?? 0))}
              />
              <Area type="monotone" dataKey="bullish" stackId="premium" stroke="#10b981" fill="url(#bullishFlow)" />
              <Area type="monotone" dataKey="bearish" stackId="premium" stroke="#ef4444" fill="url(#bearishFlow)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </TerminalPanel>
    </div>
  );
}
