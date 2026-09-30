import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';
import type { VideoAuditVideoResult } from '../types/videoAudit';

// Public Audit = the user-facing Video Audit engine fed by YouTube's *public*
// Data API endpoints (server key, no OAuth). Results therefore have the exact
// same shape as a Video Audit batch, so the report renders with the shared types.
export interface PublicAuditChannelSnapshot {
  title?: string;
  description?: string;
  avatarUrl?: string;
  customUrl?: string;
  handle?: string;
  country?: string;
  channelPublishedAt?: string | null;
  bannerUrl?: string;
  channelKeywords?: string;
  topics?: string[];
  statistics?: {
    subscriberCount?: string | null;
    viewCount?: string | null;
    videoCount?: string | null;
    hiddenSubscriberCount?: boolean;
  };
  auditedVideoIds?: string[];
  includeThumbnail?: boolean;
  includeCaptions?: boolean;
}

export interface PublicAuditVideoStats {
  viewCount?: string | null;
  likeCount?: string | null;
  commentCount?: string | null;
  favoriteCount?: string | null;
}

export interface PublicAuditChannelLifetime {
  auditedVideoCount: number;
  totalViewsAudited: number;
  totalLikesAudited: number;
  totalCommentsAudited: number;
  avgViewsPerVideo: number | null;
  engagementRatePct: number | null;
  oldestAuditedAt: string | null;
  newestAuditedAt: string | null;
  uploadCadenceDays: number | null;
  shortsCount: number;
  longformCount: number;
}

export interface PublicAuditPlaylist {
  playlistId: string;
  title: string;
  description?: string;
  publishedAt?: string | null;
  itemCount?: number | null;
  thumbnailUrl?: string;
}

/** One Full Audit category (each sums to 100 points). */
export interface PublicAuditCategoryScore {
  key: 'channel' | 'video' | 'playlist' | 'general';
  label: string;
  score: number;
  max: number;
  breakdown: { key: string; label: string; earned: number; max: number }[];
}

/** A channel-wide problem the Full Audit found, ranked by severity/count. */
export interface PublicAuditIssue {
  key: string;
  label: string;
  hint: string;
  severity: 'high' | 'medium';
  count: number;
  affected: { type: 'video' | 'channel' | 'playlist'; id: string | null; title: string; url: string | null }[];
}

/**
 * The Full Audit section: the SAME 4-category engine the Full Audit page uses,
 * fed with publicly available data only (no OAuth). Present on new reports and
 * on replayed history; `null` when scoring was unavailable at run time.
 *
 * `health` carries the per-item audits from the same deterministic engine
 * (zero extra quota — pure math over fetched data): per-playlist scores with
 * a top fix each, and per-field channel health. Absent on reports saved
 * before per-item audits shipped (UI degrades to aggregate-only).
 */
export interface PublicAuditPlaylistDimension {
  key: 'title' | 'description' | 'size' | string;
  label: string;
  /** 0-100 health for this dimension. */
  current: number;
}

export interface PublicAuditPlaylistRecommendation {
  dimension: 'title' | 'description' | 'size' | string;
  label: string;
  current: number;
  /** Fix target (100) and uplift if fixed — mirrors video recommendations. */
  projected: number;
  delta: number;
}

export interface PublicAuditPlaylistHealth {
  playlistId: string | null;
  title: string;
  size: number;
  /** 0-100 audit score for this playlist. */
  health: number;
  /** The weakest dimension's actionable fix. */
  hint: string;
  /** Per-dimension scores (title/description/size). Absent on old reports. */
  dimensions?: PublicAuditPlaylistDimension[];
  /** One fix per dimension below target, biggest uplift first. Absent on old reports. */
  recommendations?: PublicAuditPlaylistRecommendation[];
}

export interface PublicAuditChannelFieldHealth {
  value?: string;
  values?: string[];
  health: number;
  hint: string;
}

export interface PublicAuditChannelHealth {
  name: PublicAuditChannelFieldHealth;
  username: PublicAuditChannelFieldHealth;
  description: PublicAuditChannelFieldHealth;
  keywords: PublicAuditChannelFieldHealth;
}

export interface PublicAuditGeneralHealth {
  key: string;
  label: string;
  health: number;
  hint: string;
}

export interface PublicAuditFullAudit {
  overall: number;
  categories: PublicAuditCategoryScore[];
  issues: PublicAuditIssue[];
  health?: {
    channel: PublicAuditChannelHealth | null;
    playlists: PublicAuditPlaylistHealth[];
    general: PublicAuditGeneralHealth[];
  } | null;
  scoredVideos: number;
  source: 'public-data';
}

