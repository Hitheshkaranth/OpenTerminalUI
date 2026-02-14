import { useMemo } from "react";

import { usePromoterHoldings } from "../../hooks/useStocks";

type Props = {
  ticker: string;
};

function formatPct(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "-";
  return `${value.toFixed(2)}%`;
}

export function PromoterHoldingsCard({ ticker }: Props) {
  const { data, isLoading } = usePromoterHoldings(ticker);

  const latest = useMemo(() => {
    const rows = data?.history ?? [];
    if (!rows.length) return null;
    return rows[rows.length - 1];
  }, [data?.history]);

  if (isLoading) {
    return <div className="h-40 animate-pulse rounded border border-terminal-border bg-terminal-panel" />;
  }

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-4">
      <div className="text-xs uppercase tracking-wide text-terminal-accent">Promoter Holdings</div>
      <div className="mt-1 text-[11px] text-terminal-muted">{latest?.date ?? "No period available"}</div>
      <div className="mt-3 grid grid-cols-2 gap-2 text-xs md:grid-cols-4">
        <div className="rounded border border-terminal-border px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Promoter</div>
          <div className="mt-1 font-semibold tabular-nums">{formatPct(latest?.promoter)}</div>
        </div>
        <div className="rounded border border-terminal-border px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">FII</div>
          <div className="mt-1 font-semibold tabular-nums">{formatPct(latest?.fii)}</div>
        </div>
        <div className="rounded border border-terminal-border px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">DII</div>
          <div className="mt-1 font-semibold tabular-nums">{formatPct(latest?.dii)}</div>
        </div>
        <div className="rounded border border-terminal-border px-2 py-2">
          <div className="text-[10px] uppercase tracking-wide text-terminal-muted">Public</div>
          <div className="mt-1 font-semibold tabular-nums">{formatPct(latest?.public)}</div>
        </div>
      </div>
      {data?.warning ? <div className="mt-2 text-[11px] text-terminal-warn">{String(data.warning)}</div> : null}
    </div>
  );
}
