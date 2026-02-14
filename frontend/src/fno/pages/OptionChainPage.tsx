import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchChainSummary, fetchOptionChain } from "../api/fnoApi";
import { OptionChainTable } from "../components/OptionChainTable";
import { OIChart } from "../components/OIChart";
import { StrikeSummaryBar } from "../components/StrikeSummaryBar";
import { useFnoContext } from "../FnoLayout";
import type { StrikeData } from "../types/fno";

export function OptionChainPage() {
  const { symbol, expiry } = useFnoContext();
  const [rangeFilter, setRangeFilter] = useState<10 | 15 | 20 | 0>(20);

  const backendRange = rangeFilter === 0 ? 100 : rangeFilter;

  const chainQuery = useQuery({
    queryKey: ["fno-chain", symbol, expiry, backendRange],
    queryFn: () => fetchOptionChain(symbol, expiry || undefined, backendRange),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const summaryQuery = useQuery({
    queryKey: ["fno-summary", symbol, expiry],
    queryFn: () => fetchChainSummary(symbol, expiry || undefined),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const chain = chainQuery.data;
  const rows = useMemo(() => {
    const list = (chain?.strikes ?? []) as StrikeData[];
    if (!list.length || rangeFilter === 0) return list;
    const atm = Number(chain?.atm_strike || 0);
    const idx = Math.max(0, list.findIndex((r) => Math.abs(Number(r.strike_price) - atm) < 1e-9));
    const left = Math.max(0, idx - rangeFilter);
    const right = Math.min(list.length, idx + rangeFilter + 1);
    return list.slice(left, right);
  }, [chain?.strikes, chain?.atm_strike, rangeFilter]);

  return (
    <div className="space-y-3">
      <div className="sticky top-0 z-10">
        <StrikeSummaryBar
          symbol={symbol}
          expiry={chain?.expiry_date || expiry}
          spotPrice={Number(chain?.spot_price || 0)}
          summary={summaryQuery.data}
        />
      </div>

      <div className="flex items-center gap-2 rounded border border-terminal-border bg-terminal-panel px-3 py-2 text-xs">
        <span className="uppercase text-terminal-muted">Strike Range</span>
        {([10, 15, 20, 0] as const).map((r) => (
          <button
            key={String(r)}
            className={`rounded border px-2 py-1 ${rangeFilter === r ? "border-terminal-accent text-terminal-accent" : "border-terminal-border text-terminal-muted"}`}
            onClick={() => setRangeFilter(r)}
          >
            {r === 0 ? "All" : `±${r}`}
          </button>
        ))}
        <div className="ml-auto text-[11px] text-terminal-muted">? ATM | Green ?OI up | Red ?OI down</div>
      </div>

      {chainQuery.isLoading && <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Loading option chain...</div>}
      {chainQuery.isError && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">Failed to load option chain</div>}

      {!chainQuery.isLoading && !chainQuery.isError && (
        <>
          <OptionChainTable rows={rows} atmStrike={Number(chain?.atm_strike || 0)} />
          <OIChart rows={rows} title="OI Distribution By Strike" />
        </>
      )}
    </div>
  );
}
