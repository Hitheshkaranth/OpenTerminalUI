import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";

export type NavEvent = {
  path: string;
  label: string;
  breadcrumbs: string[];
  timestamp: number;
};

type NavigationState = {
  history: NavEvent[];
  currentIndex: number;
  push: (event: NavEvent) => void;
  goBack: () => NavEvent | null;
  goForward: () => NavEvent | null;
  getRecent: (count: number) => NavEvent[];
};

const NAV_HISTORY_KEY = "ot-nav-history";
const MAX_HISTORY = 50;

function sanitizeNavEvent(value: unknown): NavEvent | null {
  if (!value || typeof value !== "object") return null;
  const row = value as Partial<NavEvent>;
  const path = String(row.path ?? "").trim();
  if (!path) return null;

  const label = String(row.label ?? path).trim() || path;
  const breadcrumbs = Array.isArray(row.breadcrumbs)
    ? row.breadcrumbs.map((item) => String(item ?? "").trim()).filter(Boolean)
    : [label];
  const timestamp = Number.isFinite(Number(row.timestamp)) ? Number(row.timestamp) : Date.now();

  return {
    path,
    label,
    breadcrumbs: breadcrumbs.length ? breadcrumbs : [label],
    timestamp,
  };
}

function sanitizeHistory(value: unknown): NavEvent[] {
  if (!Array.isArray(value)) return [];
  return value
    .map(sanitizeNavEvent)
    .filter((item): item is NavEvent => Boolean(item))
    .slice(-MAX_HISTORY);
}

export const useNavigationStore = create<NavigationState>()(
  persist(
    (set, get) => ({
      history: [],
      currentIndex: -1,
      push: (event) =>
        set((state) => {
          const nextEvent = sanitizeNavEvent(event);
          if (!nextEvent) return {};

          const baseHistory =
            state.currentIndex >= 0 ? state.history.slice(0, state.currentIndex + 1) : state.history.slice();
          const previous = baseHistory[baseHistory.length - 1];

          if (previous?.path === nextEvent.path) {
            const updated = [...baseHistory.slice(0, -1), nextEvent];
            return {
              history: updated,
              currentIndex: updated.length - 1,
            };
          }

          const nextHistory = [...baseHistory, nextEvent].slice(-MAX_HISTORY);
          return {
            history: nextHistory,
            currentIndex: nextHistory.length - 1,
          };
        }),
      goBack: () => {
        const { history, currentIndex } = get();
        if (currentIndex <= 0) return null;
        const nextIndex = currentIndex - 1;
        const event = history[nextIndex] ?? null;
        if (event) {
          set({ currentIndex: nextIndex });
        }
        return event;
      },
      goForward: () => {
        const { history, currentIndex } = get();
        if (currentIndex < 0 || currentIndex >= history.length - 1) return null;
        const nextIndex = currentIndex + 1;
        const event = history[nextIndex] ?? null;
        if (event) {
          set({ currentIndex: nextIndex });
        }
        return event;
      },
      getRecent: (count) => {
        const limit = Math.max(0, count);
        if (!limit) return [];

        const seen = new Set<string>();
        const recent: NavEvent[] = [];
        const history = get().history;
        for (let index = history.length - 1; index >= 0 && recent.length < limit; index -= 1) {
          const event = history[index];
          if (seen.has(event.path)) continue;
          seen.add(event.path);
          recent.push(event);
        }
        return recent;
      },
    }),
    {
      name: NAV_HISTORY_KEY,
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        history: state.history,
        currentIndex: state.currentIndex,
      }),
      merge: (persistedState, currentState) => {
        const persisted = (persistedState as Partial<NavigationState>) ?? {};
        const history = sanitizeHistory(persisted.history);
        const currentIndex = Math.max(-1, Math.min(Number(persisted.currentIndex ?? history.length - 1), history.length - 1));

        return {
          ...(currentState as NavigationState),
          history,
          currentIndex,
        };
      },
    },
  ),
);
