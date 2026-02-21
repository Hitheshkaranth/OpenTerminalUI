import React, { useEffect, useState } from "react";
import { fetchCockpitSummary } from "../../api/quantClient";

export function CockpitDashboard() {
    const [data, setData] = useState<any>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);

    async function loadData() {
        setLoading(true);
        setError(null);
        try {
            const summary = await fetchCockpitSummary();
            setData(summary);
        } catch (e: any) {
            setError(e.message || "Failed to load cockpit summary");
        } finally {
            setLoading(false);
        }
    }

    useEffect(() => {
        loadData();
    }, []);

    return (
        <div className="space-y-4 p-4">
            <div className="flex justify-between items-center rounded border border-terminal-border bg-terminal-panel p-3">
                <h1 className="text-lg font-bold text-terminal-accent">Cockpit Aggregator</h1>
                <button
                    className="rounded border border-terminal-border px-3 py-1 text-sm hover:bg-terminal-border/30"
                    onClick={loadData}
                    disabled={loading}
                >
                    {loading ? "Refreshing..." : "Refresh"}
                </button>
            </div>

            {error ? (
                <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-4 text-terminal-neg">
                    {error}
                </div>
            ) : loading && !data ? (
                <div className="flex justify-center p-8">
                    <div className="animate-pulse text-terminal-accent">Loading...</div>
                </div>
            ) : data ? (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">

                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                        <h2 className="mb-2 font-semibold text-terminal-text">Portfolio Snapshot</h2>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between"><span>Value:</span> <span>${data.portfolio_snapshot?.total_value?.toLocaleString()}</span></div>
                            <div className="flex justify-between"><span>PnL:</span> <span className={data.portfolio_snapshot?.daily_pnl >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>${data.portfolio_snapshot?.daily_pnl?.toLocaleString()}</span></div>
                            <div className="flex justify-between"><span>Active Jobs:</span> <span>{data.portfolio_snapshot?.active_jobs}</span></div>
                        </div>
                    </div>

                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                        <h2 className="mb-2 font-semibold text-terminal-text">Signal Summary</h2>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between"><span>Bullish:</span> <span className="text-terminal-pos">{data.signal_summary?.bullish_count}</span></div>
                            <div className="flex justify-between"><span>Bearish:</span> <span className="text-terminal-neg">{data.signal_summary?.bearish_count}</span></div>
                            <div className="flex justify-between"><span>Neutral:</span> <span>{data.signal_summary?.neutral_count}</span></div>
                        </div>
                    </div>

                    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
                        <h2 className="mb-2 font-semibold text-terminal-text">Risk Summary</h2>
                        <div className="space-y-1 text-sm">
                            <div className="flex justify-between"><span>VaR (95%):</span> <span>{data.risk_summary?.var_95}</span></div>
                            <div className="flex justify-between"><span>Beta:</span> <span>{data.risk_summary?.beta?.toFixed(2)}</span></div>
                        </div>
                    </div>

                    <div className="col-span-full rounded border border-terminal-border bg-terminal-panel p-4">
                        <h2 className="mb-2 font-semibold text-terminal-text">Recent Events &amp; News</h2>
                        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            <div>
                                <h3 className="text-xs font-bold text-terminal-accent mb-1 border-b border-terminal-border pb-1">Events</h3>
                                <ul className="text-sm space-y-1 mt-2">
                                    {data.events?.map((e: any, i: number) => (
                                        <li key={i} className="flex justify-between">
                                            <span>{e.symbol}</span>
                                            <span className="text-terminal-dim">{e.event_type}</span>
                                        </li>
                                    ))}
                                </ul>
                            </div>
                            <div>
                                <h3 className="text-xs font-bold text-terminal-accent mb-1 border-b border-terminal-border pb-1">News</h3>
                                <ul className="text-sm space-y-1 mt-2">
                                    {data.news?.map((n: any, i: number) => (
                                        <li key={i} className="truncate" title={n.headline}>
                                            <span className="text-terminal-dim mr-2">{n.source}</span>
                                            {n.headline}
                                        </li>
                                    ))}
                                </ul>
                            </div>
                        </div>
                    </div>

                </div>
            ) : (
                <div className="flex flex-col items-center justify-center gap-3 rounded border border-terminal-border bg-terminal-panel p-12 text-center">
                    <span className="text-4xl">🛰</span>
                    <p className="text-terminal-accent font-semibold">Cockpit Aggregator</p>
                    <p className="text-sm text-terminal-muted max-w-md">
                        The cockpit summary endpoint is not yet fully implemented. This view will aggregate portfolio, risk,
                        signals, and news into a single command center once the backend integration is complete.
                    </p>
                    <button
                        className="mt-2 rounded border border-terminal-accent px-4 py-1.5 text-sm text-terminal-accent hover:bg-terminal-accent/10"
                        onClick={loadData}
                    >
                        Retry
                    </button>
                </div>
            )}
        </div>
    );
}
