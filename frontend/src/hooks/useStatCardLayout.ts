/**
 * Boots the stat-card layout customization for the dashboard.
 *
 * Call once per page (`DashboardPage`): loads the localStorage mirror
 * immediately, then reconciles with the backend for the signed-in user and
 * flushes any pending save on unmount. Components read the layout straight from
 * `useCardLayoutStore` and resolve order/visibility via `utils/cardLayout.ts`.
 */

import { useEffect } from 'react';
import { useAuth } from './useAuth';
import { flushCardLayoutSave, useCardLayoutStore } from '../stores/cardLayoutStore';

export const useStatCardLayout = (): void => {
  const { user, isAuthenticated } = useAuth();
  const uid = isAuthenticated ? (user?.uid ?? null) : null;

  const loadFromStorage = useCardLayoutStore((state) => state.loadFromStorage);
  const syncFromBackend = useCardLayoutStore((state) => state.syncFromBackend);

  useEffect(() => {
    loadFromStorage();
  }, [loadFromStorage]);

  useEffect(() => {
    void syncFromBackend(uid);
  }, [uid, syncFromBackend]);

  useEffect(() => () => flushCardLayoutSave(), []);
};
