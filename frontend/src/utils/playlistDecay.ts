// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer -- time-decay weighting (mirrors backend computeDecay)
// ─────────────────────────────────────────────────────────────────────────────
// Playlist analysis deliberately weights RECENT + PERFORMING videos highest:
// newer videos are stronger signals of the channel's current direction, and
// older videos accumulate views over time, so raw view counts alone would
// over-weight legacy content. Every video gets a deterministic decayWeight
// (0..1) = recency × performance, plus a tier label for display.
//
// Kept in lock-step with the backend formula in
// backend/services/playlistOptimizerService.js so the frontend can render the
// same weights for live runs even before the backend echoes videoInsights.
import type { Video, VideoInsight } from "../types/playlistOptimizer";

const DAY_MS = 24 * 60 * 60 * 1000;

export type DecayTier = "High" | "Medium" | "Low" | "Minimal";

export interface DecayInfo {
  decayWeight: number;
  decayTier: DecayTier;
  ageDays: number;
}

export function computeDecay(
  publishDate?: string,
  views?: number,
  maxViews = 0,
): DecayInfo {
  let ageDays = 0;
  if (publishDate) {
    const t = Date.parse(publishDate);
    if (!Number.isNaN(t)) {
      ageDays = Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
    }
  }
  // Recency halves roughly every 12 months: 1.0 today, ~0.5 at 1yr, ~0.25 at 2yr.
  const recency = Math.pow(0.5, ageDays / 365);
  // Performance scales up with views (log-normalized so a mega-hit can't drown
  // the set) but never zeroes a low-view video (floor 0.3). Unknown views -> 1.
  const performance =
    maxViews > 0 && (views ?? 0) > 0
      ? 0.3 + 0.7 * (Math.log1p(views ?? 0) / Math.log1p(maxViews))
      : 1;
  const decayWeight = Number((recency * performance).toFixed(3));
  const decayTier: DecayTier =
    decayWeight >= 0.75
      ? "High"
      : decayWeight >= 0.5
        ? "Medium"
        : decayWeight >= 0.25
          ? "Low"
          : "Minimal";
  return { decayWeight, decayTier, ageDays };
}

/**
 * Build the included-videos table rows from the input video list. Mirrors the
 * backend's buildVideoInsights so a live run (or an older saved result without
 * videoInsights) still renders. When `useTimeDecay` is OFF (default) videos
 * keep their input order and rows carry no decay fields, so the UI hides the
 * Time-Decay column entirely.
 */
export function computeVideoInsights(
  videos: Video[] = [],
  useTimeDecay = false,
): VideoInsight[] {
  const maxViews = Math.max(0, ...videos.map((v) => Number(v.views) || 0));
  const rows = videos.map((v) => {
    const custom = (v.customMetadata ?? {}) as Record<string, unknown>;
    const row: VideoInsight = {
      videoId: v.videoId || v.id,
      title: v.title,
      url: v.url,
      channelTitle: v.channelTitle || String(custom.channelTitle ?? ""),
      playlistId: v.originalPlaylistId || String(custom.originalPlaylistId ?? ""),
      playlistTitle:
        typeof custom.originalPlaylistTitle === "string"
          ? custom.originalPlaylistTitle
          : "",
      publishDate: v.publishDate || "",
      views: Number(v.views) || 0,
      views7: Number(v.views7) || 0,
      views30: Number(v.views30) || 0,
      views90: Number(v.views90) || 0,
    };
    if (useTimeDecay) {
      const { decayWeight, decayTier, ageDays } = computeDecay(
        v.publishDate,
        Number(v.views) || 0,
        maxViews,
      );
      row.decayWeight = decayWeight;
      row.decayTier = decayTier;
      row.ageDays = ageDays;
    }
    return row;
  });
  if (useTimeDecay) {
    rows.sort((a, b) => (b.decayWeight ?? 0) - (a.decayWeight ?? 0));
  }
  return rows;
}
