import { useEffect, useState } from "react";

import { fetchPeers } from "../../api/client";
import type { PeerResponse } from "../../types";

type Props = {
  ticker: string;
};

export function PeerComparison({ ticker }: Props) {
  const [data, setData] = useState<PeerResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    const run = async () => {
      setLoading(true);
      setError(null);
      try {
        const res = await fetchPeers(ticker);
        if (mounted) {
          setData(res);
        }
      } catch (e) {
        if (mounted) {
          setError(e instanceof Error ? e.message : "Failed to load peers");
        }
      } finally {
        if (mounted) {
          setLoading(false);
        }
      }
    };
    void run();
    return () => {
      mounted = false;
    };
  }, [ticker]);

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <h3 className="mb-2 text-sm font-semibold">Peer Comparison</h3>
      {loading && <div className="text-xs text-terminal-muted">Loading peers...</div>}
      {error && <div className="text-xs text-terminal-neg">{error}</div>}
      {data && (
        <div className="overflow-auto">
          <table className="min-w-full text-xs">
            <thead>
              <tr className="border-b border-terminal-border text-terminal-muted">
                <th className="px-2 py-1 text-left">Metric</th>
                <th className="px-2 py-1 text-right">Target</th>
                <th className="px-2 py-1 text-right">Peer Median</th>
                <th className="px-2 py-1 text-right">Peer Mean</th>
                <th className="px-2 py-1 text-right">Percentile</th>
              </tr>
            </thead>
            <tbody>
              {data.metrics.map((m) => (
                <tr key={m.metric} className="border-b border-terminal-border/60">
                  <td className="px-2 py-1 text-left">{m.metric}</td>
                  <td className="px-2 py-1 text-right">{m.target_value?.toFixed(2) ?? "-"}</td>
                  <td className="px-2 py-1 text-right">{m.peer_median?.toFixed(2) ?? "-"}</td>
                  <td className="px-2 py-1 text-right">{m.peer_mean?.toFixed(2) ?? "-"}</td>
                  <td className="px-2 py-1 text-right">{m.target_percentile?.toFixed(1) ?? "-"}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
