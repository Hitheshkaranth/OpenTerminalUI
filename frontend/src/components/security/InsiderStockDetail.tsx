import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";

import { fetchInsiderStock } from "../../api/client";
import { TradingChart } from "../chart/TradingChart";
import { DenseTable } from "../terminal/DenseTable";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { useStockHistory } from "../../hooks/useStocks";
import type { ChartPoint, CorporateEvent, InsiderTrade } from "../../types";

function formatCurrency(value: number | null | undefined): string {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return "-";
  return `$${numeric.toLocaleString("en-US", { maximumFractionDigits: 0 })}`;
}

function SummaryTile({ label, value, positive }: { label: string; value: string; positive?: boolean | null }) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-2">
      <div className="ot-type-label text-terminal-muted">{label}</div>
      <div
        className={`mt-1 text-lg ${
          positive == null ? "text-terminal-text" : positive ? "text-terminal-pos" : "text-terminal-neg"
        }`}
      >
        {value}
      </div>
    </div>
  );
}

function toContextEvent(trade: InsiderTrade): CorporateEvent {
  const isBuy = trade.type === "buy";
  return {
    symbol: trade.symbol,
    event_type: "insider_trade",
    title: `${isBuy ? "Buy" : "Sell"} · ${trade.insider_name}`,
    description: `${trade.designation || "Insider"} ${isBuy ? "bought" : "sold"} ${Number(trade.quantity || 0).toLocaleString("en-US")} shares`,
    event_date: trade.date,
    value: trade.value != null ? formatCurrency(trade.value) : null,
    source: "Insider Activity",
    impact: isBuy ? "positive" : "negative",
  };
}

export function InsiderStockDetail({ ticker }: { ticker: string }) {
  const insiderQuery = useQuery({
    queryKey: ["insider", "stock", ticker],
    queryFn: () => fetchInsiderStock(ticker, 365),
    staleTime: 60_000,
  });
  const historyQuery = useStockHistory(ticker, "1y", "1d");

  const trades = insiderQuery.data?.trades ?? [];
  const summary = insiderQuery.data?.summary;
  const contextEvents = useMemo(() => trades.slice(0, 40).map(toContextEvent), [trades]);

  return (
    <div className="grid gap-2">
      <div className="grid gap-2 md:grid-cols-4">
        <SummaryTile label="Total Buys" value={formatCurrency(summary?.total_buys)} positive />
        <SummaryTile label="Total Sells" value={formatCurrency(summary?.total_sells)} positive={false} />
        <SummaryTile label="Net Insider Flow" value={formatCurrency(summary?.net_value)} positive={(summary?.net_value ?? 0) >= 0} />
        <SummaryTile label="Active Insiders" value={String(summary?.insider_count ?? 0)} positive={null} />
      </div>

      <TerminalPanel title="Insider Timeline" subtitle={`${ticker.toUpperCase()} buys and sells over the last year`}>
        <div className="h-[420px]">
          <TradingChart
            ticker={ticker.toUpperCase()}
            data={((historyQuery.data?.data ?? []) as ChartPoint[])}
            mode="candles"
            timeframe="1D"
            panelId={`security-hub-insider-${ticker.toUpperCase()}`}
            crosshairSyncGroupId="security-hub"
            contextEvents={contextEvents}
          />
        </div>
      </TerminalPanel>

      <TerminalPanel title="Insider Trades" subtitle="Latest filings for the selected ticker">
        {insiderQuery.isLoading ? (
          <div className="rounded-sm border border-terminal-border bg-terminal-bg px-3 py-4 text-xs text-terminal-muted">
            Loading insider activity...
          </div>
        ) : (
          <DenseTable
            id={`security-hub-insider-table-${ticker.toUpperCase()}`}
            rows={trades}
            columns={[
              { key: "date", title: "Date", type: "text", width: 120, sortable: true, getValue: (row) => row.date },
              {
                key: "insider_name",
                title: "Insider",
                type: "text",
                width: 200,
                sortable: true,
                render: (row) => (
                  <div className="flex flex-col">
                    <span>{row.insider_name}</span>
                    <span className="text-[10px] text-terminal-muted">{row.designation || "Insider"}</span>
                  </div>
                ),
                getValue: (row) => row.insider_name,
              },
              {
                key: "type",
                title: "Type",
                width: 90,
                sortable: true,
                render: (row) => (
                  <TerminalBadge variant={row.type === "buy" ? "success" : "danger"}>{row.type.toUpperCase()}</TerminalBadge>
                ),
                getValue: (row) => row.type,
              },
              { key: "quantity", title: "Qty", type: "volume", align: "right", sortable: true, getValue: (row) => row.quantity },
              { key: "price", title: "Price", type: "currency", align: "right", sortable: true, getValue: (row) => row.price },
              {
                key: "value",
                title: "Value",
                type: "currency",
                align: "right",
                sortable: true,
                render: (row) => formatCurrency(row.value),
                getValue: (row) => row.value,
              },
              {
                key: "symbol",
                title: "Security",
                width: 140,
                render: (row) => (
                  <Link className="text-terminal-accent hover:underline" to={`/equity/security/${row.symbol}`}>
                    {row.symbol}
                  </Link>
                ),
                getValue: (row) => row.symbol,
              },
            ]}
            rowKey={(row, index) => `${row.symbol}-${row.insider_name}-${row.date}-${index}`}
            height={320}
          />
        )}
      </TerminalPanel>
    </div>
  );
}
