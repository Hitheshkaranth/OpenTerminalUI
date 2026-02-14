import React, { useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useDisplayCurrency } from "../../hooks/useDisplayCurrency";
import { useFinancials } from "../../hooks/useStocks";

interface FinancialTrendProps {
  ticker: string;
}

export const FinancialTrend: React.FC<FinancialTrendProps> = ({ ticker }) => {
  const { data, isLoading, error } = useFinancials(ticker, "annual");
  const { financialUnit, scaleFinancialAmount } = useDisplayCurrency();
  const [metricType, setMetricType] = useState<"revenue_profit" | "margins">("revenue_profit");

  const chartData = useMemo(() => {
    if (!data?.income_statement?.length) return [];
    const years = Object.keys(data.income_statement[0] || {}).filter((k) => k !== "metric").sort();
    return years.map((year) => {
      const getVal = (metricName: string) => {
        const row = data.income_statement.find(
          (r) => String(r.metric || "").toLowerCase() === metricName.toLowerCase()
        );
        return row ? Number(row[year]) || 0 : 0;
      };
      const revenue = getVal("Revenue");
      const netIncome = getVal("Net Income");
      return {
        year,
        revenueScaled: scaleFinancialAmount(revenue),
        netIncomeScaled: scaleFinancialAmount(netIncome),
        margin: revenue ? (netIncome / revenue) * 100 : 0,
      };
    });
  }, [data, scaleFinancialAmount]);

  if (isLoading) return <div className="h-64 animate-pulse rounded border border-terminal-border bg-terminal-panel"></div>;
  if (error) return <div className="text-terminal-neg">Failed to load financials</div>;
  if (!chartData.length) return <div className="text-terminal-muted">No financial data available</div>;

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Financial Trend (Annual)</h3>
        <div className="space-x-2">
          <button
            onClick={() => setMetricType("revenue_profit")}
            className={`rounded border px-3 py-1 text-xs ${metricType === "revenue_profit" ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
          >
            Revenue & Profit
          </button>
          <button
            onClick={() => setMetricType("margins")}
            className={`rounded border px-3 py-1 text-xs ${metricType === "margins" ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
          >
            Margins
          </button>
        </div>
      </div>

      <div className="h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {metricType === "revenue_profit" ? (
            <BarChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
              <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} />
              <YAxis
                axisLine={false}
                tickLine={false}
                tick={{ fill: "#8e98a8", fontSize: 11 }}
                tickFormatter={(v) => `${Number(v).toFixed(0)} ${financialUnit}`}
              />
              <Tooltip
                formatter={(value: number | string | undefined) => `${Number(value ?? 0).toLocaleString("en-US", { maximumFractionDigits: 2 })} ${financialUnit}`}
                contentStyle={{ borderRadius: "4px", border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
              />
              <Legend wrapperStyle={{ color: "#d8dde7" }} />
              <Bar dataKey="revenueScaled" name={`Revenue (${financialUnit})`} fill="#ff9f1a" radius={[4, 4, 0, 0]} maxBarSize={50} />
              <Bar dataKey="netIncomeScaled" name={`Net Profit (${financialUnit})`} fill="#00c176" radius={[4, 4, 0, 0]} maxBarSize={50} />
            </BarChart>
          ) : (
            <LineChart data={chartData}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
              <XAxis dataKey="year" axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} />
              <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 11 }} unit="%" />
              <Tooltip contentStyle={{ borderRadius: "4px", border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }} />
              <Legend wrapperStyle={{ color: "#d8dde7" }} />
              <Line type="monotone" dataKey="margin" name="Net Margin %" stroke="#ff9f1a" strokeWidth={3} dot={{ r: 4 }} />
            </LineChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
