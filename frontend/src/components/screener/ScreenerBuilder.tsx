import type { ScreenerRule } from "../../types";

type Props = {
  rules: ScreenerRule[];
  limit: number;
  loading: boolean;
  onRulesChange: (rules: ScreenerRule[]) => void;
  onLimitChange: (limit: number) => void;
  onRun: () => void;
};

const FIELDS = ["pe", "roe_pct", "market_cap", "pb_calc", "ev_ebitda", "rev_growth_pct", "eps_growth_pct", "div_yield_pct"];
const OPS: ScreenerRule["op"][] = [">", "<", ">=", "<=", "==", "!="];

export function ScreenerBuilder({ rules, limit, loading, onRulesChange, onLimitChange, onRun }: Props) {
  const updateRule = (idx: number, patch: Partial<ScreenerRule>) => {
    onRulesChange(rules.map((r, i) => (i === idx ? { ...r, ...patch } : r)));
  };

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Screener Builder</div>
      <div className="space-y-2">
        {rules.map((rule, idx) => (
          <div key={idx} className="grid grid-cols-[1fr_90px_1fr_80px] gap-2">
            <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={rule.field} onChange={(e) => updateRule(idx, { field: e.target.value })}>
              {FIELDS.map((field) => (
                <option key={field} value={field}>{field}</option>
              ))}
            </select>
            <select className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" value={rule.op} onChange={(e) => updateRule(idx, { op: e.target.value as ScreenerRule["op"] })}>
              {OPS.map((op) => (
                <option key={op} value={op}>{op}</option>
              ))}
            </select>
            <input className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={rule.value} onChange={(e) => updateRule(idx, { value: Number(e.target.value) })} />
            <button className="rounded border border-terminal-border px-2 py-1 text-xs" onClick={() => onRulesChange(rules.filter((_, i) => i !== idx))}>
              Remove
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2">
        <button className="rounded border border-terminal-border px-2 py-1 text-xs" onClick={() => onRulesChange([...rules, { field: "pe", op: "<=", value: 25 }])}>
          Add Rule
        </button>
        <input className="w-24 rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs" type="number" value={limit} onChange={(e) => onLimitChange(Number(e.target.value))} />
        <button className="rounded bg-terminal-accent px-3 py-1 text-xs text-black" onClick={onRun} disabled={loading}>
          {loading ? "Running..." : "Run Screen"}
        </button>
      </div>
    </div>
  );
}
