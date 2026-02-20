import type { ChartTimeframe } from "./types";

interface RangePreset {
  label: string;
  timeframe: ChartTimeframe;
  rangeDays: number;
}

const PRESETS: RangePreset[] = [
  { label: "1D", timeframe: "5m", rangeDays: 1 },
  { label: "5D", timeframe: "15m", rangeDays: 5 },
  { label: "1W", timeframe: "15m", rangeDays: 7 },
  { label: "1M", timeframe: "1h", rangeDays: 30 },
  { label: "3M", timeframe: "1D", rangeDays: 90 },
  { label: "6M", timeframe: "1D", rangeDays: 180 },
  { label: "1Y", timeframe: "1D", rangeDays: 365 },
  { label: "5Y", timeframe: "1W", rangeDays: 1825 },
  { label: "MAX", timeframe: "1M", rangeDays: 0 },
];

interface Props {
  activeRange: string;
  onSelect: (preset: {
    label: string;
    timeframe: ChartTimeframe;
    rangeDays: number;
  }) => void;
}

export function QuickRangeButtons({ activeRange, onSelect }: Props) {
  return (
    <div className="flex gap-0.5">
      {PRESETS.map((p) => (
        <button
          key={p.label}
          onClick={() => onSelect(p)}
          className={`rounded border px-2 py-0.5 text-xs font-mono transition-colors
            ${
              activeRange === p.label
                ? "border-amber-500/40 bg-amber-500/20 text-amber-400"
                : "border-transparent text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
            }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
