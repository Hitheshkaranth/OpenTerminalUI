import React, { useMemo } from "react";
import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { useFinancials } from "../../hooks/useStocks";

interface QuarterlyResultsProps {
  ticker: string;
}

export const QuarterlyResults: React.FC<QuarterlyResultsProps> = ({ ticker }) => {
  const { data, isLoading, error } = useFinancials(ticker, "quarterly");
  const { financialUnit, formatFinancialCompact, scaleFinancialAmount } = useDisplayCurrency();

  const chartData = useMemo(() => {
    if (!data?.income_statement?.length) return [];
    const periods = Object.keys(data.income_statement[0] || {}).filter((k) => k !== "metric");
    return periods.slice(0, 8).reverse().map((period) => {
      const getVal = (metricName: string) => {
        const row = data.income_statement.find(
          (r) => String(r.metric || "").toLowerCase() === metricName.toLowerCase()
        );
        return row ? Number(row[period]) || 0 : 0;
      };
      const sales = getVal("Revenue");
      const opProfit = getVal("Operating Income");
      return {
        period,
        salesScaled: scaleFinancialAmount(sales),
        netProfitScaled: scaleFinancialAmount(getVal("Net Income")),
        opm: sales ? (opProfit / sales) * 100 : 0,
      };
    });
  }, [data, scaleFinancialAmount]);

  if (isLoading) return <div className="h-64 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;
  if (error) return <div className="text-terminal-neg">Failed to load quarterly data</div>;
  if (!chartData.length) return <div className="text-terminal-muted">No quarterly data available</div>;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Quarterly Results</h3>
      </div>
      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
            <XAxis dataKey="period" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} />
            <YAxis yAxisId="left" orientation="left" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} tickFormatter={(v) => `${Number(v).toFixed(0)} ${financialUnit}`} />
            <YAxis yAxisId="right" orientation="right" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} unit="%" />
            <Tooltip
              formatter={(value: number | string | undefined, name: string | number | undefined) => {
                const key = String(name || "");
                if (key.includes("OPM")) {
                  return [`${Number(value ?? 0).toFixed(2)}%`, key];
                }
                const scaled = Number(value ?? 0);
                const base = scaled * (financialUnit === "Cr" ? 1e7 : 1e6);
                return [formatFinancialCompact(base), key];
              }}
              contentStyle={{ borderRadius: "4px", border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
            />
            <Legend wrapperStyle={{ color: "#d8dde7" }} />
            <Bar yAxisId="left" dataKey="salesScaled" name={`Sales (${financialUnit})`} fill="#ff9f1a" radius={[4, 4, 0, 0]} barSize={20} />
            <Bar yAxisId="left" dataKey="netProfitScaled" name={`Net Profit (${financialUnit})`} fill="#00c176" radius={[4, 4, 0, 0]} barSize={20} />
            <Line yAxisId="right" type="monotone" dataKey="opm" name="OPM %" stroke="#26c6da" strokeWidth={2} dot={{ r: 4 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
};
