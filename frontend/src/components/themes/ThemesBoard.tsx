import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Area, AreaChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { ArrowLeft } from "lucide-react";

import { DenseTable, type DenseTableColumn } from "../terminal/DenseTable";
import { fetchThemeDetail, fetchThemes, type Market, type ThemeDetail, type ThemeSummary } from "../../api/ideasThemes";

function fmtNumber(value: number | null, digits = 0): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toLocaleString("en-US", { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fmtPercent(value: number | null, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function returnClass(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "text-terminal-muted";
  return value > 0 ? "text-terminal-pos" : value < 0 ? "text-terminal-neg" : "text-terminal-muted";
}

function returnCell(value: number | null) {
  const text = fmtPercent(value);
  return text === "—" ? <span className="text-terminal-muted">{text}</span> : <span className={returnClass(value)}>{text}</span>;
}

type Props = {
  initialMarket?: Market;
};

function MarketSwitch({ market, onChange }: { market: Market; onChange: (next: Market) => void }) {
  return (
    <div className="inline-flex items-center gap-1 rounded-sm border border-terminal-border bg-terminal-panel p-1">
      {(["IN", "US"] as const).map((value) => (
        <button
          key={value}
          type="button"
          aria-pressed={market === value}
          className={`rounded px-2 py-1 text-[10px] uppercase tracking-[0.12em] ${
            market === value ? "bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"
          }`}
          onClick={() => onChange(value)}
        >
          {value}
        </button>
      ))}
    </div>
  );
}

const summaryColumns = [
  { title: "Theme", align: "left" as const },
  { title: "Constituents", align: "right" as const },
  { title: "1M", align: "right" as const },
  { title: "3M", align: "right" as const },
  { title: "6M", align: "right" as const },
  { title: "1Y", align: "right" as const },
  { title: "vs 1Y", align: "right" as const },
];

function SummaryTable({ themes, onSelect }: { themes: ThemeSummary[]; onSelect: (theme: ThemeSummary) => void }) {
  if (themes.length === 0) {
    return (
      <div className="px-3 py-8 text-center text-xs text-terminal-muted">
        No themes surfaced for the current desk. Check back after the next rebalance.
      </div>
    );
  }
  return (
    <div className="overflow-auto border border-terminal-border">
      <table className="w-full border-collapse text-left text-[11px]">
        <thead className="sticky top-0 z-10 bg-terminal-panel">
          <tr>
            {summaryColumns.map((column) => (
              <th
                key={column.title}
                className={`border-b border-terminal-border px-3 py-2 text-[10px] uppercase tracking-[0.12em] text-terminal-muted ${
                  column.align === "right" ? "text-right" : "text-left"
                }`}
              >
                {column.title}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {themes.map((theme) => (
            <tr key={theme.id} className="group border-b border-terminal-border/30 hover:bg-terminal-panel/40">
              <td className="px-3 py-2">
                <button
                  type="button"
                  className="text-[11px] font-semibold uppercase tracking-[0.1em] text-terminal-accent hover:underline focus-visible:outline-none"
                  onClick={() => onSelect(theme)}
                >
                  {theme.name}
                </button>
              </td>
              <td className="px-3 py-2 text-right text-terminal-text">{fmtNumber(theme.constituents)}</td>
              <td className="px-3 py-2 text-right">{returnCell(theme.return_1m)}</td>
              <td className="px-3 py-2 text-right">{returnCell(theme.return_3m)}</td>
              <td className="px-3 py-2 text-right">{returnCell(theme.return_6m)}</td>
              <td className="px-3 py-2 text-right">{returnCell(theme.return_1y)}</td>
              <td className="px-3 py-2 text-right">{returnCell(theme.vs_benchmark_1y)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

type TooltipEntry = { name?: string; value?: number | null; color?: string };
type ChartTooltipProps = { active?: boolean; payload?: TooltipEntry[]; label?: string };

function ChartTooltip({ active, payload, label }: ChartTooltipProps) {
  if (!active || !payload || !payload.length) return null;
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel px-2 py-1 text-[11px] shadow-xl">
      <p className="mb-1 text-terminal-muted">{label}</p>
      {payload.map((entry, index) => (
        <p key={index} className="text-terminal-text" style={{ color: entry.color }}>
          {entry.name}: {entry.value == null ? "—" : Number(entry.value).toLocaleString("en-US", { maximumFractionDigits: 1 })}
        </p>
      ))}
    </div>
  );
}

function DetailChart({ detail }: { detail: ThemeDetail }) {
  const chartData = useMemo(() => {
    const baseValue = detail.series
      .map((point) => point.index)
      .filter((value): value is number => value != null && Number.isFinite(value) && value !== 0)[0];
    const base = baseValue ?? 100;
    return detail.series
      .filter((point) => point.date || point.index != null)
      .map((point) => ({
        date: point.date || "—",
        index: point.index != null ? (point.index / base) * 100 : null,
        benchmark: point.benchmark != null ? (point.benchmark / base) * 100 : null,
      }));
  }, [detail.series]);

  if (chartData.length === 0) {
    return <div className="flex h-48 items-center justify-center text-xs text-terminal-muted">No price series available.</div>;
  }

  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel/60 p-3">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-terminal-muted">Rebased to 100 · {detail.market}</span>
        <span className="text-[10px] uppercase tracking-[0.12em] text-terminal-accent">{detail.benchmark}</span>
      </div>
      <div aria-label={`${detail.name} index versus ${detail.benchmark}`}>
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={chartData} margin={{ top: 12, right: 16, left: 0, bottom: 0 }}>
            <defs>
              <linearGradient id="ot-theme-index" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="#FF6B00" stopOpacity={0.35} />
                <stop offset="100%" stopColor="#FF6B00" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="#242d3a" />
            <XAxis dataKey="date" tick={{ fontSize: 10, fill: "#8B949E" }} stroke="#8B949E" minTickGap={28} />
            <YAxis tick={{ fontSize: 10, fill: "#8B949E" }} stroke="#8B949E" domain={["auto", "auto"]} />
            <Tooltip content={<ChartTooltip />} />
            <Legend iconType="plainline" wrapperStyle={{ fontSize: 11 }} />
            <Area
              type="monotone"
              dataKey="index"
              name={detail.name}
              stroke="#FF6B00"
              strokeWidth={2}
              fill="url(#ot-theme-index)"
              connectNulls
              dot={false}
            />
            <Area
              type="monotone"
              dataKey="benchmark"
              name={detail.benchmark}
              stroke="#8B949E"
              strokeWidth={1.5}
              connectNulls
              dot={false}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function MembersTable({ members }: { members: ThemeDetail["members"] }) {
  if (members.length === 0) {
    return <div className="p-3 text-center text-xs text-terminal-muted">No members for this theme.</div>;
  }

  const columns: DenseTableColumn<(typeof members)[number]>[] = [
    {
      key: "symbol",
      title: "Symbol",
      width: 110,
      sortable: true,
      getValue: (row) => row.symbol,
      render: (row) =>
        row.symbol ? (
          <a
            href={`/equity/security/${encodeURIComponent(row.symbol)}`}
            className="text-[11px] font-semibold uppercase tracking-[0.1em] text-terminal-accent hover:underline"
          >
            {row.symbol}
          </a>
        ) : (
          <span className="text-terminal-muted">—</span>
        ),
    },
    { key: "name", title: "Name", width: 180, getValue: (row) => row.name },
    { key: "weight", title: "Weight", width: 100, align: "right", type: "percent", getValue: (row) => row.weight },
    { key: "last", title: "Last", width: 110, align: "right", type: "currency", getValue: (row) => row.last },
    {
      key: "return_1y",
      title: "1Y",
      width: 100,
      align: "right",
      type: "percent",
      getValue: (row) => row.return_1y,
      render: (row) => (row.return_1y == null ? <span className="text-terminal-muted">—</span> : <span className={returnClass(row.return_1y)}>{fmtPercent(row.return_1y)}</span>),
    },
  ];

  return <DenseTable id="theme-members" rows={members} columns={columns} rowKey={(row) => row.symbol} height={320} />;
}

function ThemeDetailPanel({
  detail,
  onBack,
  loading,
  error,
  onRetry,
}: {
  detail: ThemeDetail;
  onBack: () => void;
  loading: boolean;
  error: Error | null;
  onRetry: () => void;
}) {
  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <button
          type="button"
          className="inline-flex items-center gap-1.5 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:text-terminal-accent"
          onClick={onBack}
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
        <div className="flex items-center gap-2">
          <span className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">{detail.name}</span>
          <span className="rounded border border-terminal-border px-1.5 py-0.5 text-[10px] text-terminal-muted">{detail.market}</span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto p-3">
        {loading ? (
          <div className="flex h-48 items-center justify-center text-xs text-terminal-muted animate-pulse">LOADING THEME…</div>
        ) : error || !detail ? (
          <div className="p-3">
            <div className="rounded border border-terminal-neg/40 bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">
              Unable to load this theme.
            </div>
            <button
              type="button"
              className="rounded border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
              onClick={onRetry}
            >
              Retry
            </button>
          </div>
        ) : (
          <div className="space-y-3">
            <DetailChart detail={detail} />
            <MembersTable members={detail.members} />
          </div>
        )}
      </div>
    </div>
  );
}

export function ThemesBoard({ initialMarket = "IN" }: Props) {
  const [market, setMarket] = useState<Market>(initialMarket);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ["themes", market],
    queryFn: () => fetchThemes(market),
    refetchInterval: 60_000,
  });
  const themes = data?.themes ?? [];

  const selected = themes.find((theme) => theme.id === selectedId) ?? null;

  const { data: detail, isLoading: detailLoading, error: detailError, refetch: refetchDetail } = useQuery({
    queryKey: ["theme-detail", selectedId],
    queryFn: () => fetchThemeDetail(selectedId as string),
    enabled: Boolean(selectedId),
  });

  function applyMarket(nextMarket: Market) {
    if (nextMarket === market) return;
    setMarket(nextMarket);
    setSelectedId(null);
  }

  const detailData: ThemeDetail | null = selected && detail ? detail : null;

  if (detailData) {
    return (
      <ThemeDetailPanel
        key={selectedId}
        detail={detailData}
        onBack={() => setSelectedId(null)}
        loading={detailLoading}
        error={detailError}
        onRetry={() => void refetchDetail()}
      />
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-terminal-border px-3 py-2">
        <div>
          <h2 className="ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">Thematic Indices</h2>
          <p className="mt-0.5 text-xs text-terminal-muted">
            {data ? `Benchmark ${data.benchmark}` : isLoading ? "Loading themes…" : `Desk themes · ${market}`}
          </p>
        </div>
        <MarketSwitch market={market} onChange={applyMarket} />
      </div>
      {isLoading ? (
        <div className="flex h-48 items-center justify-center text-xs text-terminal-muted animate-pulse">
          CALCULATING THEMES…
        </div>
      ) : error ? (
        <div className="p-3">
          <div className="rounded border border-terminal-neg/40 bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">
            Unable to load themes.
          </div>
          <button
            type="button"
            className="mt-2 rounded border border-terminal-border px-2 py-1 text-[11px] uppercase tracking-[0.12em] text-terminal-muted hover:border-terminal-accent hover:text-terminal-accent"
            onClick={() => void refetch()}
          >
            Retry
          </button>
        </div>
      ) : (
        <div className="min-h-0 flex-1 overflow-auto">
          <SummaryTable themes={themes} onSelect={(theme) => setSelectedId(theme.id)} />
        </div>
      )}
    </div>
  );
}

export default ThemesBoard;