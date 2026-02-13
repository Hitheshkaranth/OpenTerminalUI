type ChartMode = "candles" | "line" | "area";

type Props = {
  mode: ChartMode;
  onModeChange: (mode: ChartMode) => void;
  showVolume: boolean;
  onToggleVolume: () => void;
  showHighLow: boolean;
  onToggleHighLow: () => void;
  logarithmic: boolean;
  onToggleLogarithmic: () => void;
};

export function ChartToolbar({
  mode,
  onModeChange,
  showVolume,
  onToggleVolume,
  showHighLow,
  onToggleHighLow,
  logarithmic,
  onToggleLogarithmic,
}: Props) {
  const modes: ChartMode[] = ["candles", "line", "area"];
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs text-terminal-muted">
      {modes.map((m) => (
        <button
          key={m}
          className={`rounded border px-2 py-1 ${
            mode === m ? "border-terminal-accent bg-terminal-accent text-white" : "border-terminal-border"
          }`}
          onClick={() => onModeChange(m)}
        >
          {m[0].toUpperCase() + m.slice(1)}
        </button>
      ))}
      <button
        className={`rounded border px-2 py-1 ${showVolume ? "border-terminal-accent bg-terminal-accent text-white" : "border-terminal-border"}`}
        onClick={onToggleVolume}
      >
        Volume
      </button>
      <button
        className={`rounded border px-2 py-1 ${showHighLow ? "border-terminal-accent bg-terminal-accent text-white" : "border-terminal-border"}`}
        onClick={onToggleHighLow}
      >
        H/L Guides
      </button>
      <button
        className={`rounded border px-2 py-1 ${logarithmic ? "border-terminal-accent bg-terminal-accent text-white" : "border-terminal-border"}`}
        onClick={onToggleLogarithmic}
      >
        Log Scale
      </button>
    </div>
  );
}
