// ─────────────────────────────────────────────────────────────────────────────
// Public Audit — shared constants + pure formatting/scoring helpers.
//
// Single home for the numbers and text the panel, its tabs, the dialog, and
// the PDF/Excel exports all render, so copy and thresholds stay identical.
// No components here (react-refresh safe), no CSS, no raw hex — Tailwind
// token classes only.
// ─────────────────────────────────────────────────────────────────────────────

export const PAGE_SIZE = 10;
/** Public Audit presets; 1,000 is the server ceiling. */
export const VIDEO_COUNT_OPTIONS = [10, 25, 50, 100, 250, 500, 1000];

export const ELEMENT_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  tags: 'Tags',
  keywords: 'Keywords',
  thumbnail: 'Thumbnail',
  captions: 'Captions',
};

export const ELEMENT_ORDER = ['title', 'description', 'tags', 'keywords', 'thumbnail', 'captions'] as const;

// All video-table sort orders (header clicks + dropdown share this state).
export type ElementSortValue =
  | `${(typeof ELEMENT_ORDER)[number]}-desc`
  | `${(typeof ELEMENT_ORDER)[number]}-asc`;
export type VideoSort =
  | 'default'
  | 'score-desc' | 'score-asc'
  | 'views-desc' | 'views-asc'
  | 'likes-desc'
  | 'engagement-desc' | 'engagement-asc'
  | ElementSortValue;

// Header-click sort cycles per sortable column: biggest → lowest → normal.
export const SORT_CYCLE = {
  views: ['views-desc', 'views-asc'],
  engagement: ['engagement-desc', 'engagement-asc'],
  total: ['score-desc', 'score-asc'],
  title: ['title-desc', 'title-asc'],
  description: ['description-desc', 'description-asc'],
  tags: ['tags-desc', 'tags-asc'],
  keywords: ['keywords-desc', 'keywords-asc'],
  thumbnail: ['thumbnail-desc', 'thumbnail-asc'],
  captions: ['captions-desc', 'captions-asc'],
} as const;
export type SortColumnKey = keyof typeof SORT_CYCLE;

export const labelForElement = (key: string): string =>
  ELEMENT_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1);

// ── Concise per-element recommendations ────────────────────────────────────
// Short 1–2 sentence "what to do" lines for the public-audit video inspector.
// Deliberately generic (no full rewrites, no tag dumps, no AI copy): the
// inspector shows `Recommendation: <line>` only, while the full ready-to-use
// copy (alt titles, description rewrite, suggested tags) lives on the
// Video Audit detailed-analysis page via `SuggestionBody`.
export const ELEMENT_RECOMMENDATIONS: Record<string, string> = {
  keywords:
    'Choose 1 primary keyword that directly describes the video\'s main topic and use it naturally across the title, description, and tags. Add the same primary keyword at least once in each.',
  description:
    'Include the primary keyword within the first 2–3 sentences and naturally add 2–3 related keywords while clearly explaining the video\'s premise, stakes, and reason to watch. Avoid keyword stuffing.',
  title:
    'Include the primary keyword near the beginning of the title, ideally within the first 60 characters, while keeping the title focused on the video\'s main challenge, outcome, or hook.',
  tags: 'Add 5–10 specific multi-word tags viewers actually search for, including the primary keyword as a phrase. Avoid single-word or irrelevant tags.',
  thumbnail:
    'Use a high-contrast close-up with a 2–3 word overlay repeating the hook. Open this video in the Thumbnail Optimizer for the full visual audit.',
  captions:
    'Upload accurate captions covering all dialogue so search and accessibility pick up the primary keyword and related phrases.',
};

export function recommendationForElement(key: string): string {
  return ELEMENT_RECOMMENDATIONS[key] ?? `Improve the ${labelForElement(key).toLowerCase()} so it clearly targets the video's primary keyword.`;
}

// ── Concise per-dimension playlist recommendations ─────────────────────────
// Same shape as the video inspector's Recommendation lines: one 1–2 sentence
// "what to do" per weak playlist dimension (title/description/size). Rendered
// by the playlist inspector dialog next to each Fix uplift.
export const PLAYLIST_DIMENSION_LABELS: Record<string, string> = {
  title: 'Title',
  description: 'Description',
  size: 'Coverage / Size',
};

