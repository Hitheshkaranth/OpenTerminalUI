import { useEffect, useState } from "react";

import { fetchPortfolioRisk, fetchRiskScenarios } from "../api/client";
import type { RiskPortfolioResponse } from "../types";

export function RiskDashboardPage() {
  const [risk, setRisk] = useState<RiskPortfolioResponse | null>(null);
  const [scenarios, setScenarios] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const [riskData, scenarioData] = await Promise.all([
        fetchPortfolioRisk({ confidence: 0.95, lookback_days: 252, portfolio_value: 1_000_000 }),
        fetchRiskScenarios(),
      ]);
      setRisk(riskData);
      setScenarios(scenarioData);
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
      <div className="rounded border border-terminal-border bg-terminal-panel p-3">
        <div className="mb-2 text-sm font-semibold text-terminal-accent">Portfolio Risk Dashboard</div>
        <button className="rounded border border-terminal-border px-2 py-1 text-xs" onClick={() => void load()} disabled={loading}>
          {loading ? "Refreshing..." : "Refresh"}
        </button>
      </div>
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-2 text-xs text-terminal-neg">{error}</div>}
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
        <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
          <div className="mb-2 font-semibold">VaR / ES</div>
          <div>Parametric VaR: {Number(risk?.parametric?.var || 0).toFixed(2)}</div>
          <div>Parametric ES: {Number(risk?.parametric?.es || 0).toFixed(2)}</div>
          <div>Historical VaR: {Number(risk?.historical?.var || 0).toFixed(2)}</div>
          <div>Historical ES: {Number(risk?.historical?.es || 0).toFixed(2)}</div>
        </div>
        <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
          <div className="mb-2 font-semibold">Factor Exposures</div>
          {Object.entries(risk?.factor_exposures || {}).map(([k, v]) => (
            <div key={k}>
              {k}: {Number(v).toFixed(4)}
            </div>
          ))}
        </div>
      </div>
      <div className="rounded border border-terminal-border bg-terminal-panel p-3 text-xs">
        <div className="mb-2 font-semibold">Stress Scenarios</div>
        <div className="space-y-1">
          {(risk?.scenarios || []).map((s) => (
            <div key={String(s.id)}>
              {String(s.name)} | PnL: {Number(s.pnl).toFixed(2)} | Post Value: {Number(s.post_value).toFixed(2)}
            </div>
          ))}
          {(!risk?.scenarios || risk.scenarios.length === 0) &&
            scenarios.map((s) => (
              <div key={String(s.id)}>
                {String(s.name)} ({String(s.type)} {String(s.shock)})
              </div>
            ))}
        </div>
      </div>
    </div>
  );
}
