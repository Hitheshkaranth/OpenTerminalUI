import { useQuery } from "@tanstack/react-query";
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

import { TerminalPanel } from "../terminal/TerminalPanel";
import { fetchResultsHistory } from "../../api/resultsTracker";
import type { ResultsQuarter } from "../../api/resultsTracker";
import { colorClassFor, formatNumber, formatPct, scorecardLabel, scorecardVariant } from "./helpers";

type Props = {
  symbol: string;
};

type ChartRow = {
  period: string;
  revenue: number | null;
  net_income: number | null;
  ebitda_margin: number | null;
  net_margin: number | null;
};

function tooltipStyle() {
  return {
    background: "#1A2332",
    border: "1px solid #2c394d",
    borderRadius: 4,
    color: "#e5e7eb",
    fontSize: 11,
  } as const;
}

function VolumeChart({
  data,
  currency,
}: {
  data: ChartRow[];
  currency: string | null;
}) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-terminal-text">Revenue vs Net income</span>
        {currency ? <span className="text-[10px] text-terminal-muted">{currency}</span> : null}
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#242d3a" />
          <XAxis dataKey="period" stroke="#8B949E" fontSize={10} tick={{ fill: "#8B949E" }} />
          <YAxis stroke="#8B949E" fontSize={10} tick={{ fill: "#8B949E" }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Bar dataKey="revenue" name="Revenue" fill="#FF6B00" />
          <Bar dataKey="net_income" name="Net income" fill="#3ba776" />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

function MarginChart({ data }: { data: ChartRow[] }) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-terminal-text">Margins</span>
        <span className="text-[10px] text-terminal-muted">%</span>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={data} margin={{ top: 8, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#242d3a" />
          <XAxis dataKey="period" stroke="#8B949E" fontSize={10} tick={{ fill: "#8B949E" }} />
          <YAxis stroke="#8B949E" fontSize={10} tick={{ fill: "#8B949E" }} />
          <Tooltip contentStyle={tooltipStyle()} />
          <Legend />
          <Line type="monotone" dataKey="ebitda_margin" name="EBITDA margin" stroke="#FF6B00" strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="net_margin" name="Net margin" stroke="#3ba776" strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

function YoYTable({ quarters }: { quarters: ResultsQuarter[] }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-terminal-border text-[10px] uppercase text-terminal-muted">
            <th className="px-3 py-1.5 text-left font-medium">Period</th>
            <th className="px-3 py-1.5 text-right font-medium">Revenue</th>
            <th className="px-3 py-1.5 text-right font-medium">Net income</th>
            <th className="px-3 py-1.5 text-right font-medium">EBITDA %</th>
            <th className="px-3 py-1.5 text-right font-medium">Net %</th>
            <th className="px-3 py-1.5 text-right font-medium">Rev YoY</th>
            <th className="px-3 py-1.5 text-right font-medium">Profit YoY</th>
            <th className="px-3 py-1.5 text-right font-medium">EPS</th>
          </tr>
        </thead>
        <tbody>
          {quarters.map((q, idx) => (
            <tr key={q.period || idx} className={`border-b border-terminal-border/40 ${idx % 2 === 0 ? "bg-terminal-bg" : "bg-terminal-bg/40"}`}>
              <td className="px-3 py-1.5 font-sans font-medium text-terminal-text">{q.period}</td>
              <td className="px-3 py-1.5 text-right font-sans text-terminal-text">{formatNumber(q.revenue)}</td>
              <td className={`px-3 py-1.5 text-right font-sans ${colorClassFor(q.net_income)}`}>{formatNumber(q.net_income)}</td>
              <td className="px-3 py-1.5 text-right font-sans text-terminal-muted">{formatPct(q.ebitda_margin_pct)}</td>
              <td className="px-3 py-1.5 text-right font-sans text-terminal-muted">{formatPct(q.net_margin_pct)}</td>
              <td className={`px-3 py-1.5 text-right font-sans font-semibold ${colorClassFor(q.revenue_yoy_pct)}`}>{formatPct(q.revenue_yoy_pct)}</td>
              <td className={`px-3 py-1.5 text-right font-sans font-semibold ${colorClassFor(q.profit_yoy_pct)}`}>{formatPct(q.profit_yoy_pct)}</td>
              <td className="px-3 py-1.5 text-right font-sans text-terminal-text">{formatNumber(q.eps, 4)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function ResultsHistory({ symbol }: Props) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["results-history", symbol, 8],
    queryFn: () => fetchResultsHistory(symbol, 8),
  });

  const quarters: ResultsQuarter[] = data?.quarters ?? [];
  const scorecard = data?.scorecard;
  const currency = data?.currency ?? null;

  const chartData = quarters.map((q) => ({
    period: q.period,
    revenue: q.revenue,
    net_income: q.net_income,
    ebitda_margin: q.ebitda_margin_pct,
    net_margin: q.net_margin_pct,
  }));

  return (
    <TerminalPanel
      title={`${symbol} — Quarterly results`}
      actions={
        <span
          className={`inline-flex items-center rounded-sm border px-2 py-0.5 font-sans text-[11px] ${
            scorecardVariant(scorecard?.label ?? "") === "success"
              ? "border-terminal-pos text-terminal-pos bg-terminal-pos/10"
              : scorecardVariant(scorecard?.label ?? "") === "danger"
                ? "border-terminal-neg text-terminal-neg bg-terminal-neg/10"
                : scorecardVariant(scorecard?.label ?? "") === "warn"
                  ? "border-terminal-warn text-terminal-warn bg-terminal-warn/10"
                  : "border-terminal-accent text-terminal-accent bg-terminal-accent/10"
          }`}
        >
          {scorecard ? scorecardLabel(scorecard.label) : "—"}
        </span>
      }
      className="w-full"
    >
      <div className="space-y-3">
        {scorecard?.reasons?.length ? (
          <div className="rounded-sm border border-terminal-border/60 bg-terminal-bg/60 px-3 py-2 text-[11px] text-terminal-muted">
            {scorecard.reasons.map((r, i) => (
              <div key={i}>• {r}</div>
            ))}
          </div>
        ) : null}

        {isLoading ? (
          <div className="flex h-28 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg text-xs text-terminal-muted">
            Loading quarterly history…
          </div>
        ) : isError || quarters.length === 0 ? (
          <div className="flex h-28 items-center justify-center rounded-sm border border-terminal-border bg-terminal-bg text-xs text-terminal-muted">
            No quarterly history available.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
              <VolumeChart data={chartData} currency={currency} />
              <MarginChart data={chartData} />
            </div>
            <YoYTable quarters={quarters} />
          </>
        )}
      </div>
    </TerminalPanel>
  );
}