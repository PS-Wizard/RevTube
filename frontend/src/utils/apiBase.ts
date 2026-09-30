/**
 * Resolved origin for all `/api/*` backend calls.
 * - Relative `VITE_BACKEND_URL` (default `/api`): same origin, works with Vite dev proxy.
 * - Absolute URL: used as-is (production / Docker nginx, or direct backend in dev).
 */
export function getResolvedApiBaseUrl(): string {
  const raw = (import.meta.env.VITE_BACKEND_URL ?? '/api').trim();
  if (raw.startsWith('http://') || raw.startsWith('https://')) {
    return raw.replace(/\/$/, '');
  }
  const path = (raw.startsWith('/') ? raw : `/${raw}`).replace(/\/$/, '');
  return `${window.location.origin}${path}`;
}

/** Path is relative to the API mount, e.g. `/admin/config` or `/oauth/refresh`. */
export function apiUrl(apiPath: string): string {
  const base = getResolvedApiBaseUrl();
  const p = apiPath.startsWith('/') ? apiPath : `/${apiPath}`;
  return `${base}${p}`;
}
