import React from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { useShareholdingPattern } from "../hooks/useStocks";
import type { ShareholdingPatternResponse, ShareholdingTrendPoint } from "../types";

type Props = {
  ticker: string;
  enabled?: boolean;
};

const COLORS = {
  promoter: "#22c55e",
  fii: "#3b82f6",
  dii: "#f59e0b",
  public: "#9ca3af",
  government: "#a855f7",
};

class ShareholdingErrorBoundary extends React.Component<{ onRetry: () => void; children: React.ReactNode }, { hasError: boolean; message: string }> {
  constructor(props: { onRetry: () => void; children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, message: error?.message || "Render failure" };
  }

  componentDidCatch(error: Error) {
    // eslint-disable-next-line no-console
    console.error("Shareholding panel runtime error:", error);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="rounded border border-terminal-neg bg-terminal-panel p-4 text-terminal-neg">
          <div className="font-semibold">Shareholding panel crashed.</div>
          <div className="mt-2 text-xs break-all">{this.state.message}</div>
          <button
            onClick={() => {
              this.setState({ hasError: false, message: "" });
              this.props.onRetry();
            }}
            className="mt-3 rounded border border-terminal-neg px-3 py-1 text-xs text-terminal-neg hover:bg-terminal-neg/10"
          >
            Retry
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}

function formatPct(value: number): string {
  if (!Number.isFinite(value)) return "-";
  return `${value.toFixed(2)}%`;
}

function formatInt(value?: number | null): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return new Intl.NumberFormat("en-IN").format(Math.trunc(value));
}

function getQoQ(trend: ShareholdingTrendPoint[] | undefined, key: keyof ShareholdingTrendPoint): number {
  if (!trend || trend.length < 2) return 0;
  return Number(trend[0]?.[key] || 0) - Number(trend[1]?.[key] || 0);
}

function QoQBadge({ delta }: { delta: number }) {
  if (!Number.isFinite(delta) || delta === 0) return <span className="text-xs text-terminal-muted">0.00%</span>;
  const up = delta > 0;
  return (
    <span className={`text-xs ${up ? "text-terminal-pos" : "text-terminal-neg"}`}>
      {up ? "^" : "v"} {Math.abs(delta).toFixed(2)}%
    </span>
  );
}

function LoadingSkeleton() {
  return (
    <div className="space-y-3 rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="h-6 w-56 animate-pulse rounded bg-terminal-bg" />
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        <div className="h-72 animate-pulse rounded bg-terminal-bg" />
        <div className="h-72 animate-pulse rounded bg-terminal-bg" />
      </div>
      <div className="h-52 animate-pulse rounded bg-terminal-bg" />
    </div>
  );
}

