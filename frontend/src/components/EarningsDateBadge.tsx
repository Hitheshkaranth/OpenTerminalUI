import type { EarningsDate } from "../types";

function daysTo(rawDate: string): number | null {
  const dt = new Date(`${rawDate}T00:00:00Z`);
  if (!Number.isFinite(dt.getTime())) return null;
  const now = new Date();
  const n = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const d = Date.UTC(dt.getUTCFullYear(), dt.getUTCMonth(), dt.getUTCDate());
  return Math.round((d - n) / (1000 * 60 * 60 * 24));
}

export function EarningsDateBadge({ event }: { event?: EarningsDate | null }) {
  if (!event) return <span className="text-xs text-terminal-muted">-</span>;
  const diff = daysTo(event.earnings_date);
  const text =
    diff == null
      ? event.earnings_date
      : diff === 0
      ? "Earnings today"
      : diff === 1
      ? "Earnings tomorrow"
      : diff > 1
      ? `Earnings in ${diff} days`
      : `Earnings ${Math.abs(diff)} days ago`;

  const tone =
    diff === 0 || diff === 1
      ? "border-red-500/50 text-red-300"
      : diff != null && diff > 1 && diff <= 7
      ? "border-amber-500/50 text-amber-300"
      : "border-terminal-border text-terminal-text";

  return (
    <span
      className={`inline-flex items-center rounded border px-2 py-0.5 text-[11px] ${tone} ${diff === 1 ? "animate-pulse" : ""}`}
      title={`Est EPS: ${event.estimated_eps ?? "-"} | ${event.fiscal_quarter}`}
    >
      {text}
    </span>
  );
}