export const PLAYLIST_RECOMMENDATIONS: Record<string, string> = {
  title:
    'Use a clear, keyword-rich playlist title (20–70 characters) built around the primary keyword viewers search for.',
  description:
    'Write 200+ characters explaining what the playlist covers and who it is for, with the primary keyword in the first 2 sentences.',
  size: 'Grow the playlist to 10–100 videos so it works as a bingeable series and ranks better in search and suggested.',
};

export function labelForPlaylistDimension(key: string): string {
  return (
    PLAYLIST_DIMENSION_LABELS[key] ?? key.charAt(0).toUpperCase() + key.slice(1)
  );
}

export function recommendationForPlaylistDimension(key: string): string {
  return (
    PLAYLIST_RECOMMENDATIONS[key] ??
    `Improve the playlist ${labelForPlaylistDimension(key).toLowerCase()} so the series is easy to find and binge.`
  );
}

export function scoreTone(score: number | null | undefined): { color: string; label: string } {
  if (score === null || score === undefined || Number.isNaN(score)) {
    return { color: 'var(--rt-color-text-tertiary)', label: 'Not measured' };
  }
  if (score >= 80) return { color: 'var(--rt-color-success)', label: 'High performance' };
  if (score >= 50) return { color: 'var(--rt-color-warning)', label: 'Moderate alignment' };
  return { color: 'var(--rt-color-danger)', label: 'Needs attention' };
}

/** Tailwind text-color class for a score — replaces inline `style={{ color }}`. */
export function scoreTextClass(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score))
    return 'text-[var(--rt-color-text-tertiary)]';
  if (score >= 80) return 'text-[var(--rt-color-success)]';
  if (score >= 50) return 'text-[var(--rt-color-warning)]';
  return 'text-[var(--rt-color-danger)]';
}

/** Tailwind text + border classes for an outlined score Badge. */
export function scoreBadgeClasses(score: number | null | undefined): string {
  if (score === null || score === undefined || Number.isNaN(score))
    return 'text-[var(--rt-color-text-tertiary)] border-[var(--rt-color-border)]';
  if (score >= 80) return 'text-[var(--rt-color-success)] border-[var(--rt-color-success)]';
  if (score >= 50) return 'text-[var(--rt-color-warning)] border-[var(--rt-color-warning)]';
  return 'text-[var(--rt-color-danger)] border-[var(--rt-color-danger)]';
}

export function toneFor(s: number | null | undefined): 'neutral' | 'success' | 'warning' | 'destructive' {
  if (s === null || s === undefined) return 'neutral';
  if (s >= 80) return 'success';
  if (s >= 50) return 'warning';
  return 'destructive';
}

export function formatCount(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === '') return '—';
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString() : String(value);
}

