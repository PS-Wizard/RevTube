import { create } from 'zustand';

export interface UsageState {
  used: number;
  limit: number;
  pageKey: string;
}

interface UsageStore {
  usage: Record<string, UsageState>;
  updateUsage: (pageKey: string, used: number, limit: number) => void;
}

export const useUsageStore = create<UsageStore>((set, get) => ({
  usage: {},
  updateUsage: (pageKey, used, limit) => {
    // Monotonic update: quota can only increase during a month, never decrease.
    // Parallel requests (common when switching dashboard tabs) return different
    // values depending on cache-hit vs cache-miss timing.  A cache-hit response
    // carries the pre-increment count and can arrive *after* a cache-miss response
    // already stored the higher post-increment count -- overwriting would make the
    // display bounce down.  Only ever raise the stored value.
    const current = get().usage[pageKey];
    if (current && current.used >= used) return;
    set((state) => ({
      usage: { ...state.usage, [pageKey]: { used, limit, pageKey } },
    }));
  },
}));
