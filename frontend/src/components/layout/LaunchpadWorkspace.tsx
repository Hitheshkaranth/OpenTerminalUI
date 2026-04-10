import { Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  Link2,
  Unlink2,
  Plus,
  Settings,
  X,
  GripVertical,
  LayoutGrid,
  Search,
} from "lucide-react";

import {
  setGroupSymbol,
  subscribeSymbolLinkMessages,
  type LinkGroup,
} from "../../contexts/SymbolLinkContext";
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
  "hotkeys",
];

function typeIconLabel(type: LaunchpadPanelType) {
  switch (type) {
    case "chart":
      return "CH";
    case "watchlist":
      return "WL";
    case "news-feed":
    case "news":
      return "NW";
    case "overview":
      return "OV";
    case "order-book":
      return "OB";
    case "screener":
    case "screener-results":
      return "SC";
    case "financials":
    case "fundamentals":
      return "FN";
    case "portfolio-allocation":
      return "AL";
    case "portfolio-performance":
      return "PF";
    case "risk-metrics":
      return "RM";
    case "market-pulse":
      return "MP";
    case "yield-curve":
      return "YC";
    case "economics":
      return "EC";
    case "greeks":
      return "GR";
    case "oi-chart":
      return "OI";
    case "peers":
      return "PR";
    case "ai-research":
      return "AI";
    case "option-chain":
      return "OC";
    case "watchlist-heatmap":
      return "HM";
    case "sector-rotation":
      return "RRG";
    case "hotkeys":
      return "HK";
    default:
      return "PN";
  }
}

