// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Frontend API client
// ─────────────────────────────────────────────────────────────────────────────
import { readJsonResponse } from '../utils/readJsonResponse';
import { getFirebaseAuthHeader } from './authHeaders';
import { apiUrl } from '../utils/apiBase';
import { tryExtractUsage } from './analyticsService';
import type {
  AuditRequest,
  AuditResponse,
  SaveAuditRequest,
  SavedAudit,
  HistoryResponse,
} from '../types/thumbnailOptimizer';

async function authFetch<T>(
  path: string,
  options: RequestInit = {},
  orgId?: string,
): Promise<T> {
  const authHeaders = await getFirebaseAuthHeader();
  const response = await fetch(apiUrl(path), {
    ...options,
    headers: {
      'Content-Type': 'application/json',
      ...authHeaders,
      ...(orgId ? { 'X-Org-Id': orgId } : {}),
      ...(options.headers as Record<string, string>),
    },
  });

  const body = await readJsonResponse(response, `ThumbnailOptimizer.${path}`);
  tryExtractUsage(body);

  if (!response.ok) {
    const errBody = body as { error?: { message?: string; code?: string; detail?: string } };
    let errMsg = errBody?.error?.message || `Request failed with status ${response.status}`;
    if (errBody?.error?.detail) {
      errMsg += ` (${errBody.error.detail})`;
    }
    console.error(`[ThumbnailOptimizer] ${response.status}:`, errBody?.error);
    throw new Error(errMsg);
  }

  return body as T;
}

export class ThumbnailOptimizerService {
  /**
   * Analyze one or more YouTube thumbnail URLs.
   * Returns structured audits with scores across 12 pillars.
   */
  static async analyze(params: AuditRequest, orgId?: string): Promise<AuditResponse> {
    return authFetch<AuditResponse>('/thumbnail-optimizer/analyze', {
      method: 'POST',
      body: JSON.stringify(params),
    }, orgId);
  }

  /**
   * Enqueue a background thumbnail analysis. Returns a jobId that survives
   * page navigation / tab close; poll getJobStatus to read the result.
   */
  static async enqueueJob(params: AuditRequest & { channelId?: string; channelTitle?: string }, orgId?: string): Promise<{ jobId: string }> {
    return authFetch<{ jobId: string }>('/thumbnail-optimizer/jobs', {
      method: 'POST',
      body: JSON.stringify(params),
    }, orgId);
  }

  /**
   * Poll a thumbnail optimizer job by id.
   */
  static async getJobStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    progress?: number;
    result?: { savedId?: number; kind?: string; result: AuditResponse };
  }> {
    return authFetch(`/thumbnail-optimizer/jobs/${encodeURIComponent(jobId)}`);
  }

  // ── Persistence ────────────────────────────────────────────────────────────

  /**
   * Save a completed audit to Firestore for future access.
   */
  static async save(params: SaveAuditRequest): Promise<{ id: number; createdAt: string }> {
    return authFetch('/thumbnail-optimizer/save', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * List saved audit summaries (paginated, newest-first).
   */
  static async history(params?: {
    limit?: number;
    page?: number;
    search?: string;
  }): Promise<HistoryResponse> {
    const qp = new URLSearchParams();
    if (params?.limit) qp.set('limit', String(params.limit));
    if (params?.page) qp.set('page', String(params.page));
    if (params?.search) qp.set('search', params.search);
    const qs = qp.toString();
    return authFetch(`/thumbnail-optimizer/history${qs ? `?${qs}` : ''}`);
  }

  /**
   * Find the newest saved audit that contains a specific video id.
   * `id` is null when no saved entry includes it.
   */
  static async findByVideo(videoId: string): Promise<{ id: number | null }> {
    return authFetch(`/thumbnail-optimizer/history/by-video/${encodeURIComponent(videoId)}`);
  }

  /**
   * Retrieve a single saved audit with full results.
   */
  static async getHistory(id: number): Promise<SavedAudit> {
    return authFetch(`/thumbnail-optimizer/history/${encodeURIComponent(id)}`);
  }

  /**
   * Delete a saved audit from PostgreSQL.
   */
  static async deleteHistory(id: number): Promise<{ success: boolean }> {
    return authFetch(`/thumbnail-optimizer/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
