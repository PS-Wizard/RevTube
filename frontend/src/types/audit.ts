// ─────────────────────────────────────────────────────────────────────────────
// Unified Audit & Scoring -- TypeScript types
// Mirrors the backend audit scoring engine (backend/services/auditScoringService.js)
// and the /audit route response shape.
// ─────────────────────────────────────────────────────────────────────────────

export interface AuditBreakdownItem {
  key: string;
  label: string;
  earned: number;
  max: number;
}

export interface AuditScore {
  total: number;
  breakdown: AuditBreakdownItem[];
}

// Health (0-100) + actionable hint per displayed data item so the UI can color
// the collected audit data good/ok/bad and show how to improve. Mirrors backend
// services/auditScoringService rateHealth.
export interface AuditChannelField {
  value: string;
  health: number;
  hint: string;
}
export interface AuditChannelKeywords {
  values: string[];
  health: number;
  hint: string;
}
export interface AuditChannelHealth {
  name: AuditChannelField;
  username: AuditChannelField;
  description: AuditChannelField;
  keywords: AuditChannelKeywords;
}

export interface AuditVideoData {
  title: string;
  description: string;
  tags: string[];
  publishedAt?: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  health: number;
  hint: string;
}

export interface AuditPlaylistData {
  title: string;
  description: string;
  size: number;
  health: number;
  hint: string;
}

// General (insights-style) recommendations: upload cadence, engagement, content focus.
export interface AuditGeneralItem {
  key: string;
  label: string;
  health: number;
  hint: string;
}

export interface AuditInput {
  channel: AuditChannelHealth;
  videos: AuditVideoData[];
  playlists: AuditPlaylistData[];
  general: AuditGeneralItem[];
}

export interface AuditResult {
  results: {
    video: AuditScore;
    channel: AuditScore;
    playlist: AuditScore;
    general: AuditScore;
  };
  overall: number;
  input?: AuditInput;
  issues?: AuditIssue[];
}

// Issues grouped by type (not per-item) so the UI can show actionable fixes
// with how many videos/playlists are affected plus direct links.
export interface AuditIssueAffected {
  type: 'video' | 'playlist' | 'channel';
  id: string | null;
  title: string;
  url: string | null;
}

export interface AuditIssue {
  key: string;
  label: string;
  hint: string;
  severity: 'high' | 'medium';
  count: number;
  affected: AuditIssueAffected[];
}
