import { useQuery } from "@tanstack/react-query";
import {
    BarChart3,
    Bell,
    BookOpenText,
    Calculator,
    CalendarClock,
    Factory,
    FileSearch,
    Filter,
    Flame,
    Grid3X3,
    History,
    Layers,
    Lightbulb,
    ListChecks,
    Network,
    type LucideIcon,
} from "lucide-react";
import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";

import { api } from "../api/client";
import { fetchThemes, marketFromDesk } from "../api/ideasThemes";
import { fetchLatestResults } from "../api/resultsTracker";
import { IdeasRadar } from "../components/ideas/IdeasRadar";
import { BulkDealsTable } from "../components/market/BulkDealsTable";
import { EventCalendar } from "../components/market/EventCalendar";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { useEarningsCalendar, useMarketStatus } from "../hooks/useStocks";
import { useSettingsStore } from "../store/settingsStore";

type MoverRow = { symbol: string; price: number; change_pct: number };

function useMovers(listType: "gainers" | "losers") {
    return useQuery<MoverRow[]>({
        queryKey: ["dashboard-movers", listType],
        queryFn: async () => {
            const { data } = await api.get<{ items: MoverRow[] }>("/hotlists", { params: { list_type: listType, market: "IN", limit: 5 } });
            return data.items ?? [];
        },
        staleTime: 60_000,
    });
}

