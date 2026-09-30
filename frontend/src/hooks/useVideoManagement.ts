/**
 * useVideoManagement -- loads/edits the default "Optimized — Video Audit" list
 * as a per-field management grid (shown in the Optimized Content page's Video
 * tab). Each managed video carries an independent optimization status per field
 * (thumbnail, title keywords, description, tags, playlist, CTA). Optimistic
 * updates keep the UI snappy; Firestore persists in the background.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  getAllOptimizedLists,
  markOptimized,
  unmarkOptimized,
  setVideoFieldStatus,
  type OptimizedField,
  type OptimizedFields,
  type OptimizedItemMeta,
  type OptimizedScope,
} from '../services/optimizedFlagService';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';

export interface ManagedVideo {
  id: string;
  title?: string;
  thumbnailUrl?: string;
  addedAt: number;
  fields: OptimizedFields;
  fromAudit?: boolean;
}

export interface AddVideoInput {
  id: string;
  title?: string;
  thumbnailUrl?: string;
}

export function useVideoManagement() {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  const scope = useMemo<OptimizedScope | null>(
    () => (user ? { uid: user.uid, organizationId: currentOrganization?.id ?? null } : null),
    [user, currentOrganization?.id],
  );

  const [items, setItems] = useState<ManagedVideo[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(async () => {
    if (!scope) {
      setItems([]);
      await Promise.resolve();
      setReady(false);
      return;
    }
    try {
      const list = (await getAllOptimizedLists(scope)).video;
      const metaMap = (list?.itemsMeta ?? {}) as Record<string, OptimizedItemMeta>;
      const next = (list?.videoIds ?? [])
        .map((id) => ({
          id,
          title: metaMap[id]?.title,
          thumbnailUrl: metaMap[id]?.thumbnailUrl,
          addedAt: metaMap[id]?.addedAt ?? 0,
          fields: { ...(metaMap[id]?.fields ?? {}) },
          fromAudit: metaMap[id]?.fromAudit,
        }))
        .filter((item) => item.id);
      setItems(next);
    } catch (err) {
      console.error('[videoManagement] failed to load list:', err);
    } finally {
      setReady(true);
    }
  }, [scope]);

  useEffect(() => {
    // Defer state writes so they are not synchronous-within-effect.
    let cancelled = false;
    (async () => {
      await Promise.resolve();
      if (cancelled) return;
      await reload();
    })();
    return () => {
      cancelled = true;
    };
  }, [reload]);

  /** Add one or more videos directly to the management list (no audit needed). */
  const addVideos = useCallback(
    async (inputs: AddVideoInput[]) => {
      if (!scope || !inputs.length) return;
      const ids = inputs.map((i) => i.id).filter(Boolean);
      const meta: Record<string, OptimizedItemMeta> = {};
      for (const i of inputs) {
        if (!i.id) continue;
        meta[i.id] = {
          title: i.title,
          thumbnailUrl: i.thumbnailUrl,
          addedAt: Date.now(),
        };
      }
      try {
        const updated = await markOptimized(scope, 'video', ids, meta);
        void reload();
        return updated;
      } catch (err) {
        toast.error('Failed to add videos to Video Management');
        console.error('[videoManagement] add failed:', err);
        return null;
      }
    },
    [scope, reload],
  );

  const removeVideo = useCallback(
    async (id: string) => {
      if (!scope) return;
      setItems((prev) => prev.filter((v) => v.id !== id));
      try {
        await unmarkOptimized(scope, 'video', [id]);
      } catch (err) {
        void reload();
        toast.error('Failed to remove video');
        console.error('[videoManagement] remove failed:', err);
      }
    },
    [scope, reload],
  );

  /** Toggle a single optimization field for one video. */
  const setField = useCallback(
    async (id: string, field: OptimizedField, value: boolean) => {
      if (!scope) return;
      // optimistic
      setItems((prev) =>
        prev.map((v) =>
          v.id === id
            ? { ...v, fields: { ...v.fields, [field]: value } }
            : v,
        ),
      );
      const item = items.find((v) => v.id === id);
      try {
        await setVideoFieldStatus(scope, id, field, value, {
          title: item?.title,
          thumbnailUrl: item?.thumbnailUrl,
        });
      } catch (err) {
        void reload();
        toast.error('Failed to save optimization status');
        console.error('[videoManagement] setField failed:', err);
      }
    },
    [scope, items, reload],
  );

  return { items, ready, addVideos, removeVideo, setField, reload };
}