export function formatDate(value: string | null | undefined): string {
  if (!value) return '—';
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

export function formatShort(value: string | number | null | undefined): string {
  const n = typeof value === 'string' ? Number(value) : value;
  if (n === null || n === undefined || !Number.isFinite(n)) return '—';
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(1)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return String(Math.round(n));
}

export function engagementRate(views: string | null | undefined, likes: string | null | undefined, comments: string | null | undefined): string {
  const v = Number(views);
  if (!Number.isFinite(v) || v <= 0) return '—';
  const l = Number(likes);
  const c = Number(comments);
  const rate = (((Number.isFinite(l) ? l : 0) + (Number.isFinite(c) ? c : 0)) / v) * 100;
  return `${rate.toFixed(2)}%`;
}

export function ageLabel(publishedAt: string | null | undefined): string {
  if (!publishedAt) return '';
  const t = Date.parse(publishedAt);
  if (!Number.isFinite(t)) return '';
  const days = Math.max(0, Math.floor((Date.now() - t) / 86400000));
  if (days < 1) return 'today';
  if (days === 1) return '1 day ago';
  if (days < 30) return `${days} days ago`;
  if (days < 365) return `${Math.floor(days / 30)} mo ago`;
  return `${Math.floor(days / 365)} yr ago`;
}

// ── Playlist table sort ────────────────────────────────────────────────────
// Mirrors the Videos tab header-click cycling (biggest → lowest → normal) for
// the Playlists tab's AuditDataTable. Unscored playlists (no audit health)
// and missing values sort last in both directions.

export type PlaylistSort =
  | 'default'
  | 'score-desc' | 'score-asc'
  | 'size-desc' | 'size-asc'
  | 'published-desc' | 'published-asc'
  | 'title-asc' | 'title-desc';

export const PLAYLIST_SORT_CYCLE = {
  score: ['score-desc', 'score-asc'],
  size: ['size-desc', 'size-asc'],
  published: ['published-desc', 'published-asc'],
  title: ['title-asc', 'title-desc'],
} as const;
export type PlaylistSortColumnKey = keyof typeof PLAYLIST_SORT_CYCLE;

export interface PlaylistSortRow {
  playlistId: string;
  title?: string | null;
  publishedAt?: string | null;
  itemCount?: number | null;
}

const playlistScoreOf = (
  row: PlaylistSortRow,
  healthById: Pick<Map<string, { health: number }>, 'get'>,
): number => {
  const h = row.playlistId ? healthById.get(row.playlistId)?.health : undefined;
  return typeof h === 'number' ? h : -1;
};

/**
 * Sorted copy of the playlist catalog for the Playlists tab. Pure —
 * unit-tested. Never mutates the input; `default` keeps catalog order.
 * Missing values (unscored playlists, unknown size/date) sort last in both
 * directions — they use the -1 sentinel below, which the comparator pins.
 */
export function sortPlaylists<T extends PlaylistSortRow>(
  list: T[],
  sort: PlaylistSort,
  healthById: Pick<Map<string, { health: number }>, 'get'>,
): T[] {
  const rows = [...(Array.isArray(list) ? list : [])];
  // Numeric sort with the -1 sentinel (missing value) pinned last in both
  // directions; dir flips only the ordered values.
  const numSort = (val: (r: T) => number, dir: 1 | -1): T[] =>
    rows.sort((a, b) => {
      const va = val(a);
      const vb = val(b);
      if (va < 0 && vb < 0) return 0;
      if (va < 0) return 1;
      if (vb < 0) return -1;
      return dir * (va - vb);
    });
  const scoreVal = (r: T): number => playlistScoreOf(r, healthById);
  const sizeVal = (r: T): number => (typeof r.itemCount === 'number' ? r.itemCount : -1);
  const pubVal = (r: T): number => {
    const t = r.publishedAt ? Date.parse(r.publishedAt) : NaN;
    return Number.isFinite(t) ? t : -1;
  };
  switch (sort) {
    case 'score-desc': return numSort(scoreVal, -1);
    case 'score-asc': return numSort(scoreVal, 1);
    case 'size-desc': return numSort(sizeVal, -1);
    case 'size-asc': return numSort(sizeVal, 1);
    case 'published-desc': return numSort(pubVal, -1);
    case 'published-asc': return numSort(pubVal, 1);
    case 'title-asc': return rows.sort((a, b) => (a.title || '').localeCompare(b.title || ''));
    case 'title-desc': return rows.sort((a, b) => (b.title || '').localeCompare(a.title || ''));
    default: return rows;
  }
}

// ── Data-driven fix details ──────────────────────────────────────────────
// Specific, computed "what to do" lines for a weak element, derived from the
// video's own metadata (title/description/tags echoed by the audit engine).
// Used when the AI suggestion copy is missing so a fix card is never bare
// numbers. All inputs optional — no data yields no lines (never crashes).

export interface FixDetailVideo {
  videoTitle?: string | null;
  description?: string | null;
  tags?: string[] | null;
}

const STOPWORDS = new Set(
  'a,an,the,and,or,but,for,with,from,that,this,these,those,are,was,were,has,have,had,will,would,can,its,it,you,your,we,our,they,their,not,all,any,how,why,what,when,who,get,got,into,out,top,new,best,vs,part,full,video'.split(','),
);

function significantWords(text: string | null | undefined): string[] {
  if (!text) return [];
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of text.toLowerCase().split(/[^a-z0-9]+/)) {
    if (raw.length < 4 || STOPWORDS.has(raw) || /^\d+$/.test(raw) || seen.has(raw)) continue;
    seen.add(raw);
    out.push(raw);
  }
  return out;
}

