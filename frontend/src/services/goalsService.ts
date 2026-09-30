import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';
import type {
  Goal,
  GoalSummary,
  CreateGoalInput,
  UpdateGoalInput,
} from '../types/goals';

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
        `Goals API request failed (${res.status})`,
    );
  }
  return res.json() as Promise<T>;
}

export async function getGoals(
  channelId: string,
  organizationId?: string | null,
): Promise<Goal[]> {
  const q = new URLSearchParams({ channelId });
  if (organizationId) q.set('organizationId', organizationId);
  const data = await request<{ goals: Goal[] }>(`/goals?${q.toString()}`, undefined, organizationId);
  return data.goals;
}

export async function getGoal(
  id: number | string,
  organizationId?: string | null,
): Promise<Goal> {
  const data = await request<{ goal: Goal }>(`/goals/${id}`, undefined, organizationId);
  return data.goal;
}

export async function getGoalsSummary(
  channelId: string,
  organizationId?: string | null,
): Promise<GoalSummary> {
  const q = new URLSearchParams({ channelId });
  if (organizationId) q.set('organizationId', organizationId);
  return request<GoalSummary>(`/goals/summary?${q.toString()}`, undefined, organizationId);
}

export async function createGoal(
  input: CreateGoalInput,
  orgId?: string | null,
): Promise<Goal> {
  const data = await request<{ goal: Goal }>(
    '/goals',
    { method: 'POST', body: JSON.stringify(input) },
    orgId,
  );
  return data.goal;
}

export async function updateGoal(
  id: number,
  input: UpdateGoalInput,
  orgId?: string | null,
): Promise<Goal> {
  const data = await request<{ goal: Goal }>(
    `/goals/${id}`,
    { method: 'PUT', body: JSON.stringify(input) },
    orgId,
  );
  return data.goal;
}

export async function deleteGoal(
  id: number,
  orgId?: string | null,
): Promise<void> {
  await request<{ success: boolean }>(
    `/goals/${id}`,
    { method: 'DELETE' },
    orgId,
  );
}
