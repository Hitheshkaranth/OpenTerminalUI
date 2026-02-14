import { useQuery } from "@tanstack/react-query";

import { fetchExpiryDashboard } from "../api/fnoApi";

export function ExpiryPage() {
  const query = useQuery({
    queryKey: ["fno-expiry-dashboard"],
    queryFn: fetchExpiryDashboard,
    staleTime: 60_000,
    refetchInterval: 60_000,
  });

  const items = query.data ?? [];
  const headline = items.slice(0, 2);
  const rest = items.slice(2, 7);

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
        {headline.map((row) => (
          <div key={row.symbol} className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
            <div className="mb-2 text-sm font-semibold text-terminal-accent">{row.symbol}</div>
            <div>Spot/Expiry: {row.expiry_date} ({row.days_to_expiry}d)</div>
            <div>ATM IV: {Number(row.atm_iv || 0).toFixed(2)}%</div>
            <div>PCR: {Number(row.pcr?.pcr_oi || 0).toFixed(2)} ({row.pcr?.signal || "Neutral"})</div>
            <div>Max Pain: {row.max_pain}</div>
            <div>Support: {(row.support_resistance?.support ?? []).join(", ") || "-"}</div>
            <div>Resistance: {(row.support_resistance?.resistance ?? []).join(", ") || "-"}</div>
          </div>
        ))}
      </div>

      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-terminal-accent">Top Active Symbols</div>
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-[10px] uppercase tracking-wide text-terminal-muted">
                <th className="px-2 py-2 text-left">Symbol</th>
                <th className="px-2 py-2 text-left">Expiry</th>
                <th className="px-2 py-2 text-right">ATM IV</th>
                <th className="px-2 py-2 text-right">PCR</th>
                <th className="px-2 py-2 text-right">Max Pain</th>
                <th className="px-2 py-2 text-left">Support</th>
                <th className="px-2 py-2 text-left">Resistance</th>
              </tr>
            </thead>
            <tbody>
              {rest.map((row) => (
                <tr key={`expiry-${row.symbol}`} className="border-b border-terminal-border/30">
                  <td className="px-2 py-1 font-semibold">{row.symbol}</td>
                  <td className="px-2 py-1">{row.expiry_date}</td>
                  <td className="px-2 py-1 text-right">{Number(row.atm_iv || 0).toFixed(2)}%</td>
                  <td className="px-2 py-1 text-right">{Number(row.pcr?.pcr_oi || 0).toFixed(2)}</td>
                  <td className="px-2 py-1 text-right">{row.max_pain}</td>
                  <td className="px-2 py-1">{(row.support_resistance?.support ?? []).join(", ")}</td>
                  <td className="px-2 py-1">{(row.support_resistance?.resistance ?? []).join(", ")}</td>
                </tr>
              ))}
              {!rest.length && (
                <tr><td colSpan={7} className="px-2 py-3 text-center text-terminal-muted">No dashboard data</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
