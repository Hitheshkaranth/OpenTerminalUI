import React from "react";
import { useBulkDeals } from "../../hooks/useStocks";
import { formatInr } from "../../utils/formatters";
import type { BulkDeal } from "../../types";

export const BulkDealsTable: React.FC = () => {
    const { data, isLoading, error } = useBulkDeals();
    const rows: BulkDeal[] = Array.isArray(data?.data)
        ? data.data.map((item) => ({
            symbol: String(item.symbol ?? "-"),
            clientName: String(item.clientName ?? "-"),
            buySell: String(item.buySell ?? "BUY") === "SELL" ? "SELL" : "BUY",
            quantity: Number(item.quantity ?? 0),
            tradePrice: Number(item.tradePrice ?? 0),
        }))
        : [];

    if (isLoading) return <div className="h-64 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;
    if (error) return <div className="text-terminal-neg">Failed to load bulk deals</div>;
    if (!rows.length) return <div className="text-terminal-muted">No bulk deals found today</div>;

    return (
        <div className="overflow-hidden rounded border border-terminal-border bg-terminal-panel p-4">
            <div className="flex justify-between items-center mb-4">
                <h3 className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Bulk Deals</h3>
                <span className="text-xs text-terminal-muted">Live</span>
            </div>
            <div className="overflow-x-auto">
                <table className="min-w-full divide-y divide-terminal-border text-xs">
                    <thead className="bg-terminal-bg/40">
                        <tr>
                            <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-terminal-muted">Symbol</th>
                            <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-terminal-muted">Client</th>
                            <th className="px-3 py-2 text-left font-medium uppercase tracking-wider text-terminal-muted">Type</th>
                            <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-terminal-muted">Qty</th>
                            <th className="px-3 py-2 text-right font-medium uppercase tracking-wider text-terminal-muted">Price</th>
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-terminal-border/60">
                        {rows.slice(0, 10).map((deal, idx) => (
                            <tr key={idx} className="transition-colors hover:bg-terminal-bg/50">
                                <td className="whitespace-nowrap px-3 py-2 text-terminal-accent">{deal.symbol}</td>
                                <td className="max-w-[150px] truncate whitespace-nowrap px-3 py-2 text-terminal-muted" title={deal.clientName}>{deal.clientName}</td>
                                <td className="px-3 py-2 whitespace-nowrap text-xs">
                                    <span className={`rounded px-2 py-0.5 ${deal.buySell === "BUY" ? "bg-terminal-pos/20 text-terminal-pos" : "bg-terminal-neg/20 text-terminal-neg"}`}>
                                        {deal.buySell}
                                    </span>
                                </td>
                                <td className="whitespace-nowrap px-3 py-2 text-right text-terminal-text">{Number(deal.quantity).toLocaleString()}</td>
                                <td className="whitespace-nowrap px-3 py-2 text-right text-terminal-text">{formatInr(Number(deal.tradePrice))}</td>
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
