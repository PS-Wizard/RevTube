// ─────────────────────────────────────────────────────────────────────────────
// Centralized Audit Orchestrator -- frontend API client.
// Talks to POST/GET /audit-orchestrator (enqueue, poll, report, rerun).
// ─────────────────────────────────────────────────────────────────────────────
import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';

export type AuditSubRunType = 'channelIdentity' | 'video' | 'playlist' | 'general';

export interface AuditedVideoItem {
  videoId: string;
  title: string;
  description?: string;
  publishedAt: string | null;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  url: string;
  // Full-depth engine output (only present when the Full Audit actually analyzed
  // this video with the real Video Audit engine). Mirrors the standalone Video
  // Audit report for a single video.
  score?: number | null;
  projectedTotal?: number | null;
  elements?: Array<{
    element: string;
    score: number;
    max: number;
    breakdown?: Array<{ criterion: string; earned: number; max: number; note?: string }>;
    thumbnailAnalysis?: unknown;
  }>;
  breakdown?: Array<{ element: string; key: string; label: string; score: number; earned: number; max: number }>;
  recommendations?: Array<{
    element: string;
    current: number;
    projected: number;
    delta: number;
  }>;
  suggestions?: Record<
    string,
    {
      options?: string[];
      rewrite?: string;
      suggested?: string[];
      concepts?: string[];
      why?: string;
      score?: number;
      scores?: number[];
    }
  > | null;
}

export interface AuditSubRunMeta {
  [key: string]: unknown;
  niche?: string;
  coherencePct?: number | null;
  videoCount?: number;
  videos?: AuditedVideoItem[];
  playlistCount?: number;
  sampleSize?: number;
  error?: string;
  /**
   * Standalone Video Audit history row id written by this Full Audit run
   * ("Full Audit -- <date>"). Lets deep links open that exact saved audit
   * (?audit=<id>). Absent on runs saved before this field existed.
   */
  videoHistoryId?: number | null;
  /**
   * Standalone Playlist Optimizer history row id written by this Full Audit
   * run ("Full Audit -- <date>"). Lets the Playlist deep link open that exact
   * saved analysis (?audit=<id>). Absent on runs saved before this field existed.
   */
  playlistHistoryId?: number | null;
}

export interface AuditSubRunScore {
  score: number;
  meta?: AuditSubRunMeta;
  status?: string;
  params?: AuditSubRunParam[];
  recommendations?: AuditSubRunRecommendation[];
}

export interface AuditOrchestratorEnqueueResponse {
  jobId: string;
}

export interface AuditOrchestratorJobStatus {
  jobId: string;
  state: string;
  progress?: number;
  result?: AuditOrchestratorResult;
}

// Shapes persisted into audit_sub_runs.results JSONB.
export interface AuditSubRunParam {
  key: string;
  label: string;
  category?: string;
  earned: number | null;
  max: number;
  rawValue?: unknown;
  recommendationTemplate?: string;
  impactGain?: number;
  impactPenalty?: number;
  /**
   * Member contributions behind a merged dimension card. The card itself shows
   * the combined earned/max (backend weighted blend of the deterministic + AI
   * engines); detail lists what each engine contributed. Never rendered as
   * extra cards.
   */
  detail?: Array<{ key: string; label: string; earned: number; max: number; engine: string }>;
}

export interface AuditSubRunRecommendation {
  auditType: AuditSubRunType | string;
  paramKey: string;
  severity: string;
  message: string;
  impactGain?: number;
  impactPenalty?: number;
}

export interface AuditSubRunResultRow {
  id: number;
  audit_run_id: number;
  type: AuditSubRunType;
  status: string;
  score: number | null;
  grade: string | null;
  results: {
    params?: AuditSubRunParam[];
    recommendations?: AuditSubRunRecommendation[];
    meta?: AuditSubRunMeta;
  };
  report_url: string | null;
  created_at: string;
}

