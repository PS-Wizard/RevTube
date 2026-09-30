// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer -- Frontend API client
// ─────────────────────────────────────────────────────────────────────────────
import { readJsonResponse } from '../utils/readJsonResponse';
import { getFirebaseAuthHeader } from './authHeaders';
import { apiUrl } from '../utils/apiBase';
import { tryExtractUsage } from './analyticsService';
import type {
  AnalyzeRequest,
  AnalyzeResponse,
  SaveRequest,
  SaveResponse,
  SavedAnalysis,
  HistoryResponse,
} from '../types/playlistOptimizer';

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

  const body = await readJsonResponse(response, `PlaylistOptimizer.${path}`);
  tryExtractUsage(body);

  if (!response.ok) {
    const errBody = body as { error?: { message?: string; code?: string; detail?: string } };
    let errMsg = errBody?.error?.message || `Request failed with status ${response.status}`;
    if (errBody?.error?.detail) {
      errMsg += ` (${errBody.error.detail})`;
    }
    console.error(`[PlaylistOptimizer] ${response.status}:`, errBody?.error);
    throw new Error(errMsg);
  }

  return body as T;
}

export class PlaylistOptimizerService {
  /**
   * Analyze videos and return playlist optimization results.
   */
  static async analyze(params: AnalyzeRequest, orgId?: string): Promise<AnalyzeResponse> {
    return authFetch<AnalyzeResponse>('/playlist-optimizer/analyze', {
      method: 'POST',
      body: JSON.stringify(params),
    }, orgId);
  }

  /**
   * Enqueue a background playlist analysis. Returns a jobId that survives
   * page navigation / tab close; poll getJobStatus to read the result.
   */
  static async enqueueJob(params: AnalyzeRequest & { channelId?: string; channelTitle?: string }, orgId?: string): Promise<{ jobId: string }> {
    return authFetch<{ jobId: string }>('/playlist-optimizer/jobs', {
      method: 'POST',
      body: JSON.stringify(params),
    }, orgId);
  }

  /**
   * Poll a playlist optimizer job by id.
   */
  static async getJobStatus(jobId: string): Promise<{
    jobId: string;
    state: string;
    progress?: number;
    result?: { savedId?: number; kind?: string; result: AnalyzeResponse };
  }> {
    return authFetch(`/playlist-optimizer/jobs/${encodeURIComponent(jobId)}`);
  }

  // ── Persistence ──────────────────────────────────────────────────────────

  /**
   * Save a completed analysis to PostgreSQL for future access.
   */
  static async save(params: SaveRequest): Promise<SaveResponse> {
    return authFetch<SaveResponse>('/playlist-optimizer/save', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  }

  /**
   * List saved analysis summaries (paginated, newest-first).
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
    return authFetch(`/playlist-optimizer/history${qs ? `?${qs}` : ''}`);
  }

  /**
   * Retrieve a single saved analysis with full results.
   */
  static async getHistory(id: number): Promise<SavedAnalysis> {
    return authFetch(`/playlist-optimizer/history/${encodeURIComponent(id)}`);
  }

  /**
   * Newest saved analysis whose recommendation cards contain this reference
   * id (the same id items are marked optimized by). Powers the Optimized
   * Content deep-link; returns null when no saved entry contains it.
   */
  static async findByVideo(refId: string): Promise<{ id: number | null }> {
    return authFetch(`/playlist-optimizer/history/by-video/${encodeURIComponent(refId)}`);
  }

  /**
   * Delete a saved analysis from PostgreSQL.
   */
  static async deleteHistory(id: number): Promise<{ success: boolean }> {
    return authFetch(`/playlist-optimizer/history/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  }
}
