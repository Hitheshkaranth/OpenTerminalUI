import type { ScreenerFactorConfig } from "../../types";

type Props = {
  factors: ScreenerFactorConfig[];
  sectorNeutral: boolean;
  onFactorsChange: (next: ScreenerFactorConfig[]) => void;
  onSectorNeutralChange: (next: boolean) => void;
};

const FIELD_OPTIONS = [
  "roe_pct",
  "rev_growth_pct",
  "eps_growth_pct",
  "pe",
  "ev_ebitda",
  "pb_calc",
  "market_cap",
];

export function FactorSelector({
  factors,
  sectorNeutral,
  onFactorsChange,
  onSectorNeutralChange,
}: Props) {
  const update = (idx: number, patch: Partial<ScreenerFactorConfig>) => {
    onFactorsChange(factors.map((f, i) => (i === idx ? { ...f, ...patch } : f)));
  };

  const addFactor = () => {
    onFactorsChange([
      ...factors,
      { field: "roe_pct", weight: 0.2, higher_is_better: true },
    ]);
  };

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Factor Weights</div>
      <div className="space-y-2">
        {factors.map((f, idx) => (
          <div key={`${f.field}-${idx}`} className="grid grid-cols-[1fr_140px_80px_80px] gap-2">
            <select
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
              value={f.field}
              onChange={(e) => update(idx, { field: e.target.value })}
            >
              {FIELD_OPTIONS.map((field) => (
                <option key={field} value={field}>
                  {field}
                </option>
              ))}
            </select>
            <input
              type="range"
              min={0}
              max={100}
              value={Math.round(f.weight * 100)}
              onChange={(e) => update(idx, { weight: Number(e.target.value) / 100 })}
            />
            <input
              className="rounded border border-terminal-border bg-terminal-bg px-2 py-1 text-xs"
              type="number"
              min={0}
              max={1}
              step={0.01}
              value={f.weight}
              onChange={(e) => update(idx, { weight: Number(e.target.value) })}
            />
            <button
              className="rounded border border-terminal-border px-2 py-1 text-xs"
              onClick={() => update(idx, { higher_is_better: !f.higher_is_better })}
            >
              {f.higher_is_better ? "Higher" : "Lower"}
            </button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex items-center gap-2 text-xs">
        <button className="rounded border border-terminal-border px-2 py-1" onClick={addFactor}>
          Add Factor
        </button>
        <label className="ml-2 flex items-center gap-2 text-terminal-muted">
          <input
            type="checkbox"
            checked={sectorNeutral}
            onChange={(e) => onSectorNeutralChange(e.target.checked)}
          />
          Sector neutral z-score
        </label>
      </div>
    </div>
  );
}
