import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';
import type { VideoAuditBatchResult, VideoAuditHistoryDetail, VideoAuditHistoryResponse, VideoAuditJobStatus } from '../types/videoAudit';

export interface VideoAuditCriterion {
  key: string;
  label: string;
  weight: number;
  element: string;
  category: string;
  instruction: string;
}

export interface EnqueueVideoAuditPayload {
  channelId: string;
  videoIds: string[];
  /** Opt-in Thumbnail Optimizer 12-pillar analysis (one Gemini vision call per video). */
  includeThumbnail?: boolean;
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

export function enqueueVideoAudit(payload: EnqueueVideoAuditPayload, accessToken?: string | null, orgId?: string): Promise<{ jobId: string }> {
  return request(
    '/video-audit',
    {
      method: 'POST',
      body: JSON.stringify(payload),
      headers: accessToken ? { Authorization: `Bearer ${accessToken}` } : {},
    },
    orgId,
  );
}

export function getVideoAuditCriteria(): Promise<{ criteria: VideoAuditCriterion[] }> {
  return request('/video-audit/criteria');
}

export function getVideoAuditJobStatus(jobId: string): Promise<VideoAuditJobStatus> {
  return request(`/video-audit/jobs/${jobId}`);
}

export function saveVideoAudit(payload: { name?: string; channelId?: string; channelTitle?: string; results: VideoAuditBatchResult }): Promise<{ id: number; createdAt: string }> {
  return request('/video-audit/history', { method: 'POST', body: JSON.stringify(payload) });
}

export function getVideoAuditHistory(params?: { limit?: number; page?: number; search?: string }): Promise<VideoAuditHistoryResponse> {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.page) q.set('page', String(params.page));
  if (params?.search?.trim()) q.set('search', params.search.trim());
  const qs = q.toString();
  return request(`/video-audit/history${qs ? `?${qs}` : ''}`);
}

export function getVideoAuditHistoryItem(id: number): Promise<VideoAuditHistoryDetail> {
  return request(`/video-audit/history/${id}`);
}

export function findVideoAuditByVideo(videoId: string): Promise<{ id: number | null }> {
  return request(`/video-audit/history/by-video/${encodeURIComponent(videoId)}`);
}

export function deleteVideoAuditHistory(id: number): Promise<{ success: boolean }> {
  return request(`/video-audit/history/${id}`, { method: 'DELETE' });
}

export function renameVideoAuditHistory(id: number, name: string): Promise<{ id: number; name: string }> {
  return request(`/video-audit/history/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}