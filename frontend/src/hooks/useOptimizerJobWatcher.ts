import { useEffect, useRef } from "react";
import { ThumbnailOptimizerService } from "../services/thumbnailOptimizerService";
import { PlaylistOptimizerService } from "../services/playlistOptimizerService";

/**
 * App-level background watcher for thumbnail / playlist optimizer jobs.
 *
 * Mounted once in Layout. When a jobId is present in sessionStorage (because the
 * user started an analysis then navigated away or closed the page), this hook
 * keeps polling so a completed job cleans up its jobId. The in-app notification
 * + email + toast + OS notification are fired by the backend's queue completed
 * handler and surfaced by NotificationBell (which polls globally), so this hook
 * only handles cleanup.
 *
 * Scopes mirror useSessionJobId: "thumbnail-optimizer" / "playlist-optimizer",
 * optionally suffixed with ":org:{orgId}".
 */
export function useOptimizerJobWatcher(orgId?: string | null) {
  const pollingRef = useRef(false);

  useEffect(() => {
    const orgSuffix = orgId ? `:org:${orgId}` : "";
    const thumbKey = `rt:jobId:thumbnail-optimizer${orgSuffix}`;
    const playlistKey = `rt:jobId:playlist-optimizer${orgSuffix}`;

    const readJobIds = (): { key: string; jobId: string; kind: "thumbnail" | "playlist" }[] => {
      try {
        const out: { key: string; jobId: string; kind: "thumbnail" | "playlist" }[] = [];
        const thumb = sessionStorage.getItem(thumbKey);
        if (thumb) out.push({ key: thumbKey, jobId: thumb, kind: "thumbnail" });
        const playlist = sessionStorage.getItem(playlistKey);
        if (playlist) out.push({ key: playlistKey, jobId: playlist, kind: "playlist" });
        return out;
      } catch {
        return [];
      }
    };

    const clearKey = (key: string) => {
      try {
        sessionStorage.removeItem(key);
      } catch { /* non-fatal */ }
    };

    const poll = async () => {
      if (pollingRef.current) return;
      pollingRef.current = true;
      try {
        for (const entry of readJobIds()) {
          try {
            const status =
              entry.kind === "thumbnail"
                ? await ThumbnailOptimizerService.getJobStatus(entry.jobId)
                : await PlaylistOptimizerService.getJobStatus(entry.jobId);
            if (status.state === "completed" || status.state === "failed") {
              clearKey(entry.key);
            }
          } catch {
            // Transient network / auth error -- keep polling.
          }
        }
      } finally {
        pollingRef.current = false;
      }
    };

    const interval = setInterval(poll, 5000);
    // Kick off immediately in case a job completed while the app was closed.
    void poll();
    return () => clearInterval(interval);
  }, [orgId]);
}
