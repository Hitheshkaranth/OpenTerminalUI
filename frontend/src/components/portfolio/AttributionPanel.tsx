import { Suspense, lazy, useEffect, useMemo, useState } from "react";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const FactorAttributionChart = lazy(() => import("./FactorAttributionChart"));

type AttributionSectorRow = {
  sector: string;
  portfolio_weight: number;
  benchmark_weight: number;
  portfolio_return: number;
  benchmark_return: number;
  allocation: number;
  selection: number;
  interaction: number;
  total: number;
};

type AttributionResponse = {
  portfolio_id: string;
  portfolio_name?: string;
  period: string;
  benchmark: string;
  total_return: number;
  benchmark_return: number;
  active_return: number;
  brinson: {
    sectors: AttributionSectorRow[];
    total_allocation: number;
    total_selection: number;
    total_interaction: number;
    check_sum: number;
  };
  factors: {
    exposures: Record<string, number>;
    factor_returns: Record<string, number>;
    contributions: Record<string, number>;
    alpha: number;
    check_sum?: number;
  };
};

type Props = {
  portfolioId: string;
};

const PERIODS = ["1W", "1M", "3M", "6M", "1Y", "YTD"] as const;
const BENCHMARKS = ["NIFTY50", "SENSEX", "S&P500", "CUSTOM"] as const;

