import { useDeferredValue, useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import {
  fetchInsiderClusterBuys,
  fetchRecentInsiderTrades,
  fetchTopInsiderBuyers,
  fetchTopInsiderSellers,
} from "../api/client";
import { DenseTable } from "../components/terminal/DenseTable";
import { TerminalBadge } from "../components/terminal/TerminalBadge";
import { TerminalInput } from "../components/terminal/TerminalInput";
import { TerminalPanel } from "../components/terminal/TerminalPanel";
import { TerminalTabs, type TerminalTabItem } from "../components/terminal/TerminalTabs";
import type { InsiderClusterRow, InsiderTopActivityRow, InsiderTrade } from "../types";

type InsiderTab = "recent" | "buyers" | "sellers" | "clusters";

const TABS: TerminalTabItem[] = [
  { id: "recent", label: "Recent Trades" },
  { id: "buyers", label: "Top Buyers" },
  { id: "sellers", label: "Top Sellers" },
  { id: "clusters", label: "Cluster Buys" },
];

function formatCurrency(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function formatPrice(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `$${numeric.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function SummaryCard({
  label,
  value,
  positive,
  onClick,
}: {
  label: string;
  value: string;
  positive?: boolean | null;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-sm border border-terminal-border bg-terminal-panel px-3 py-3 text-left ${
        onClick ? "transition-colors hover:border-terminal-accent" : ""
      }`}
    >
      <div className="ot-type-label text-terminal-muted">{label}</div>
      <div
        className={`mt-2 text-xl ${
          positive == null ? "text-terminal-text" : positive ? "text-terminal-pos" : "text-terminal-neg"
        }`}
      >
        {value}
      </div>
    </button>
  );
}

function filterTradesByDateRange(rows: InsiderTrade[], fromDate: string, toDate: string): InsiderTrade[] {
  if (!fromDate && !toDate) return rows;
  const fromTs = fromDate ? new Date(fromDate).getTime() : Number.NEGATIVE_INFINITY;
  const toTs = toDate ? new Date(toDate).getTime() : Number.POSITIVE_INFINITY;
  return rows.filter((row) => {
    const tradeTs = new Date(row.date).getTime();
    return tradeTs >= fromTs && tradeTs <= toTs;
  });
}

