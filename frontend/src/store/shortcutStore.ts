import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface KeyboardShortcut {
  id: string;
  label: string;
  keys: string; // e.g. "ctrl+g", "alt+s", "/"
  action: string; // command or internal event
  category: "navigation" | "trading" | "general";
}

interface ShortcutState {
  shortcuts: KeyboardShortcut[];
  updateShortcut: (id: string, newKeys: string) => void;
  resetAll: () => void;
}

const DEFAULT_SHORTCUTS: KeyboardShortcut[] = [
  { id: "go-bar", label: "Focus GO Bar", keys: "ctrl+g", action: "focus-go-bar", category: "navigation" },
  { id: "market-heatmap", label: "Market Heatmap", keys: "g h", action: "/equity/heatmap", category: "navigation" },
  { id: "screener", label: "Screener", keys: "g s", action: "/equity/screener", category: "navigation" },
  { id: "portfolio", label: "Portfolio", keys: "g p", action: "/equity/portfolio", category: "navigation" },
  { id: "watchlist", label: "Watchlist", keys: "g w", action: "/equity/watchlist", category: "navigation" },
  { id: "hot-key-panel", label: "Toggle Trading Panel", keys: "ctrl+t", action: "toggle-trading-panel", category: "trading" },
  { id: "shortcut-help", label: "Show Shortcuts", keys: "ctrl+/", action: "show-shortcuts", category: "general" },
];

export const useShortcutStore = create<ShortcutState>()(
  persist(
    (set) => ({
      shortcuts: DEFAULT_SHORTCUTS,
      updateShortcut: (id, newKeys) => set((state) => ({
        shortcuts: state.shortcuts.map((s) => s.id === id ? { ...s, keys: newKeys } : s)
      })),
      resetAll: () => set({ shortcuts: DEFAULT_SHORTCUTS }),
    }),
    { name: "otui-shortcuts" }
  )
);
