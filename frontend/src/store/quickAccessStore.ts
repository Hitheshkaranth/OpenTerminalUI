import { create } from "zustand";
import { persist, type PersistStorage } from "zustand/middleware";

import { NAV_SECTIONS, PINNED_DEFAULT } from "../components/layout/navConfig";

export const QUICK_ACCESS_STORAGE_KEY = "ot:nav:pinned";
export const MAX_PINNED_TOOLS = 16;
const registeredIds = new Set(NAV_SECTIONS.flatMap((section) => section.items.map((item) => item.id)));

export function sanitizePinnedTools(value: unknown): string[] {
  if (!Array.isArray(value)) return [...PINNED_DEFAULT];
  return [...new Set(value.filter((id): id is string => typeof id === "string" && registeredIds.has(id)))].slice(0, MAX_PINNED_TOOLS);
}

type PersistedPins = { pinnedIds: string[] };
type QuickAccessState = PersistedPins & {
  togglePin: (id: string) => void;
};

// Preserve the existing sidebar's raw string-array format, including an intentionally
// empty list. Failures in private browsing or full storage must not block navigation.
const storage: PersistStorage<PersistedPins> = {
  getItem(name) {
    try {
      const raw = localStorage.getItem(name);
      return raw === null ? null : { state: { pinnedIds: sanitizePinnedTools(JSON.parse(raw)) }, version: 0 };
    } catch {
      return null;
    }
  },
  setItem(name, value) {
    try { localStorage.setItem(name, JSON.stringify(value.state.pinnedIds)); } catch { /* Keep session pins usable. */ }
  },
  removeItem(name) {
    try { localStorage.removeItem(name); } catch { /* Storage may be unavailable. */ }
  },
};

export const useQuickAccessStore = create<QuickAccessState>()(
  persist(
    (set) => ({
      pinnedIds: [...PINNED_DEFAULT],
      togglePin: (id) => set((state) => {
        if (!registeredIds.has(id)) return state;
        if (state.pinnedIds.includes(id)) return { pinnedIds: state.pinnedIds.filter((item) => item !== id) };
        if (state.pinnedIds.length >= MAX_PINNED_TOOLS) return state;
        return { pinnedIds: [...state.pinnedIds, id] };
      }),
    }),
    {
      name: QUICK_ACCESS_STORAGE_KEY,
      storage,
      partialize: ({ pinnedIds }) => ({ pinnedIds }),
      merge: (saved, current) => ({
        ...current,
        pinnedIds: sanitizePinnedTools((saved as Partial<PersistedPins> | null)?.pinnedIds),
      }),
    },
  ),
);
