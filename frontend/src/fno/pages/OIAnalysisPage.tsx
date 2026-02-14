import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { fetchOIAnalysis, fetchOptionChain } from "../api/fnoApi";
import { OIChart } from "../components/OIChart";
import { useFnoContext } from "../FnoLayout";

function prettySignal(value: string): string {
  return String(value || "").replace(/_/g, " ");
}

export function OIAnalysisPage() {
  const { symbol, expiry } = useFnoContext();

  const analysisQuery = useQuery({
    queryKey: ["fno-oi", symbol, expiry],
    queryFn: () => fetchOIAnalysis(symbol, expiry || undefined, 25),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const chainQuery = useQuery({
    queryKey: ["fno-oi-chain", symbol, expiry],
    queryFn: () => fetchOptionChain(symbol, expiry || undefined, 25),
    staleTime: 30_000,
    refetchInterval: 60_000,
  });

  const keyLevels = useMemo(() => {
    const data = analysisQuery.data;
    return {
      maxPain: data?.max_pain ?? 0,
      support: data?.support_resistance?.support ?? [],
      resistance: data?.support_resistance?.resistance ?? [],
    };
  }, [analysisQuery.data]);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-[10px] uppercase text-terminal-muted">Max Pain</div>
          <div className="mt-1 text-lg font-semibold text-terminal-accent">{keyLevels.maxPain || "-"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-[10px] uppercase text-terminal-muted">Support</div>
          <div className="mt-1 text-sm font-semibold text-terminal-pos">{keyLevels.support.join(", ") || "-"}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-3">
          <div className="text-[10px] uppercase text-terminal-muted">Resistance</div>
          <div className="mt-1 text-sm font-semibold text-terminal-neg">{keyLevels.resistance.join(", ") || "-"}</div>
        </div>
      </div>

      {analysisQuery.isLoading && <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs text-terminal-muted">Loading OI analysis...</div>}
      {analysisQuery.isError && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">Failed to load OI analysis</div>}

      {!analysisQuery.isLoading && !analysisQuery.isError && (
        <div className="rounded border border-terminal-border bg-terminal-panel p-0">
          <div className="border-b border-terminal-border px-3 py-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">OI Buildup</div>
          <div className="max-h-[360px] overflow-auto">
            <table className="min-w-full text-xs">
              <thead className="sticky top-0 bg-terminal-panel">
                <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wide text-terminal-muted">
                  <th className="px-2 py-2 text-left">Strike</th>
                  <th className="px-2 py-2 text-left">CE Signal</th>
                  <th className="px-2 py-2 text-left">PE Signal</th>
                </tr>
              </thead>
              <tbody>
                {(analysisQuery.data?.buildup ?? []).map((row) => (
                  <tr key={`oi-${row.strike_price}`} className="border-b border-terminal-border/30">
                    <td className="px-2 py-1">{Number(row.strike_price).toFixed(0)}</td>
                    <td className="px-2 py-1">{prettySignal(row.ce_pattern)}</td>
                    <td className="px-2 py-1">{prettySignal(row.pe_pattern)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <OIChart rows={chainQuery.data?.strikes ?? []} title="CE vs PE OI" />
    </div>
  );
}
