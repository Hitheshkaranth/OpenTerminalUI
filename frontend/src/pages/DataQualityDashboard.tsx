import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, RefreshCw } from "lucide-react";
import { fetchDataQualityHealth, parseProviderHealth } from "../api/dataQuality";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTable } from "../components/terminal/TerminalTable";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalButton } from "../components/terminal/TerminalButton";

export function qualityStatusVariant(status: string): "success" | "warn" | "danger" | "neutral" {
  if (["healthy", "ok"].includes(status)) return "success";
  if (["stale", "degraded", "partial"].includes(status)) return "warn";
  if (["offline", "down", "disconnected"].includes(status)) return "danger";
  return "neutral";
}
const label = (value?: string | null) => value ? value.replace(/_/g, " ") : "Unknown";
function timestamp(value?: string | null): string {
  if (!value) return "Not observed";
  const parsed = new Date(value);
  return Number.isFinite(parsed.getTime()) ? parsed.toLocaleString() : "Unknown time";
}
const buttonClass = "inline-flex min-h-9 items-center gap-2 rounded-sm border border-terminal-border px-3 text-xs text-terminal-text hover:border-terminal-accent focus-visible:outline focus-visible:outline-2 focus-visible:outline-terminal-accent";

export function DataQualityDashboard() {
  const [query, setQuery] = useState("");
  const [filter, setFilter] = useState("all");
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ["data-quality-health"], queryFn: fetchDataQualityHealth,
    staleTime: 5_000, refetchInterval: 30_000, retry: 1,
  });
  const providers = parseProviderHealth(data?.provider_health);
  const rows = useMemo(() => (data?.symbols || []).filter((row) => {
    const matches = `${row.symbol} ${row.market || ""} ${row.provider_source}`.toLowerCase().includes(query.trim().toLowerCase());
    return matches && (filter === "all" || (filter === "attention" && ["stale", "disconnected", "degraded"].includes(row.health_status))
      || (filter === "unknown" && (!row.session_state || row.session_state === "unknown")) || (filter === "closed" && row.session_state === "closed"));
  }), [data?.symbols, query, filter]);
  const coverage = data?.coverage;
  const monitorUnavailable = data?.unavailable_sources?.includes("Feed monitoring") || Boolean(error && !data);
  return (
    <main className="mx-auto max-w-[1600px] space-y-6 p-4 pb-24 font-sans text-terminal-text md:p-7">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div><p className="text-xs font-medium text-terminal-accent">Data trust</p><h1 className="mt-2 text-2xl font-semibold">Know what your data can support.</h1><p className="mt-2 max-w-3xl text-sm leading-6 text-terminal-muted">Inspect provider availability, monitored feeds, and the session behind each freshness check. A running service alone does not establish healthy market data.</p></div>
        <div className="flex flex-wrap items-center gap-2"><TerminalBadge variant={qualityStatusVariant(data?.status || "unknown")}>{isLoading ? "Checking" : label(data?.status)}</TerminalBadge><TerminalButton variant="ghost" size="sm" onClick={() => void refetch()} loading={isFetching}><RefreshCw size={13} aria-hidden="true" /> Refresh health</TerminalButton><Link to="/equity/settings" className={buttonClass}>Provider settings <ArrowUpRight size={14} aria-hidden="true" /></Link></div>
      </header>
      {error && <div role="alert" className="rounded-sm border border-terminal-neg/50 p-4 text-sm"><strong>Data health could not be refreshed.</strong><p className="mt-2 text-terminal-muted">{error instanceof Error ? error.message : "Monitoring is unavailable. Retry to check again."}</p>{data && <p className="mt-2">Showing the last successful report below.</p>}<button type="button" className={`${buttonClass} mt-3`} onClick={() => void refetch()}>Retry data health</button></div>}
      {(data?.issues || []).map((issue) => <div key={issue.type} role="status" className="border-l-2 border-terminal-warn bg-terminal-panel px-4 py-3 text-sm leading-6">{issue.message}</div>)}
      <dl className="grid grid-cols-2 gap-5 border-y border-terminal-border py-5 lg:grid-cols-4">
        {[
          ["Monitored symbols", coverage?.monitored, "Only symbols observed by the monitor"],
          ["Stale in session", data?.metrics?.stale_symbols, "Age exceeds the active-session threshold"],
          ["Session bars missing", data?.metrics?.missing_bars_session, "Expected minus received, known sessions only"],
          ["Known session calendars", coverage ? `${coverage.known_sessions} / ${coverage.monitored}` : undefined, "Unknown calendars are excluded from expectations"],
        ].map(([title, value, detail]) => <div key={String(title)}><dt className="text-xs text-terminal-muted">{title}</dt><dd className="mt-2 text-2xl font-semibold tabular-nums">{value ?? (isLoading ? "Checking…" : "Unavailable")}</dd><p className="mt-2 max-w-[32ch] text-xs leading-5 text-terminal-muted">{detail}</p></div>)}
      </dl>
      <section aria-labelledby="feed-health-heading" className="space-y-3">
        <div className="flex flex-wrap items-end justify-between gap-3"><div><h2 id="feed-health-heading" className="text-lg font-semibold">Feed and session coverage</h2><p className="mt-1 text-xs text-terminal-muted">Report: {timestamp(data?.timestamp)}. Closed sessions are separate from stale feeds.</p></div><div className="flex flex-wrap gap-2"><label className="sr-only" htmlFor="quality-search">Search monitored symbols</label><input id="quality-search" className="min-h-9 w-44 rounded-sm border border-terminal-border bg-terminal-panel px-3 text-xs" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Symbol or provider" /><label className="sr-only" htmlFor="quality-filter">Filter feed coverage</label><select id="quality-filter" className="min-h-9 rounded-sm border border-terminal-border bg-terminal-panel px-2 text-xs" value={filter} onChange={(event) => setFilter(event.target.value)}><option value="all">All coverage</option><option value="attention">Needs attention</option><option value="unknown">Unknown calendar</option><option value="closed">Closed sessions</option></select></div></div>
        <div className="overflow-x-auto rounded-sm border border-terminal-border">
          <table className="w-full min-w-[850px] text-left text-xs"><caption className="sr-only">Observed feeds with market sessions and calendar coverage</caption><thead className="border-b border-terminal-border bg-terminal-panel text-terminal-muted"><tr>{["Symbol / venue", "Feed state", "Session", "Last tick", "Bars received / expected", "Calendar coverage"].map((heading) => <th scope="col" className="px-3 py-3 font-medium" key={heading}>{heading}</th>)}</tr></thead><tbody>
            {rows.map((row) => <tr className="border-b border-terminal-border last:border-b-0" key={row.symbol}><th scope="row" className="px-3 py-4 font-medium"><Link className="text-terminal-accent underline-offset-4 hover:underline" to={`/equity/security?ticker=${encodeURIComponent(row.symbol)}`}>{row.symbol}</Link><div className="mt-1 font-normal text-terminal-muted">{row.market || "UNKNOWN"} · {row.provider_source || "unknown provider"}</div></th><td className="px-3 py-4"><TerminalBadge variant={qualityStatusVariant(row.health_status)}>{label(row.health_status)}</TerminalBadge></td><td className="px-3 py-4">{label(row.session_state)}<div className="mt-1 text-terminal-muted">{label(row.session_scope)} · {row.timezone || "Timezone unknown"}</div><div className="mt-1 text-terminal-muted">{row.session_date || "Date unknown"}</div></td><td className="px-3 py-4 tabular-nums">{timestamp(row.last_tick_time)}</td><td className="px-3 py-4 tabular-nums">{row.bars_received_today} / {row.bars_expected_today ?? "Unknown"}</td><td className="max-w-[300px] px-3 py-4 leading-5">{row.calendar_coverage || "Not supplied"}<div className="mt-1 text-terminal-muted">{row.calendar_note || row.calendar_source || "The monitor has not supplied a verified session calendar for this symbol."}</div></td></tr>)}
          </tbody></table>
          {!rows.length && <div className="p-6 text-sm" role="status"><h3 className="font-medium">{isLoading ? "Loading monitored feeds…" : monitorUnavailable ? "Feed monitoring unavailable" : (data?.symbols?.length ? "No feeds match your filters" : "No monitored symbols yet")}</h3><p className="mt-2 max-w-2xl leading-6 text-terminal-muted">{monitorUnavailable ? "Retry health checks to inspect feed coverage. The monitor could not be reached, so symbol counts and missing bars are unavailable." : data?.symbols?.length ? "Try a different symbol, provider, or coverage filter." : "Open a supported quote stream to observe ticks. An empty monitor does not establish live coverage or zero missing bars."}</p><Link to="/equity/watchlist" className={`${buttonClass} mt-3`}>Open watchlists <ArrowUpRight size={14} aria-hidden="true" /></Link></div>}
        </div>
      </section>
      <TerminalPanel title="Provider availability" subtitle="Provider availability is separate from per-symbol freshness."><TerminalTable rows={providers} rowKey={(row) => row.name} emptyText={isLoading ? "Loading provider availability…" : "Provider status is unavailable. Retry health checks or review provider settings."} columns={[
        { key: "name", label: "Provider", render: (row) => <span className="font-medium text-terminal-text">{row.name}</span> },
        { key: "status", label: "Status", render: (row) => <TerminalBadge variant={qualityStatusVariant(row.status)}>{label(row.status)}</TerminalBadge> },
        { key: "last_update", label: "Last successful observation", render: (row) => timestamp(row.last_update) },
      ]} /></TerminalPanel>
      <p className="max-w-4xl text-xs leading-6 text-terminal-muted">Calendar coverage is reported by the monitor. Bundled calendars can have limited years and exceptions; unsupported venues, derivatives and uncertain identities require an explicit calendar. This page does not verify execution entitlements.</p>
    </main>
  );
}
