import type { DrawingLayerMove, NormalizedChartDrawing } from "../../shared/chart/drawingEngine";

type Props = {
  drawings: NormalizedChartDrawing[];
  selectedDrawingId: string | null;
  onSelect: (drawingId: string) => void;
  onToggleVisibility: (drawingId: string) => void;
  onToggleLocked: (drawingId: string) => void;
  onMoveLayer: (drawingId: string, direction: DrawingLayerMove) => void;
  onCreateAlert?: (drawingId: string) => void;
  alertableDrawingIds?: string[];
};

export function DrawingObjectTree({
  drawings,
  selectedDrawingId,
  onSelect,
  onToggleVisibility,
  onToggleLocked,
  onMoveLayer,
  onCreateAlert,
  alertableDrawingIds = [],
}: Props) {
  const ordered = drawings.slice().sort((left, right) => right.order - left.order);

  return (
    <div className="space-y-2" data-testid="drawing-object-tree">
      {ordered.length ? (
        ordered.map((drawing) => {
          const selected = drawing.id === selectedDrawingId;
          const canCreateAlert = alertableDrawingIds.includes(drawing.id);
          return (
            <div
              key={drawing.id}
              className={`rounded border px-2 py-2 text-[11px] ${
                selected ? "border-terminal-accent bg-terminal-accent/10" : "border-terminal-border bg-terminal-bg/60"
              }`}
              data-testid={`drawing-object-${drawing.id}`}
            >
              <div className="flex items-center justify-between gap-2">
                <button
                  type="button"
                  className="min-w-0 flex-1 truncate text-left text-terminal-text"
                  onClick={() => onSelect(drawing.id)}
                >
                  {drawing.tool.label}
                </button>
                <span className="text-[10px] uppercase tracking-[0.18em] text-terminal-muted">
                  {drawing.tool.family}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1">
                <button
                  type="button"
                  className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                  onClick={() => onToggleVisibility(drawing.id)}
                  aria-label={drawing.visible ? `Hide ${drawing.tool.label}` : `Show ${drawing.tool.label}`}
                >
                  {drawing.visible ? "Hide" : "Show"}
                </button>
                <button
                  type="button"
                  className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                  onClick={() => onToggleLocked(drawing.id)}
                  aria-label={drawing.locked ? `Unlock ${drawing.tool.label}` : `Lock ${drawing.tool.label}`}
                >
                  {drawing.locked ? "Unlock" : "Lock"}
                </button>
                <button
                  type="button"
                  className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                  onClick={() => onMoveLayer(drawing.id, "front")}
                  aria-label={`Bring ${drawing.tool.label} to front`}
                >
                  Top
                </button>
                <button
                  type="button"
                  className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                  onClick={() => onMoveLayer(drawing.id, "forward")}
                  aria-label={`Move ${drawing.tool.label} forward`}
                >
                  Up
                </button>
                <button
                  type="button"
                  className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                  onClick={() => onMoveLayer(drawing.id, "backward")}
                  aria-label={`Move ${drawing.tool.label} backward`}
                >
                  Down
                </button>
                <button
                  type="button"
                  className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted"
                  onClick={() => onMoveLayer(drawing.id, "back")}
                  aria-label={`Send ${drawing.tool.label} to back`}
                >
                  Bottom
                </button>
                {onCreateAlert ? (
                  <button
                    type="button"
                    className="rounded border border-terminal-border px-1.5 py-0.5 text-terminal-muted disabled:opacity-40"
                    onClick={() => onCreateAlert(drawing.id)}
                    aria-label={`Create alert from ${drawing.tool.label}`}
                    data-testid={`drawing-alert-${drawing.id}`}
                    disabled={!canCreateAlert}
                  >
                    Alert
                  </button>
                ) : null}
              </div>
            </div>
          );
        })
      ) : (
        <div className="rounded border border-dashed border-terminal-border px-2 py-3 text-[11px] text-terminal-muted">
          No drawing objects yet.
        </div>
      )}
    </div>
  );
}
