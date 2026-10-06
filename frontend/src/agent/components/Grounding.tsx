import { createContext, useContext } from "react";
import type { GroundingClaim, GroundingReport, GroundingSource } from "../types";

/**
 * Ground-truth display for agent answers. The backend checks every figure in an
 * answer against the tool results of the run (see backend/agent/grounding.py)
 * and marks it ⟦v:S3⟧ (verified), ⟦w:S3⟧ (verified, low-quality source),
 * ⟦x:S3:24.1⟧ (contradicts S3, which says 24.1) or ⟦u⟧ (no source).
 */

export const GroundingContext = createContext<GroundingReport | null>(null);

const COLOR = {
  verified: "var(--ot-color-market-up)",
  warn: "var(--ot-color-feedback-warning)",
  mismatch: "var(--ot-color-market-down)",
  unsourced: "var(--ot-color-text-muted)",
} as const;

function describeSource(src: GroundingSource | undefined): string {
  if (!src) return "";
  const subject = (src.args.ticker ?? src.args.symbol ?? "") as string;
  const parts = [`${src.tool}${subject ? `(${subject})` : ""}`, src.provider, src.quality];
  if (src.as_of) parts.push(`as of ${src.as_of}`);
  return parts.join(" · ");
}

export function SourceChip({ kind, sourceId, expected }: { kind: string; sourceId?: string; expected?: string }) {
  const report = useContext(GroundingContext);
  const src = report?.sources.find((s) => s.id === sourceId);
  let label: string;
  let color: string;
  let title: string;
  if (kind === "v" || kind === "w") {
    label = sourceId ?? "";
    color = kind === "w" ? COLOR.warn : COLOR.verified;
    title = `Matches ${sourceId}: ${describeSource(src)}${kind === "w" ? " (low-quality source)" : ""}`;
  } else if (kind === "x") {
    label = `≠${sourceId}`;
    color = COLOR.mismatch;
    title = `Does not match ${sourceId}, which reports ${expected}: ${describeSource(src)}`;
  } else {
    label = "?";
    color = COLOR.unsourced;
    title = "Not found in any tool result for this run (computed or unsupported)";
  }
  return (
    <sup
      title={title}
      className="ml-0.5 cursor-help rounded-sm border px-0.5 font-mono text-[9px] font-semibold not-italic"
      style={{ color, borderColor: color, borderStyle: kind === "u" ? "dashed" : "solid" }}
    >
      {label}
    </sup>
  );
}

const STATUS_LABEL: Record<GroundingClaim["status"], string> = {
  verified: "verified",
  mismatch: "mismatch",
  unsourced: "no source",
};

function claimColor(c: GroundingClaim): string {
  if (c.status === "mismatch") return COLOR.mismatch;
  if (c.status === "unsourced") return COLOR.unsourced;
  return c.warning ? COLOR.warn : COLOR.verified;
}

function fmtValue(v: number | null): string {
  if (v == null) return "—";
  return Math.abs(v) >= 1e5 ? v.toLocaleString(undefined, { maximumFractionDigits: 0 }) : String(+v.toFixed(4));
}

export function SourcesPanel({ report }: { report: GroundingReport }) {
  const { summary, claims, sources } = report;
  if (!summary.total && !sources.length) return null;
  const issues = summary.mismatch + summary.unsourced;
  return (
    <details
      open={summary.mismatch > 0}
      className="rounded-md border border-terminal-border bg-terminal-panel/60 text-[11px]"
    >
      <summary className="flex cursor-pointer flex-wrap items-center gap-x-2 gap-y-0.5 px-2.5 py-1.5 font-mono text-terminal-muted">
        <span className="uppercase tracking-[0.12em] text-terminal-accent">Ground truth</span>
        {summary.total ? (
          <>
            <span style={{ color: issues ? COLOR.warn : COLOR.verified }}>
              {summary.verified}/{summary.total} figures verified
            </span>
            {summary.mismatch ? <span style={{ color: COLOR.mismatch }}>· {summary.mismatch} mismatch</span> : null}
            {summary.unsourced ? <span>· {summary.unsourced} unsourced</span> : null}
            {summary.low_quality ? (
              <span style={{ color: COLOR.warn }}>· {summary.low_quality} from low-quality data</span>
            ) : null}
          </>
        ) : (
          <span>no figures to check</span>
        )}
        <span className="ml-auto">{sources.length} source{sources.length === 1 ? "" : "s"}</span>
      </summary>
      <div className="flex flex-col gap-2 border-t border-terminal-border/60 px-2.5 py-2">
        {claims.length > 0 && (
          <div className="overflow-x-auto">
            <table className="w-full border-collapse font-mono text-[10.5px]">
              <thead>
                <tr className="text-left text-terminal-muted">
                  <th className="py-0.5 pr-2 font-normal">Figure</th>
                  <th className="py-0.5 pr-2 font-normal">Check</th>
                  <th className="py-0.5 pr-2 font-normal">Source</th>
                  <th className="py-0.5 pr-2 font-normal">Field</th>
                  <th className="py-0.5 font-normal">Source value</th>
                </tr>
              </thead>
              <tbody>
                {claims.map((c, i) => (
                  <tr key={i} className="border-t border-terminal-border/40 align-top">
                    <td className="py-0.5 pr-2 text-terminal-text">{c.text}</td>
                    <td className="py-0.5 pr-2" style={{ color: claimColor(c) }} title={c.warning}>
                      {STATUS_LABEL[c.status]}
                      {c.warning ? " ⚠" : ""}
                    </td>
                    <td className="py-0.5 pr-2 text-terminal-accent">{c.source_id ?? "—"}</td>
                    <td className="py-0.5 pr-2 text-terminal-muted">
                      {c.path ? `${c.subject ? `${c.subject} · ` : ""}${c.path}` : c.metric ?? "—"}
                    </td>
                    <td className="py-0.5 text-terminal-text">{c.status === "mismatch" ? c.expected : fmtValue(c.source_value)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {sources.length > 0 && (
          <ul className="flex list-none flex-col gap-0.5 p-0">
            {sources.map((s) => (
              <li key={s.id} className="font-mono text-[10.5px] text-terminal-muted">
                <span className="text-terminal-accent">{s.id}</span>{" "}
                <span className="text-terminal-text">{s.tool}</span>
                {Object.keys(s.args).length ? `(${Object.entries(s.args).map(([k, v]) => `${k}=${typeof v === "object" ? JSON.stringify(v) : String(v)}`).join(", ")})` : ""}
                {" — "}
                {s.provider} ·{" "}
                <span style={{ color: ["synthetic", "unavailable", "unreported"].includes(s.quality) ? COLOR.warn : undefined }}>
                  {s.quality}
                </span>
                {s.as_of ? ` · as of ${s.as_of}` : ""}
                {s.note ? ` · ${s.note}` : ""}
              </li>
            ))}
          </ul>
        )}
      </div>
    </details>
  );
}
