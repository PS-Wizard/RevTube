// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- TypeScript type definitions
// ─────────────────────────────────────────────────────────────────────────────

export type Tier = 'Red' | 'Yellow' | 'Grey';

export interface OptimizationArea {
  area: string;
  status: string;
  opportunity: string;
  score: number;
  tier: Tier;
}

export interface ThumbnailAudit {
  url: string;
  videoTitle: string;
  reviewSummary: string;
  strengths: string;
  opportunities: string;
  currentScore: number;
  expectedScore: number;
  detailedAreas: OptimizationArea[];
  niche?: string;
  targetAudience?: string;
  brandVoice?: string;
}

export type AnalysisState = 'IDLE' | 'LOADING' | 'SUCCESS' | 'ERROR';

export interface AuditRequest {
  urls: string[];
  niche?: string;
  targetAudience?: string;
  brandVoice?: string;
}

export interface AuditResponse {
  results: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
}

// ── Persisted audit types ─────────────────────────────────────────────────────

export interface SavedAuditSummary {
  id: number;
  name: string;
  createdAt: string | null;
  channelId: string | null;
  channelTitle: string | null;
  totalVideos: number;
  niche: string | null;
  hasErrors: boolean;
}

export interface SavedAudit extends SavedAuditSummary {
  audits: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
  targetAudience: string | null;
  brandVoice: string | null;
  updatedAt?: string | null;
}

export interface HistoryResponse {
  items: SavedAuditSummary[];
  total: number;
  page: number;
}

export interface SaveAuditRequest {
  name?: string;
  audits: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
  channelId?: string;
  channelTitle?: string;
  niche?: string;
  targetAudience?: string;
  brandVoice?: string;
}
