/**
 * analyticsCache.ts
 *
 * Two-layer cache for YouTube Analytics API responses:
 *   1. In-memory Map  -- instant (survives re-renders, lost on full page reload)
 *   2. sessionStorage  -- survives soft navigation / HMR, cleared on tab close
 *
 * TTL: 1 hour. YouTube Analytics data itself lags 24-72h and the backend
 * caches reports for 6h, so refetching more often just burns YouTube quota +
 * monthly usage for byte-identical payloads. After expiry, the live API is
 * called and the result re-cached.
 */

const TTL_MS = 60 * 60 * 1000; // 1 hour
const STORAGE_PREFIX = 'yt_analytics_cache:';

interface CacheEntry<T> {
    data: T;
    expiresAt: number;
}

// In-memory layer (fastest)
const memCache = new Map<string, CacheEntry<unknown>>();

/** Build a stable cache key from arbitrary report params */
export function buildCacheKey(params: Record<string, string | number | boolean | undefined>): string {
    return Object.entries(params)
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([k, v]) => `${k}=${v}`)
        .join('&');
}

/** Read from cache (memory first, then sessionStorage). Returns null on miss or expiry. */
export function readCache<T>(key: string): T | null {
    // 1. Memory cache
    const mem = memCache.get(key) as CacheEntry<T> | undefined;
    if (mem) {
        if (Date.now() < mem.expiresAt) return mem.data;
        memCache.delete(key);
    }

    // 2. sessionStorage cache
    try {
        const raw = sessionStorage.getItem(STORAGE_PREFIX + key);
        if (raw) {
            const entry: CacheEntry<T> = JSON.parse(raw);
            if (Date.now() < entry.expiresAt) {
                // Warm the memory layer
                memCache.set(key, entry);
                return entry.data;
            }
            sessionStorage.removeItem(STORAGE_PREFIX + key);
        }
    } catch {
        try {
            sessionStorage.removeItem(STORAGE_PREFIX + key);
        } catch {
            /* ignore */
        }
    }

    return null;
}

/** Write to both cache layers. `ttlMs` overrides the default 24h TTL. */
export function writeCache<T>(key: string, data: T, ttlMs: number = TTL_MS): void {
    const entry: CacheEntry<T> = { data, expiresAt: Date.now() + ttlMs };

    // Memory layer
    memCache.set(key, entry as CacheEntry<unknown>);

    // sessionStorage layer
    try {
        sessionStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(entry));
    } catch {
        // Quota exceeded or unavailable -- memory layer still works
    }
}

/** Invalidate all cached entries (e.g. on forced refresh). */
export function clearAnalyticsCache(): void {
    memCache.clear();
    try {
        Object.keys(sessionStorage)
            .filter(k => k.startsWith(STORAGE_PREFIX))
            .forEach(k => sessionStorage.removeItem(k));
    } catch { /* ignore */ }
}