function formatPct(value: number | null | undefined, digits = 2): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${value >= 0 ? "+" : ""}${value.toFixed(digits)}%`;
}

function formatWeight(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "-";
  return `${(value * 100).toFixed(1)}%`;
}

export function AttributionPanel({ portfolioId }: Props) {
  const [period, setPeriod] = useState<(typeof PERIODS)[number]>("1M");
  const [benchmarkPreset, setBenchmarkPreset] = useState<(typeof BENCHMARKS)[number]>("NIFTY50");
  const [customBenchmark, setCustomBenchmark] = useState("SPY");
  const [data, setData] = useState<AttributionResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const benchmark = useMemo(
    () => (benchmarkPreset === "CUSTOM" ? customBenchmark.trim() || "NIFTY50" : benchmarkPreset),
    [benchmarkPreset, customBenchmark],
  );

  useEffect(() => {
    const controller = new AbortController();
    async function loadAttribution() {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch(
          `/api/portfolio/${encodeURIComponent(portfolioId)}/attribution?period=${encodeURIComponent(period)}&benchmark=${encodeURIComponent(benchmark)}`,
          { signal: controller.signal },
        );
        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { detail?: string } | null;
          throw new Error(body?.detail ?? `Failed to load attribution (${response.status})`);
        }
        const payload = (await response.json()) as AttributionResponse;
        setData(payload);
      } catch (err) {
        if (err instanceof DOMException && err.name === "AbortError") return;
        setData(null);
        setError(err instanceof Error ? err.message : "Failed to load attribution");
      } finally {
        setLoading(false);
      }
    }
    void loadAttribution();
    return () => controller.abort();
  }, [benchmark, period, portfolioId]);

  const sectorRows = useMemo(
    () => [...(data?.brinson.sectors ?? [])].sort((a, b) => Math.abs(b.total) - Math.abs(a.total)),
    [data?.brinson.sectors],
  );

  const activeReturn = data?.active_return ?? 0;
  const totalBreakdown = [
    { label: "Allocation", value: data?.brinson.total_allocation ?? 0, tone: "text-terminal-accent" },
    { label: "Selection", value: data?.brinson.total_selection ?? 0, tone: "text-terminal-pos" },
    { label: "Interaction", value: data?.brinson.total_interaction ?? 0, tone: "text-terminal-neg" },
  ];

  return (
    <div className="space-y-3 rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="text-sm font-semibold uppercase tracking-wide text-terminal-accent">Attribution</div>
          <div className="text-xs text-terminal-muted">
            {data?.portfolio_name ?? portfolioId} · {data?.benchmark ?? benchmark} · {period}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <div className="flex items-center gap-1 text-[11px]">
            {PERIODS.map((value) => (
              <button
                key={value}
                className={`rounded border px-2 py-1 ${
                  period === value
                    ? "border-terminal-accent text-terminal-accent"
                    : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                }`}
                onClick={() => setPeriod(value)}
              >
                {value}
              </button>
            ))}
          </div>
          <label className="flex items-center gap-2 text-[11px] text-terminal-muted">
            Benchmark
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-terminal-text"
              value={benchmarkPreset}
              onChange={(event) => setBenchmarkPreset(event.target.value as (typeof BENCHMARKS)[number])}
            >
              {BENCHMARKS.map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
          {benchmarkPreset === "CUSTOM" ? (
            <input
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs text-terminal-text"
              value={customBenchmark}
              onChange={(event) => setCustomBenchmark(event.target.value)}
              placeholder="Custom benchmark"
            />
          ) : null}
        </div>
      </div>

      {error ? <div className="rounded border border-terminal-neg/40 bg-terminal-neg/10 px-3 py-2 text-xs text-terminal-neg">{error}</div> : null}
      {loading ? <div className="text-xs text-terminal-muted">Loading attribution data...</div> : null}

      {data ? (
        <>
          <div className="grid gap-2 md:grid-cols-4">
            <div className="rounded border border-terminal-border bg-terminal-bg p-3">
              <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Total Return</div>
              <div className={data.total_return >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatPct(data.total_return)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg p-3">
              <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Benchmark Return</div>
              <div className={data.benchmark_return >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatPct(data.benchmark_return)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg p-3">
              <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Active Return</div>
              <div className={activeReturn >= 0 ? "text-terminal-pos" : "text-terminal-neg"}>{formatPct(activeReturn)}</div>
            </div>
            <div className="rounded border border-terminal-border bg-terminal-bg p-3">
              <div className="text-[11px] uppercase tracking-wide text-terminal-muted">Brinson Check</div>
              <div className={Math.abs((data.brinson.check_sum ?? 0) - activeReturn) <= 1e-10 ? "text-terminal-pos" : "text-terminal-neg"}>
                {formatPct((data.brinson.check_sum ?? 0) - activeReturn)}
              </div>
            </div>
          </div>

          <div className="grid gap-2 md:grid-cols-3">
            {totalBreakdown.map((row) => (
              <div key={row.label} className="rounded border border-terminal-border bg-terminal-bg p-2">
                <div className="text-[11px] uppercase tracking-wide text-terminal-muted">{row.label}</div>
                <div className={row.value >= 0 ? row.tone : "text-terminal-neg"}>{formatPct(row.value)}</div>
              </div>
            ))}
          </div>

          <div className="h-72 rounded border border-terminal-border bg-terminal-bg p-2">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={sectorRows} margin={{ top: 8, right: 24, left: 12, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#2a2f3a" />
                <XAxis axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 10 }} dataKey="sector" />
                <YAxis axisLine={false} tickLine={false} tick={{ fill: "#8e98a8", fontSize: 10 }} />
                <Tooltip
                  contentStyle={{ border: "1px solid #2a2f3a", background: "#0c0f14", color: "#d8dde7" }}
                  formatter={(value: number | string | undefined, name: string | undefined, item) => {
                    const row = (item?.payload ?? {}) as AttributionSectorRow;
                    if (name === "allocation" || name === "selection" || name === "interaction") {
                      return [formatPct(Number(value ?? 0)), name];
                    }
                    return [String(value ?? "-"), name ?? "Value"];
                  }}
                  labelFormatter={(label) => `Sector: ${label}`}
                />
                <Bar dataKey="allocation" stackId="brinson" fill="#5aa9ff" />
                <Bar dataKey="selection" stackId="brinson" fill="#00c176" />
                <Bar dataKey="interaction" stackId="brinson" fill="#fbbf24" />
              </BarChart>
            </ResponsiveContainer>
          </div>

          <div className="overflow-auto rounded border border-terminal-border bg-terminal-bg">
            <table className="min-w-full text-xs">
              <thead>
                <tr className="border-b border-terminal-border text-terminal-muted">
                  <th className="px-2 py-1 text-left">Sector</th>
                  <th className="px-2 py-1 text-right">Port Weight</th>
                  <th className="px-2 py-1 text-right">Bench Weight</th>
                  <th className="px-2 py-1 text-right">Port Return</th>
                  <th className="px-2 py-1 text-right">Bench Return</th>
                  <th className="px-2 py-1 text-right">Allocation</th>
                  <th className="px-2 py-1 text-right">Selection</th>
                  <th className="px-2 py-1 text-right">Interaction</th>
                  <th className="px-2 py-1 text-right">Total</th>
                </tr>
              </thead>
              <tbody>
                {sectorRows.map((row) => (
                  <tr key={row.sector} className="border-b border-terminal-border/50">
                    <td className="px-2 py-1">{row.sector}</td>
                    <td className="px-2 py-1 text-right">{formatWeight(row.portfolio_weight)}</td>
                    <td className="px-2 py-1 text-right">{formatWeight(row.benchmark_weight)}</td>
                    <td className="px-2 py-1 text-right">{formatPct(row.portfolio_return)}</td>
                    <td className="px-2 py-1 text-right">{formatPct(row.benchmark_return)}</td>
                    <td className={`px-2 py-1 text-right ${row.allocation >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(row.allocation)}</td>
                    <td className={`px-2 py-1 text-right ${row.selection >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(row.selection)}</td>
                    <td className={`px-2 py-1 text-right ${row.interaction >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(row.interaction)}</td>
                    <td className={`px-2 py-1 text-right ${row.total >= 0 ? "text-terminal-pos" : "text-terminal-neg"}`}>{formatPct(row.total)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="rounded border border-terminal-border bg-terminal-bg p-2">
            <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">Factor Decomposition</div>
            <Suspense fallback={<div className="text-xs text-terminal-muted">Loading factor chart...</div>}>
              <FactorAttributionChart data={data.factors} activeReturn={activeReturn} />
            </Suspense>
          </div>
        </>
      ) : null}
    </div>
  );
}

export default AttributionPanel;
