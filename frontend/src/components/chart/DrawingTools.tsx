import { listDrawingTools, type DrawingToolType } from "../../shared/chart/drawingEngine";

export type DrawMode = "none" | DrawingToolType;

type Props = {
  mode: DrawMode;
  onModeChange: (mode: DrawMode) => void;
  onClear: () => void;
  pendingTrendPoint?: boolean;
};

const TOOL_LABELS: Record<DrawingToolType, string> = {
  trendline: "Trendline",
  ray: "Ray",
  hline: "H-Line",
  vline: "V-Line",
  rectangle: "Box",
};

const TOOL_HINTS: Record<DrawingToolType, string> = {
  trendline: "Click two points to draw a trendline",
  ray: "Click two points to project a ray",
  hline: "Click chart to place a horizontal level",
  vline: "Click chart to place a vertical marker",
  rectangle: "Click two corners to draw a range box",
};

export function DrawingTools({ mode, onModeChange, onClear, pendingTrendPoint = false }: Props) {
  const tools = [
    { id: "none" as const, label: "Cursor", family: "cursor" },
    ...listDrawingTools().map((tool) => ({
      id: tool.type,
      label: TOOL_LABELS[tool.type],
      family: tool.family.toUpperCase(),
    })),
  ];

  const activeHint =
    mode !== "none"
      ? pendingTrendPoint && (mode === "trendline" || mode === "ray" || mode === "rectangle")
        ? "Select the next anchor..."
        : TOOL_HINTS[mode]
      : "Choose a tool to start drawing.";

  return (
    <div className="rounded border border-terminal-border bg-terminal-panel p-3">
      <div className="mb-2 text-sm font-semibold">Drawing Tools</div>
      <div className="grid grid-cols-2 gap-2 text-xs">
        {tools.map((tool) => (
          <button
            key={tool.id}
            type="button"
            onClick={() => onModeChange(tool.id)}
            className={`rounded border px-2 py-2 text-left ${
              mode === tool.id
                ? "border-terminal-accent bg-terminal-accent/15 text-terminal-accent"
                : "border-terminal-border text-terminal-text"
            }`}
          >
            <div className="font-medium">{tool.label}</div>
            <div className="mt-1 text-[10px] uppercase tracking-[0.18em] text-terminal-muted">{tool.family}</div>
          </button>
        ))}
      </div>
      <div className="mt-3 rounded border border-terminal-border/70 bg-terminal-bg/60 px-2 py-2 text-[11px] text-terminal-muted">
        {activeHint}
      </div>
      <button
        type="button"
        onClick={onClear}
        className="mt-3 w-full rounded border border-terminal-border px-2 py-1 text-xs text-terminal-text hover:border-terminal-neg hover:text-terminal-neg"
      >
        Clear Drawings
      </button>
    </div>
  );
}
