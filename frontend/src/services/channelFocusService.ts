import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';

export interface ChannelFocus {
  id?: number;
  channelId: string;
  organizationId: string | null;
  niche: string;
  audience: string;
  contentPillars: string[];
  tone: string;
  goalsNotes: string;
  source: 'ai' | 'manual' | 'heuristic';
  /** What channel data grounded the draft: saved analytics, live audit, or basic info. */
  dataSource?: 'db' | 'live' | 'snapshot';
  createdBy?: string;
  updatedAt?: string;
}

export interface ChannelFocusInput {
  channelId: string;
  organizationId?: string | null;
  niche?: string | null;
  audience?: string | null;
  contentPillars?: string[];
  tone?: string | null;
  goalsNotes?: string | null;
  source?: 'ai' | 'manual';
  aiSnapshot?: Record<string, unknown>;
}

export interface ChannelSnapshot {
  title?: string;
  channelTitle?: string;
  description?: string;
  tags?: string[];
  stats?: Record<string, number | string>;
  topVideos?: Array<{ title?: string; viewCount?: number | string; tags?: string[] }>;
}

async function request<T = unknown>(
  path: string,
  init?: RequestInit,
  orgId?: string | null,
): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getFirebaseAuthHeader()),
      ...(orgId ? { 'X-Org-Id': orgId } : {}),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) {
    const errBody = await res.json().catch(() => ({}));
    throw new Error(
      (errBody as { error?: { message?: string } })?.error?.message ??
        `Channel Focus API request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

export async function getChannelFocus(
  channelId: string,
  organizationId?: string | null,
): Promise<ChannelFocus | null> {
  const q = new URLSearchParams({ channelId });
  if (organizationId) q.set('organizationId', organizationId);
  const data = await request<{ focus: ChannelFocus | null }>(
    `/channel-focus?${q.toString()}`,
    undefined,
    organizationId,
  );
  return data.focus;
}

export async function saveChannelFocus(
  input: ChannelFocusInput,
  orgId?: string | null,
): Promise<ChannelFocus> {
  const data = await request<{ focus: ChannelFocus }>(
    '/channel-focus',
    { method: 'PUT', body: JSON.stringify(input) },
    orgId ?? input.organizationId ?? null,
  );
  return data.focus;
}

export async function generateChannelFocus(
  channelId: string,
  channelSnapshot: ChannelSnapshot,
  organizationId?: string | null,
): Promise<ChannelFocus> {
  const data = await request<{ generated: ChannelFocus }>(
    '/channel-focus/generate',
    { method: 'POST', body: JSON.stringify({ channelId, organizationId: organizationId ?? null, channelSnapshot }) },
    organizationId,
  );
  return data.generated;
}
