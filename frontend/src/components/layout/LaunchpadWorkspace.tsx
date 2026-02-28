import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Link2,
  Unlink2,
  Plus,
  Settings,
  X,
  ExternalLink,
  GripVertical,
  LayoutGrid,
} from "lucide-react";

import { PanelBody, PanelFrame, PanelHeader } from "./PanelChrome";
import { type LaunchpadPanelType, useLaunchpad } from "./LaunchpadContext";
import { LaunchpadGrid } from "./LaunchpadGrid";
import { useStockStore } from "../../store/stockStore";

const PANEL_TYPES: LaunchpadPanelType[] = [
  "chart",
  "watchlist",
  "news-feed",
  "order-book",
  "ticker-detail",
  "screener-results",
  "alerts",
  "portfolio-summary",
  "heatmap",
  "market-pulse",
  "yield-curve",
  "ai-research",
  "option-chain",
  "watchlist-heatmap",
  "sector-rotation",
];

function typeIconLabel(type: LaunchpadPanelType) {
  switch (type) {
    case "chart":
      return "CH";
    case "watchlist":
      return "WL";
    case "news-feed":
      return "NW";
    case "order-book":
      return "OB";
    case "market-pulse":
      return "MP";
    case "yield-curve":
      return "YC";
    case "ai-research":
      return "AI";
    case "option-chain":
      return "OC";
    case "watchlist-heatmap":
      return "HM";
    case "sector-rotation":
      return "RRG";
    default:
      return "PN";
  }
}

function VisibilityMount({
  panelId,
  focused,
  children,
}: {
  panelId: string;
  focused: boolean;
  children: ReactNode;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const node = hostRef.current;
    if (!node) return;
    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        setVisible(Boolean(entry?.isIntersecting));
      },
      { root: null, threshold: 0.01, rootMargin: "200px" },
    );
    observer.observe(node);
    return () => observer.disconnect();
  }, [panelId]);

  return (
    <div ref={hostRef} className="h-full min-h-0">
      {visible || focused ? children : <PanelBody>Panel paused while out of view.</PanelBody>}
    </div>
  );
}

