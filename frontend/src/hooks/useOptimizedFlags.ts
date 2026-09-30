/**
 * useOptimizedFlags -- loads/edits the default "Optimized" list for one audit
 * kind in the current channel + workspace context. Optimistic updates keep the
 * UI snappy; Firestore write happens in the background.
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import { toast } from 'react-hot-toast';
import {
  getAllOptimizedLists,
  markOptimized,
  setVideoFieldStatus,
  setVideoFieldsStatus,
  unmarkOptimized,
  type OptimizedField,
  type OptimizedFields,
  type OptimizedItemMeta,
  type OptimizedKind,
  type OptimizedScope,
} from '../services/optimizedFlagService';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';

export function useOptimizedFlags(kind: OptimizedKind) {
  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  const scope = useMemo<OptimizedScope | null>(
    () => (user ? { uid: user.uid, organizationId: currentOrganization?.id ?? null } : null),
    [user, currentOrganization?.id],
  );

  const [optimizedIds, setOptimizedIds] = useState<Set<string>>(new Set());
  const [meta, setMeta] = useState<Record<string, OptimizedItemMeta>>({});
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!scope) {
        // Defer state writes so they are not synchronous-within-effect.
        await Promise.resolve();
        if (cancelled) return;
        setOptimizedIds(new Set());
        setMeta({});
        setReady(false);
        return;
      }
      const all = await getAllOptimizedLists(scope);
      if (cancelled) return;
      const list = all[kind];
      const ids = list
        ? kind === 'playlist'
          ? list.playlistIds ?? []
          : list.videoIds ?? []
        : [];
      setOptimizedIds(new Set(ids));
      setMeta(list?.itemsMeta ?? {});
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [scope, kind]);

  const mark = useCallback(
    async (ids: string[], itemMeta?: Record<string, OptimizedItemMeta>) => {
      if (!scope) return;
      // optimistic
      setOptimizedIds((prev) => new Set([...prev, ...ids]));
      try {
        await markOptimized(scope, kind, ids, itemMeta, true);
        toast.success(ids.length > 1 ? `${ids.length} items marked optimized` : 'Marked as optimized');
      } catch (err) {
        setOptimizedIds((prev) => {
          const next = new Set(prev);
          ids.forEach((id) => next.delete(id));
          return next;
        });
        toast.error('Failed to save optimized flag');
        console.error('[optimizedFlag] mark failed:', err);
      }
    },
    [scope, kind],
  );

  const unmark = useCallback(
    async (id: string) => {
      if (!scope) return;
      setOptimizedIds((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
      try {
        await unmarkOptimized(scope, kind, [id]);
      } catch (err) {
        setOptimizedIds((prev) => new Set([...prev, id]));
        toast.error('Failed to remove optimized flag');
        console.error('[optimizedFlag] unmark failed:', err);
      }
    },
    [scope, kind],
  );

  const toggle = useCallback(
    (id: string, label?: string, thumbnailUrl?: string) => {
      if (optimizedIds.has(id)) void unmark(id);
      else void mark([id], { [id]: { title: label, thumbnailUrl, addedAt: Date.now() } });
    },
    [optimizedIds, mark, unmark],
  );

  // Set the optimization status of a single field for one item, mirroring the
  // Video Management per-field toggles. Ensuring the item is present mirrors
  // setVideoFieldStatus server-side; optimistic local update keeps the UI snappy.
  const setField = useCallback(
    (id: string, field: OptimizedField, value: boolean, label?: string, thumbnailUrl?: string) => {
      if (!scope) return;
      setOptimizedIds((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
      setMeta((prev) => {
        const item = prev[id] ?? { addedAt: Date.now() };
        return {
          ...prev,
          [id]: {
            ...item,
            ...(label ? { title: label } : {}),
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
            fields: { ...(item.fields ?? {}), [field]: value },
          },
        };
      });
      setVideoFieldStatus(scope, id, field, value, { title: label, thumbnailUrl })
        .catch((err) => {
          setMeta((prev) => {
            const item = prev[id];
            if (!item?.fields) return prev;
            return {
              ...prev,
              [id]: { ...item, fields: { ...item.fields, [field]: !value } },
            };
          });
          toast.error('Failed to update optimized field');
          console.error('[optimizedFlag] setField failed:', err);
        });
    },
    [scope],
  );

  // Bulk-set several fields for one item in a single optimistic update + one
  // persisted write (avoids the read-modify-write race of firing setField per
  // field, which is what the Video Audit "Mark All" needs).
  const setFields = useCallback(
    (id: string, fields: OptimizedFields, label?: string, thumbnailUrl?: string) => {
      if (!scope || Object.keys(fields).length === 0) return;
      setOptimizedIds((prev) => (prev.has(id) ? prev : new Set([...prev, id])));
      setMeta((prev) => {
        const item = prev[id] ?? { addedAt: Date.now() };
        return {
          ...prev,
          [id]: {
            ...item,
            ...(label ? { title: label } : {}),
            ...(thumbnailUrl ? { thumbnailUrl } : {}),
            fields: { ...(item.fields ?? {}), ...fields },
          },
        };
      });
      setVideoFieldsStatus(scope, id, fields, { title: label, thumbnailUrl })
        .catch((err) => {
          setMeta((prev) => {
            const item = prev[id];
            if (!item?.fields) return prev;
            const rollback = { ...item.fields };
            for (const k of Object.keys(fields)) delete rollback[k as OptimizedField];
            return { ...prev, [id]: { ...item, fields: rollback } };
          });
          toast.error('Failed to update optimized fields');
          console.error('[optimizedFlag] setFields failed:', err);
        });
    },
    [scope],
  );

  return { optimizedIds, meta, ready, mark, toggle, setField, setFields };
}