const fmtPct = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "—" : `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const toneOf = (v: number | null | undefined) =>
    v == null || !Number.isFinite(v) ? "text-terminal-muted" : v >= 0 ? "text-terminal-pos" : "text-terminal-neg";

/* ── Index strip ─────────────────────────────────────────────────────────── */

const INDEX_FIELDS: Array<{ key: string; label: string }> = [
    { key: "nifty50", label: "NIFTY 50" },
    { key: "sensex", label: "SENSEX" },
    { key: "sp500", label: "S&P 500" },
    { key: "nasdaq", label: "NASDAQ" },
    { key: "dowjones", label: "DOW" },
    { key: "usdInr", label: "USD/INR" },
    { key: "gold", label: "GOLD" },
    { key: "crude", label: "CRUDE" },
];

function IndexStrip({ status }: { status: Record<string, unknown> }) {
    return (
        <div className="overflow-x-auto rounded-sm border border-terminal-border bg-terminal-panel">
            <dl className="flex min-w-max divide-x divide-terminal-border">
                {INDEX_FIELDS.map(({ key, label }) => {
                    const value = typeof status[key] === "number" ? (status[key] as number) : null;
                    const pct = typeof status[`${key}Pct`] === "number" ? (status[`${key}Pct`] as number) : null;
                    return (
                        <div key={key} className="px-4 py-2">
                            <dt className="ot-type-label text-terminal-muted">{label}</dt>
                            <dd className="flex items-baseline gap-2">
                                <span className="ot-type-data text-sm text-terminal-text">
                                    {value == null ? "—" : value.toLocaleString("en-US", { maximumFractionDigits: 2 })}
                                </span>
                                <span className={`ot-type-data text-xs ${toneOf(pct)}`}>{fmtPct(pct)}</span>
                            </dd>
                        </div>
                    );
                })}
            </dl>
        </div>
    );
}

/* ── Research workflows launcher ─────────────────────────────────────────── */

type Workflow = { label: string; detail: string; to: string; icon: LucideIcon };

const DISCOVER: Workflow[] = [
    { label: "Ideas board", detail: "Order wins, capex, approvals, insider and bulk buys", to: "/equity/hotlists?view=ideas", icon: Lightbulb },
    { label: "Screener", detail: "Fundamentals plus filings growth and headwind scores", to: "/equity/screener", icon: Filter },
    { label: "Thematic indices", detail: "Defence, railways, EMS, AI semis vs benchmark", to: "/equity/sector-rotation?view=themes", icon: Layers },
    { label: "Hotlists", detail: "Gainers, 52-week highs, unusual volume", to: "/equity/hotlists", icon: Flame },
    { label: "Heatmap", detail: "Sector and market-cap map of the session", to: "/equity/heatmap", icon: Grid3X3 },
];

const MONITOR: Workflow[] = [
    { label: "Results tracker", detail: "Quarterly YoY and QoQ with scorecards", to: "/equity/earnings?view=results", icon: BarChart3 },
    { label: "Filings watch", detail: "Alerts on warning letters, guidance cuts, stance changes", to: "/equity/alerts", icon: Bell },
    { label: "Commodity links", detail: "Who a commodity price move hurts and helps", to: "/equity/commodities", icon: Factory },
    { label: "Watchlist", detail: "Live quotes for the names you follow", to: "/equity/watchlist", icon: ListChecks },
    { label: "Intelligence timeline", detail: "Filings, order wins and analysis events in one feed", to: "/equity/intelligence-timeline", icon: History },
];

// Company-level analysis lives in the Security Hub; each entry opens one of its tabs.
const COMPANY_TABS: Array<{ label: string; tab: string; icon: LucideIcon }> = [
    { label: "Filings: growth & headwinds", tab: "filings", icon: FileSearch },
    { label: "Financials, KPIs & reverse DCF", tab: "financials", icon: Calculator },
    { label: "Peers & value chain", tab: "peers", icon: Network },
    { label: "Concall summaries", tab: "news", icon: BookOpenText },
    { label: "Guidance tracker", tab: "estimates", icon: CalendarClock },
];

function WorkflowList({ title, items }: { title: string; items: Workflow[] }) {
    const id = `wf-${title.toLowerCase()}`;
    return (
        <section aria-labelledby={id} className="min-w-0">
            <h3 id={id} className="mb-1 text-xs font-semibold text-terminal-text">{title}</h3>
            <ul className="divide-y divide-terminal-border/60">
                {items.map(({ label, detail, to, icon: Icon }) => (
                    <li key={to}>
                        <Link
                            to={to}
                            className="group flex items-start gap-2 rounded-sm px-1 py-1.5 transition-colors duration-150 hover:bg-terminal-bg/60 focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent"
                        >
                            <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-terminal-muted group-hover:text-terminal-accent" aria-hidden="true" />
                            <span className="min-w-0">
                                <span className="block text-xs text-terminal-text group-hover:text-terminal-accent">{label}</span>
                                <span className="block truncate text-[11px] text-terminal-muted">{detail}</span>
                            </span>
                        </Link>
                    </li>
                ))}
            </ul>
        </section>
    );
}

function CompanyJump() {
    const navigate = useNavigate();
    const [ticker, setTicker] = useState("");
    const symbol = ticker.trim().toUpperCase();
    const open = (tab: string) => {
        if (symbol) navigate(`/equity/security/${encodeURIComponent(symbol)}?tab=${tab}`);
    };
    const onSubmit = (e: FormEvent) => {
        e.preventDefault();
        open("overview");
    };
    return (
        <section aria-labelledby="wf-company" className="min-w-0">
            <h3 id="wf-company" className="mb-1 text-xs font-semibold text-terminal-text">Analyse a company</h3>
            <form onSubmit={onSubmit} className="mb-1 flex gap-1">
                <input
                    value={ticker}
                    onChange={(e) => setTicker(e.target.value)}
                    placeholder="Ticker, e.g. SUNPHARMA or LLY"
                    aria-label="Ticker to analyse"
                    className="h-7 min-w-0 flex-1 rounded-sm border border-terminal-border bg-terminal-bg px-2 text-xs text-terminal-text placeholder:text-terminal-muted focus:border-terminal-accent focus:outline-none"
                />
                <button
                    type="submit"
                    disabled={!symbol}
                    className="h-7 rounded-sm border border-terminal-accent px-2 text-[11px] text-terminal-accent transition-colors duration-150 hover:bg-terminal-accent/15 disabled:cursor-not-allowed disabled:border-terminal-border disabled:text-terminal-muted"
                >
                    Open
                </button>
            </form>
            <ul className="divide-y divide-terminal-border/60">
                {COMPANY_TABS.map(({ label, tab, icon: Icon }) => (
                    <li key={tab}>
                        <button
                            type="button"
                            onClick={() => open(tab)}
                            disabled={!symbol}
                            title={symbol ? `Open ${symbol}: ${label}` : "Enter a ticker first"}
                            className="group flex w-full items-center gap-2 rounded-sm px-1 py-1.5 text-left transition-colors duration-150 enabled:hover:bg-terminal-bg/60 disabled:cursor-not-allowed focus-visible:outline focus-visible:outline-1 focus-visible:outline-terminal-accent"
                        >
                            <Icon className="h-3.5 w-3.5 shrink-0 text-terminal-muted group-enabled:group-hover:text-terminal-accent" aria-hidden="true" />
                            <span className="text-xs text-terminal-text group-disabled:text-terminal-muted group-enabled:group-hover:text-terminal-accent">{label}</span>
                        </button>
                    </li>
                ))}
            </ul>
        </section>
    );
}

/* ── Live side widgets ───────────────────────────────────────────────────── */

function MoverList({ rows, loading }: { rows: MoverRow[]; loading: boolean }) {
    if (loading) return <div className="h-20 animate-pulse rounded-sm bg-terminal-bg/60 motion-reduce:animate-none" aria-label="Loading movers" />;
    if (!rows.length) return <div className="text-xs text-terminal-muted">None</div>;
    return (
        <ul className="space-y-1">
            {rows.map((row) => (
                <li key={row.symbol} className="flex justify-between gap-2 text-xs">
                    <Link to={`/equity/security/${encodeURIComponent(row.symbol)}`} className="text-terminal-text hover:text-terminal-accent">
                        {row.symbol}
                    </Link>
                    <span className={`ot-type-data ${toneOf(row.change_pct)}`}>{fmtPct(row.change_pct)}</span>
                </li>
            ))}
        </ul>
    );
}

function ThemeLeaders({ market }: { market: "IN" | "US" }) {
    const { data, isLoading } = useQuery({ queryKey: ["dashboard-themes", market], queryFn: () => fetchThemes(market), staleTime: 15 * 60_000 });
    const ranked = [...(data?.themes ?? [])].filter((t) => t.return_1m != null).sort((a, b) => (b.return_1m ?? 0) - (a.return_1m ?? 0));
    const rows = ranked.length > 5 ? [...ranked.slice(0, 3), ...ranked.slice(-2)] : ranked;
    return (
        <TerminalPanel
            title="Theme leaders"
            subtitle={`1-month return · ${market}`}
            actions={<Link to="/equity/sector-rotation?view=themes" className="text-[11px] text-terminal-muted hover:text-terminal-accent">All themes</Link>}
        >
            {isLoading ? (
                <div className="h-24 animate-pulse rounded-sm bg-terminal-bg/60 motion-reduce:animate-none" aria-label="Loading themes" />
            ) : !rows.length ? (
                <div className="text-xs text-terminal-muted">Theme indices are unavailable right now.</div>
            ) : (
                <ul className="space-y-1">
                    {rows.map((t) => (
                        <li key={t.id} className="flex justify-between gap-2 text-xs">
                            <span className="truncate text-terminal-text">{t.name}</span>
                            <span className={`ot-type-data ${toneOf(t.return_1m)}`}>{fmtPct(t.return_1m)}</span>
                        </li>
                    ))}
                </ul>
            )}
        </TerminalPanel>
    );
}

const SCORE_TONE: Record<string, string> = { strong: "text-terminal-pos", weak: "text-terminal-neg", mixed: "text-terminal-warn" };

function ResultsPulse({ market }: { market: "IN" | "US" }) {
    const { data, isLoading } = useQuery({ queryKey: ["dashboard-results", market], queryFn: () => fetchLatestResults(market, 8), staleTime: 30 * 60_000 });
    const rows = data?.items ?? [];
    return (
        <TerminalPanel
            title="Latest results"
            subtitle="Reported in the last 14 days"
            actions={<Link to="/equity/earnings?view=results" className="text-[11px] text-terminal-muted hover:text-terminal-accent">Results tracker</Link>}
        >
            {isLoading ? (
                <div className="h-24 animate-pulse rounded-sm bg-terminal-bg/60 motion-reduce:animate-none" aria-label="Loading results" />
            ) : !rows.length ? (
                <div className="text-xs text-terminal-muted">No companies reported results in the last 14 days.</div>
            ) : (
                <table className="w-full text-xs">
                    <thead>
                        <tr className="text-left text-[10px] text-terminal-muted">
                            <th className="pb-1 font-normal">Symbol</th>
                            <th className="pb-1 text-right font-normal">Rev YoY</th>
                            <th className="pb-1 text-right font-normal">Profit YoY</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.slice(0, 6).map((r) => (
                            <tr key={`${r.symbol}-${r.period}`} className="border-t border-terminal-border/50">
                                <td className="py-1">
                                    <Link to={`/equity/security/${encodeURIComponent(r.symbol)}?tab=financials`} className={`hover:underline ${SCORE_TONE[r.scorecard] ?? "text-terminal-text"}`}>
                                        {r.symbol}
                                    </Link>
                                </td>
                                <td className={`py-1 text-right ot-type-data ${toneOf(r.revenue_yoy_pct)}`}>{fmtPct(r.revenue_yoy_pct)}</td>
                                <td className={`py-1 text-right ot-type-data ${toneOf(r.profit_yoy_pct)}`}>{fmtPct(r.profit_yoy_pct)}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            )}
        </TerminalPanel>
    );
}

/* ── Page ────────────────────────────────────────────────────────────────── */

function StatusChip({ label, value, tone }: { label: string; value: string; tone: string }) {
    return (
        <span className="inline-flex items-center gap-1.5 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-0.5 text-[11px]">
            <span className={`h-1.5 w-1.5 rounded-full ${tone}`} aria-hidden="true" />
            <span className="text-terminal-muted">{label}</span>
            <span className="text-terminal-text">{value}</span>
        </span>
    );
}

export function DashboardPage() {
    const { data: marketStatus } = useMarketStatus();
    const selectedMarket = useSettingsStore((s) => s.selectedMarket);
    const market = marketFromDesk(selectedMarket);
    const today = new Date();
    const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { data: earningsThisWeek = [] } = useEarningsCalendar({
        from_date: today.toISOString().slice(0, 10),
        to_date: weekAhead.toISOString().slice(0, 10),
    });
    const gainers = useMovers("gainers");
    const losers = useMovers("losers");
    const moversUnavailable = !gainers.isLoading && !losers.isLoading && !(gainers.data?.length || losers.data?.length);
    const status = (marketStatus ?? {}) as Record<string, unknown> & {
        error?: string;
        nseStatus?: string;
        nyseStatus?: string;
        source?: { nseIndices?: boolean };
    };
    const statusError = Boolean(status.error);
    const nseLive = status.source?.nseIndices === true;
    const openTone = (s?: string) => (s === "OPEN" ? "bg-terminal-pos" : "bg-terminal-muted");

    return (
        <div className="space-y-3 px-3 py-2">
            <header className="flex flex-wrap items-end justify-between gap-2">
                <div>
                    <h1 className="text-xl font-semibold text-terminal-text">Market overview</h1>
                    <p className="text-xs text-terminal-muted">Indices, movers and every research workflow in one place.</p>
                </div>
                <div className="flex flex-wrap gap-1.5" aria-label="Market status">
                    {statusError ? (
                        <StatusChip label="Status" value="unavailable" tone="bg-terminal-neg" />
                    ) : (
                        <>
                            <StatusChip label="NSE" value={status.nseStatus ?? "NA"} tone={openTone(status.nseStatus)} />
                            <StatusChip label="NYSE" value={status.nyseStatus ?? "NA"} tone={openTone(status.nyseStatus)} />
                        </>
                    )}
                    <StatusChip label="Data" value={nseLive ? "NSE direct" : "Yahoo (delayed)"} tone={nseLive ? "bg-terminal-pos" : "bg-terminal-warn"} />
                </div>
            </header>

            <IndexStrip status={status} />

            <div className="grid grid-cols-1 gap-3 xl:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
                <div className="min-w-0 space-y-3">
                    <TerminalPanel title="Research workflows" subtitle="Company tools open the Security Hub on the matching tab">
                        <div className="grid gap-4 md:grid-cols-3">
                            <WorkflowList title="Discover" items={DISCOVER} />
                            <CompanyJump />
                            <WorkflowList title="Monitor" items={MONITOR} />
                        </div>
                    </TerminalPanel>
                    <IdeasRadar market={market} />
                    <BulkDealsTable />
                </div>

                <aside className="min-w-0 space-y-3" aria-label="Market pulse">
                    <TerminalPanel title="Market movers" subtitle="NSE large caps, latest session">
                        {moversUnavailable ? (
                            <div className="text-xs text-terminal-muted">Movers unavailable: the price history provider did not respond.</div>
                        ) : (
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="mb-1 text-[11px] text-terminal-pos">Top gainers</div>
                                    <MoverList rows={gainers.data ?? []} loading={gainers.isLoading} />
                                </div>
                                <div>
                                    <div className="mb-1 text-[11px] text-terminal-neg">Top losers</div>
                                    <MoverList rows={losers.data ?? []} loading={losers.isLoading} />
                                </div>
                            </div>
                        )}
                    </TerminalPanel>
                    <ThemeLeaders market={market} />
                    <ResultsPulse market={market} />
                    <EventCalendar />
                    <TerminalPanel title="Earnings this week" subtitle="Scheduled announcements">
                        {earningsThisWeek.length === 0 ? (
                            <div className="text-xs text-terminal-muted">No earnings scheduled in the next 7 days.</div>
                        ) : (
                            <ul className="divide-y divide-terminal-border/60">
                                {earningsThisWeek.slice(0, 8).map((row) => (
                                    <li key={`${row.symbol}-${row.earnings_date}`} className="flex justify-between gap-2 py-1 text-xs">
                                        <Link to={`/equity/security/${encodeURIComponent(row.symbol)}`} className="text-terminal-text hover:text-terminal-accent">{row.symbol}</Link>
                                        <span className="text-terminal-muted">{row.earnings_date} · {row.fiscal_quarter}</span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </TerminalPanel>
                </aside>
            </div>
        </div>
    );
}