function norm(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function wordsMissingFrom(haystack: string | null | undefined, words: string[]): string[] {
  const hay = norm(haystack ?? '');
  return words.filter((w) => w && !hay.includes(norm(w)));
}

function titleFixes(title: string): string[] {
  const len = title.length;
  if (len > 60) {
    return [`Title is ${len} characters — front-load the main keyword and trim to ~60 so it doesn't truncate in search.`];
  }
  return [];
}

function keywordFixes(title: string, tags: string[]): string[] {
  const lines: string[] = [];
  const clean = tags.map((t) => t.trim()).filter(Boolean);
  if (clean.length === 0) {
    lines.push('No tags set — add 5–10 specific multi-word phrases viewers search for.');
  } else if (clean.length < 5) {
    lines.push(`Only ${clean.length} tag${clean.length === 1 ? '' : 's'} — add ${5 - clean.length}–${10 - clean.length} more specific phrases (aim 5–10).`);
  }
  const single = clean.filter((t) => !/\s/.test(t)).length;
  if (single > 0 && clean.length > 0) {
    lines.push(`${single} of ${clean.length} tags are single words — expand them into phrases (e.g. "rust" → "rust programming tutorial").`);
  }
  const missing = wordsMissingFrom(clean.join(' '), significantWords(title)).slice(0, 3);
  if (missing.length > 0) {
    lines.push(`Not covered by tags: ${missing.join(', ')} — add them as phrases.`);
  }
  return lines;
}

function descriptionFixes(description: string, title: string): string[] {
  const lines: string[] = [];
  const words = description.split(/\s+/).filter(Boolean).length;
  if (words < 50) {
    lines.push(`Description is only ${words} words — expand to 150–250 with the keyword in the first 2 lines.`);
  }
  if (!/https?:\/\//i.test(description)) {
    lines.push('No links — add a subscribe link, a related video, and social links.');
  }
  if (/(^|\s)#[a-z0-9_-]+/i.test(description) === false) {
    lines.push('No hashtags — add 3–5 targeted ones (the first 3 show above the title).');
  }
  if (/\b\d{1,3}:\d{2}\b/.test(description) === false) {
    lines.push('No chapters — add timestamps (0:00 Intro …) to unlock key moments in search.');
  }
  const missing = wordsMissingFrom(description, significantWords(title)).slice(0, 3);
  if (missing.length > 0) {
    lines.push(`Description never mentions: ${missing.join(', ')} — weave them into the opening lines.`);
  }
  return lines;
}

/**
 * Specific fix lines for a weak element, computed from the video's metadata.
 * Empty array when there is nothing concrete to say (callers fall back to
 * generic guidance). Never throws on missing fields.
 */
export function buildFixDetails(element: string, video: FixDetailVideo): string[] {
  try {
    const title = video?.videoTitle ?? '';
    // Unknown (absent) fields mean "can't assess" — only genuinely present
    // (even if empty) fields produce findings, so old reports without the
    // echoed metadata never get false "missing" claims.
    const hasDescription = typeof video?.description === 'string';
    const hasTags = Array.isArray(video?.tags);
    const description = hasDescription ? (video.description as string) : '';
    const tags = hasTags ? (video.tags as string[]).filter((t): t is string => typeof t === 'string') : [];
    switch (element) {
      case 'title':
        return titleFixes(title);
      case 'keywords':
      case 'tags':
        return hasTags ? keywordFixes(title, tags) : [];
      case 'description':
        return hasDescription ? descriptionFixes(description, title) : [];
      default:
        return [];
    }
  } catch {
    return [];
  }
}
