import { create } from "zustand";

export interface WorkspaceSelection {
  selected_symbols?: string[];
  filters?: Record<string, unknown> | unknown[];
  universe?: string;
  portfolio_id?: string;
  date_range?: { from?: string; to?: string };
  document_ids?: string[];
  workspace_id?: string;
  dossier_id?: string;
}

/** Ephemeral, route-scoped selection. Never leak a previous screen's selection. */
export const useWorkspaceContextStore = create<{
  route: string | null;
  selection: WorkspaceSelection;
  setContext: (selection: WorkspaceSelection, route: string) => void;
  clearContext: () => void;
}>((set) => ({
  route: null,
  selection: {},
  setContext: (selection, route) => set({ route, selection: {
    ...selection,
    selected_symbols: selection.selected_symbols?.slice(0, 100),
    document_ids: selection.document_ids?.slice(0, 100),
  } }),
  clearContext: () => set({ route: null, selection: {} }),
}));
