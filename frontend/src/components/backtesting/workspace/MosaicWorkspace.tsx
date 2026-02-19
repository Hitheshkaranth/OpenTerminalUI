import { useMemo, useState } from "react";

import { CommandBar } from "./CommandBar";
import { loadLayout, saveLayout } from "./layoutStore";
import { PANEL_LABELS, renderPanel, type PanelId, type PanelRendererMap } from "./PanelRegistry";

type MosaicWorkspaceProps = {
  renderers: PanelRendererMap;
  onCommand: (command: string) => void;
};

const DEFAULT_PANELS: PanelId[] = ["equity", "monthly", "drawdown", "trades"];

function getInitialLayout(): PanelId[] {
  const saved = loadLayout();
  if (saved) {
    try {
      const parsed = JSON.parse(saved) as PanelId[];
      if (Array.isArray(parsed) && parsed.length) return parsed;
    } catch {
      // fallback to default
    }
  }
  return DEFAULT_PANELS;
}

export function MosaicWorkspace({ renderers, onCommand }: MosaicWorkspaceProps) {
  const [layout, setLayout] = useState<PanelId[]>(getInitialLayout);
  const allPanels = useMemo(() => Object.keys(PANEL_LABELS) as PanelId[], []);
  const [catalogOpen, setCatalogOpen] = useState(false);

  const visiblePanels = layout.slice(0, 4);
  const addPanel = (panel: PanelId) => {
    if (layout.includes(panel)) return;
    const next = [...layout, panel];
    setLayout(next);
    saveLayout(JSON.stringify(next));
  };
  const removePanel = (panel: PanelId) => {
    const next = layout.filter((x) => x !== panel);
    setLayout(next.length ? next : DEFAULT_PANELS);
    saveLayout(JSON.stringify(next.length ? next : DEFAULT_PANELS));
  };

  return (
    <div className="space-y-2">
      <CommandBar onSelectCommand={onCommand} />
      <div className="flex flex-wrap items-center gap-2 rounded border border-terminal-border/40 bg-terminal-bg/60 p-2 text-[11px]">
        <span className="text-terminal-muted">Panels:</span>
        {allPanels.map((panel) => (
          <span key={panel} className="rounded border border-terminal-border px-2 py-0.5 text-terminal-muted">
            {PANEL_LABELS[panel]}
          </span>
        ))}
        <button
          className="ml-auto rounded border border-terminal-accent px-2 py-1 text-terminal-accent"
          onClick={() => {
            const reset = DEFAULT_PANELS;
            setLayout(reset);
            saveLayout(JSON.stringify(reset));
          }}
        >
          Reset Layout
        </button>
        <button
          className="rounded border border-terminal-border px-2 py-1 text-terminal-muted hover:text-terminal-text"
          onClick={() => setCatalogOpen((v) => !v)}
        >
          {catalogOpen ? "Hide Catalog" : "Panel Catalog"}
        </button>
      </div>
      {catalogOpen && (
        <div className="flex flex-wrap gap-2 rounded border border-terminal-border/40 bg-terminal-bg/40 p-2">
          {allPanels.map((panel) => (
            <button
              key={`catalog-${panel}`}
              className="rounded border border-terminal-border px-2 py-1 text-[11px] text-terminal-muted hover:bg-terminal-accent/10 hover:text-terminal-accent"
              onClick={() => addPanel(panel)}
            >
              + {PANEL_LABELS[panel]}
            </button>
          ))}
        </div>
      )}
      <div className="h-[72vh] min-h-[520px] rounded border border-terminal-border/40 bg-terminal-bg/50 p-1">
        <div className="grid h-full grid-cols-1 gap-2 md:grid-cols-2">
          {visiblePanels.map((id) => (
            <div key={`tile-${id}`} className="relative min-h-0 overflow-hidden rounded border border-terminal-border/40">
              <button
                className="absolute right-2 top-2 z-10 rounded border border-terminal-border bg-terminal-bg px-1 py-0.5 text-[10px] text-terminal-muted hover:text-terminal-neg"
                onClick={() => removePanel(id)}
              >
                x
              </button>
              {renderPanel(id, renderers)}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
