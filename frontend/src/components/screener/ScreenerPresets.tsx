import type { ScreenerRule } from "../../types";

type Props = {
  onApply: (rules: ScreenerRule[], limit: number) => void;
};

const PRESETS: Array<{ name: string; limit: number; rules: ScreenerRule[] }> = [
  {
    name: "Value",
    limit: 50,
    rules: [
      { field: "pe", op: "<=", value: 20 },
      { field: "market_cap", op: ">=", value: 10000000000 },
    ],
  },
  {
    name: "Quality",
    limit: 50,
    rules: [
      { field: "roe_pct", op: ">=", value: 15 },
      { field: "ev_ebitda", op: "<=", value: 18 },
    ],
  },
  {
    name: "Growth",
    limit: 50,
    rules: [
      { field: "rev_growth_pct", op: ">=", value: 10 },
      { field: "eps_growth_pct", op: ">=", value: 10 },
    ],
  },
];

export function ScreenerPresets({ onApply }: Props) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Presets</div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((preset) => (
          <button
            key={preset.name}
            className="rounded border border-terminal-border px-3 py-1 text-xs text-terminal-muted hover:text-terminal-text"
            onClick={() => onApply(preset.rules, preset.limit)}
          >
            {preset.name}
          </button>
        ))}
      </div>
    </div>
  );
}
