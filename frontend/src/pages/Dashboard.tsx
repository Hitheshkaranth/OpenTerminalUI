import { BulkDealsTable } from "../components/market/BulkDealsTable";
import { EventCalendar } from "../components/market/EventCalendar";
import { useEarningsCalendar, useMarketStatus } from "../hooks/useStocks";

export function DashboardPage() {
    const { data: marketStatus } = useMarketStatus();
    const today = new Date();
    const weekAhead = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
    const { data: earningsThisWeek = [] } = useEarningsCalendar({
        from_date: today.toISOString().slice(0, 10),
        to_date: weekAhead.toISOString().slice(0, 10),
    });
    const hasMarketData = Array.isArray((marketStatus as { marketState?: unknown[] } | undefined)?.marketState);

    return (
        <div className="space-y-4 px-3 py-2">
            <div className="mb-6">
                <h1 className="text-2xl font-bold text-terminal-accent">Market Overview</h1>
                <p className="text-terminal-muted">Live market insights and upcoming events.</p>
            </div>

            <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
                <div className="lg:col-span-2 space-y-6">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                            <div className="text-xs uppercase text-terminal-muted">NIFTY 50</div>
                            <div className="text-xl font-bold text-terminal-text">{hasMarketData ? "LIVE" : "NA"}</div>
                            <div className="text-sm text-terminal-pos">{hasMarketData ? "Feed Connected" : "Fallback Mode"}</div>
                        </div>
                        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                            <div className="text-xs uppercase text-terminal-muted">Market Status</div>
                            <div className="text-xl font-bold text-terminal-text">
                                {(marketStatus as { error?: string } | undefined)?.error ? "Unavailable" : "Available"}
                            </div>
                            <div className={`text-sm ${(marketStatus as { error?: string } | undefined)?.error ? "text-terminal-neg" : "text-terminal-pos"}`}>
                                {(marketStatus as { error?: string } | undefined)?.error ? "NSE endpoint failed" : "Realtime endpoint active"}
                            </div>
                        </div>
                        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                            <div className="text-xs uppercase text-terminal-muted">Data Vendor</div>
                            <div className="text-xl font-bold text-terminal-text">NSE/Yahoo</div>
                            <div className="text-sm text-terminal-muted">Auto-fallback enabled</div>
                        </div>
                    </div>

                    <BulkDealsTable />
                </div>

                <div className="space-y-6">
                    <EventCalendar />
                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Events This Week</h3>
                        {earningsThisWeek.length === 0 ? (
                            <div className="text-xs text-terminal-muted">No earnings events available for this week.</div>
                        ) : (
                            <div className="space-y-2">
                                {earningsThisWeek.slice(0, 8).map((row) => (
                                    <div key={`${row.symbol}-${row.earnings_date}`} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs">
                                        <div className="font-medium text-terminal-text">{row.symbol}</div>
                                        <div className="text-terminal-muted">{row.earnings_date} - {row.fiscal_quarter}</div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                        <h3 className="mb-3 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Market Movers</h3>
                        <div className="space-y-2">
                            <div className="flex justify-between text-sm">
                                <span className="font-medium text-terminal-pos">Top Gainers</span>
                                <span className="font-medium text-terminal-neg">Top Losers</span>
                            </div>
                            <div className="py-4 text-center text-xs text-terminal-muted">Feature wired, data source pending.</div>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
}