export interface PublicAuditReport {
  id: number;
  channelInput?: string;
  channelId: string;
  channelTitle: string;
  videoCount: number;
  overall: number | null;
  /** Video sub-audit score (mean of per-video totals), kept alongside `overall`. */
  videoAuditOverall?: number | null;
  fullAudit?: PublicAuditFullAudit | null;
  /** ISO timestamp emitted by the audit engine (batch `auditedAt`). */
  auditedAt?: string;
  snapshot?: PublicAuditChannelSnapshot;
  /** Aggregates computed from public data (persisted alongside results). */
  channelLifetime?: PublicAuditChannelLifetime | null;
  playlists?: PublicAuditPlaylist[];
  playlistCount?: number;
  results: (VideoAuditVideoResult & {
    statistics?: PublicAuditVideoStats;
    publishedAt?: string | null;
    durationLabel?: string;
    durationSeconds?: number | null;
    definition?: string;
    categoryId?: string;
    liveBroadcastContent?: string;
  })[];
  createdByEmail?: string | null;
  createdAt?: string;
}

export interface PublicAuditListItem {
  id: number;
  channelInput: string;
  channelId: string;
  channelTitle: string;
  videoCount: number;
  overall: number | null;
  createdByEmail: string | null;
  createdAt: string;
}

export interface PublicAuditListResponse {
  items: PublicAuditListItem[];
  total: number;
  page: number;
}

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getFirebaseAuthHeader()),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const errJson = await res.json().catch(() => null);
    const message =
      (errJson as { error?: { message?: string } } | null)?.error?.message ||
      `Request to ${path} failed (${res.status})`;
    throw new Error(message);
  }
  return res.json() as Promise<T>;
}

export function runPublicAudit(payload: {
  channelInput: string;
  maxVideos?: number;
  includeAllPlaylists?: boolean;
  includeThumbnail?: boolean;
  includeCaptions?: boolean;
}): Promise<PublicAuditReport> {
  return request('/admin/public-audits', { method: 'POST', body: JSON.stringify(payload) });
}

export interface PublicAuditEnqueueResponse {
  /** Present when the run was queued; poll `getPublicAuditJobStatus`. */
  jobId?: string;
  /** Present when the queue is disabled and the run completed inline. */
  direct?: boolean;
  id?: number;
  [key: string]: unknown;
}

export interface PublicAuditJobStatus {
  jobId: string;
  state: 'waiting' | 'active' | 'delayed' | 'completed' | 'failed' | string;
  progress: number;
  result?: PublicAuditReport;
  error?: string;
}

/** Enqueue a background public-audit job (preferred for large runs). */
export function enqueuePublicAudit(payload: {
  channelInput: string;
  maxVideos?: number;
  includeAllPlaylists?: boolean;
  includeThumbnail?: boolean;
  includeCaptions?: boolean;
}): Promise<PublicAuditEnqueueResponse> {
  return request('/admin/public-audits/jobs', { method: 'POST', body: JSON.stringify(payload) });
}

/** Poll a queued public-audit job. */
export function getPublicAuditJobStatus(jobId: string): Promise<PublicAuditJobStatus> {
  return request(`/admin/public-audits/jobs/${encodeURIComponent(jobId)}`);
}

export function listPublicAudits(params?: {
  limit?: number;
  page?: number;
  search?: string;
}): Promise<PublicAuditListResponse> {
  const q = new URLSearchParams();
  if (params?.limit) q.set('limit', String(params.limit));
  if (params?.page) q.set('page', String(params.page));
  if (params?.search) q.set('search', params.search);
  const suffix = q.toString() ? `?${q.toString()}` : '';
  return request(`/admin/public-audits${suffix}`);
}

export function getPublicAudit(id: number): Promise<PublicAuditReport> {
  return request(`/admin/public-audits/${id}`);
}

export function deletePublicAudit(id: number): Promise<{ success: boolean }> {
  return request(`/admin/public-audits/${id}`, { method: 'DELETE' });
}

/** Rename a saved report (updates its channel title in history). */
export function renamePublicAudit(id: number, name: string): Promise<{ id: number; channelTitle: string }> {
  return request(`/admin/public-audits/${id}`, { method: 'PATCH', body: JSON.stringify({ name }) });
}