function resolvePanelLinkGroup(panel: { linkGroup?: LinkGroup; linked?: boolean }): LinkGroup {
  if (
    panel.linkGroup === "none" ||
    panel.linkGroup === "red" ||
    panel.linkGroup === "blue" ||
    panel.linkGroup === "green" ||
    panel.linkGroup === "yellow"
  ) {
    return panel.linkGroup;
  }
  return panel.linked === false ? "none" : "red";
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

export function LaunchpadWorkspace({ toolbarActions }: { toolbarActions?: ReactNode }) {
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
    setPanelPoppedOut,
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
  const [panelSearch, setPanelSearch] = useState("");
  
  const panels = activeLayout?.panels ?? [];

  const filteredPanelTypes = useMemo(() => 
    PANEL_TYPES.filter(t => t.toLowerCase().includes(panelSearch.toLowerCase())),
    [panelSearch]
  );

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

  useEffect(() => {
    return subscribeSymbolLinkMessages((message) => {
      if (message.type === "panel-return" && message.panelId) {
        setPanelPoppedOut(message.panelId, false);
        return;
      }
      if (message.type === "symbol-change" && message.linkGroup !== "none" && message.symbol) {
        emitSymbolChange(message.symbol, undefined, message.linkGroup);
      }
    });
  }, [emitSymbolChange, setPanelPoppedOut]);

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
          {toolbarActions}
          <div className="relative">
            <button
              type="button"
              onClick={() => setPanelTypeOpen((v) => !v)}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-terminal-border px-2 text-[11px] hover:border-terminal-accent hover:text-terminal-accent"
            >
              <Plus className="h-3.5 w-3.5" /> Panel
            </button>
            {panelTypeOpen ? (
              <div className="absolute right-0 top-8 z-40 w-48 rounded-sm border border-terminal-border bg-[#0F141B] p-2 shadow-xl">
                <div className="relative mb-2">
                  <Search className="absolute left-2 top-1.5 h-3 w-3 text-terminal-muted" />
                  <input
                    autoFocus
                    className="w-full rounded-sm border border-terminal-border bg-terminal-bg pl-7 pr-2 py-1 text-[10px] outline-none focus:border-terminal-accent"
                    placeholder="Search panels..."
                    value={panelSearch}
                    onChange={(e) => setPanelSearch(e.target.value)}
                  />
                </div>
                <div className="max-h-60 overflow-auto">
                  {filteredPanelTypes.map((type) => (
                    <button
                      key={type}
                      type="button"
                      onClick={() => {
                        addPanel(type);
                        setPanelTypeOpen(false);
                        setPanelSearch("");
                      }}
                      className="block w-full rounded px-2 py-1 text-left text-xs hover:bg-terminal-panel capitalize"
                    >
                      {type.replace(/-/g, " ")}
                    </button>
                  ))}
                  {filteredPanelTypes.length === 0 && (
                    <div className="px-2 py-1 text-[10px] text-terminal-muted italic text-center">No matching panels</div>
                  )}
                </div>
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
            const panelLinkGroup = resolvePanelLinkGroup(panel);
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
                data-testid="launchpad-panel-frame"
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
                            if (panelLinkGroup !== "none") {
                              setGroupSymbol(panelLinkGroup, symbol, panel.id);
                              emitSymbolChange(symbol, panel.id, panelLinkGroup);
                            }
                          }
                        }}
                        placeholder="SYMBOL"
                        className="w-20 rounded-sm border border-terminal-border bg-terminal-bg px-1 py-0 text-[10px] ot-type-data text-terminal-text outline-none focus:border-terminal-accent"
                        aria-label="Panel symbol"
                      />
                    </div>
                  }
                  linkGroup={panelLinkGroup}
                  onLinkGroupChange={(group) => {
                    updatePanel(panel.id, { linkGroup: group, linked: group !== "none" });
                    if (group !== "none" && panel.symbol) {
                      setGroupSymbol(group, panel.symbol, panel.id);
                      emitSymbolChange(panel.symbol, panel.id, group);
                    }
                  }}
                  onPopout={() => setPanelPoppedOut(panel.id, true)}
                  actions={
                    <div className="inline-flex items-center gap-1">
                      <button
                        type="button"
                        onClick={() => {
                          const nextGroup = panelLinkGroup === "none" ? "red" : "none";
                          updatePanel(panel.id, { linkGroup: nextGroup, linked: nextGroup !== "none" });
                          if (nextGroup !== "none" && panel.symbol) {
                            setGroupSymbol(nextGroup, panel.symbol, panel.id);
                            emitSymbolChange(panel.symbol, panel.id, nextGroup);
                          }
                        }}
                        className={`rounded p-1 ${panelLinkGroup !== "none" ? "text-terminal-accent" : "text-terminal-muted hover:text-terminal-text"}`}
                        title={panelLinkGroup !== "none" ? "Linked panel" : "Unlinked panel"}
                        aria-label={panelLinkGroup !== "none" ? "Disable panel link" : "Enable panel link"}
                      >
                        {panelLinkGroup !== "none" ? <Link2 className="h-3.5 w-3.5" /> : <Unlink2 className="h-3.5 w-3.5" />}
                      </button>
                      <button type="button" className="rounded p-1 text-terminal-muted hover:text-terminal-text" aria-label="Panel settings">
                        <Settings className="h-3.5 w-3.5" />
                      </button>
                      <button type="button" onClick={() => closePanel(panel.id)} className="rounded p-1 text-terminal-muted hover:text-rose-400" aria-label="Close panel">
                        <X className="h-3.5 w-3.5" />
                      </button>
                    </div>
                  }
                />
                {panel.poppedOut ? (
                  <PanelBody className="flex min-h-[160px] flex-col items-center justify-center gap-3 text-center">
                    <div>
                      <div className="ot-type-panel-title text-terminal-accent">Panel In External Window</div>
                      <div className="mt-1 text-xs text-terminal-muted">
                        This panel is detached. Close the popout to restore it here, or recall it manually.
                      </div>
                    </div>
                    <button
                      type="button"
                      className="rounded-sm border border-terminal-border px-3 py-1 text-xs text-terminal-text hover:border-terminal-accent hover:text-terminal-accent"
                      onClick={() => setPanelPoppedOut(panel.id, false)}
                    >
                      Recall Panel
                    </button>
                  </PanelBody>
                ) : (
                  <Suspense fallback={<PanelBody>Loading panel...</PanelBody>}>
                    <VisibilityMount panelId={panel.id} focused={focusedPanelId === panel.id}>
                      <PanelView panel={panel} />
                    </VisibilityMount>
                  </Suspense>
                )}
              </PanelFrame>
            );
          }}
        />
      </div>
    </div>
  );
}
