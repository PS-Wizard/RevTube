// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer -- deterministic playlist quality scoring
// ─────────────────────────────────────────────────────────────────────────────
// The AI's viralityScore is a guess. This module computes a deterministic,
// explainable score (0..100) per playlist from real signals so the number the
// user sees reflects actual quality and each deduction maps to a concrete
// "why" + a concrete "raise it" tip.
//
// Signals (joined from result.videoInsights by videoId):
//   - size    : how many videos are in the playlist
//   - age     : average age of its videos (recency; penalized harder when
//               time-decay weighting is on, and softened by a tight Data range)
//   - niche   : share of videos whose title matches the playlist theme
//   - views   : average views relative to the channel's best performer
//
// Floor guarantee: when all advanced settings are at their defaults, at least
// one playlist is guaranteed to score >= 80 (the strongest one is lifted to 80
// and flagged). Under non-default settings no floor is applied -- the honest
// score stands and the tips point at the settings to change.
import type {
  PlaylistRecommendation,
  VideoInsight,
} from "../types/playlistOptimizer";

export type ScoreFactorKey = "size" | "age" | "niche" | "views";

export interface ScoreFactor {
  key: ScoreFactorKey;
  label: string; // human-readable reason, e.g. "Only 2 videos"
  deduction: number; // points lost (>= 0)
  tip?: string; // how to recover the points
}

export interface PlaylistScore {
  score: number; // deterministic 0-100
  isTopUplifted: boolean; // true when the default-settings 80-floor lifted this playlist
  factors: ScoreFactor[]; // deductions, largest first (empty = solid playlist)
}

export interface ScoringSettings {
  useTimeDecay?: boolean;
  dataRange?: string;
  excludeKeywords?: string;
  minVideosPerPlaylist?: number;
  maxVideosPerPlaylist?: number;
  maxPlaylistsPerVideo?: number;
  onlyOptimized?: boolean;
  enableTargetPlaylist?: boolean;
}

const DAY_MS = 24 * 60 * 60 * 1000;

const STOPWORDS = new Set([
  "the", "and", "are", "for", "with", "from", "you", "your", "that", "this",
  "these", "those", "how", "why", "what", "when", "where", "who", "will",
  "can", "has", "have", "had", "not", "but", "our", "their", "they", "them",
  "its", "just", "out", "into", "about", "than", "then", "all", "any", "one",
  "two", "really", "very", "much", "more", "most", "some", "such", "only",
  "also", "other", "video", "videos", "watch", "subscribe", "channel", "new",
  "now", "get", "got", "day", "days", "night", "good", "great", "fun", "vs",
]);

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, Math.round(n)));
}

function ageDaysFrom(publishDate?: string): number | null {
  if (!publishDate) return null;
  const t = Date.parse(publishDate);
  if (Number.isNaN(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / DAY_MS));
}

/** Significant tokens (len >= 3, non-stopword) of a text, for theme matching. */
function tokens(text = ""): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

function sharesThemeToken(videoTitle: string, themeTokens: Set<string>): boolean {
  return tokens(videoTitle).some((t) => themeTokens.has(t));
}

/** Every setting that can tilt the analysis away from a plain default run. */
export function isDefaultSettings(s: ScoringSettings = {}): boolean {
  const range = s.dataRange || "all";
  return (
    range === "all" &&
    !s.useTimeDecay &&
    !(s.excludeKeywords ?? "").trim() &&
    !(s.minVideosPerPlaylist ?? 0) &&
    !(s.maxVideosPerPlaylist ?? 0) &&
    (s.maxPlaylistsPerVideo ?? 1) <= 1 &&
    !s.onlyOptimized &&
    !s.enableTargetPlaylist
  );
}

/**
 * Score one playlist from its matched video insights. Falls back to the AI
 * score (no factors) when no insight rows match the playlist's videos.
 */
