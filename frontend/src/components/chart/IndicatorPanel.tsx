export type IndicatorId =
  | "sma20"
  | "sma50"
  | "sma200"
  | "ema20"
  | "ema50"
  | "bollinger_bands"
  | "rsi"
  | "macd"
  | "volume"
  | "atr";

type Props = {
  selected: IndicatorId[];
  onToggle: (id: IndicatorId) => void;
};

const OPTIONS: Array<{ id: IndicatorId; label: string }> = [
  { id: "sma20", label: "SMA(20)" },
  { id: "sma50", label: "SMA(50)" },
  { id: "sma200", label: "SMA(200)" },
  { id: "ema20", label: "EMA(20)" },
  { id: "ema50", label: "EMA(50)" },
  { id: "bollinger_bands", label: "Bollinger" },
  { id: "rsi", label: "RSI(14)" },
  { id: "macd", label: "MACD" },
  { id: "volume", label: "Volume SMA" },
  { id: "atr", label: "ATR(14)" },
];

export function IndicatorPanel({ selected, onToggle }: Props) {
  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Indicators</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {OPTIONS.map((opt) => {
          const active = selected.includes(opt.id);
          return (
            <button
              key={opt.id}
              className={`rounded border px-2 py-1 text-left ${
                active
                  ? "border-terminal-accent bg-terminal-accent text-white"
                  : "border-terminal-border text-terminal-text"
              }`}
              onClick={() => onToggle(opt.id)}
            >
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
