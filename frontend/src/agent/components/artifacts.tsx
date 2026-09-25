import type * as React from "react";
import { formatMoney } from "../../lib/format";
import type { AgentArtifact, SignalTableData } from "../types";
import { SignalTable } from "./SignalTable";

const cell: React.CSSProperties = {
  padding: "var(--ot-space-1) var(--ot-space-2)",
  borderBottom: "1px solid var(--ot-color-border-subtle)",
  fontFamily: "var(--ot-font-data)",
  fontSize: 12,
  color: "var(--ot-color-text-primary)",
  textAlign: "left",
  whiteSpace: "nowrap",
};

function RowsTable({ rows }: { rows: Record<string, unknown>[] }) {
  if (!rows.length) return <div style={{ color: "var(--ot-color-text-muted)" }}>No rows.</div>;
  const cols = Object.keys(rows[0]);
  return (
    <table style={{ borderCollapse: "collapse", width: "100%" }}>
      <thead>
        <tr>
          {cols.map((c) => (
            <th key={c} style={{ ...cell, color: "var(--ot-color-text-secondary)", fontFamily: "var(--ot-font-ui)" }}>
              {c}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            {cols.map((c) => (
              <td key={c} style={cell}>{r[c] == null ? "—" : String(r[c])}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function asRows(data: unknown): Record<string, unknown>[] {
  // screen_stocks returns rows under `results`; compare_stocks under `rows`.
  const d = data as { rows?: unknown[]; results?: unknown[] } | null;
  const rows = d?.rows ?? d?.results;
  return Array.isArray(rows) ? (rows as Record<string, unknown>[]) : [];
}

type ResearchRow = {
  title?: string;
  authors?: string[];
  url?: string;
  published_at?: string;
  score?: number;
  abstract?: string;
};

function ResearchList({ data }: { data: unknown }) {
  const rows = ((data as { results?: ResearchRow[] })?.results ?? []) as ResearchRow[];
  if (!rows.length) return <div style={{ color: "var(--ot-color-text-muted)" }}>No research found.</div>;
  return (
    <div style={{ display: "grid", gap: "var(--ot-space-2)" }}>
      {rows.map((r, i) => (
        <div
          key={i}
          style={{
            border: "1px solid var(--ot-color-border-subtle)",
            borderRadius: "var(--ot-radius-sm)",
            padding: "var(--ot-space-2)",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", gap: "var(--ot-space-2)" }}>
            <a
              href={r.url && /^https?:\/\//i.test(r.url) ? r.url : "#"}
              target="_blank"
              rel="noreferrer"
              style={{ fontFamily: "var(--ot-font-ui)", fontSize: 12, fontWeight: 600, color: "var(--ot-color-text-primary)" }}
            >
              {r.title || "Untitled"}
            </a>
            {typeof r.score === "number" ? (
              <span style={{ fontFamily: "var(--ot-font-data)", fontSize: 10, color: "var(--ot-color-accent)" }}>
                {r.score.toFixed(3)}
              </span>
            ) : null}
          </div>
          <div style={{ fontFamily: "var(--ot-font-ui)", fontSize: 10, color: "var(--ot-color-text-muted)", marginTop: 2 }}>
            {(r.authors || []).join(", ") || "Unknown authors"}
            {r.published_at ? ` · ${String(r.published_at).slice(0, 10)}` : ""}
          </div>
          {r.abstract ? (
            <p style={{ margin: "var(--ot-space-1) 0 0", fontFamily: "var(--ot-font-data)", fontSize: 11, color: "var(--ot-color-text-secondary)", lineHeight: 1.4 }}>
              {String(r.abstract).slice(0, 280)}
              {String(r.abstract).length > 280 ? "…" : ""}
            </p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

type Snapshot = {
  ticker?: string;
  company_name?: string;
  current_price?: number;
  change_pct?: number;
  market_cap?: number;
  enterprise_value?: number;
  pe?: number;
  forward_pe?: number;
  pb?: number;
  ps?: number;
  ev_ebitda?: number;
  roe_pct?: number;
  roa_pct?: number;
  op_margin_pct?: number;
  net_margin_pct?: number;
  rev_growth_pct?: number;
  eps_growth_pct?: number;
  div_yield_pct?: number;
  beta?: number;
  sector?: string;
  industry?: string;
  exchange?: string;
  currency?: string;
  flag_emoji?: string;
  market_status?: string;
  has_futures?: boolean;
  has_options?: boolean;
  error?: string;
};

const num = (v: unknown): number | null => (typeof v === "number" && Number.isFinite(v) ? v : null);

function compactMoney(value: number, currency: string): string {
  const sym = currency === "INR" ? "₹" : currency === "USD" ? "$" : "";
  const abs = Math.abs(value);
  const units: [number, string][] = [
    [1e12, "T"],
    [1e9, "B"],
    [1e7, "Cr"],
    [1e6, "M"],
  ];
  for (const [size, label] of units) {
    if (abs >= size) return `${sym}${(value / size).toFixed(2)}${label}`;
  }
  return `${sym}${value.toFixed(0)}`;
}

function asCurrency(value: number, currency: string): string {
  return currency === "INR" || currency === "USD"
    ? formatMoney(value, currency)
    : `${value.toFixed(2)}`;
}

const pct = (v: number) => `${v >= 0 ? "+" : ""}${v.toFixed(2)}%`;
const toneClass = (v: number) => (v >= 0 ? "text-terminal-pos" : "text-terminal-neg");

function Metric({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-sm border border-terminal-border bg-terminal-bg/40 px-2 py-1.5">
      <span className="block text-[9px] uppercase tracking-[0.12em] text-terminal-muted">{label}</span>
      <span className={`mt-0.5 block font-mono text-xs ${tone ?? "text-terminal-text"}`}>{value}</span>
    </div>
  );
}

function Logo({ ticker, flag }: { ticker: string; flag?: string }) {
  const mono = (ticker || "?").replace(/[^A-Za-z0-9]/g, "").slice(0, 3).toUpperCase() || "?";
  return (
    <div className="relative shrink-0">
      <div className="flex h-11 w-11 items-center justify-center rounded-md border border-terminal-accent/40 bg-gradient-to-br from-terminal-accent/20 to-terminal-bg/40">
        <span className="font-mono text-[13px] font-semibold tracking-tight text-terminal-accent">{mono}</span>
      </div>
      {flag ? (
        <span className="absolute -bottom-1 -right-1 rounded-sm border border-terminal-border bg-terminal-panel px-0.5 text-[10px] leading-none">
          {flag}
        </span>
      ) : null}
    </div>
  );
}

function SnapshotCard({ data }: { data: Snapshot }) {
  if (!data || data.error) {
    return <div className="text-xs text-terminal-muted">{data?.error || "No snapshot available."}</div>;
  }
  const currency = data.currency || "USD";
  const price = num(data.current_price);
  const change = num(data.change_pct);
  const mcap = num(data.market_cap);
  const ev = num(data.enterprise_value);

  const valuation: [string, number | null][] = [
    ["P/E", num(data.pe)],
    ["Fwd P/E", num(data.forward_pe)],
    ["P/B", num(data.pb)],
    ["P/S", num(data.ps)],
    ["EV/EBITDA", num(data.ev_ebitda)],
    ["Beta", num(data.beta)],
  ];
  const profitability: [string, number | null][] = [
    ["ROE", num(data.roe_pct)],
    ["ROA", num(data.roa_pct)],
    ["Op Margin", num(data.op_margin_pct)],
    ["Net Margin", num(data.net_margin_pct)],
  ];
  const growth: [string, number | null, boolean][] = [
    ["Rev Growth", num(data.rev_growth_pct), true],
    ["EPS Growth", num(data.eps_growth_pct), true],
    ["Div Yield", num(data.div_yield_pct), false],
  ];

  return (
    <div className="flex flex-col gap-3">
      {/* header: logo + name + price */}
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2.5">
          <Logo ticker={data.ticker || ""} flag={data.flag_emoji} />
          <div className="min-w-0">
            <div className="truncate font-semibold text-terminal-text">{data.company_name || data.ticker}</div>
            <div className="font-mono text-[11px] uppercase tracking-wide text-terminal-muted">
              {data.ticker}
              {data.exchange ? ` · ${data.exchange}` : ""}
            </div>
          </div>
        </div>
        <div className="text-right">
          {price != null ? (
            <div className="font-mono text-base font-semibold text-terminal-text">{asCurrency(price, currency)}</div>
          ) : null}
          {change != null ? (
            <div className={`font-mono text-xs ${toneClass(change)}`}>{pct(change)}</div>
          ) : null}
        </div>
      </div>

      {/* meta chips */}
      <div className="flex flex-wrap gap-1">
        {data.sector ? <Chip>{data.sector}</Chip> : null}
        {data.industry ? <Chip>{data.industry}</Chip> : null}
        {mcap != null ? <Chip accent>MCap {compactMoney(mcap, currency)}</Chip> : null}
        {ev != null ? <Chip>EV {compactMoney(ev, currency)}</Chip> : null}
        {data.market_status ? <Chip>{data.market_status}</Chip> : null}
        {data.has_options ? <Chip>Options</Chip> : null}
        {data.has_futures ? <Chip>Futures</Chip> : null}
      </div>

      {/* metric grids */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {valuation.map(([l, v]) => (
          <Metric key={l} label={l} value={v == null ? "—" : v.toFixed(2)} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-1.5">
        {profitability.map(([l, v]) => (
          <Metric key={l} label={l} value={v == null ? "—" : `${v.toFixed(2)}%`} />
        ))}
      </div>
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-1.5">
        {growth.map(([l, v, signed]) => (
          <Metric
            key={l}
            label={l}
            value={v == null ? "—" : signed ? pct(v) : `${v.toFixed(2)}%`}
            tone={v != null && signed ? toneClass(v) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

function Chip({ children, accent }: { children: React.ReactNode; accent?: boolean }) {
  return (
    <span
      className={`rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-[0.1em] ${
        accent ? "border-terminal-accent/60 text-terminal-accent" : "border-terminal-border text-terminal-muted"
      }`}
    >
      {children}
    </span>
  );
}

type Technicals = {
  ticker?: string;
  price?: number;
  trend?: { above_50dma?: boolean; above_200dma?: boolean };
  momentum?: { rsi_14?: number };
  volatility?: { atr_pct?: number };
  volume?: { rvol_20?: number };
  distance_from_20d_high_pct?: number;
  active_setups?: { setup_type?: string; event_type?: string }[];
  note?: string;
};

const displayNum = (value: unknown, suffix = "") => {
  const valueNum = num(value);
  return valueNum == null ? "—" : `${valueNum.toFixed(2)}${suffix}`;
};

function TechnicalsCard({ data }: { data: Technicals }) {
  const setups = Array.isArray(data?.active_setups) ? data.active_setups : [];
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-terminal-text">{data?.ticker || "Technical analysis"}</span>
        {data?.note ? <span className="text-xs text-terminal-muted">{data.note}</span> : null}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Price" value={displayNum(data?.price)} />
        <Metric label="Above 50 DMA" value={data?.trend?.above_50dma == null ? "—" : data.trend.above_50dma ? "Yes" : "No"} tone={data?.trend?.above_50dma ? "text-terminal-pos" : "text-terminal-neg"} />
        <Metric label="Above 200 DMA" value={data?.trend?.above_200dma == null ? "—" : data.trend.above_200dma ? "Yes" : "No"} tone={data?.trend?.above_200dma ? "text-terminal-pos" : "text-terminal-neg"} />
        <Metric label="RSI 14" value={displayNum(data?.momentum?.rsi_14)} />
        <Metric label="ATR %" value={displayNum(data?.volatility?.atr_pct, "%")} />
        <Metric label="RVOL 20" value={displayNum(data?.volume?.rvol_20)} />
        <Metric label="From 20D High" value={displayNum(data?.distance_from_20d_high_pct, "%")} />
      </div>
      {setups.length ? (
        <div className="flex flex-wrap gap-1">
          {setups.map((setup, index) => <Chip key={`${setup.setup_type}-${index}`} accent>{setup.setup_type || "Setup"} · {setup.event_type || "none"}</Chip>)}
        </div>
      ) : <div className="text-xs text-terminal-muted">No active technical setups.</div>}
    </div>
  );
}

function SetupTable({ data }: { data: unknown }) {
  const results = (data as { results?: unknown[] } | null)?.results;
  const fields = ["symbol", "setup_type", "score", "event_type", "trend_state", "rvol", "atr_pct"];
  const rows = Array.isArray(results)
    ? results.filter((row): row is Record<string, unknown> => !!row && typeof row === "object").map((row) => {
      const mapped: Record<string, unknown> = {};
      fields.forEach((field) => { mapped[field] = row[field]; });
      return mapped;
    })
    : [];
  return <RowsTable rows={rows} />;
}

type EquityPoint = { date?: string; equity?: number; strategy?: number; benchmark?: number };
type BacktestReport = {
  ticker?: string; bars?: number; metrics?: Record<string, unknown>; equity_curve?: EquityPoint[]; note?: string;
};
type BasketBacktest = {
  tickers?: string[]; benchmark?: string; top_n?: number; summary?: {
    strategy?: Record<string, unknown>; benchmark?: Record<string, unknown>; alpha_total_return_pct?: number;
  }; equity_curve?: EquityPoint[]; note?: string;
};
type RobustnessWindow = {
  index?: number; start?: string; end?: string; total_return?: number; cagr?: number;
  sharpe?: number; max_drawdown?: number;
};
type RobustnessCard = {
  points?: number; metric?: string; verdict?: string; note?: string;
  permutation?: {
    observed?: number; p_value?: number; percentile?: number; null_mean?: number;
    null_std?: number; significant?: boolean; interpretation?: string;
  };
  robustness?: {
    n_windows?: number; consistency_score?: number;
    coverage?: { profitable_pct?: number; positive_sharpe_pct?: number };
    interpretation?: string; windows?: RobustnessWindow[];
  };
};

function linePoints(values: number[], width = 120, height = 36): string {
  if (values.length < 2) return "";
  const low = Math.min(...values);
  const high = Math.max(...values);
  const span = high - low || 1;
  return values.map((value, index) => `${(index / (values.length - 1)) * width},${height - ((value - low) / span) * height}`).join(" ");
}

function BacktestReportCard({ data }: { data: BacktestReport }) {
  const metrics = data?.metrics || {};
  const curve = Array.isArray(data?.equity_curve) ? data.equity_curve : [];
  const values = curve.map((point) => num(point.equity)).filter((value): value is number => value != null);
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-terminal-text">{data?.ticker || "Backtest"}</span>
        {data?.note ? <span className="text-xs text-terminal-muted">{data.note}</span> : <Chip accent>SMA crossover</Chip>}
      </div>
      {values.length >= 2 ? (
        <svg viewBox="0 0 120 36" preserveAspectRatio="none" className="h-10 w-full" role="img" aria-label="Equity curve">
          <polyline fill="none" stroke="var(--ot-color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={linePoints(values)} />
        </svg>
      ) : <div className="text-xs text-terminal-muted">Not enough data.</div>}
      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Total return" value={displayNum(metrics.total_return_pct, "%")} tone={num(metrics.total_return_pct) != null ? toneClass(num(metrics.total_return_pct) || 0) : undefined} />
        {metrics.cagr_pct != null ? <Metric label="CAGR" value={displayNum(metrics.cagr_pct, "%")} /> : null}
        <Metric label="Sharpe" value={displayNum(metrics.sharpe)} />
        <Metric label="Max drawdown" value={displayNum(metrics.max_drawdown_pct, "%")} tone="text-terminal-neg" />
        <Metric label="Win rate" value={displayNum(metrics.win_rate_pct, "%")} />
        <Metric label="Profit factor" value={displayNum(metrics.profit_factor)} />
        <Metric label="Trades" value={displayNum(metrics.trades)} />
        <Metric label="Bars" value={displayNum(data?.bars)} />
      </div>
    </div>
  );
}

function BasketEquityCurve({ data }: { data: BasketBacktest }) {
  const curve = Array.isArray(data?.equity_curve) ? data.equity_curve : [];
  const strategy = curve.map((point) => num(point.strategy));
  const benchmark = curve.map((point) => num(point.benchmark));
  const usable = strategy.length >= 2 && benchmark.length >= 2 && strategy.every((value) => value != null) && benchmark.every((value) => value != null);
  const summary = data?.summary;
  const strategyReturn = num(summary?.strategy?.total_return_pct);
  const benchmarkReturn = num(summary?.benchmark?.total_return_pct);
  const alpha = num(summary?.alpha_total_return_pct);
  const allValues = usable ? [...(strategy as number[]), ...(benchmark as number[])] : [];
  const low = allValues.length ? Math.min(...allValues) : 0;
  const high = allValues.length ? Math.max(...allValues) : 1;
  const points = (values: number[]) => values.map((value, index) => `${(index / (values.length - 1)) * 120},${36 - ((value - low) / (high - low || 1)) * 36}`).join(" ");
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-terminal-text">Momentum rotation</span>
        {data?.note ? <span className="text-xs text-terminal-muted">{data.note}</span> : <Chip>{data?.top_n || "—"} holdings</Chip>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Metric label="Strategy" value={displayNum(strategyReturn, "%")} tone={strategyReturn != null ? toneClass(strategyReturn) : undefined} />
        <Metric label="Benchmark" value={displayNum(benchmarkReturn, "%")} tone={benchmarkReturn != null ? toneClass(benchmarkReturn) : undefined} />
        <Metric label="Alpha" value={displayNum(alpha, "%")} tone={alpha != null ? toneClass(alpha) : undefined} />
      </div>
      {usable ? (
        <div>
          <div className="mb-1 flex gap-3 text-[10px] text-terminal-muted"><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-terminal-accent" />Strategy</span><span><i className="mr-1 inline-block h-1.5 w-1.5 rounded-full bg-terminal-muted" />{data?.benchmark || "Benchmark"}</span></div>
          <svg viewBox="0 0 120 36" preserveAspectRatio="none" className="h-12 w-full" role="img" aria-label="Strategy and benchmark equity curves">
            <polyline fill="none" stroke="var(--ot-color-accent)" strokeWidth="1.5" vectorEffect="non-scaling-stroke" points={points(strategy as number[])} />
            <polyline fill="none" stroke="var(--ot-color-text-muted)" strokeWidth="1.25" vectorEffect="non-scaling-stroke" points={points(benchmark as number[])} />
          </svg>
        </div>
      ) : <div className="text-xs text-terminal-muted">Not enough data.</div>}
    </div>
  );
}

function RobustnessReportCard({ data }: { data: RobustnessCard }) {
  const permutation = data?.permutation || {};
  const robustness = data?.robustness || {};
  const coverage = robustness.coverage || {};
  const pValue = num(permutation.p_value);
  const windows = Array.isArray(robustness.windows) ? robustness.windows : [];
  const rows = windows.map((window) => ({
    index: window.index,
    start: window.start,
    end: window.end,
    total_return: displayNum(window.total_return, "%"),
    cagr: displayNum(window.cagr, "%"),
    sharpe: displayNum(window.sharpe),
    max_drawdown: displayNum(window.max_drawdown, "%"),
  }));
  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <span className="font-mono text-sm font-semibold text-terminal-text">Backtest robustness</span>
        {data?.note ? <span className="text-xs text-terminal-muted">{data.note}</span> : <Chip accent>{data?.points ?? 0} points</Chip>}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
        <Metric label={data?.metric === "total_return" ? "Observed return" : "Observed Sharpe"} value={displayNum(data?.metric === "total_return" && num(permutation.observed) != null ? (num(permutation.observed) as number) * 100 : permutation.observed, data?.metric === "total_return" ? "%" : "")} tone={num(permutation.observed) != null ? toneClass(num(permutation.observed) || 0) : undefined} />
        <Metric label="P-value" value={displayNum(pValue)} tone={pValue != null && pValue < 0.05 ? "text-terminal-pos" : "text-terminal-muted"} />
        <Metric label="Percentile" value={displayNum(permutation.percentile, "%")} />
        <Metric label="Consistency" value={displayNum(robustness.consistency_score)} tone={num(robustness.consistency_score) != null ? toneClass(num(robustness.consistency_score) || 0) : undefined} />
        <Metric label="Profitable windows" value={displayNum(coverage.profitable_pct, "%")} />
        <Metric label="Positive-Sharpe" value={displayNum(coverage.positive_sharpe_pct, "%")} />
      </div>
      {data?.verdict ? <Chip accent={pValue != null && pValue < 0.05}>{data.verdict}</Chip> : null}
      {rows.length ? <RowsTable rows={rows} /> : <div className="text-xs text-terminal-muted">No window results available.</div>}
    </div>
  );
}

export function ArtifactView({ artifact }: { artifact: AgentArtifact }) {
  let body: React.ReactNode;
  switch (artifact.kind) {
    case "screener_table":
    case "compare_table":
      body = <RowsTable rows={asRows(artifact.data)} />;
      break;
    case "snapshot_card":
      body = <SnapshotCard data={(artifact.data as Snapshot) || {}} />;
      break;
    case "research_list":
      body = <ResearchList data={artifact.data} />;
      break;
    case "technicals_card":
      body = <TechnicalsCard data={(artifact.data as Technicals) || {}} />;
      break;
    case "setup_table":
      body = <SetupTable data={artifact.data} />;
      break;
    case "backtest_report":
      body = <BacktestReportCard data={(artifact.data as BacktestReport) || {}} />;
      break;
    case "equity_curve":
      body = <BasketEquityCurve data={(artifact.data as BasketBacktest) || {}} />;
      break;
    case "robustness_card":
      body = <RobustnessReportCard data={(artifact.data as RobustnessCard) || {}} />;
      break;
    case "signal_table":
      body = <SignalTable data={artifact.data as SignalTableData} />;
      break;
    default:
      body = (
        <pre style={{ margin: 0, fontFamily: "var(--ot-font-data)", fontSize: 11, color: "var(--ot-color-text-secondary)", whiteSpace: "pre-wrap" }}>
          {JSON.stringify(artifact.data, null, 2)}
        </pre>
      );
  }
  return (
    <section className="overflow-x-auto rounded-sm border border-terminal-border bg-terminal-panel/80 p-2.5">
      <header className="mb-2 ot-type-panel-title uppercase tracking-[0.14em] text-terminal-accent">
        {artifact.name}
      </header>
      {body}
    </section>
  );
}
