export type DrawMode = "none" | "trendline" | "hline";

type Props = {
  mode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
  onClear: () => void;
  pendingTrendPoint?: boolean;
};

export function DrawingTools({ mode, onModeChange, onClear, pendingTrendPoint = false }: Props) {
  const tools: Array<{ id: DrawMode; label: string }> = [
    { id: "none", label: "Cursor" },
    { id: "trendline", label: "Trendline" },
    { id: "hline", label: "H-Line" },
  ];

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Drawing Tools</div>
      <div className="grid grid-cols-3 gap-2 text-xs">
        {tools.map((tool) => (
          <button
            key={tool.id}
            onClick={() => onModeChange(tool.id)}
            className={`rounded border px-2 py-1 text-left ${
              mode === tool.id
                ? "border-terminal-accent bg-terminal-accent text-white"
                : "border-terminal-border text-terminal-text"
            }`}
          >
            {tool.label}
          </button>
        ))}
      </div>
      {mode === "trendline" && (
        <div className="mt-2 text-[11px] text-terminal-muted">
          {pendingTrendPoint ? "Select second point..." : "Click two points to draw trendline"}
        </div>
      )}
      {mode === "hline" && <div className="mt-2 text-[11px] text-terminal-muted">Click chart to place horizontal level</div>}
      <button
        onClick={onClear}
        className="mt-3 w-full rounded border border-terminal-border px-2 py-1 text-xs text-terminal-text hover:border-terminal-neg hover:text-terminal-neg"
      >
        Clear Drawings
      </button>
    </div>
  );
}
