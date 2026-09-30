/**
 * Dashboard data is scoped to personal vs organization. All workspace-bound React Query
 * keys should start with [REVTUBE_DASHBOARD_WS_ROOT, workspaceKey, ...] so caches cannot
 * collide across contexts and removeQueries can wipe the previous workspace on switch.
 */

export const REVTUBE_DASHBOARD_WS_ROOT = 'revtube-dws' as const;

export function getDashboardWorkspaceKey(params: {
  userId: string | undefined;
  isPersonalContext: boolean;
  organizationId: string | undefined;
}): string | null {
  if (!params.userId) return null;
  if (params.isPersonalContext) return `personal:${params.userId}`;
  return `org:${params.organizationId ?? 'none'}`;
}

/** Placeholder segment when building keys before auth is ready (queries stay disabled). */
export const DASHBOARD_WS_KEY_PENDING = 'pending' as const;
