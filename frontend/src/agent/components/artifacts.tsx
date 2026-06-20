import type * as React from "react";
import { formatMoney } from "../../lib/format";
import type { AgentArtifact } from "../types";

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
              href={r.url || "#"}
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
      <div className="grid grid-cols-3 gap-1.5">
        {valuation.map(([l, v]) => (
          <Metric key={l} label={l} value={v == null ? "—" : v.toFixed(2)} />
        ))}
      </div>
      <div className="grid grid-cols-4 gap-1.5">
        {profitability.map(([l, v]) => (
          <Metric key={l} label={l} value={v == null ? "—" : `${v.toFixed(2)}%`} />
        ))}
      </div>
      <div className="grid grid-cols-3 gap-1.5">
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
