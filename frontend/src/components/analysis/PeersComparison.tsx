import React from "react";
import { usePeerComparison } from "../../hooks/useStocks";
import { ArrowUpIcon, ArrowDownIcon } from "@heroicons/react/20/solid";

interface PeersComparisonProps {
    ticker: string;
}

export const PeersComparison: React.FC<PeersComparisonProps> = ({ ticker }) => {
    const { data, isLoading, error } = usePeerComparison(ticker);

    if (isLoading) return <div className="h-64 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;
    if (error || !data) return <div className="text-terminal-neg">Failed to load peer comparison</div>;

    return (
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Peer Comparison</h3>
                <span className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-muted">{data.universe}</span>
            </div>

            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-terminal-border text-xs">
                    <thead>
                        <tr>
                            <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-terminal-muted">Metric</th>
                            <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-terminal-muted">{ticker}</th>
                            <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-terminal-muted">Peer Median</th>
                            <th className="px-3 py-2 text-center font-medium uppercase tracking-wider text-terminal-muted">vs Median</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/60">
                        {data.metrics.map((m) => {
                            const diff = m.target_value - (m.peer_median || 0);
                            const diffPct = m.peer_median ? (diff / m.peer_median) * 100 : 0;
                            const isPositive = diff > 0;

                            return (
                                <tr key={m.metric}>
                                    <td className="whitespace-nowrap px-3 py-3 font-medium capitalize text-terminal-text">{m.metric.replace(/_/g, " ")}</td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right text-terminal-text">{m.target_value?.toFixed(2) ?? "-"}</td>
                                    <td className="whitespace-nowrap px-3 py-3 text-right text-terminal-muted">{m.peer_median?.toFixed(2) ?? "-"}</td>
                                    <td className="whitespace-nowrap px-3 py-3 text-center">
                                        <span className={`inline-flex items-center rounded px-2 py-0.5 font-medium ${isPositive ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-neg/20 text-terminal-neg"}`}>
                                            {isPositive ? <ArrowUpIcon className="w-3 h-3 mr-1" /> : <ArrowDownIcon className="w-3 h-3 mr-1" />}
                                            {Math.abs(diffPct).toFixed(1)}%
                                        </span>
                                    </td>
                                </tr>
                            );
                        })}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
