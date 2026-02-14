import React, { useMemo } from "react";
import {
    AreaChart,
    Area,
    XAxis,
    YAxis,
    CartesianGrid,
    Tooltip,
    Legend,
    ResponsiveContainer
} from "recharts";
import { useShareholding } from "../../hooks/useStocks";
import { NewsPanel } from "../market/NewsPanel";

interface ShareholdingChartProps {
    ticker: string;
    market: string;
}

export const ShareholdingChart: React.FC<ShareholdingChartProps> = ({ ticker, market }) => {
    const { data, isLoading, error } = useShareholding(ticker);

    const chartData = useMemo(() => {
        if (!data || !data.history) return [];
        return data.history.map((point) => ({
            date: String(point.date ?? ""),
            promoter: Number(point.promoter ?? 0),
            fii: Number(point.fii ?? 0),
            dii: Number(point.dii ?? 0),
            public: Number(point.public ?? 0),
        }));
    }, [data]);

    if (isLoading) return <div className="h-64 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;
    if (error || !chartData.length) return <NewsPanel symbol={ticker} market={market} limit={12} />;

    return (
        <div className="rounded border border-terminal-border bg-terminal-panel p-4">
            <h3 className="mb-4 text-sm font-semibold uppercase tracking-wide text-terminal-accent">Shareholding Pattern Trend</h3>
            {data?.warning ? <div className="mb-2 text-xs text-terminal-warn">{String(data.warning)}</div> : null}
            <div className="h-80 w-full">
                <ResponsiveContainer width="100%" height="100%">
                    <AreaChart data={chartData}>
                        <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                        <XAxis dataKey="date" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} dy={10} />
                        <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} unit="%" domain={[0, 100]} />
                        <Tooltip
                            contentStyle={{ borderRadius: "4px", border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
                        />
                        <Legend wrapperStyle={{ color: "#d8dde7" }} />
                        <Area type="monotone" dataKey="promoter" stackId="1" stroke="#ff9f1a" fill="#ff9f1a" name="Promoter" />
                        <Area type="monotone" dataKey="fii" stackId="1" stroke="#00c176" fill="#00c176" name="FII" />
                        <Area type="monotone" dataKey="dii" stackId="1" stroke="#26c6da" fill="#26c6da" name="DII" />
                        <Area type="monotone" dataKey="public" stackId="1" stroke="#8e98a8" fill="#8e98a8" name="Public" />
                    </AreaChart>
                </ResponsiveContainer>
            </div>
        </div>
    );
};