export function LaunchpadWorkspace() {
  const {
    activeLayout,
    activeLayoutId,
    savedLayouts,
    setActiveLayoutId,
    createLayout,
    renameLayout,
    deleteLayout,
    addPanel,
    closePanel,
    updatePanel,
    updatePanelsLayout,
    reorderPanels,
    panelRegistry,
    emitSymbolChange,
    lastBroadcastSymbol,
    symbolEventVersion,
    loadingLayouts,
  } = useLaunchpad();
  const globalTicker = useStockStore((s) => s.ticker);
  const setTicker = useStockStore((s) => s.setTicker);
  const loadTicker = useStockStore((s) => s.load);
  const [draggingPanelId, setDraggingPanelId] = useState<string | null>(null);
  const [editingLayoutId, setEditingLayoutId] = useState<string | null>(null);
  const [layoutNameDraft, setLayoutNameDraft] = useState("");
  const [panelTypeOpen, setPanelTypeOpen] = useState(false);
  const [focusedPanelId, setFocusedPanelId] = useState<string | null>(null);
  const panels = activeLayout?.panels ?? [];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.ctrlKey || event.metaKey) || event.altKey) return;
      const key = event.key;
      if (/^[1-9]$/.test(key)) {
        const idx = Number(key) - 1;
        const panel = panels[idx];
        if (!panel) return;
        event.preventDefault();
        setFocusedPanelId(panel.id);
        const node = document.querySelector<HTMLElement>(`[data-launchpad-panel-id="${panel.id}"]`);
        node?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [panels]);

  if (!activeLayout) {
    return (
      <div className="p-3">
        <PanelFrame>
          <PanelBody>No launchpad layout loaded.</PanelBody>
        </PanelFrame>
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-2 p-2">
      <div className="flex flex-wrap items-center gap-2 rounded-sm border border-terminal-border bg-terminal-panel px-2 py-1">
        <div className="inline-flex items-center gap-2">
          <LayoutGrid className="h-4 w-4 text-terminal-accent" />
          <span className="ot-type-label text-terminal-accent">Launchpad Presets</span>
          {loadingLayouts ? <span className="text-[10px] text-terminal-muted">SYNCING...</span> : null}
        </div>
        <div className="ml-2 flex flex-wrap items-center gap-1">
          {savedLayouts.map((layout) => (
            <div key={layout.id} className="relative">
              {editingLayoutId === layout.id ? (
                <input
                  autoFocus
                  className="h-7 rounded-sm border border-terminal-accent bg-terminal-bg px-2 text-xs outline-none"
                  value={layoutNameDraft}
                  onChange={(e) => setLayoutNameDraft(e.target.value)}
                  onBlur={() => {
                    const next = layoutNameDraft.trim();
                    if (next) renameLayout(layout.id, next);
                    setEditingLayoutId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      const next = layoutNameDraft.trim();
                      if (next) renameLayout(layout.id, next);
                      setEditingLayoutId(null);
                    }
                    if (e.key === "Escape") setEditingLayoutId(null);
                  }}
                />
              ) : (
                <button
                  type="button"
                  onClick={() => setActiveLayoutId(layout.id)}
                  onContextMenu={(e) => {
                    e.preventDefault();
                    const action = window.prompt("Layout action: rename / delete", "rename");
                    if (!action) return;
                    if (action.toLowerCase() === "delete") {
                      deleteLayout(layout.id);
                      return;
                    }
                    setEditingLayoutId(layout.id);
                    setLayoutNameDraft(layout.name);
                  }}
                  className={`h-7 rounded-sm border px-2 text-[11px] uppercase tracking-wide ${
                    layout.id === activeLayoutId
                      ? "border-terminal-accent bg-terminal-accent/10 text-terminal-accent"
                      : "border-terminal-border text-terminal-muted hover:text-terminal-text"
                  }`}
                >
                  {layout.name}
                </button>
              )}
            </div>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-1">
          <div className="relative">
            <button
              type="button"
              onClick={() => setPanelTypeOpen((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-terminal-border px-2 text-[11px] hover:border-terminal-accent hover:text-terminal-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Panel
            </button>
            {panelTypeOpen ? (
              <div className="absolute right-0 top-8 z-40 w-44 rounded-sm border border-terminal-border bg-[#0F141B] p-1 shadow-xl">
                {PANEL_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => {
                      addPanel(type);
                      setPanelTypeOpen(false);
                    }}
                    className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel"
                  >
                    {type}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={createLayout} className="inline-flex h-7 items-center gap-1 rounded-sm border border-terminal-border px-2 text-[11px] hover:border-terminal-accent hover:text-terminal-accent">
            <Plus className="h-3.5 w-3.5" /> Layout
          </button>
        </div>
      </div>

      <div className="rounded-sm border border-terminal-border bg-[#0B1018] px-2 py-1 text-[11px] text-terminal-muted">
        Linked symbol broadcast: <span className="ot-type-data text-terminal-text">{lastBroadcastSymbol || globalTicker || "NONE"}</span>
        <span className="ml-2">event #{symbolEventVersion}</span>
        <span className="ml-4">Tip: drag panel headers to reorder; resize with CSS resize handle at panel bottom-right.</span>
      </div>

      <div className="min-h-0 flex-1 overflow-auto rounded-sm border border-terminal-border bg-terminal-bg p-2">
        <LaunchpadGrid
          panels={activeLayout.panels}
          onLayoutChange={(panels) => updatePanelsLayout(panels)}
          renderPanel={(panel) => {
            const PanelView = panelRegistry[panel.type];
            return (
              <PanelFrame
                key={panel.id}
                draggable
                onDragStart={() => setDraggingPanelId(panel.id)}
                onDragOver={(e) => e.preventDefault()}
                onDrop={() => {
                  if (draggingPanelId && draggingPanelId !== panel.id) reorderPanels(draggingPanelId, panel.id);
                  setDraggingPanelId(null);
                }}
                className={`min-h-[160px] min-w-0 overflow-hidden ${focusedPanelId === panel.id ? "ring-1 ring-terminal-accent/70" : ""}`}
                tabIndex={0}
                onFocus={() => setFocusedPanelId(panel.id)}
                data-launchpad-panel-id={panel.id}
              >
                <PanelHeader
                  title={
                    <div className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        draggable
                        className="launchpad-drag-handle cursor-grab text-terminal-muted"
                        aria-label={`Drag ${panel.title}`}
                        onDragStart={() => setDraggingPanelId(panel.id)}
                      >
                        <GripVertical className="h-3.5 w-3.5" />
                      </button>
                      <span className="inline-flex rounded-sm border border-terminal-border px-1 text-[10px] text-terminal-muted">
                        {typeIconLabel(panel.type)}
                      </span>
                      <input
                        value={panel.title}
                        onChange={(e) => updatePanel(panel.id, { title: e.target.value })}
                        className="w-32 border-0 bg-transparent p-0 text-xs text-terminal-accent outline-none"
                        aria-label="Panel title"
                      />
                    </div>
                  }
                  subtitle={
                    <div className="inline-flex items-center gap-2 text-[10px]">
                      <span>{panel.type}</span>
                      <input
                        value={panel.symbol || ""}
                        onChange={(e) => updatePanel(panel.id, { symbol: e.target.value.toUpperCase() })}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") {
                            const symbol = (e.currentTarget.value || "").trim().toUpperCase();
                            if (!symbol) return;
                            updatePanel(panel.id, { symbol });
                            setTicker(symbol);
                            void loadTicker();
                            if (panel.linked) emitSymbolChange(symbol, panel.id);
                          }
                        }}
                        placeholder="SYMBOL"
                        className="w-20 rounded-sm border border-terminal-border bg-terminal-bg px-1 py-0 text-[10px] ot-type-data text-terminal-text outline-none focus:border-terminal-accent"
                        aria-label="Panel symbol"
                      />
                    </div>
                  }
                  actions={
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => updatePanel(panel.id, { linked: !panel.linked })}
                        className={`rounded p-1 ${panel.linked ? "text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"}`}
                        title={panel.linked ? "Linked panel" : "Unlinked panel"}
                        aria-label={panel.linked ? "Disable panel link" : "Enable panel link"}
                      >
                        {panel.linked ? <Link2 className="h-3.5 w-3.5" /> : <Unlink2 className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" className="rounded p-1 text-terminal-muted hover:text-terminal-text" aria-label="Panel settings">
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                      <button
                        type="button"
                        className="rounded p-1 text-terminal-muted hover:text-terminal-text"
                        aria-label="Detach panel"
                        onClick={() => {
                          const params = new URLSearchParams({
                            id: panel.id,
                            type: panel.type,
                            title: panel.title,
                            symbol: panel.symbol || "",
                            linked: panel.linked ? "1" : "0",
                          });
                          window.open(`/equity/launchpad/popout?${params.toString()}`, `_blank`, "noopener,noreferrer,width=1280,height=760");
                        }}
                      >
                        <ExternalLink className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => closePanel(panel.id)} className="rounded p-1 text-terminal-muted hover:text-rose-400" aria-label="Close panel">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  }
                />
                <Suspense fallback={<PanelBody>Loading panel...</PanelBody>}>
                  <VisibilityMount panelId={panel.id} focused={focusedPanelId === panel.id}>
                    <PanelView panel={panel} />
                  </VisibilityMount>
                </Suspense>
              </PanelFrame>
            );
          }}
        />
      </div>
    </div>
  );
}
