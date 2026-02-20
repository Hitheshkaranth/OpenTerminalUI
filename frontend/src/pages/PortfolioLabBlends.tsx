import { FormEvent, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { createStrategyBlend, listStrategyBlends } from "../api/portfolioLab";
import { TerminalPanel } from "../components/terminal/TerminalPanel";

const STRATEGY_OPTIONS = [
  "sma_crossover",
  "ema_crossover",
  "mean_reversion",
  "breakout_20",
  "macd_crossover",
  "pure_jump_markov_vol",
];

export function PortfolioLabBlendsPage() {
  const queryClient = useQueryClient();
  const [name, setName] = useState("Balanced Blend");
  const [blendMode, setBlendMode] = useState<"WEIGHTED_SUM_RETURNS" | "WEIGHTED_SUM_SIGNALS">("WEIGHTED_SUM_RETURNS");
  const [rows, setRows] = useState<Array<{ model_key: string; weight: number; params_json: string }>>([
    { model_key: "sma_crossover", weight: 0.5, params_json: "{}" },
    { model_key: "mean_reversion", weight: 0.5, params_json: "{}" },
  ]);
  const [error, setError] = useState<string | null>(null);

  const blends = useQuery({
    queryKey: ["portfolio-lab", "blends"],
    queryFn: listStrategyBlends,
  });

  const createMutation = useMutation({
    mutationFn: createStrategyBlend,
    onSuccess: () => {
      setError(null);
      void queryClient.invalidateQueries({ queryKey: ["portfolio-lab", "blends"] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : "Failed to create blend"),
  });

  const normalizedRows = useMemo(() => {
    const total = rows.reduce((acc, row) => acc + Math.max(0, Number(row.weight) || 0), 0);
    return rows.map((row) => ({
      ...row,
      norm_weight: total > 0 ? Math.max(0, Number(row.weight) || 0) / total : 0,
    }));
  }, [rows]);

  const onSave = (event: FormEvent) => {
    event.preventDefault();
    try {
      createMutation.mutate({
        name,
        blend_method: blendMode,
        strategies_json: normalizedRows.map((row) => ({
          model_key: row.model_key,
          weight: row.norm_weight,
          params_json: JSON.parse(row.params_json),
        })),
      });
    } catch {
      setError("Invalid JSON in params");
    }
  };

  return (
    <div className="space-y-3 p-3">
      <TerminalPanel title="Portfolio Lab / Blends" subtitle="Strategy blending registry">
        <div className="text-xs text-terminal-muted">Returns blending is MVP and default mode.</div>
      </TerminalPanel>

      <div className="grid grid-cols-1 gap-3 xl:grid-cols-[1.1fr_1fr]">
        <TerminalPanel title="Saved Blends" subtitle="Registry">
          <div className="space-y-2 text-xs">
            {(blends.data || []).map((blend) => (
              <div key={blend.id} className="rounded border border-terminal-border/40 p-2">
                <div className="font-semibold">{blend.name}</div>
                <div className="text-terminal-muted">{blend.blend_method} | {(blend.strategies_json || []).length} strategies</div>
                <div className="mt-1 space-y-1">
                  {(blend.strategies_json || []).map((row, idx) => (
                    <div key={`${blend.id}-${idx}`} className="flex justify-between"><span>{row.model_key}</span><span>{(Number(row.weight || 0) * 100).toFixed(1)}%</span></div>
                  ))}
                </div>
              </div>
            ))}
            {!blends.data?.length && <div className="text-terminal-muted">No blends defined.</div>}
          </div>
        </TerminalPanel>

        <TerminalPanel title="Blend Builder" subtitle="Multi-model composition">
          <form onSubmit={onSave} className="space-y-2 text-xs">
            <input className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={name} onChange={(e) => setName(e.target.value)} />
            <select className="w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={blendMode} onChange={(e) => setBlendMode(e.target.value as "WEIGHTED_SUM_RETURNS" | "WEIGHTED_SUM_SIGNALS")}>
              <option value="WEIGHTED_SUM_RETURNS">WEIGHTED_SUM_RETURNS</option>
              <option value="WEIGHTED_SUM_SIGNALS">WEIGHTED_SUM_SIGNALS</option>
            </select>

            {normalizedRows.map((row, idx) => (
              <div key={idx} className="rounded border border-terminal-border/40 p-2">
                <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                  <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={row.model_key} onChange={(e) => {
                    setRows((prev) => prev.map((item, i) => i === idx ? { ...item, model_key: e.target.value } : item));
                  }}>
                    {STRATEGY_OPTIONS.map((opt) => <option key={opt} value={opt}>{opt}</option>)}
                  </select>
                  <input type="number" step={0.05} min={0} className="rounded border border-terminal-border bg-terminal-bg px-2 py-1" value={row.weight} onChange={(e) => {
                    setRows((prev) => prev.map((item, i) => i === idx ? { ...item, weight: Number(e.target.value) } : item));
                  }} />
                  <button type="button" className="rounded border border-terminal-border px-2 py-1" onClick={() => setRows((prev) => prev.filter((_, i) => i !== idx))}>Remove</button>
                </div>
                <textarea className="mt-2 h-14 w-full rounded border border-terminal-border bg-terminal-bg px-2 py-1 font-mono text-[11px]" value={row.params_json} onChange={(e) => {
                  setRows((prev) => prev.map((item, i) => i === idx ? { ...item, params_json: e.target.value } : item));
                }} />
                <div className="mt-1 text-terminal-muted">Normalized weight: {(row.norm_weight * 100).toFixed(1)}%</div>
              </div>
            ))}

            <button type="button" className="rounded border border-terminal-border px-2 py-1" onClick={() => setRows((prev) => [...prev, { model_key: "sma_crossover", weight: 0.2, params_json: "{}" }])}>Add Strategy</button>
            {error && <div className="text-terminal-neg">{error}</div>}
            <button type="submit" className="rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-1 font-semibold text-terminal-accent" disabled={createMutation.isPending}>
              {createMutation.isPending ? "Saving..." : "Save Blend"}
            </button>
          </form>
        </TerminalPanel>
      </div>
    </div>
  );
}
