import { useState } from "react";

import { runScreener } from "../api/client";
import { ScreenerBuilder } from "../components/screener/ScreenerBuilder";
import { ScreenerPresets } from "../components/screener/ScreenerPresets";
import { ScreenerResults } from "../components/screener/ScreenerResults";
import type { ScreenerRule } from "../types";

export function ScreenerPage() {
  const [rules, setRules] = useState<ScreenerRule[]>([
    { field: "pe", op: "<=", value: 25 },
    { field: "roe_pct", op: ">=", value: 15 },
  ]);
  const [limit, setLimit] = useState(50);
  const [rows, setRows] = useState<Array<Record<string, string | number | null>>>([]);
  const [warnings, setWarnings] = useState<Array<{ code: string; message: string }>>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleRun = async (runRules: ScreenerRule[], runLimit: number) => {
    setLoading(true);
    setError(null);
    try {
      const result = await runScreener(runRules, runLimit);
      setRows(result.rows);
      setWarnings(result.meta?.warnings ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Screener failed");
      setWarnings([]);
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
      <ScreenerResults rows={rows} />
    </div>
  );
}
