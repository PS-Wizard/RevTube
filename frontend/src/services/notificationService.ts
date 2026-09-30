import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';
import type { GetNotificationsResponse } from '../types/notification';

async function request<T = unknown>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(apiUrl(path), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(await getFirebaseAuthHeader()),
      ...(init?.headers ?? {}),
    },
  });
  if (!res.ok) throw new Error(`Request to ${path} failed (${res.status})`);
  return res.json() as Promise<T>;
}

export function getNotifications(): Promise<GetNotificationsResponse> {
  return request<GetNotificationsResponse>('/notifications');
}

export function markRead(id: string): Promise<{ success: boolean }> {
  return request(`/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH' });
}

export function markAllRead(): Promise<{ success: boolean }> {
  return request('/notifications/read-all', { method: 'PATCH' });
}
