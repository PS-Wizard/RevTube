import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Persists an in-flight audit jobId in sessionStorage so the audit survives
 * page navigation and tab-close-within-session.
 *
 * Audits run server-side in BullMQ and keep running even when the user leaves
 * the page or closes the tab -- but the frontend lost its jobId on unmount, so
 * returning looked like the audit was cancelled. This hook restores the jobId
 * on mount (resuming polling) and clears it once the job is gone.
 *
 * Keyed by a caller-supplied scope (e.g. "video-audit" / "audit") and optional
 * orgId so personal vs org-context audits don't collide.
 *
 * IMPORTANT (org race): on a full page refresh the org context resolves
 * asynchronously -- `currentOrganization` is `null` for the very first render,
 * then hydrates from cache in an effect. The `key` therefore changes after
 * mount, so this hook re-reads storage whenever `key` changes (not just on the
 * initial mount). Without this, a job started inside an org context would never
 * be restored after refresh because the first render reads the non-org key.
 */
export function useSessionJobId(scope: string, orgId?: string | null) {
  const key = `rt:jobId:${scope}${orgId ? `:org:${orgId}` : ""}`;

  const readStored = () => {
    try {
      return sessionStorage.getItem(key) || null;
    } catch {
      return null;
    }
  };

  const [jobId, setJobIdState] = useState<string | null>(readStored);

  // Re-sync when the key changes (e.g. org context resolves on page load) so a
  // job started in an org context is restored once that org is known.
  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    setJobIdState(readStored());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setJobId = useCallback(
    (next: string | null) => {
      setJobIdState(next);
      try {
        if (next) sessionStorage.setItem(key, next);
        else sessionStorage.removeItem(key);
      } catch {
        /* storage unavailable -- non-fatal */
      }
    },
    [key],
  );

  return [jobId, setJobId] as const;
}

/**
 * Persists side-context for an in-flight audit (channel + whether the completed
 * result was already saved to history) alongside the jobId in sessionStorage, so
 * resuming after navigation can re-save once without duplicating history rows.
 * Keyed the same way as useSessionJobId so both clear together per scope/org.
 * Re-reads storage whenever the key changes, for the same async-org reason above.
 */
export function useJobContext<T extends Record<string, unknown>>(scope: string, orgId?: string | null) {
  const key = `rt:jobCtx:${scope}${orgId ? `:org:${orgId}` : ""}`;

  const readStored = () => {
    try {
      const raw = sessionStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : null;
    } catch {
      return null;
    }
  };

  const [ctx, setCtxState] = useState<T | null>(readStored);

  const prevKey = useRef(key);
  useEffect(() => {
    if (prevKey.current === key) return;
    prevKey.current = key;
    setCtxState(readStored());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);

  const setCtx = useCallback(
    (next: T | null) => {
      setCtxState(next);
      try {
        if (next) sessionStorage.setItem(key, JSON.stringify(next));
        else sessionStorage.removeItem(key);
      } catch {
        /* storage unavailable -- non-fatal */
      }
    },
    [key],
  );

  return [ctx, setCtx] as const;
}
