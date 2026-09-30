import { create } from "zustand";
import { devtools } from "zustand/middleware";
import type { NotificationItem } from "../types/notification";

interface NotificationState {
  items: NotificationItem[];
  unreadCount: number;
  setNotifications: (items: NotificationItem[], unreadCount: number) => void;
  markOneRead: (id: string) => void;
  markAllReadLocal: () => void;
  reset: () => void;
}

const initialState = {
  items: [] as NotificationItem[],
  unreadCount: 0,
};

export const useNotificationStore = create<NotificationState>()(
  devtools((set) => ({
    ...initialState,

    setNotifications: (items, unreadCount) => set({ items, unreadCount }),

    markOneRead: (id) =>
      set((state) => {
        const items = state.items.map((n) => (n.id === id ? { ...n, read: true } : n));
        const unreadCount = items.filter((n) => !n.read).length;
        return { items, unreadCount };
      }),

    markAllReadLocal: () =>
      set((state) => ({
        items: state.items.map((n) => ({ ...n, read: true })),
        unreadCount: 0,
      })),

    reset: () => set({ ...initialState }),
  })),
);
