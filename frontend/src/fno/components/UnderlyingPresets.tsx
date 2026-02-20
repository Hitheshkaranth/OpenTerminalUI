interface Preset {
  label: string;
  underlying: string;
  exchange: string;
  strikeStep: number;
}

const INDIA_PRESETS: Preset[] = [
  { label: "NIFTY", underlying: "NIFTY 50", exchange: "NFO", strikeStep: 50 },
  { label: "BANKNIFTY", underlying: "NIFTY BANK", exchange: "NFO", strikeStep: 100 },
  {
    label: "FINNIFTY",
    underlying: "NIFTY FIN SERVICE",
    exchange: "NFO",
    strikeStep: 50,
  },
];

const US_PRESETS: Preset[] = [
  { label: "SPY", underlying: "SPY", exchange: "AMEX", strikeStep: 1 },
  { label: "QQQ", underlying: "QQQ", exchange: "AMEX", strikeStep: 1 },
  { label: "IWM", underlying: "IWM", exchange: "AMEX", strikeStep: 1 },
];

interface Props {
  market: "india" | "us";
  active: string;
  onSelect: (preset: Preset) => void;
}

export function UnderlyingPresets({ market, active, onSelect }: Props) {
  const presets = market === "india" ? INDIA_PRESETS : US_PRESETS;

  return (
    <div className="flex gap-1">
      {presets.map((p) => (
        <button
          key={p.label}
          onClick={() => onSelect(p)}
          className={`rounded border px-3 py-1 text-xs font-mono transition-colors
            ${
              active === p.underlying
                ? "border-amber-500/40 bg-amber-500/20 text-amber-400"
                : "border-zinc-700 text-zinc-400 hover:border-zinc-500 hover:text-zinc-200"
            }`}
        >
          {p.label}
        </button>
      ))}
    </div>
  );
}