function RankedActivityPanel({
  title,
  subtitle,
  rows,
  rowLabel,
}: {
  title: string;
  subtitle: string;
  rows: InsiderTopActivityRow[];
  rowLabel: string;
}) {
  const chartRows = rows.slice(0, 10).map((row) => ({
    symbol: row.symbol,
    total_value: row.total_value,
  }));

  return (
    <div className="grid gap-2 xl:grid-cols-[1.25fr_0.95fr]">
      <TerminalPanel title={title} subtitle={subtitle}>
        <DenseTable
          id={`insider-${rowLabel}`}
          rows={rows}
          columns={[
            { key: "rank", title: "#", width: 70, align: "right", getValue: (_, index) => index + 1, render: (_, index) => index + 1 },
            {
              key: "symbol",
              title: "Symbol",
              width: 110,
              render: (row) => (
                <Link className="text-terminal-accent hover:underline" to={`/equity/security/${row.symbol}`}>
                  {row.symbol}
                </Link>
              ),
              getValue: (row) => row.symbol,
            },
            { key: "name", title: "Name", width: 220, sortable: true, getValue: (row) => row.name },
            { key: "total_value", title: "Total Value", type: "currency", align: "right", sortable: true, render: (row) => formatCurrency(row.total_value), getValue: (row) => row.total_value },
            { key: "trade_count", title: "Trades", type: "number", align: "right", sortable: true, getValue: (row) => row.trade_count },
            { key: "latest_date", title: "Latest", width: 130, sortable: true, getValue: (row) => row.latest_date },
          ]}
          rowKey={(row, index) => `${row.symbol}-${index}`}
          height={360}
        />
      </TerminalPanel>

      <TerminalPanel title="Value Ladder" subtitle="Top 10 by disclosed value">
        <div className="h-[360px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartRows} layout="vertical" margin={{ top: 8, right: 20, left: 8, bottom: 8 }}>
              <CartesianGrid stroke="#253041" strokeDasharray="3 3" />
              <XAxis type="number" tick={{ fill: "#94a3b8", fontSize: 11 }} tickFormatter={(value) => `$${Math.round(Number(value) / 1_000_000)}M`} />
              <YAxis type="category" dataKey="symbol" tick={{ fill: "#e2e8f0", fontSize: 11 }} width={90} />
              <Tooltip
                cursor={{ fill: "rgba(255,107,0,0.08)" }}
                formatter={(value) => [formatCurrency(Number(value ?? 0)), "Value"]}
                contentStyle={{ background: "#0f1720", border: "1px solid #334155", color: "#e2e8f0" }}
              />
              <Bar dataKey="total_value" fill="#FF6B00" radius={[0, 3, 3, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </TerminalPanel>
    </div>
  );
}

export function InsiderActivityPage() {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useState<InsiderTab>("recent");
  const [days, setDays] = useState(30);
  const [minValue, setMinValue] = useState(1_000_000);
  const [typeFilter, setTypeFilter] = useState<"" | "buy" | "sell">("");
  const [symbolSearch, setSymbolSearch] = useState("");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [expandedCluster, setExpandedCluster] = useState<string | null>(null);
  const deferredSymbolSearch = useDeferredValue(symbolSearch.trim().toUpperCase());

  const summaryQuery = useQuery({
    queryKey: ["insider", "summary", 30],
    queryFn: () => fetchRecentInsiderTrades({ days: 30, min_value: 0, limit: 250 }),
    staleTime: 60_000,
  });
  const recentQuery = useQuery({
    queryKey: ["insider", "recent", days, minValue, typeFilter],
    queryFn: () => fetchRecentInsiderTrades({ days, min_value: minValue, type: typeFilter, limit: 100 }),
    staleTime: 60_000,
  });
  const topBuyersQuery = useQuery({
    queryKey: ["insider", "buyers"],
    queryFn: () => fetchTopInsiderBuyers(90, 20),
    staleTime: 60_000,
  });
  const topSellersQuery = useQuery({
    queryKey: ["insider", "sellers"],
    queryFn: () => fetchTopInsiderSellers(90, 20),
    staleTime: 60_000,
  });
  const clusterQuery = useQuery({
    queryKey: ["insider", "clusters"],
    queryFn: () => fetchInsiderClusterBuys(30, 3),
    staleTime: 60_000,
  });

  const summaryTrades = summaryQuery.data?.trades ?? [];
  const totalBuyValue = summaryTrades.reduce((sum, row) => sum + (row.type === "buy" ? Number(row.value || 0) : 0), 0);
  const totalSellValue = summaryTrades.reduce((sum, row) => sum + (row.type === "sell" ? Number(row.value || 0) : 0), 0);
  const netFlow = totalBuyValue - totalSellValue;

  const recentRows = useMemo(() => {
    let rows = recentQuery.data?.trades ?? [];
    rows = filterTradesByDateRange(rows, fromDate, toDate);
    if (deferredSymbolSearch) {
      rows = rows.filter((row) => row.symbol.includes(deferredSymbolSearch) || row.name.toUpperCase().includes(deferredSymbolSearch));
    }
    return rows;
  }, [deferredSymbolSearch, fromDate, recentQuery.data?.trades, toDate]);

  const clusterRows = clusterQuery.data?.clusters ?? [];

  return (
    <div className="h-full min-h-0 overflow-auto p-2">
      <div className="grid gap-2">
        <div className="grid gap-2 lg:grid-cols-4">
          <SummaryCard label="Total Buy Value (30d)" value={formatCurrency(totalBuyValue)} positive />
          <SummaryCard label="Total Sell Value (30d)" value={formatCurrency(totalSellValue)} positive={false} />
          <SummaryCard label="Net Insider Flow (30d)" value={formatCurrency(netFlow)} positive={netFlow >= 0} />
          <SummaryCard label="Cluster Buy Stocks" value={String(clusterRows.length)} positive={null} onClick={() => setActiveTab("clusters")} />
        </div>

        <TerminalPanel
          title="Insider Activity"
          subtitle="Officer and director accumulation / distribution tracker"
          actions={<TerminalTabs items={TABS} value={activeTab} onChange={(value) => setActiveTab(value as InsiderTab)} variant="accent" />}
        >
          {activeTab === "recent" ? (
            <div className="grid gap-2">
              <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-5">
                <TerminalInput as="select" aria-label="Recent insider date range" value={String(days)} onChange={(event) => setDays(Number(event.target.value))}>
                  <option value="7">Last 7d</option>
                  <option value="30">Last 30d</option>
                  <option value="90">Last 90d</option>
                  <option value="365">Last 1y</option>
                </TerminalInput>
                <TerminalInput aria-label="Recent insider from date" type="date" value={fromDate} onChange={(event) => setFromDate(event.target.value)} />
                <TerminalInput aria-label="Recent insider to date" type="date" value={toDate} onChange={(event) => setToDate(event.target.value)} />
                <TerminalInput aria-label="Recent insider minimum value" type="number" min={0} value={minValue} onChange={(event) => setMinValue(Number(event.target.value) || 0)} placeholder="Min value" />
                <div className="grid grid-cols-[120px_1fr] gap-2">
                  <TerminalInput as="select" aria-label="Recent insider type" value={typeFilter} onChange={(event) => setTypeFilter(event.target.value as "" | "buy" | "sell")}>
                    <option value="">All</option>
                    <option value="buy">Buy</option>
                    <option value="sell">Sell</option>
                  </TerminalInput>
                  <TerminalInput aria-label="Recent insider symbol search" value={symbolSearch} onChange={(event) => setSymbolSearch(event.target.value)} placeholder="Symbol" />
                </div>
              </div>

              <DenseTable
                id="insider-recent-trades"
                rows={recentRows}
                columns={[
                  { key: "date", title: "Date", type: "text", width: 120, sortable: true, getValue: (row) => row.date },
                  {
                    key: "symbol",
                    title: "Symbol",
                    width: 110,
                    render: (row) => (
                      <button type="button" className="text-terminal-accent hover:underline" onClick={() => navigate(`/equity/security/${row.symbol}`)}>
                        {row.symbol}
                      </button>
                    ),
                    getValue: (row) => row.symbol,
                  },
                  { key: "insider_name", title: "Insider Name", width: 200, sortable: true, getValue: (row) => row.insider_name },
                  { key: "designation", title: "Designation", width: 180, sortable: true, getValue: (row) => row.designation },
                  {
                    key: "type",
                    title: "Type",
                    width: 100,
                    sortable: true,
                    render: (row) => <TerminalBadge variant={row.type === "buy" ? "success" : "danger"}>{row.type.toUpperCase()}</TerminalBadge>,
                    getValue: (row) => row.type,
                  },
                  { key: "quantity", title: "Qty", type: "volume", align: "right", sortable: true, getValue: (row) => row.quantity },
                  { key: "price", title: "Price", type: "currency", align: "right", sortable: true, render: (row) => formatPrice(row.price), getValue: (row) => row.price },
                  { key: "value", title: "Value", type: "currency", align: "right", sortable: true, render: (row) => formatCurrency(row.value), getValue: (row) => row.value },
                  {
                    key: "post_holding_pct",
                    title: "Post-Holding %",
                    type: "number",
                    align: "right",
                    sortable: true,
                    render: (row) => (row.post_holding_pct == null ? "-" : `${row.post_holding_pct.toFixed(2)}%`),
                    getValue: (row) => row.post_holding_pct,
                  },
                ]}
                rowKey={(row, index) => `${row.symbol}-${row.insider_name}-${row.date}-${index}`}
                height={420}
              />
            </div>
          ) : null}

          {activeTab === "buyers" ? (
            <RankedActivityPanel title="Top Buyers" subtitle="Highest accumulated insider buy value over 90 days" rows={topBuyersQuery.data?.buyers ?? []} rowLabel="buyers" />
          ) : null}

          {activeTab === "sellers" ? (
            <RankedActivityPanel title="Top Sellers" subtitle="Highest insider sell value over 90 days" rows={topSellersQuery.data?.sellers ?? []} rowLabel="sellers" />
          ) : null}

          {activeTab === "clusters" ? (
            <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-3">
              {clusterRows.map((cluster: InsiderClusterRow) => {
                const expanded = expandedCluster === cluster.symbol;
                return (
                  <div
                    key={cluster.symbol}
                    className="rounded-sm border border-terminal-accent/50 bg-terminal-panel p-3 shadow-[0_0_18px_rgba(255,107,0,0.12)]"
                    data-testid="cluster-buy-card"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <button type="button" className="text-left text-terminal-accent hover:underline" onClick={() => navigate(`/equity/security/${cluster.symbol}`)}>
                          <div className="text-lg">{cluster.symbol}</div>
                        </button>
                        <div className="text-xs text-terminal-muted">{cluster.name}</div>
                      </div>
                      <TerminalBadge variant="accent">{cluster.insider_count} insiders</TerminalBadge>
                    </div>
                    <div className="mt-3 text-sm text-terminal-text">{formatCurrency(cluster.total_value)}</div>
                    <button
                      type="button"
                      className="mt-3 text-xs text-terminal-accent hover:underline"
                      onClick={() => setExpandedCluster(expanded ? null : cluster.symbol)}
                    >
                      {expanded ? "Hide insider list" : "Show insider list"}
                    </button>
                    {expanded ? (
                      <div className="mt-3 grid gap-2">
                        {cluster.insiders.map((insider) => (
                          <div key={`${cluster.symbol}-${insider.name}`} className="rounded-sm border border-terminal-border bg-terminal-bg px-2 py-2">
                            <div className="flex items-center justify-between gap-2">
                              <div>
                                <div className="text-sm text-terminal-text">{insider.name}</div>
                                <div className="text-[11px] text-terminal-muted">{insider.designation || "Insider"}</div>
                              </div>
                              <div className="text-right">
                                <div className="text-sm text-terminal-accent">{formatCurrency(insider.value)}</div>
                                <div className="text-[11px] text-terminal-muted">{insider.date || "-"}</div>
                              </div>
                            </div>
                          </div>
                        ))}
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          ) : null}
        </TerminalPanel>
      </div>
    </div>
  );
}
