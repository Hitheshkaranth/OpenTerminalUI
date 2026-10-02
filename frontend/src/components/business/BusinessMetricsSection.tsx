import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
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
import { useEffect, useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";

import {
  fetchBusinessMetrics,
  extractBusinessMetrics,
  type BusinessMetrics,
  type Citation,
  type KpiCategory,
  type KpiSeries,
  type MixDimension,
  type MixSnapshot,
} from "../../api/businessResearch";
import { TerminalButton } from "../terminal/TerminalButton";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTable } from "../terminal/TerminalTable";
import { CitationHint, formatCitation } from "./citations";

export type BusinessMetricsSectionProps = { symbol: string; market?: string };

const CATEGORY_LABELS: Record<KpiCategory, string> = {
  order_book: "Order book",
  capacity: "Capacity",
  operational: "Operational",
  customers: "Customers",
  financial: "Financial",
};

const MIX_DIMENSION_LABELS: Record<MixDimension, string> = {
  segment: "Segment",
  geography: "Geography",
  product: "Product",
  customer: "Customer",
};

const KPI_CATEGORY_FILTERS: KpiCategory[] = ["order_book", "capacity", "operational", "customers"];

function fmtNumber(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const n = Number(value);
  if (Number.isInteger(n)) return n.toLocaleString("en-US");
  return n.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

function fmtPercent(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${Number(value).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function WarningsBar({ warnings }: { warnings: string[] }) {
  if (!warnings?.length) return null;
  return (
    <div className="flex flex-wrap items-start gap-1.5" role="alert">
      {warnings.map((warning, idx) => (
        <span
          key={idx}
          className="rounded-sm border border-terminal-warn bg-terminal-warn/10 px-2 py-0.5 ot-type-ui text-[10px] text-terminal-warn"
        >
          {warning}
        </span>
      ))}
    </div>
  );
}

type CategoryChipsProps = {
  value: KpiCategory | "all";
  onChange: (value: KpiCategory | "all") => void;
};

function CategoryChips({ value, onChange }: CategoryChipsProps) {
  return (
    <div className="inline-flex flex-wrap items-center gap-1.5" role="tablist" aria-label="KPI category">
      <button
        role="tab"
        aria-selected={value === "all"}
        type="button"
        onClick={() => onChange("all")}
        className={[
          "inline-flex items-center rounded-sm border px-2 py-0.5 ot-type-label text-[10px]",
          value === "all"
            ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
            : "border-terminal-border text-terminal-muted hover:text-terminal-text",
        ]
          .join(" ")
          .trim()}
      >
        All
      </button>
      {KPI_CATEGORY_FILTERS.map((cat) => {
        const active = cat === value;
        return (
          <button
            key={cat}
            role="tab"
            aria-selected={active}
            type="button"
            onClick={() => onChange(cat)}
            className={[
              "inline-flex items-center rounded-sm border px-2 py-0.5 ot-type-label text-[10px]",
              active
                ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                : "border-terminal-border text-terminal-muted hover:text-terminal-text",
            ]
              .join(" ")
              .trim()}
          >
            {CATEGORY_LABELS[cat]}
          </button>
        );
      })}
    </div>
  );
}

type KpiTooltipProps = {
  unit: string | null;
  active?: boolean;
  payload?: Array<{ value: number | null; payload: { period: string; citation: Citation | null } }> | null;
};

function KpiChartTooltip({ active, payload, unit }: KpiTooltipProps) {
  if (!active || !payload?.length) return null;
  const point = payload[0];
  const label = formatCitation(point.payload.citation);
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1 ot-type-ui text-[11px] text-terminal-text shadow-lg">
      <div className="text-terminal-muted">{point.payload.period}</div>
      <div className="font-medium">
        {fmtNumber(point.value)}
        {unit ? ` ${unit}` : ""}
      </div>
      {label ? <div className="mt-0.5 text-terminal-muted">{label}</div> : null}
    </div>
  );
}

function KpiSmallMultiple({ series }: { series: KpiSeries }) {
  const points = series.points?.filter((p) => p != null) || [];
  const hasData = points.length > 0;
  return (
    <div className="flex flex-col rounded-sm border border-terminal-border bg-terminal-panel">
      <div className="flex items-start justify-between gap-2 border-b border-terminal-border px-2.5 py-2">
        <div className="min-w-0">
          <div className="truncate ot-type-label text-[11px] text-terminal-text">{series.label}</div>
          {series.unit ? <div className="text-terminal-muted text-[10px]">in {series.unit}</div> : null}
        </div>
        <CitationHint citation={points[points.length - 1]?.citation} />
      </div>
      <div className="min-h-[88px] px-1.5 py-2">
        {!hasData ? (
          <div className="flex h-20 items-center text-terminal-muted text-[11px]">—</div>
        ) : (
          <ResponsiveContainer width="100%" height={88}>
            <LineChart data={points} margin={{ top: 4, right: 6, bottom: 4, left: 6 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#2b3442" />
              <XAxis dataKey="period" tick={{ fill: "#8B949E", fontSize: 9 }} />
              <YAxis tick={{ fill: "#8B949E", fontSize: 9 }} axisLine={false} />
              <Tooltip content={<KpiChartTooltip unit={series.unit} />} />
              <Line type="monotone" dataKey="value" dot={{ r: 2.5 }} strokeWidth={1.8} stroke="#FF6B00" />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </div>
  );
}

type MixRow = {
  period: string;
  citation: Citation | null;
  [name: string]: number | null | string | Citation | null;
};

function buildMixData(snapshots: MixSnapshot[]) {
  const periods = snapshots.map((s) => s.period);
  const names = Array.from(new Set(snapshots.flatMap((s) => s.items.map((i) => i.name))));
  const byPeriod = new Map(snapshots.map((s) => [s.period, s]));
  const data: MixRow[] = periods.map((period) => {
    const snapshot = byPeriod.get(period);
    const row: MixRow = { period, citation: snapshot?.citation ?? null };
    names.forEach((name) => {
      const item = snapshot?.items.find((i) => i.name === name);
      row[name] = item?.share_pct ?? null;
    });
    return row;
  });
  return { data, names };
}

function MixChartTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number | null; payload: MixRow }> | null }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  const present = payload.filter((p) => p.value != null);
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1 ot-type-ui text-[11px] text-terminal-text shadow-lg">
      <div className="mb-0.5 flex items-center justify-between gap-3">
        <span className="font-medium">{row.period}</span>
        <CitationHint citation={row.citation} />
      </div>
      {present.map((p) => (
        <div key={p.name} className="flex items-center justify-between gap-3">
          <span className="truncate text-terminal-muted">{p.name}</span>
          <span className="text-terminal-text">{fmtPercent(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

function MixLegend({ names }: { names: string[] }) {
  return (
    <div className="flex flex-wrap gap-x-3 gap-y-1 px-1 pt-1 pb-0">
      {names.map((name) => (
        <span key={name} className="inline-flex items-center gap-1 text-terminal-muted text-[10px]">
          <span className="inline-block h-2 w-2 rounded-sm bg-[#FF6B00]" />
          <span className="truncate max-w-[120px]">{name}</span>
        </span>
      ))}
    </div>
  );
}

function RevenueMixChart({ data, names }: { data: MixRow[]; names: string[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2b3442" />
        <XAxis dataKey="period" tick={{ fill: "#8B949E", fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fill: "#8B949E", fontSize: 10 }} tickFormatter={(v) => `${v}%`} axisLine={false} />
        <Tooltip content={<MixChartTooltip />} />
        <Legend content={<MixLegend names={names} />} />
        {names.map((name) => (
          <Bar key={name} dataKey={name} stackId="mix" name={name} fill="#FF6B00" />
        ))}
      </BarChart>
    </ResponsiveContainer>
  );
}

function RevenueMixSection({ snapshots }: { snapshots: MixSnapshot[] }) {
  const [dimension, setDimension] = useState<MixDimension | null>(null);

  const byDimension = useMemo(() => {
    const map: Record<MixDimension, MixSnapshot[]> = { segment: [], geography: [], product: [], customer: [] };
    snapshots.forEach((s) => {
      if (map[s.dimension]) map[s.dimension].push(s);
    });
    return map;
  }, [snapshots]);

  useEffect(() => {
    const available = (Object.keys(byDimension) as MixDimension[]).filter((d) => byDimension[d].length > 0);
    setDimension((prev) => {
    if (!available.length) return null;
    if (prev != null && available.includes(prev)) return prev;
    return available[0];
  });
  }, [byDimension]);

  const current = dimension ? byDimension[dimension] : [];
  const latest = current[current.length - 1];
  const { names } = useMemo(() => buildMixData(current), [current]);

  const tableRows = useMemo(() => {
    if (!latest) return [];
    return latest.items.map((item) => {
      const unit = item.unit ? ` ${item.unit}` : "";
      if (item.share_pct != null && item.value != null) {
        return { name: item.name, display: `${fmtNumber(item.share_pct)}% · ${fmtNumber(item.value)}${unit}` };
      }
      if (item.share_pct != null) {
        return { name: item.name, display: `${fmtNumber(item.share_pct)}%` };
      }
      if (item.value != null) {
        return { name: item.name, display: `${fmtNumber(item.value)}${unit}` };
      }
      return { name: item.name, display: "—" };
    });
  }, [latest]);

  if (!current.length) return null;

  return (
    <div className="flex flex-col gap-3">
      <div className="rounded-sm border border-terminal-border bg-terminal-panel p-2">
        <RevenueMixChart data={buildMixData(current).data} names={names} />
      </div>
      {latest ? (
        <div className="ot-type-label mb-1 uppercase text-terminal-muted text-[10px]">
          {latest.period} · latest · {MIX_DIMENSION_LABELS[latest.dimension]}
        </div>
      ) : null}
      <TerminalTable
        emptyText="No items"
        density="dense"
        rowKey={(_row, idx) => `mix-${idx}`}
columns={[
           {
             key: "name",
             label: "Item",
             render: (row) => <span className="truncate max-w-[240px]">{row.name || "—"}</span>,
           },
           {
             key: "display",
             label: "Value",
             align: "right",
             render: (row) => (
               <span className="ot-type-data text-right text-[11px] text-terminal-text">{row.display}</span>
             ),
           },
         ]}
        rows={tableRows}
      />
    </div>
  );
}

function MarketShareChart({ series }: { series: BusinessMetrics["market_share"] }) {
  const markets = series.filter((s) => s && s.points?.length) || [];
  if (!markets.length) return null;
  const indexByMarketPeriod = new Map(
    markets.map((s) => [s.market, new Map(s.points.map((p) => [p.period, p]))]),
  );
  const periods = Array.from(new Set(markets.flatMap((s) => s.points.map((p) => p.period))));
  const data = periods.map((period) => {
    const row: Record<string, number | null | Citation | null | string> = { period };
    let citation: Citation | null = null;
    markets.forEach((s) => {
      const point = indexByMarketPeriod.get(s.market)?.get(period);
      row[s.market] = point ? point.share_pct : null;
      if (point?.citation) citation = point.citation;
    });
    row.__citation__ = citation;
    return row;
  });

  return (
    <ResponsiveContainer width="100%" height={200}>
      <LineChart data={data} margin={{ top: 8, right: 12, bottom: 4, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#2b3442" />
        <XAxis dataKey="period" tick={{ fill: "#8B949E", fontSize: 10 }} />
        <YAxis domain={[0, 100]} tick={{ fill: "#8B949E", fontSize: 10 }} tickFormatter={(v) => `${v}%`} axisLine={false} />
        <Tooltip content={<ShareTooltip />} />
        <Legend content={<MixLegend names={markets.map((s) => s.market)} />} />
        {markets.map((s) => (
          <Line key={s.market} dataKey={s.market} dot={{ r: 2.5 }} strokeWidth={1.8} type="monotone" stroke="#38bdf8" />
        ))}
      </LineChart>
    </ResponsiveContainer>
  );
}

function ShareTooltip({ active, payload }: { active?: boolean; payload?: Array<{ name: string; value: number | null; payload: any }> | null }) {
  if (!active || !payload?.length) return null;
  const row = payload[0].payload;
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1 ot-type-ui text-[11px] text-terminal-text shadow-lg">
      <div className="text-terminal-muted">{payload[0].name}</div>
      <div className="font-medium">{fmtPercent(payload[0].value)}</div>
      {formatCitation(row.__citation__) ? <div className="mt-0.5 text-terminal-muted">{formatCitation(row.__citation__)}</div> : null}
    </div>
  );
}

export function BusinessMetricsSection({ symbol }: BusinessMetricsSectionProps) {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const location = useLocation();
  const [category, setCategory] = useState<KpiCategory | "all">("all");

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ["business-metrics", symbol],
    queryFn: () => fetchBusinessMetrics(symbol),
    enabled: Boolean(symbol),
    staleTime: 10 * 60 * 1000,
  });

  const extractMutation = useMutation({
    mutationFn: () => extractBusinessMetrics(symbol),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["business-metrics", symbol] });
      void refetch();
    },
  });

  const metrics = data ?? null;
  const activeKpis = useMemo(() => {
    const list = metrics?.kpis?.filter((s) => s.points?.length) || [];
    const seen = new Set<string>();
    const result: KpiSeries[] = [];
    for (const series of list) {
      if (category !== "all" && series.category !== category) continue;
      if (seen.has(series.key)) continue;
      seen.add(series.key);
      result.push(series);
    }
    return result;
  }, [metrics, category]);

  const openFilings = () => {
    navigate(`${location.pathname}?tab=filings`);
  };

  if (isLoading) {
    return (
      <TerminalPanel title="Business metrics" subtitle="Loading…">
        <div className="px-2.5 py-6 text-terminal-muted text-[11px]">Loading business metrics…</div>
      </TerminalPanel>
    );
  }

  if (isError) {
    return (
      <TerminalPanel title="Business metrics" subtitle="Error">
        <div className="px-2.5 py-6">
          <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-3 py-2 ot-type-ui text-[11px] text-terminal-neg">
            {error instanceof Error ? error.message : "Failed to load business metrics."}
          </div>
        </div>
      </TerminalPanel>
    );
  }

  if (!metrics) {
    return (
      <TerminalPanel
        title="Business metrics"
        subtitle="Not extracted yet"
        actions={
          <TerminalButton size="sm" onClick={openFilings}>
            Open Filings tab
          </TerminalButton>
        }
      >
        <div className="flex flex-col gap-3 px-2.5 py-6">
          <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-4 ot-type-ui text-center text-[11px] text-terminal-muted">
            No operating KPIs, revenue mix, or market share extracted for this company yet. Extract from filings to populate
            this view.
          </div>
          <TerminalButton size="sm" onClick={openFilings}>
            Open Filings tab
          </TerminalButton>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel
      title="Business metrics"
      subtitle={metrics.engine ? `Extracted · ${metrics.engine}` : "Derived from filings"}
      actions={
        <TerminalButton
          size="sm"
          variant="accent"
          loading={extractMutation.isPending}
          onClick={() => extractMutation.mutate()}
        >
          Extract from filings
        </TerminalButton>
      }
    >
      <div className="space-y-5">
        <WarningsBar warnings={metrics.warnings || []} />

        <section className="flex flex-col gap-3">
          <div className="flex items-center justify-between gap-2">
            <h3 className="ot-type-subheading text-[12px] uppercase text-terminal-text">Operating KPIs</h3>
            <CategoryChips
              value={category}
              onChange={(cat) => setCategory((prev) => (prev === cat ? "all" : cat))}
            />
          </div>
          {activeKpis.length ? (
            <div className="grid grid-cols-2 gap-2 lg:grid-cols-3">
              {activeKpis.map((series) => (
                <KpiSmallMultiple key={series.key} series={series} />
              ))}
            </div>
          ) : (
            <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2.5 py-6 text-center text-terminal-muted text-[11px]">
              No operating KPIs extracted.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="ot-type-subheading text-[12px] uppercase text-terminal-text">Revenue mix</h3>
          {metrics.revenue_mix?.length ? (
            <RevenueMixSection snapshots={metrics.revenue_mix} />
          ) : (
            <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2.5 py-6 text-center text-terminal-muted text-[11px]">
              No revenue mix data.
            </div>
          )}
        </section>

        <section className="flex flex-col gap-3">
          <h3 className="ot-type-subheading text-[12px] uppercase text-terminal-text">Market share</h3>
          {metrics.market_share?.length ? (
            <div className="rounded-sm border border-terminal-border bg-terminal-panel p-2">
              <MarketShareChart series={metrics.market_share} />
            </div>
          ) : (
            <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2.5 py-6 text-center text-terminal-muted text-[11px]">
              No market share data.
            </div>
          )}
        </section>
      </div>
    </TerminalPanel>
  );
}