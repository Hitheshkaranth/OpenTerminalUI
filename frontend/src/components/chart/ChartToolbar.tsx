import { useEffect } from "react";

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
  showPatterns?: boolean;
  onTogglePatterns?: () => void;
  enablePatternHotkey?: boolean;
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
  showPatterns = false,
  onTogglePatterns,
  enablePatternHotkey = true,
}: Props) {
  const modes: ChartMode[] = ["candles", "line", "area"];

  useEffect(() => {
    if (!enablePatternHotkey || !onTogglePatterns) return;
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const tag = target?.tagName?.toLowerCase();
      const editing = tag === "input" || tag === "textarea" || tag === "select" || Boolean(target?.isContentEditable);
      if (editing || event.ctrlKey || event.metaKey || event.altKey) return;
      if (event.key.toLowerCase() !== "p") return;
      event.preventDefault();
      onTogglePatterns();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enablePatternHotkey, onTogglePatterns]);

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
      {onTogglePatterns ? (
        <button
          className={`rounded border px-2 py-1 ${showPatterns ? "border-terminal-accent bg-terminal-accent text-white" : "border-terminal-border"}`}
          onClick={onTogglePatterns}
          title="Toggle pattern overlay (P)"
        >
          Patterns
        </button>
      ) : null}
    </div>
  );
}
