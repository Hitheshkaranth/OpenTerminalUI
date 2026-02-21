import { useEffect, useState } from "react";

import { fetchRiskSummary, fetchRiskExposures, fetchRiskCorrelation } from "../api/quantClient";

export function RiskDashboardPage() {
  const [summary, setSummary] = useState<any>(null);
  const [exposures, setExposures] = useState<any>(null);
  const [correlation, setCorrelation] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [sumData, expData, corrData] = await Promise.all([
        fetchRiskSummary(),
        fetchRiskExposures(),
        fetchRiskCorrelation()
      ]);
      setSummary(sumData);
      setExposures(expData);
      setCorrelation(corrData);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load risk data");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <div className="space-y-3 p-4">
      <div className="flex justify-between items-center rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="text-sm font-semibold text-terminal-accent">Portfolio Risk Dashboard</div>
        <button className="rounded border border-terminal-border px-3 py-1 text-xs hover:bg-terminal-border/30" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>

      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
          <div className="mb-2 font-semibold text-terminal-accent">General Risk</div>
          <div>EWMA Volatility: {Number(summary?.ewma_vol || 0).toFixed(4)}</div>
          <div>Beta vs Benchmark: {Number(summary?.beta || 0).toFixed(4)}</div>

          <div className="mt-4 font-semibold text-terminal-accent">Marginal Contribution</div>
          <div className="mt-1 space-y-1">
            {Object.entries(summary?.marginal_contribution || {}).map(([asset, val]) => (
              <div key={asset} className="flex justify-between">
                <span>{asset}</span>
                <span>{Number(val).toFixed(4)}</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
          <div className="mb-2 font-semibold text-terminal-accent">Factor Exposures (PCA)</div>
          <div className="space-y-1">
            {exposures?.pca_factors?.map((f: any) => (
              <div key={f.factor} className="flex justify-between">
                <span>{f.factor}</span>
                <span>{(Number(f.variance_explained) * 100).toFixed(1)}% variance</span>
              </div>
            ))}
          </div>

          <div className="mt-4 font-semibold text-terminal-accent">Asset Loadings</div>
          <div className="max-h-32 overflow-y-auto mt-1 space-y-1">
            {Object.entries(exposures?.loadings || {}).map(([asset, loads]: [string, any]) => (
              <div key={asset} className="flex justify-between border-b border-terminal-border/30 pb-1">
                <span>{asset}</span>
                <span className="text-terminal-dim">[{loads.map((l: number) => l.toFixed(2)).join(", ")}]</span>
              </div>
            ))}
          </div>
        </div>

        <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
          <div className="mb-2 font-semibold text-terminal-accent">Correlation Matrix</div>
          <div className="overflow-x-auto">
            <table className="w-full text-right border-collapse">
              <thead>
                <tr>
                  <th className="p-1 border-b border-r border-terminal-border text-left">Asset</th>
                  {correlation?.assets?.map((a: string) => <th key={a} className="p-1 border-b border-terminal-border">{a}</th>)}
                </tr>
              </thead>
              <tbody>
                {correlation?.matrix?.map((row: number[], idx: number) => (
                  <tr key={idx}>
                    <td className="p-1 border-r border-terminal-border text-left font-bold">{correlation.assets[idx]}</td>
                    {row.map((val, cIdx) => (
                      <td key={cIdx} className={`p-1 ${val > 0.5 ? 'text-terminal-pos' : val < -0.5 ? 'text-terminal-neg' : 'text-terminal-text'}`}>
                        {val.toFixed(2)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
