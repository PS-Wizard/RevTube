// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- TypeScript types
// For the async video audit system (POST /video-audit, GET /video-audit/jobs/:id)
// ─────────────────────────────────────────────────────────────────────────────

export interface VideoAuditInput {
  videoId: string;
  title: string;
  description: string;
  tags: string[];
  keywords: string[];
  thumbnail: { url: string };
  captions?: { text: string }[];
}

export interface VideoAuditCriterionScore {
  criterion: string;
  earned: number;
  max: number;
  note?: string;
}

export interface VideoAuditElementScore {
  element: 'title' | 'description' | 'tags' | 'keywords' | 'thumbnail' | 'captions';
  score: number;
  max: number;
  breakdown: VideoAuditCriterionScore[];
  // Present only for the `thumbnail` element. Holds the full 12-pillar
  // Thumbnail Optimizer audit so the UI can show a general-knowledge summary
  // in the normal view and hand off to a detailed child audit on the
  // Thumbnail Optimizer page. Keyed off `currentScore`/`expectedScore`.
  thumbnailAnalysis?: import('./thumbnailOptimizer').ThumbnailAudit
}

// Focus categories the audit is split into (mirrors the channel audit's
// category approach). Discoverability = title/keywords/tags, Content Quality =
// description/captions, Visual Hook = thumbnail. Overall = mean of category scores.
export type VideoAuditCategoryKey = 'discoverability' | 'contentQuality' | 'visualHook';

export interface VideoAuditCategoryScore {
  key: VideoAuditCategoryKey;
  label: string;
  score: number;
  max: number;
  elements: string[];
}

// A concrete fix-the-weak-element recommendation. `delta` is the points the
// video's total gains (0-100) if every criterion in this element is raised to
// `targetPerElement` (the fix target). Sorted by delta descending.
export interface VideoAuditRecommendation {
  element: VideoAuditElementScore['element'];
  current: number;
  projected: number;
  delta: number;
  targetPerElement: number;
}

// Concrete, ready-to-use copy the model suggests for a weak element. Only some
// fields are present depending on the element: title -> `options`, description
// -> `rewrite`, tags/keywords -> `suggested`, thumbnail -> `concepts`.
// Each scored alternative carries a 0-100 number from the SAME element scorer
// the live audit used, so it's directly comparable to the element's own score.
// `scores` is an array parallel to `options`/`suggested`; `score` is the single
// number for a `rewrite`.
export interface VideoAuditSuggestion {
  options?: string[];
  scores?: number[];
  rewrite?: string;
  score?: number;
  suggested?: string[];
  concepts?: string[];
  why?: string;
}

// Suggestions keyed by element name (only present for weak elements with data).
export interface VideoAuditSuggestions {
  [element: string]: VideoAuditSuggestion | undefined;
}

export interface VideoAuditVideoResult {
  videoId: string;
  videoTitle: string;
  /** Raw metadata echo (capped) for data-driven fix guidance. Absent on old rows. */
  description?: string;
  tags?: string[];
  total: number;
  projectedTotal: number;
  suggestions: VideoAuditSuggestions;
  recommendations: VideoAuditRecommendation[];
  elements: VideoAuditElementScore[];
  categories: VideoAuditCategoryScore[];
}

export interface VideoAuditBatchResult {
  results: VideoAuditVideoResult[];
  overall: number;
  auditedAt: string;
  /**
   * thumbnail_audits row id the queue worker created for this run's embedded
   * child analyses ("Video Audit -- <date>" entry). Present only when the run
   * actually persisted history; lets the deep-dive button open that saved
   * entry on the Thumbnail Optimizer page instead of re-running a fresh audit.
   */
  thumbnailAuditSavedId?: number;
}

export interface VideoAuditJobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'completed' | 'failed' | 'delayed';
  progress: number;
  result?: VideoAuditBatchResult;
  error?: string;
}

export interface VideoAuditHistoryItem {
  id: number;
  name: string;
  channelId: string | null;
  channelTitle: string | null;
  createdAt: string;
}

export interface VideoAuditHistoryResponse {
  items: VideoAuditHistoryItem[];
  total: number;
  page: number;
}

export interface VideoAuditHistoryDetail extends VideoAuditHistoryItem {
  results: VideoAuditBatchResult;
}