export interface AuditRunRow {
  id: number;
  uid: string;
  channel_id: string | null;
  channel_title: string | null;
  org_id: string | null;
  status: string;
  overall_score: number | null;
  overall_grade: string | null;
  profile_version: number | null;
  include_thumbnail_ai: boolean;
  started_at: string;
  completed_at: string | null;
  created_at: string;
}

export interface AuditOrchestratorResult {
  auditRunId: number;
  overall: number;
  grade: string;
  /** Standalone Video Audit history row id for the ?audit= deep link. */
  videoHistoryId?: number | null;
  subRuns: Record<AuditSubRunType, AuditSubRunScore>;
}

async function request<T = unknown>(path: string, init?: RequestInit, orgId?: string): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getFirebaseAuthHeader()),
      ...(orgId ? { 'X-Org-Id': orgId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Request to ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export interface AuditOrchestratorVideoSelection {
  mode: 'recent' | 'since';
  count: number;
  since?: string;
}

export function runAuditOrchestrator(channelId: string, opts?: { includeThumbnailAI?: boolean; orgId?: string; scope?: 'full' | 'channel'; videoSelection?: AuditOrchestratorVideoSelection }): Promise<AuditOrchestratorEnqueueResponse> {
  return request(
    '/audit-orchestrator',
    {
      method: 'POST',
      body: JSON.stringify({
        channelId,
        includeThumbnailAI: opts?.includeThumbnailAI ?? false,
        scope: opts?.scope ?? 'full',
        ...(opts?.videoSelection ? { videoSelection: opts.videoSelection } : {}),
      }),
    },
    opts?.orgId,
  );
}

export function getAuditOrchestratorJobStatus(jobId: string): Promise<AuditOrchestratorJobStatus> {
  return request(`/audit-orchestrator/jobs/${encodeURIComponent(jobId)}`);
}

export function getAuditOrchestratorReport(runId: number): Promise<{ run: AuditRunRow; subRuns: AuditSubRunResultRow[] }> {
  return request(`/audit-orchestrator/${runId}`);
}

export function rerunAuditOrchestrator(runId: number, opts?: { includeThumbnailAI?: boolean; orgId?: string }): Promise<AuditOrchestratorEnqueueResponse> {
  return request(
    `/audit-orchestrator/${runId}/rerun`,
    { method: 'POST', body: JSON.stringify({ includeThumbnailAI: opts?.includeThumbnailAI ?? false }) },
    opts?.orgId,
  );
}

export interface AuditOrchestratorHistoryItem {
  id: number;
  name: string;
  channelId: string | null;
  channelTitle: string | null;
  overallScore: number | null;
  overallGrade: string | null;
  includeThumbnailAi: boolean;
  createdAt: string;
}

export function getAuditOrchestratorHistory(opts?: { page?: number; search?: string; orgId?: string }): Promise<{ items: AuditOrchestratorHistoryItem[]; total: number; page: number }> {
  const params = new URLSearchParams();
  if (opts?.page) params.set('page', String(opts.page));
  if (opts?.search) params.set('search', opts.search);
  const qs = params.toString();
  return request(`/audit-orchestrator/history${qs ? `?${qs}` : ''}`, undefined, opts?.orgId);
}

export function deleteAuditOrchestratorHistory(id: number, orgId?: string): Promise<{ success: boolean }> {
  return request(`/audit-orchestrator/history/${id}`, { method: 'DELETE' }, orgId);
}

export function renameAuditOrchestratorHistory(id: number, name: string, orgId?: string): Promise<{ id: number; name: string }> {
  return request(`/audit-orchestrator/history/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) }, orgId);
}

export interface AuditCriteriaItem {
  key: string;
  label: string;
  max: number;
}

// Admin-configured Full Audit scoring criteria (config/optimizerCriteria),
// served read-only by the orchestrator's GET /audit-orchestrator/criteria.
export interface AuditCriteria {
  categories: Record<'channel' | 'video' | 'playlist' | 'general', AuditCriteriaItem[]>;
}

export function getAuditOrchestratorCriteria(): Promise<AuditCriteria> {
  return request('/audit-orchestrator/criteria');
}