function HoldingsFallback({ data }: { data: ShareholdingPatternResponse }) {
  const holders = data.institutional_holders ?? [];
  return (
    <div className="space-y-3">
      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-sm text-terminal-text">
        Institutional holders fallback (FMP) for {data.symbol}
      </div>
      <div className="overflow-x-auto rounded border border-terminal-border bg-terminal-panel">
        <table className="min-w-full text-left text-xs text-terminal-text">
          <thead className="border-b border-terminal-border bg-terminal-bg text-[11px] uppercase tracking-wide text-terminal-muted">
            <tr>
              <th className="px-3 py-2">Holder</th>
              <th className="px-3 py-2">Shares</th>
              <th className="px-3 py-2">Change</th>
              <th className="px-3 py-2">Reported</th>
            </tr>
          </thead>
          <tbody>
            {holders.length ? (
              holders.slice(0, 20).map((row, idx) => (
                <tr key={`${row.holder}-${idx}`} className="border-b border-gray-800">
                  <td className="px-3 py-2">{row.holder}</td>
                  <td className="px-3 py-2 tabular-nums">{formatInt(row.shares)}</td>
                  <td className={`px-3 py-2 tabular-nums ${row.change >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{row.change.toFixed(2)}</td>
                  <td className="px-3 py-2">{row.date_reported || "-"}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-3 text-terminal-muted" colSpan={4}>
                  No institutional holders returned.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ShareholdingPanelBody({ data }: { data: ShareholdingPatternResponse }) {
  const pieData = [
    { name: "Promoter", value: Number(data.promoter_holding || 0), color: COLORS.promoter },
    { name: "FII", value: Number(data.fii_holding || 0), color: COLORS.fii },
    { name: "DII", value: Number(data.dii_holding || 0), color: COLORS.dii },
    { name: "Public", value: Number(data.public_holding || 0), color: COLORS.public },
    { name: "Government", value: Number(data.government_holding || 0), color: COLORS.government },
  ];

  const trend = (data.historical || []).map((row) => ({
    quarter: String(row.quarter || ""),
    promoter: Number(row.promoter || 0),
    fii: Number(row.fii || 0),
    dii: Number(row.dii || 0),
    public: Number(row.public || 0),
    government: Number(row.government || 0),
  }));

  return (
    <div className="space-y-3 rounded border border-terminal-border bg-terminal-panel p-4 text-terminal-text">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Shareholding Pattern</h3>
          <p className="text-xs text-terminal-muted">
            {data.symbol} | {data.quarter} | As of {data.as_of_date}
          </p>
        </div>
        {data.warning ? <div className="text-xs text-terminal-warn">{String(data.warning)}</div> : null}
      </div>

      {data.source === "fmp" ? (
        <HoldingsFallback data={data} />
      ) : (
        <>
          <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
            <div className="rounded border border-terminal-border bg-terminal-bg p-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-terminal-muted">Current Mix</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={pieData} dataKey="value" nameKey="name" innerRadius={55} outerRadius={90} paddingAngle={2}>
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      formatter={(value: number | string | undefined) => `${Number(value ?? 0).toFixed(2)}%`}
                      contentStyle={{ background: "#0f141d", border: "1px solid #22303c", color: "#d8dde7" }}
                    />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            </div>

            <div className="rounded border border-terminal-border bg-terminal-bg p-2">
              <div className="mb-1 text-xs uppercase tracking-wide text-terminal-muted">8 Quarter Trend</div>
              <div className="h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={trend}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#22303c" />
                    <XAxis dataKey="quarter" tick={{ fill: "#8e98a8", fontSize: 11 }} />
                    <YAxis domain={[0, 100]} tick={{ fill: "#8e98a8", fontSize: 11 }} />
                    <Tooltip contentStyle={{ background: "#0f141d", border: "1px solid #22303c", color: "#d8dde7" }} />
                    <Area type="monotone" dataKey="promoter" stackId="1" stroke={COLORS.promoter} fill={COLORS.promoter} />
                    <Area type="monotone" dataKey="fii" stackId="1" stroke={COLORS.fii} fill={COLORS.fii} />
                    <Area type="monotone" dataKey="dii" stackId="1" stroke={COLORS.dii} fill={COLORS.dii} />
                    <Area type="monotone" dataKey="public" stackId="1" stroke={COLORS.public} fill={COLORS.public} />
                    <Area type="monotone" dataKey="government" stackId="1" stroke={COLORS.government} fill={COLORS.government} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs md:grid-cols-5">
            <div className="rounded border border-terminal-border px-2 py-2">
              <div className="text-terminal-muted">Promoter</div>
              <div className="font-semibold">{formatPct(data.promoter_holding)}</div>
              <QoQBadge delta={getQoQ(trend, "promoter")} />
            </div>
            <div className="rounded border border-terminal-border px-2 py-2">
              <div className="text-terminal-muted">FII</div>
              <div className="font-semibold">{formatPct(data.fii_holding)}</div>
              <QoQBadge delta={getQoQ(trend, "fii")} />
            </div>
            <div className="rounded border border-terminal-border px-2 py-2">
              <div className="text-terminal-muted">DII</div>
              <div className="font-semibold">{formatPct(data.dii_holding)}</div>
              <QoQBadge delta={getQoQ(trend, "dii")} />
            </div>
            <div className="rounded border border-terminal-border px-2 py-2">
              <div className="text-terminal-muted">Public</div>
              <div className="font-semibold">{formatPct(data.public_holding)}</div>
              <QoQBadge delta={getQoQ(trend, "public")} />
            </div>
            <div className="rounded border border-terminal-border px-2 py-2">
              <div className="text-terminal-muted">Government</div>
              <div className="font-semibold">{formatPct(data.government_holding)}</div>
              <QoQBadge delta={getQoQ(trend, "government")} />
            </div>
          </div>

          <div className="overflow-x-auto rounded border border-terminal-border">
            <table className="min-w-full text-left text-xs text-terminal-text">
              <thead className="border-b border-terminal-border bg-terminal-bg text-[11px] uppercase tracking-wide text-terminal-muted">
                <tr>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Percentage</th>
                  <th className="px-3 py-2">Shares</th>
                  <th className="px-3 py-2">Quarter</th>
                </tr>
              </thead>
              <tbody>
                {(data.categories || []).map((row, idx) => (
                  <tr key={`${row.category}-${idx}`} className="border-b border-terminal-border/50">
                    <td className="px-3 py-2">{row.category}</td>
                    <td className="px-3 py-2 tabular-nums">{formatPct(Number(row.percentage || 0))}</td>
                    <td className="px-3 py-2 tabular-nums">{formatInt(row.shares)}</td>
                    <td className="px-3 py-2">{row.quarter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}

export function ShareholdingPanel({ ticker, enabled = true }: Props) {
  const { data, isLoading, isError, error, refetch } = useShareholdingPattern(ticker, enabled);

  if (!enabled) {
    return (
      <div className="rounded border border-terminal-border bg-terminal-panel p-4 text-sm text-terminal-muted">
        Open this tab to load shareholding data.
      </div>
    );
  }

  if (isLoading) return <LoadingSkeleton />;

  if (isError || !data) {
    return (
      <div className="rounded border border-terminal-neg bg-terminal-panel p-4 text-terminal-neg">
        <div className="text-sm font-semibold">Failed to load shareholding data.</div>
        <div className="mt-1 text-xs">{String((error as Error | undefined)?.message || "Unknown error")}</div>
        <button onClick={() => void refetch()} className="mt-3 rounded border border-terminal-neg px-3 py-1 text-xs text-terminal-neg hover:bg-terminal-neg/10">
          Retry
        </button>
      </div>
    );
  }

  return (
    <ShareholdingErrorBoundary onRetry={() => void refetch()}>
      <ShareholdingPanelBody data={data} />
    </ShareholdingErrorBoundary>
  );
}
