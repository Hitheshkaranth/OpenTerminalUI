import { useQuery } from "@tanstack/react-query";
import { useEffect, useMemo, useState } from "react";

import {
  fetchReverseDcf,
  type ReverseDcf,
  type ReverseDcfBasis,
  type ReverseDcfVerdict,
  type ReverseDcfParams,
} from "../../api/businessResearch";
import { TerminalBadge } from "../terminal/TerminalBadge";
import { TerminalInput } from "../terminal/TerminalInput";
import { TerminalPanel } from "../terminal/TerminalPanel";
import { TerminalTable } from "../terminal/TerminalTable";

export type ReverseDcfCardProps = { symbol: string; market?: string; compact?: boolean };

type VerdictMeta = { variant: "danger" | "info" | "neutral" | "success"; label: string };

const VERDICT_META: Record<ReverseDcfVerdict, VerdictMeta> = {
  priced_for_perfection: { variant: "danger", label: "Priced for perfection" },
  demanding: { variant: "danger", label: "Demanding" },
  reasonable: { variant: "info", label: "Reasonable" },
  undemanding: { variant: "success", label: "Undemanding" },
  not_meaningful: { variant: "neutral", label: "Not meaningful" },
};

function fmtPct(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${(value * 100).toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

// implied_growth_pct (headline + sensitivity grid) is already in percent (19.4 = 19.4%), unlike the
// fractional historical CAGRs that fmtPct scales; formatting it with fmtPct showed "1,937%".
const EMPTY_SENSITIVITY = { discount_rates: [] as number[], terminal_growths: [] as number[], implied_growth_pct: [] as (number | null)[][] };

function fmtPctPoints(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString("en-US", { maximumFractionDigits: 1 })}%`;
}

function heatStyle(value: number | null) {
  if (value == null) return { bg: "transparent", fg: "text-terminal-muted" };
  const min = -5;
  const max = 35;
  const mid = (min + max) / 2;
  const half = (max - min) / 2;
  const t = Math.max(-1, Math.min(1, (value - mid) / half));
  const alpha = 0.12 + Math.min(0.55, Math.abs(t) * 0.55);
  const bg = value < 0 ? `rgba(34,197,94,${alpha.toFixed(2)})` : `rgba(239,68,68,${alpha.toFixed(2)})`;
  return { bg, fg: "text-terminal-text" };
}

function pctLabel(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function formatAssumption(
  value: number | null,
  currency: string | null,
  opts: { large?: boolean } = {},
): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const n = Number(value);
  if (opts.large) {
    if (Math.abs(n) >= 1e12) return `${(n / 1e12).toFixed(2)}T`;
    if (Math.abs(n) >= 1e9) return `${(n / 1e9).toFixed(2)}B`;
    if (Math.abs(n) >= 1e6) return `${(n / 1e6).toFixed(2)}M`;
  }
  const num = n.toLocaleString("en-US", { maximumFractionDigits: 2 });
  return currency ? `${num} ${currency}` : num;
}

const BASIS_LABELS: Record<ReverseDcfBasis, string> = { fcf: "Free cash flow", net_income: "Net income" };

export function ReverseDcfCard({ symbol, compact }: ReverseDcfCardProps) {
  const [discountState, setDiscountState] = useState("0.12");
  const [growthState, setGrowthState] = useState("0.04");
  const [yearsState, setYearsState] = useState("10");
  const [basisState, setBasisState] = useState<ReverseDcfBasis>("fcf");

  const [applied, setApplied] = useState<ReverseDcfParams>({
    discount_rate: 0.12,
    terminal_growth: 0.04,
    years: 10,
    basis: "fcf",
  });

  useEffect(() => {
    const handle = setTimeout(() => {
      setApplied({
        discount_rate: Number(discountState) || 0.12,
        terminal_growth: Number(growthState) || 0.04,
        years: Number(yearsState) || 10,
        basis: basisState,
      });
    }, 400);
    return () => clearTimeout(handle);
  }, [discountState, growthState, yearsState, basisState]);

  const { data, isLoading, isError, error, isRefetching, refetch } = useQuery({
    queryKey: ["reverse-dcf", symbol, applied.discount_rate, applied.terminal_growth, applied.years, applied.basis],
    queryFn: () => fetchReverseDcf(symbol, applied),
    enabled: Boolean(symbol),
    staleTime: 5 * 60 * 1000,
  });

  useEffect(() => {
    if (!data) return;
    setDiscountState(String(data.discount_rate));
    setGrowthState(String(data.terminal_growth));
    setYearsState(String(data.years));
    setBasisState(data.basis);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  const reverseDcf = data ?? null;

  const assumed = useMemo(() => {
    if (!reverseDcf) return null;
    const rows = [
      { label: "Price", value: formatAssumption(reverseDcf.price, reverseDcf.currency) },
      { label: "Market cap", value: formatAssumption(reverseDcf.market_cap, reverseDcf.currency, { large: true }) },
      { label: "Net debt", value: formatAssumption(reverseDcf.net_debt, reverseDcf.currency, { large: true }) },
      {
        label: `Base cash flow (${BASIS_LABELS[reverseDcf.basis]})`,
        value: formatAssumption(reverseDcf.base_cash_flow, reverseDcf.currency, { large: true }),
      },
    ];
    return rows;
  }, [reverseDcf]);

  if (isLoading) {
    return (
      <TerminalPanel title="Reverse DCF" subtitle="Loading…">
        <div className="px-2.5 py-6 text-terminal-muted text-[11px]">Loading reverse DCF…</div>
      </TerminalPanel>
    );
  }

  if (isError) {
    return (
      <TerminalPanel title="Reverse DCF" subtitle="Error">
        <div className="px-2.5 py-6">
          <div className="rounded-sm border border-terminal-neg bg-terminal-neg/10 px-3 py-2 ot-type-ui text-[11px] text-terminal-neg">
            {error instanceof Error ? error.message : "Failed to load reverse DCF."}
          </div>
        </div>
      </TerminalPanel>
    );
  }

  if (!reverseDcf) {
    return (
      <TerminalPanel title="Reverse DCF" subtitle="Not available yet">
        <div className="flex flex-col gap-2 px-2.5 py-6">
          <div className="rounded-sm border border-terminal-border bg-terminal-panel px-3 py-4 ot-type-ui text-center text-[11px] text-terminal-muted">
            No valuation data to build a reverse DCF for this company yet.
          </div>
        </div>
      </TerminalPanel>
    );
  }

  const verdict = reverseDcf.verdict;
  const meta = VERDICT_META[verdict];

  if (compact) {
    // Prefer 5-year CAGRs; many companies only have 3 years of statements from the provider.
    // Never trust a partial payload to have every block: a missing `historical` crashed the Overview tab.
    const h = reverseDcf.historical ?? { revenue_cagr_3y: null, revenue_cagr_5y: null, profit_cagr_3y: null, profit_cagr_5y: null };
    const revYears = h.revenue_cagr_5y != null ? 5 : 3;
    const profitYears = h.profit_cagr_5y != null ? 5 : 3;
    const revenueCagr = h.revenue_cagr_5y ?? h.revenue_cagr_3y;
    const profitCagr = h.profit_cagr_5y ?? h.profit_cagr_3y;
    return (
      <TerminalPanel title="Reverse DCF" subtitle="What the price implies">
        <div className="flex flex-col gap-3 px-2.5 py-3">
          {verdict === "not_meaningful" ? (
            <div className="rounded-sm border border-terminal-border bg-terminal-panel px-2.5 py-2 ot-type-ui text-terminal-muted text-[11px]">
              Implied growth is not meaningful with the current inputs.
            </div>
          ) : null}
          <div className="flex items-baseline justify-between gap-2">
            <span className="ot-type-label uppercase text-terminal-muted text-[10px]">Implied growth</span>
            <span className="ot-type-data text-3xl font-semibold text-terminal-text">
              {fmtPctPoints(reverseDcf.implied_growth_pct)}
            </span>
          </div>
          <div className="flex flex-col gap-1 border-t border-terminal-border pt-2 ot-type-ui text-[11px] text-terminal-muted">
            <div className="flex items-center justify-between gap-3">
              <span>Historical {revYears}y revenue CAGR</span>
              <span className={growthFg(revenueCagr)}>{fmtPct(revenueCagr)}</span>
            </div>
            <div className="flex items-center justify-between gap-3">
              <span>Historical {profitYears}y profit CAGR</span>
              <span className={growthFg(profitCagr)}>{fmtPct(profitCagr)}</span>
            </div>
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="ot-type-label uppercase text-terminal-muted text-[10px]">Read</span>
            <TerminalBadge variant={meta.variant}>{meta.label}</TerminalBadge>
          </div>
        </div>
      </TerminalPanel>
    );
  }

  return (
    <TerminalPanel
      title="Reverse DCF"
      subtitle={isRefetching ? "Recalculating…" : "What growth the price implies"}
      actions={
        isRefetching ? (
          <span className="ot-type-ui text-[10px] text-terminal-muted">Recalculating…</span>
        ) : null
      }
    >
      <div className="flex flex-col gap-4">
        <div className="grid grid-cols-2 gap-3 rounded-sm border border-terminal-border bg-terminal-panel p-3 sm:grid-cols-4">
          <label className="flex flex-col gap-1">
            <span className="ot-type-label uppercase text-terminal-muted text-[10px]">Discount rate</span>
            <TerminalInput
              as="input"
              type="number"
              size="sm"
              value={discountState}
              step="0.01"
              onChange={(e) => setDiscountState(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ot-type-label uppercase text-terminal-muted text-[10px]">Terminal growth</span>
            <TerminalInput
              as="input"
              type="number"
              size="sm"
              value={growthState}
              step="0.005"
              onChange={(e) => setGrowthState(e.target.value)}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="ot-type-label uppercase text-terminal-muted text-[10px]">Years</span>
            <TerminalInput
              as="input"
              type="number"
              size="sm"
              value={yearsState}
              step="1"
              onChange={(e) => setYearsState(e.target.value)}
            />
          </label>
          <div className="flex flex-col gap-1">
            <span className="ot-type-label uppercase text-terminal-muted text-[10px]">Basis</span>
            <div className="inline-flex items-center gap-1 rounded-sm border border-terminal-border p-0.5">
              {(Object.keys(BASIS_LABELS) as ReverseDcfBasis[]).map((b) => {
                const active = b === basisState;
                return (
                  <button
                    key={b}
                    type="button"
                    onClick={() => setBasisState(b)}
                    className={[
                      "flex-1 rounded-sm px-2 py-1 ot-type-label text-[10px]",
                      active ? "border-terminal-accent bg-terminal-accent/20 text-terminal-accent" : "text-terminal-muted hover:text-terminal-text",
                    ]
                      .join(" ")
                      .trim()}
                  >
                    {b === "fcf" ? "FCF" : "Net income"}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <section className="flex flex-col gap-2">
          <h3 className="ot-type-subheading text-[12px] uppercase text-terminal-muted">Assumptions</h3>
          <TerminalTable
            density="compact"
            emptyText="No assumptions"
            rowKey={(r) => r.label}
columns={[
          { key: "label", label: "Assumption", render: (row) => <span className="ot-type-data text-[11px] text-terminal-text">{row.label}</span> },
          { key: "value", label: "Value", align: "right", render: (row) => <span className="ot-type-data text-right text-[11px] text-terminal-text">{row.value}</span> },
        ]}
            rows={assumed || []}
          />
        </section>

        <section className="flex flex-col gap-2">
          <h3 className="ot-type-subheading text-[12px] uppercase text-terminal-muted">
            Implied growth — sensitivity
          </h3>
          <div className="overflow-x-auto">
            <div className="inline-block min-w-full border border-terminal-border bg-terminal-panel">
              <table className="border-collapse">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-terminal-panel px-2 py-1.5 text-left ot-type-label text-[10px] uppercase text-terminal-muted border-r border-terminal-border">
                      Disc. \ Term.
                    </th>
                    {(reverseDcf.sensitivity ?? EMPTY_SENSITIVITY).terminal_growths.map((g, idx) => (
                      <th key={idx} className="px-2 py-1.5 text-right ot-type-label text-[10px] uppercase text-terminal-muted">
                        {pctLabel(g)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {(reverseDcf.sensitivity ?? EMPTY_SENSITIVITY).discount_rates.map((r, ri) => (
                    <tr key={ri}>
                      <td className="sticky left-0 z-10 bg-terminal-panel px-2 py-1.5 border-r border-terminal-border ot-type-label text-[10px] text-terminal-text">
                        {pctLabel(r)}
                      </td>
                      {(reverseDcf.sensitivity ?? EMPTY_SENSITIVITY).implied_growth_pct[ri]?.map((cell, ci) => {
                        const style = heatStyle(cell);
                        return (
                          <td
                            key={ci}
                            title={`Discount ${pctLabel(r)} · Terminal ${pctLabel((reverseDcf.sensitivity ?? EMPTY_SENSITIVITY).terminal_growths[ci] ?? 0)} · Implied growth ${fmtPctPoints(cell)}`}
                            style={{ background: style.bg }}
                            className={`border-r border-b border-terminal-border px-3 py-1.5 text-center ot-type-data text-[11px] min-w-[56px] ${style.fg}`}
                          >
                            {fmtPctPoints(cell)}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </section>

        {reverseDcf.notes?.length ? (
          <section className="flex flex-col gap-2">
            <h3 className="ot-type-subheading text-[12px] uppercase text-terminal-muted">Notes</h3>
            <ul className="space-y-1 ot-type-ui text-[11px] text-terminal-text">
              {reverseDcf.notes.map((note, idx) => (
                <li key={idx} className="flex gap-2 border-l border-terminal-border pl-2">
                  <span className="text-terminal-muted">•</span>
                  <span className="truncate">{note}</span>
                </li>
              ))}
            </ul>
          </section>
        ) : null}
      </div>
    </TerminalPanel>
  );
}

function growthFg(value: number | null): string {
  if (value == null) return "text-terminal-muted";
  if (value < 0) return "text-terminal-neg";
  if (value > 0.15) return "text-terminal-pos";
  return "text-terminal-text";
}