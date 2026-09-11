import { useState, useMemo } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { X, Save, FolderOpen, Trash2, Loader2 } from "lucide-react";

import {
  fetchChartWorkspaces,
  createChartWorkspace,
  deleteChartWorkspace,
  type ChartWorkspace,
} from "../../api/client";
import { useChartWorkstationStore, type ChartSlot } from "../../store/chartWorkstationStore";

type Props = {
  isOpen: boolean;
  onClose: () => void;
  gridTemplate: { cols: number; rows: number; arrangement: "grid" | "custom"; customAreas?: string };
  slots: ChartSlot[];
  syncCrosshair: boolean;
};

export function WorkspaceSaveDialog({ isOpen, onClose, slots, syncCrosshair }: Props) {
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<"save" | "load">("save");
  const [draftName, setDraftName] = useState("");
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  const setActiveSlot = useChartWorkstationStore((s) => s.setActiveSlot);
  const setSyncCrosshair = useChartWorkstationStore((s) => s.setSyncCrosshair);

  const { data: workspaces = [], isLoading: isLoadingWorkspaces } = useQuery({
    queryKey: ["chart-workspaces"],
    queryFn: fetchChartWorkspaces,
    staleTime: 30_000,
  });

  const createMutation = useMutation({
    mutationFn: (name: string) => createChartWorkspace(name, {}),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chart-workspaces"] });
      setDraftName("");
      setTab("load");
    },
  });

  const deleteMutation = useMutation({
    mutationFn: deleteChartWorkspace,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["chart-workspaces"] });
      setConfirmDeleteId(null);
    },
  });

  const activeSlot = useMemo(() => slots.find((s) => s.id === null) ?? slots[0] ?? null, [slots]);
  const activeTicker = activeSlot?.ticker;

  const handleSave = () => {
    if (!draftName.trim()) return;
    createMutation.mutate(draftName.trim());
  };

  const handleLoad = (workspace: ChartWorkspace) => {
    const config = workspace.layout_config as Record<string, unknown>;
    if (!config || !Array.isArray(config.slots)) return;

    const parsedSlots = config.slots
      .map((row: unknown): ChartSlot | null => {
        if (!row || typeof row !== "object" || Array.isArray(row)) return null;
        const r = row as Record<string, unknown>;
        const id = typeof r.id === "string" && r.id ? r.id : Math.random().toString(36).slice(2, 9) + Date.now().toString(36);
        const market = r.market === "US" ? "US" as const : "IN" as const;
        return {
          id,
          ticker: typeof r.ticker === "string" ? r.ticker : null,
          companyName: typeof r.companyName === "string" ? r.companyName : null,
          market,
          timeframe: (typeof r.timeframe === "string" ? r.timeframe : "1D") as ChartSlot["timeframe"],
          chartType: (typeof r.chartType === "string" ? r.chartType : "candle") as ChartSlot["chartType"],
          indicators: Array.isArray(r.indicators) ? r.indicators as ChartSlot["indicators"] : [],
          extendedHours: typeof r.extendedHours === "object" && r.extendedHours ? (r.extendedHours as ChartSlot["extendedHours"]) : { enabled: market === "US", showPreMarket: true, showAfterHours: true, visualMode: "merged", colorScheme: "dimmed" },
          preMarketLevels: typeof r.preMarketLevels === "object" && r.preMarketLevels ? (r.preMarketLevels as ChartSlot["preMarketLevels"]) : { showPMHigh: true, showPMLow: true, showPMOpen: false, showPMVWAP: false, extendIntoRTH: true, daysToShow: 1 },
        };
      })
      .filter((s): s is ChartSlot => s !== null);

    if (!parsedSlots.length) return;

    const rawGrid = config.gridTemplate;
    const gridRecord = rawGrid && typeof rawGrid === "object" && !Array.isArray(rawGrid)
      ? (rawGrid as Record<string, unknown>)
      : null;

    const parsedGrid: Props["gridTemplate"] = gridRecord
      ? {
          cols: typeof gridRecord.cols === "number" && gridRecord.cols > 0 ? gridRecord.cols : 1,
          rows: typeof gridRecord.rows === "number" && gridRecord.rows > 0 ? gridRecord.rows : 1,
          arrangement: (gridRecord.arrangement === "custom" ? "custom" : "grid") as "grid" | "custom",
          customAreas: typeof gridRecord.customAreas === "string" ? gridRecord.customAreas : undefined,
        }
      : { cols: 1, rows: 1, arrangement: "grid" };

    useChartWorkstationStore.setState({
      slots: parsedSlots,
      gridTemplate: parsedGrid,
      syncCrosshair: typeof config.syncCrosshair === "boolean" ? config.syncCrosshair : syncCrosshair,
      activeSlotId: parsedSlots[0]?.id ?? null,
    });

    setActiveSlot(parsedSlots[0]?.id ?? null);
    setSyncCrosshair(typeof config.syncCrosshair === "boolean" ? config.syncCrosshair : syncCrosshair);
    onClose();
  };

  const handleDelete = (id: string) => {
    if (confirmDeleteId === id) {
      deleteMutation.mutate(id);
      return;
    }
    setConfirmDeleteId(id);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={onClose}>
      <div
        className="bg-terminal-panel border border-terminal-border rounded-lg p-6 w-full max-w-md shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-sm font-semibold uppercase tracking-[0.14em] text-terminal-text">
            Save Workspace
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="text-terminal-muted hover:text-terminal-text transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex gap-1 mb-4 border-b border-terminal-border">
          <button
            type="button"
            className={`px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
              tab === "save"
                ? "text-terminal-accent border-b-2 border-terminal-accent"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
            onClick={() => setTab("save")}
          >
            <span className="flex items-center gap-1.5">
              <Save className="h-3 w-3" />
              Save
            </span>
          </button>
          <button
            type="button"
            className={`px-3 py-2 text-xs font-medium uppercase tracking-wider transition-colors ${
              tab === "load"
                ? "text-terminal-accent border-b-2 border-terminal-accent"
                : "text-terminal-muted hover:text-terminal-text"
            }`}
            onClick={() => setTab("load")}
          >
            <span className="flex items-center gap-1.5">
              <FolderOpen className="h-3 w-3" />
              Load
            </span>
          </button>
        </div>

        {/* Save Tab */}
        {tab === "save" && (
          <div className="space-y-4">
            <div>
              <label className="block text-xs text-terminal-muted mb-1.5">
                Workspace name
              </label>
              <input
                type="text"
                value={draftName}
                onChange={(e) => setDraftName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleSave()}
                placeholder="e.g. NSE Day Trading"
                className="w-full bg-terminal-bg border border-terminal-border rounded px-3 py-2 text-xs text-terminal-text placeholder:text-terminal-muted/50 focus:outline-none focus:border-terminal-accent transition-colors"
              />
            </div>
            <button
              type="button"
              onClick={handleSave}
              disabled={!draftName.trim() || createMutation.isPending}
              className="w-full flex items-center justify-center gap-2 rounded border border-terminal-accent bg-terminal-accent/10 px-3 py-2 text-xs font-medium text-terminal-accent hover:bg-terminal-accent/20 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
            >
              {createMutation.isPending ? (
                <Loader2 className="h-3 w-3 animate-spin" />
              ) : (
                <Save className="h-3 w-3" />
              )}
              Save Workspace
            </button>

            {activeTicker && (
              <div className="rounded bg-terminal-muted/20 px-3 py-2 text-[11px] text-terminal-muted">
                Will capture {slots.length} pane(s) with ticker: <span className="text-terminal-text">{activeTicker}</span>
              </div>
            )}
          </div>
        )}

        {/* Load Tab */}
        {tab === "load" && (
          <div className="space-y-2">
            {isLoadingWorkspaces ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-terminal-muted" />
              </div>
            ) : workspaces.length === 0 ? (
              <div className="text-center py-8 text-xs text-terminal-muted">
                No saved workspaces yet.
              </div>
            ) : (
              <div className="space-y-1.5 max-h-[24rem] overflow-y-auto">
                {workspaces.map((workspace) => (
                  <div
                    key={workspace.id}
                    className="flex items-center gap-2 rounded border border-terminal-border px-3 py-2 hover:border-terminal-accent/50 transition-colors"
                  >
                    <button
                      type="button"
                      onClick={() => handleLoad(workspace)}
                      className="flex-1 text-left min-w-0"
                    >
                      <div className="text-xs font-medium text-terminal-text truncate">
                        {workspace.name}
                      </div>
                      <div className="text-[10px] text-terminal-muted mt-0.5">
                        {new Date(workspace.created_at).toLocaleDateString()}
                      </div>
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDelete(workspace.id)}
                      className={`p-1 rounded transition-colors ${
                        confirmDeleteId === workspace.id
                          ? "text-red-400 bg-red-400/10"
                          : "text-terminal-muted hover:text-red-400"
                      }`}
                      title={confirmDeleteId === workspace.id ? "Click to confirm delete" : "Delete workspace"}
                    >
                      {deleteMutation.isPending && confirmDeleteId === workspace.id ? (
                        <Loader2 className="h-3 w-3 animate-spin" />
                      ) : (
                        <Trash2 className="h-3 w-3" />
                      )}
                    </button>
                  </div>
                ))}
              </div>
            )}

            {confirmDeleteId && (
              <div className="rounded bg-red-400/10 border border-red-400/30 px-3 py-2 text-[11px] text-red-400">
                Click delete again to confirm.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}