export function scorePlaylist(
  playlist: PlaylistRecommendation,
  videoInsights: VideoInsight[] = [],
  settings: ScoringSettings = {},
): PlaylistScore {
  const byId = new Map(videoInsights.map((v) => [v.videoId, v]));
  const matched = playlist.videos
    .map((v) => byId.get(v.videoId ?? v.id))
    .filter((v): v is VideoInsight => Boolean(v));

  // No real data to judge on -> defer to the AI score.
  if (matched.length === 0) {
    return {
      score: clamp(playlist.viralityScore ?? 50, 0, 100),
      isTopUplifted: false,
      factors: [],
    };
  }

  const count = matched.length;
  const ages = matched
    .map((v) => (v.ageDays !== undefined ? v.ageDays : ageDaysFrom(v.publishDate)))
    .filter((a): a is number => a !== null);
  const avgAge = ages.length ? ages.reduce((a, b) => a + b, 0) / ages.length : null;
  const views = matched.map((v) => Number(v.views) || 0);
  const avgViews = views.length
    ? views.reduce((a, b) => a + b, 0) / views.length
    : 0;
  const maxViews = Math.max(0, ...videoInsights.map((v) => Number(v.views) || 0));

  // Theme tokens from the playlist title + keywords + topic.
  const themeTokens = new Set([
    ...tokens(playlist.title),
    ...(playlist.keywords ?? []).flatMap((k) => tokens(k)),
    ...tokens(playlist.topic),
  ]);
  const offNicheCount = themeTokens.size
    ? matched.filter((v) => !sharesThemeToken(v.title, themeTokens)).length
    : 0;

  const factors: ScoreFactor[] = [];
  const useTimeDecay = !!settings.useTimeDecay;
  const dataRange = settings.dataRange || "all";
  const isNarrowRange = dataRange !== "all";

  // ── size ────────────────────────────────────────────────────────────────
  let d = 0;
  if (count <= 1) d = 28;
  else if (count === 2) d = 20;
  else if (count === 3) d = 12;
  else if (count === 4) d = 6;
  if (d) {
    const need = Math.max(3 - count, 0);
    factors.push({
      key: "size",
      label:
        count === 1
          ? "Only 1 video"
          : `Only ${count} videos`,
      deduction: d,
      tip: need
        ? `Add ${need}+ more on-theme video${need > 1 ? "s" : ""} to give this playlist real coverage.`
        : "Add 1-2 more on-theme videos to strengthen the group.",
    });
  }

  // ── age ─────────────────────────────────────────────────────────────────
  if (avgAge !== null) {
    const yrs = avgAge / 365;
    // Recency penalizes harder when time-decay weighting is on.
    d =
      yrs > 3 ? (useTimeDecay ? 22 : 14)
      : yrs > 2 ? (useTimeDecay ? 16 : 9)
      : yrs > 1 ? (useTimeDecay ? 10 : 5)
      : yrs > 0.5 ? (useTimeDecay ? 5 : 2)
      : 0;
    if (d) {
      const tip =
        !isNarrowRange && !useTimeDecay
          ? `Set Data range to the last 90 days so the audit weights current content.`
          : avgAge > 365
            ? "Most videos are over a year old; focus on newer uploads."
            : "Recent videos will score higher here.";
      factors.push({
        key: "age",
        label: `Avg video age ~${yrs >= 1 ? `${yrs.toFixed(1)}y` : `${Math.round(avgAge / 30)}mo`}`,
        deduction: d,
        tip,
      });
    }
  }

  // ── niche ───────────────────────────────────────────────────────────────
  const offPct = count ? offNicheCount / count : 0;
  d =
    offPct >= 0.5 ? 20
    : offPct >= 0.3 ? 12
    : offPct >= 0.15 ? 6
    : 0;
  if (d) {
    factors.push({
      key: "niche",
      label: `${offNicheCount} video${offNicheCount === 1 ? "" : "s"} off this theme`,
      deduction: d,
      tip: offNicheCount === 1
        ? "One video doesn't match this theme; move it to a better-fitting playlist."
        : `${offNicheCount} videos don't match this theme. Move them to a better-fitting playlist or split them into their own group.`,
    });
  }

  // ── views (relative to the channel's best performer, log-normalized) ────
  let perf = 1;
  if (maxViews > 0 && avgViews > 0) {
    perf = 0.3 + 0.7 * (Math.log1p(avgViews) / Math.log1p(maxViews));
  }
  d =
    perf < 0.4 ? 12
    : perf < 0.55 ? 6
    : perf < 0.7 ? 2
    : 0;
  if (d) {
    factors.push({
      key: "views",
      label: `Low average views (avg ${Math.round(avgViews).toLocaleString()})`,
      deduction: d,
      tip: "Prefer your better-performing videos in this playlist to lift engagement.",
    });
  }

  factors.sort((a, b) => b.deduction - a.deduction);
  const score = clamp(100 - factors.reduce((s, f) => s + f.deduction, 0), 0, 100);
  return { score, isTopUplifted: false, factors };
}

/**
 * Score every playlist and apply the default-settings floor: when no advanced
 * setting is active and the strongest playlist still scores < 80, lift it to
 * exactly 80 and flag it, so a default run always surfaces an 80+ plan.
 */
export function scoreAllPlaylists(
  playlists: PlaylistRecommendation[],
  videoInsights: VideoInsight[] = [],
  settings: ScoringSettings = {},
): Map<string, PlaylistScore> {
  const scored: Array<[string, PlaylistScore]> = playlists.map((pl) => [
    pl.id,
    scorePlaylist(pl, videoInsights, settings),
  ]);
  if (isDefaultSettings(settings) && scored.length > 0) {
    let topIdx = 0;
    for (let i = 1; i < scored.length; i++) {
      if (scored[i][1].score > scored[topIdx][1].score) topIdx = i;
    }
    const [id, s] = scored[topIdx];
    if (s.score < 80) {
      scored[topIdx] = [id, { ...s, score: 80, isTopUplifted: true }];
    }
  }
  return new Map(scored);
}
