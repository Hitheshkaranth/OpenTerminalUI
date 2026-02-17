import { create } from "zustand";

type AlertsStore = {
  unreadCount: number;
  incrementUnread: () => void;
  resetUnread: () => void;
};

export const useAlertsStore = create<AlertsStore>((set) => ({
  unreadCount: 0,
  incrementUnread: () => set((s) => ({ unreadCount: s.unreadCount + 1 })),
  resetUnread: () => set({ unreadCount: 0 }),
}));
