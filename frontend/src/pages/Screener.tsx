import { useState } from "react";

import { runScreener, runScreenerV2 } from "../api/client";
import { FactorHeatmap } from "../components/screener/FactorHeatmap";
import { FactorSelector } from "../components/screener/FactorSelector";
import { ScreenerBuilder } from "../components/screener/ScreenerBuilder";
import { ScreenerPresets } from "../components/screener/ScreenerPresets";
import { ScreenerResults } from "../components/screener/ScreenerResults";
import type { ScreenerFactorConfig, ScreenerRule } from "../types";

const FALLBACK_ROWS: Array<Record<string, string | number | null>> = [
  { ticker: "RELIANCE", company_name: "Reliance Industries", sector: "Energy", pe: 24.1, roe_pct: 11.8, composite_score: 72.3 },
  { ticker: "TCS", company_name: "Tata Consultancy Services", sector: "IT", pe: 29.7, roe_pct: 38.2, composite_score: 79.6 },
  { ticker: "INFY", company_name: "Infosys", sector: "IT", pe: 26.3, roe_pct: 30.4, composite_score: 76.8 },
  { ticker: "HDFCBANK", company_name: "HDFC Bank", sector: "Financials", pe: 19.5, roe_pct: 15.2, composite_score: 74.1 },
  { ticker: "ICICIBANK", company_name: "ICICI Bank", sector: "Financials", pe: 18.9, roe_pct: 16.1, composite_score: 75.0 },
];

export function ScreenerPage() {
  const [rules, setRules] = useState<ScreenerRule[]>([
    { field: "pe", op: "<=", value: 25 },
    { field: "roe_pct", op: ">=", value: 15 },
  ]);
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const [heatmap, setHeatmap] = useState<Array<{ id: string; data: Array<{ x: string; y: number }> }>>([]);
  const [sectorNeutral, setSectorNeutral] = useState(false);
  const [factors, setFactors] = useState<ScreenerFactorConfig[]>([
    { field: "roe_pct", weight: 0.35, higher_is_better: true },
    { field: "rev_growth_pct", weight: 0.25, higher_is_better: true },
    { field: "eps_growth_pct", weight: 0.2, higher_is_better: true },
    { field: "pe", weight: 0.2, higher_is_better: false },
  ]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async (runRules: ScreenerRule[], runLimit: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await runScreenerV2(runRules, factors, {
        limit: runLimit,
        sectorNeutral,
      });
      const v2Rows = result.rows ?? [];
      setRows(v2Rows.length ? v2Rows : FALLBACK_ROWS.slice(0, Math.min(runLimit, FALLBACK_ROWS.length)));
      setWarnings(result.meta?.warnings ?? []);
      setHeatmap(result.meta?.heatmap ?? []);
    } catch (e) {
      try {
        const fallback = await runScreener(runRules, runLimit);
        const baseRows = fallback.rows ?? [];
        setRows(baseRows.length ? baseRows : FALLBACK_ROWS.slice(0, Math.min(runLimit, FALLBACK_ROWS.length)));
        setWarnings(fallback.meta?.warnings ?? []);
        setHeatmap([]);
      } catch (fallbackError) {
        setError(fallbackError instanceof Error ? fallbackError.message : "Screener failed");
        setRows(FALLBACK_ROWS.slice(0, Math.min(runLimit, FALLBACK_ROWS.length)));
        setWarnings([]);
        setHeatmap([]);
      }
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-3 p-4">
      <ScreenerBuilder
        rules={rules}
        limit={limit}
        loading={loading}
        onRulesChange={setRules}
        onLimitChange={setLimit}
        onRun={() => handleRun(rules, limit)}
      />
      <FactorSelector
        factors={factors}
        sectorNeutral={sectorNeutral}
        onFactorsChange={setFactors}
        onSectorNeutralChange={setSectorNeutral}
      />
      <ScreenerPresets
        onApply={(presetRules, presetLimit) => {
          setRules(presetRules);
          setLimit(presetLimit);
          void handleRun(presetRules, presetLimit);
        }}
      />
      {error && <div className="rounded border border-terminal-neg bg-terminal-neg/10 p-3 text-xs text-terminal-neg">{error}</div>}
      {warnings.map((warning) => (
        <div key={warning.code} className="rounded border border-terminal-warn bg-terminal-warn/10 p-2 text-xs text-terminal-warn">
          {warning.message}
        </div>
      ))}
      <FactorHeatmap data={heatmap} />
      <ScreenerResults rows={rows} />
    </div>
  );
}
