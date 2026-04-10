import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

import {
  BUILTIN_TEMPLATES,
  type PanelConfig,
  type WorkspaceTemplate,
  type WorkspaceTemplateCategory,
} from "../data/workspaceTemplates";

interface WorkspaceTemplateState {
  customTemplates: WorkspaceTemplate[];
  activeTemplateId: string | null;
  saveCustomTemplate: (template: Omit<WorkspaceTemplate, "id">) => string;
  deleteCustomTemplate: (id: string) => void;
  setActiveTemplateId: (id: string | null) => void;
  getAllTemplates: () => WorkspaceTemplate[];
}

type PersistedWorkspaceTemplateState = Pick<WorkspaceTemplateState, "customTemplates" | "activeTemplateId">;

const STORAGE_KEY = "ot:workspace-templates:v1";

function makeId() {
  return `custom-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function sanitizeCategory(value: unknown): WorkspaceTemplateCategory {
  return value === "trading" ||
    value === "research" ||
    value === "portfolio" ||
    value === "macro" ||
    value === "custom"
    ? value
    : "custom";
}

function sanitizePanelConfig(value: unknown, index: number): PanelConfig | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<PanelConfig> & { grid?: Partial<PanelConfig["grid"]> };
  const id = String(row.id ?? `panel-${index + 1}`).trim();
  const type = String(row.type ?? "chart").trim();
  const title = String(row.title ?? type.toUpperCase()).trim();
  const grid = (row.grid ?? {}) as Partial<PanelConfig["grid"]>;
  const x = Number.isFinite(Number(grid.x)) ? Number(grid.x) : 0;
  const y = Number.isFinite(Number(grid.y)) ? Number(grid.y) : 0;
  const w = Number.isFinite(Number(grid.w)) ? Number(grid.w) : 6;
  const h = Number.isFinite(Number(grid.h)) ? Number(grid.h) : 4;

  if (!type || !title) return null;

  return {
    id: id || `panel-${index + 1}`,
    type,
    title,
    props: row.props && typeof row.props === "object" ? (row.props as Record<string, unknown>) : {},
    grid: { x, y, w, h },
  };
}

function sanitizeTemplate(value: unknown): WorkspaceTemplate | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<WorkspaceTemplate>;
  const id = String(row.id ?? "").trim();
  const name = String(row.name ?? "").trim();
  const description = String(row.description ?? "").trim();
  if (!id || !name) return null;

  const panels = Array.isArray(row.panels)
    ? row.panels.map((panel, index) => sanitizePanelConfig(panel, index)).filter((panel): panel is PanelConfig => Boolean(panel))
    : [];

  return {
    id,
    name,
    description,
    icon: String(row.icon ?? "sparkles").trim() || "sparkles",
    category: sanitizeCategory(row.category),
    panels,
    gridCols: row.gridCols === 3 ? 3 : 2,
  };
}

function sanitizeTemplates(value: unknown): WorkspaceTemplate[] {
  if (!Array.isArray(value)) return [];
  return value.map(sanitizeTemplate).filter((template): template is WorkspaceTemplate => Boolean(template));
}

export const useWorkspaceTemplateStore = create<WorkspaceTemplateState>()(
  persist(
    (set, get) => ({
      customTemplates: [],
      activeTemplateId: null,
      saveCustomTemplate: (template) => {
        const next: WorkspaceTemplate = {
          ...template,
          id: makeId(),
          category: sanitizeCategory(template.category),
          icon: String(template.icon || "sparkles").trim() || "sparkles",
          panels: template.panels.map((panel, index) => sanitizePanelConfig(panel, index)).filter((panel): panel is PanelConfig => Boolean(panel)),
          gridCols: template.gridCols === 3 ? 3 : 2,
        };
        set((state) => ({
          customTemplates: [...state.customTemplates, next],
          activeTemplateId: next.id,
        }));
        return next.id;
      },
      deleteCustomTemplate: (id) =>
        set((state) => ({
          customTemplates: state.customTemplates.filter((template) => template.id !== id),
          activeTemplateId: state.activeTemplateId === id ? null : state.activeTemplateId,
        })),
      setActiveTemplateId: (id) => set({ activeTemplateId: id }),
      getAllTemplates: () => [...BUILTIN_TEMPLATES, ...get().customTemplates],
    }),
    {
      name: STORAGE_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state): PersistedWorkspaceTemplateState => ({
        customTemplates: state.customTemplates,
        activeTemplateId: state.activeTemplateId,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<PersistedWorkspaceTemplateState>) ?? {};
        return {
          ...(currentState as WorkspaceTemplateState),
          customTemplates: sanitizeTemplates(persisted.customTemplates),
          activeTemplateId: typeof persisted.activeTemplateId === "string" ? persisted.activeTemplateId : null,
        };
      },
    },
  ),
);
