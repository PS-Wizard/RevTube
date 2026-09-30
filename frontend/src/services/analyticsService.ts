import { buildCacheKey, readCache, writeCache, clearAnalyticsCache } from './analyticsCache';
import { readJsonResponse } from '../utils/readJsonResponse';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';
import { devDebug } from '../utils/devLog';
import { useUsageStore } from '../stores/usageStore';
import { normalizeUsagePageKey } from '../utils/quotaScope';
import type { ChannelMetadata } from '../types/youtube';

/** Extract _usage metadata from any API JSON response and push it into the global
 *  usage store so the sidebar UsageBar updates in real-time. No-op if body has no _usage. */
export function tryExtractUsage(body: unknown, requestUrl?: string): void {
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const maybe = body as { _usage?: { pageKey: string; used: number; limit: number } };
    if (maybe._usage) {
      const pageKey = normalizeUsagePageKey(maybe._usage.pageKey, requestUrl);
      useUsageStore.getState().updateUsage(pageKey, maybe._usage.used, maybe._usage.limit);
    }
  }
}

export interface AnalyticsReport {
    kind: string;
    columnHeaders: Array<{
        name: string;
        dataType: string;
        columnType: string;
    }>;
    rows?: Array<Array<string>>;
}

/** Aggregate of all dimension breakdowns returned by `/dashboard/dimensions`. */
export type DimensionsBundle = {
    trafficSource: AnalyticsReport | null;
    gender: AnalyticsReport | null;
    ageGroup: AnalyticsReport | null;
    subscribedStatus: AnalyticsReport | null;
    country: AnalyticsReport | null;
    deviceType: AnalyticsReport | null;
};

/** Aggregated payload of `/dashboard/bundle`. */
export type DashboardBundle = {
    latestDate: string;
    current: AnalyticsReport | null;
    previous: AnalyticsReport | null;
    channelCurrent: AnalyticsReport | null;
    channelPrevious: AnalyticsReport | null;
    channelTotals: BundleChannelTotals | null;
    prevChannelTotals: BundleChannelTotals | null;
    d7: { current: Record<string, unknown>; previous: Record<string, unknown> };
    d30: { current: Record<string, unknown>; previous: Record<string, unknown> };
    d90: { current: Record<string, unknown>; previous: Record<string, unknown> };
    _usage?: { used: number; limit: number; pageKey: string };
};

export type DashboardSummaryResponse = {
    latestDate: string;
    d7: { current: Record<string, unknown>; previous: Record<string, unknown> };
    d30: { current: Record<string, unknown>; previous: Record<string, unknown> };
    d90: { current: Record<string, unknown>; previous: Record<string, unknown> };
};

export interface BundleChannelTotals {
    views: number;
    watch_time: number;
    subscribers_gained: number;
    subscribers_lost: number;
    likes: number;
    comments: number;
    shares: number;
}

export class UsageLimitError extends Error {
    public limit: number;
    public used: number;
    public pageKey: string;

    constructor(message: string, limit: number, used: number, pageKey: string, requestUrl?: string) {
        super(message);
        this.name = 'UsageLimitError';
        this.limit = limit;
        this.used = used;
        this.pageKey = normalizeUsagePageKey(pageKey, requestUrl);
        useUsageStore.getState().updateUsage(this.pageKey, used, limit);
    }
}

/** 30-second timeout wrapper for in-flight dedup promises.
 *  Without this, a hanging network request permanently leaks the map entry
 *  and all subsequent callers with the same key hang forever.
 */
function withInFlightTimeout<T>(
  map: Map<string, Promise<T>>,
  key: string,
  factory: () => Promise<T>,
  timeoutMs = 30_000
): Promise<T> {
  const existing = map.get(key);
  if (existing) return existing;

  const promise = Promise.race([
    factory(),
    new Promise<T>((_, reject) =>
      setTimeout(() => reject(new Error(`Analytics request timed out after ${timeoutMs}ms`)), timeoutMs)
    ),
  ]);

  map.set(key, promise);
  promise.finally(() => map.delete(key));
  return promise;
}

export class AnalyticsService {
    private baseUrl: string;
    private accessToken: string;
    private orgId: string | null;
    private static inFlightReports = new Map<string, Promise<AnalyticsReport>>();
    private static inFlightBundles = new Map<string, Promise<DashboardBundle>>();
    private static inFlightDimensions = new Map<string, Promise<DimensionsBundle>>();

    constructor(accessToken: string, _userEmail: string, orgId?: string | null) {
        this.baseUrl = getResolvedApiBaseUrl();
        this.accessToken = accessToken;
        this.orgId = orgId ?? null;
    }

    private perfEnabled(): boolean {
        try {
            return localStorage.getItem('revtube_perf') === '1';
        } catch {
            return false;
        }
    }

    private perfLog(label: string, startedAt: number, extra?: Record<string, unknown>): void {
        if (!this.perfEnabled()) return;
        const durationMs = Math.round(performance.now() - startedAt);
        if (extra) {
            console.log(`[Perf] ${label}: ${durationMs}ms`, extra);
        } else {
            console.log(`[Perf] ${label}: ${durationMs}ms`);
        }
    }

    private async getHeaders(): Promise<HeadersInit> {
        const headers: Record<string, string> = {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.accessToken}`,
            ...(await getFirebaseAuthHeader())
        };
        if (this.orgId) headers['X-Org-Id'] = this.orgId;
        return headers;
    }

    private normalizeFilters(filters?: string): string | undefined {
        if (!filters) return undefined;
        const trimmed = filters.trim();
        if (!trimmed) return undefined;
        const [lhs, rhs] = trimmed.split('==');
        if (!lhs || !rhs) return trimmed;
        const key = lhs.trim();
        if (key !== 'video' && key !== 'playlist') return trimmed;
        const normalizedIds = rhs
            .split(',')
            .map((id) => id.trim())
            .filter(Boolean)
            .sort();
        if (!normalizedIds.length) return undefined;
        return `${key}==${normalizedIds.join(',')}`;
    }

    async getReport(params: {
        startDate: string;
        endDate: string;
        metrics: string;
        dimensions?: string;
        sort?: string;
        maxResults?: number;
        filters?: string;
        ids?: string;
        /** Channel owning this report, forwarded so resolveOrgToken can swap in the org token. */
        channelId?: string;
        /**
         * Skip the client-side cache and hit the backend (which has its own
         * short TTL). Used for "source of truth" reads like the goal baseline,
         * where a stale 24h-old value is worse than one extra request.
         */
        bypassCache?: boolean;
    }): Promise<AnalyticsReport> {
        const totalStart = performance.now();
        // --- Cache check ---
        // Scope the key by workspace (org vs personal): the same channel+params
        // can return different data depending on whose token resolves it, so a
        // personal-mode response must never be served to an org-mode read.
        const normalizedFilters = this.normalizeFilters(params.filters);
        const cacheKey = buildCacheKey({
            scope: this.orgId ? `org:${this.orgId}` : 'personal',
            ids: params.ids || 'channel==MINE',
            startDate: params.startDate,
            endDate: params.endDate,
            metrics: params.metrics,
            dimensions: params.dimensions,
            sort: params.sort,
            filters: normalizedFilters,
            maxResults: params.maxResults,
        });

        const cached = params.bypassCache ? null : readCache<AnalyticsReport>(cacheKey);
        if (cached) {
            devDebug('[AnalyticsCache] HIT', cacheKey.slice(0, 80));
            this.perfLog('analytics.getReport.total', totalStart, { source: 'cache-hit', hasFilters: !!params.filters, dimensions: params.dimensions || null });
            return cached;
        }
        return withInFlightTimeout(AnalyticsService.inFlightReports, cacheKey, async () => {
        const url = `${this.baseUrl}/dashboard/report`;

        let attempt = 0;
        const maxAttempts = 3;

            while (attempt < maxAttempts) {
            try {
                const requestStart = performance.now();
                const response = await fetch(url, {
                    method: 'POST',
                    headers: await this.getHeaders(),
                    body: JSON.stringify({
                        ids: params.ids || 'channel==MINE',
                        startDate: params.startDate,
                        endDate: params.endDate,
                        metrics: params.metrics,
                        ...(params.channelId ? { channelId: params.channelId } : {}),
                        ...(params.dimensions ? { dimensions: params.dimensions } : {}),
                        ...(params.sort ? { sort: params.sort } : {}),
                        ...(params.maxResults ? { maxResults: params.maxResults } : {}),
                        ...(normalizedFilters ? { filters: normalizedFilters } : {}),
                    }),
                });
                this.perfLog('analytics.getReport.fetch', requestStart, { status: response.status, attempt: attempt + 1, dimensions: params.dimensions || null, hasFilters: !!params.filters });

                if (response.ok) {
                    const data = (await readJsonResponse(response, 'analytics.getReport')) as AnalyticsReport;
                    writeCache(cacheKey, data);
                    this.perfLog('analytics.getReport.total', totalStart, { source: 'network', dimensions: params.dimensions || null, hasFilters: !!params.filters });
                    return data;
                }

                const errorData = (await readJsonResponse(response, 'analytics.getReport')) as {
                    error?: { message?: string; code?: string; limit?: number; used?: number; pageKey?: string };
                };
                const status = response.status;

                // Handle 429 Usage Limit Exceeded
                if (status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
                    const e = errorData.error;
                    throw new UsageLimitError(
                        e.message || 'Usage limit exceeded',
                        e.limit ?? 0,
                        e.used ?? 0,
                        e.pageKey || 'dashboard'
                    );
                }

                // Retry on 500 (Internal Error) or 503 (Service Unavailable)
                if (attempt < maxAttempts - 1 && (status === 500 || status === 503)) {
                    console.warn(`YouTube Analytics API ${status} error. Retrying attempt ${attempt + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                    attempt++;
                    continue;
                }

                console.error('YouTube Analytics API Error Details:', errorData);
                throw new Error(
                    errorData.error?.message || `Failed to fetch analytics: ${response.status}`
                );

            } catch (error) {
                if (attempt < maxAttempts - 1 && error instanceof Error && error.message.includes('fetch')) {
                    // Network errors (fetch failed)
                    console.warn(`Network error during analytics fetch. Retrying attempt ${attempt + 1}...`);
                    await new Promise(resolve => setTimeout(resolve, 1000 * Math.pow(2, attempt)));
                    attempt++;
                    continue;
                }

                console.error('getReport caught error:', error);
                if (error instanceof Error) {
                    throw new Error(`Failed to get analytics report: ${error.message}`);
                }
                throw new Error('Failed to get analytics report: Unknown error');
            }
            }

            throw new Error('Max retries exceeded');
        });
    }

    /**
     * Get channel-wide CTR and impression metrics (NOT per-video)
     * NOTE: YouTube Analytics API does NOT support these metrics with dimensions=video.
     * This fetches aggregated channel-level data only.
     */
    async getChannelImpressionMetrics(startDate: string, endDate: string): Promise<AnalyticsReport> {
        return this.getReport({
            ids: 'channel==MINE',
            startDate,
            endDate,
            metrics: 'videoThumbnailImpressions'
        });
    }


    /**
     * Get retention metrics for videos
     */
    async getVideoRetentionMetrics(videoIds: string[], startDate: string, endDate: string): Promise<AnalyticsReport> {
        return this.getReport({
            ids: 'channel==MINE',
            startDate,
            endDate,
            metrics: 'averageViewPercentage,averageViewDuration',
            dimensions: 'video',
            filters: `video==${videoIds.join(',')}`
        });
    }

    /**
     * Helper to get daily views and subscribers for a channel
     */
    async getPerformanceOverview(channelId?: string, days: number = 30): Promise<AnalyticsReport> {
        const endDate = new Date().toISOString().split('T')[0];
        const startDateDate = new Date();
        startDateDate.setDate(startDateDate.getDate() - days);
        const startDate = startDateDate.toISOString().split('T')[0];

        return this.getReport({
            ids: channelId ? `channel==${channelId}` : 'channel==MINE',
            startDate,
            endDate,
            metrics: 'views,subscribersGained,estimatedMinutesWatched,averageViewDuration',
            dimensions: 'day',
            sort: 'day'
        });
    }

    /**
     * Fetch authorized channels for the user
     */
    async getAuthorizedChannels(): Promise<ChannelMetadata[]> {
        // We'll use the backend to proxy this since it handles the API keys
        const url = new URL(`${this.baseUrl}/channels/mine`);

        try {
            const response = await fetch(url.toString(), {
                headers: {
                    ...(await this.getHeaders()),
                    'Authorization': `Bearer ${this.accessToken}`
                }
            });

            if (!response.ok) {
                const errorData = (await readJsonResponse(response, 'analytics.getAuthorizedChannels')) as {
                    error?: { message?: string };
                };
                throw new Error(errorData.error?.message || `Failed to fetch channels: ${response.status}`);
            }

            const data = (await readJsonResponse(response, 'analytics.getAuthorizedChannels')) as { items?: ChannelMetadata[] };
            return data.items || [];
        } catch (error) {
            console.error('Error fetching authorized channels:', error);
            throw error;
        }
    }
    /**
     * Get the latest date for which YouTube has data available
     */
    async getLatestAvailableDate(channelId?: string): Promise<string> {
        const today = new Date();
        const endDate = today.toISOString().split('T')[0];

        const startDateDate = new Date();
        startDateDate.setDate(startDateDate.getDate() - 7);
        const startDate = startDateDate.toISOString().split('T')[0];

        try {
            const report = await this.getReport({
                ids: channelId ? `channel==${channelId}` : 'channel==MINE',
                startDate,
                endDate,
                metrics: 'views',
                dimensions: 'day',
                sort: '-day',
                maxResults: 1
            });

            if (report.rows && report.rows.length > 0) {
                return report.rows[0][0]; // Most recent day with views
            }
        } catch (err) {
            console.warn('Failed to fetch latest data date, defaulting to 2 days ago:', err);
        }

        // Default to 2 days ago if no data or error
        const defaultDate = new Date();
        defaultDate.setDate(defaultDate.getDate() - 2);
        return defaultDate.toISOString().split('T')[0];
    }


    /** Force-clear the cache so the next fetch always goes to the API */
    invalidateCache(): void {
        clearAnalyticsCache();
    }

    /**
     * Fetch all dimension breakdowns in one round-trip.
     * Returns traffic source, gender, age group, subscribed status, country, device type.
     */
    async getDimensionsBundle(params: {
        channelId: string;
        startDate: string;
        endDate: string;
        filters?: string;
    }): Promise<{
        trafficSource: AnalyticsReport | null;
        gender: AnalyticsReport | null;
        ageGroup: AnalyticsReport | null;
        subscribedStatus: AnalyticsReport | null;
        country: AnalyticsReport | null;
        deviceType: AnalyticsReport | null;
    }> {
        const totalStart = performance.now();
        // Video-scoped dims: key includes filters (traffic, subscribed, device, country)
        const normalizedFilters = this.normalizeFilters(params.filters);
        const videoCacheKey = 'dims_v4:' + buildCacheKey({ ...params, filters: normalizedFilters });
        // Channel-level dims: gender + ageGroup are NEVER video-specific per YT Analytics API
        const channelCacheKey = `dims_ch_v4:${params.channelId}:${params.startDate}:${params.endDate}`;

        const cachedVideo = readCache<DimensionsBundle>(videoCacheKey);
        const cachedChannel = readCache<DimensionsBundle>(channelCacheKey);

        // If we have both cached, merge and return immediately
        if (cachedVideo && cachedChannel) {
            this.perfLog('analytics.getDimensionsBundle.total', totalStart, { source: 'cache-hit', hasFilters: !!params.filters });
            return { ...cachedVideo, gender: cachedChannel.gender, ageGroup: cachedChannel.ageGroup };
        }
        const inFlightDimensionsKey = `${videoCacheKey}|${channelCacheKey}`;

        const data = await withInFlightTimeout(
            AnalyticsService.inFlightDimensions,
            inFlightDimensionsKey,
            async () => {
                const url = `${this.baseUrl}/dashboard/dimensions`;
                const requestStart = performance.now();
                const response = await fetch(url, {
                    method: 'POST',
                    headers: await this.getHeaders(),
                    body: JSON.stringify({ ...params, filters: normalizedFilters })
                });
                this.perfLog('analytics.getDimensionsBundle.fetch', requestStart, { status: response.status, hasFilters: !!params.filters });

                if (!response.ok) {
                    const err = (await readJsonResponse(response, 'analytics.getDimensionsBundle')) as { error?: { message?: string } };
                    throw new Error(err.error?.message || `Dimensions request failed: ${response.status}`);
                }

                return (await readJsonResponse(response, 'analytics.getDimensionsBundle')) as {
                    trafficSource: AnalyticsReport | null;
                    gender: AnalyticsReport | null;
                    ageGroup: AnalyticsReport | null;
                    subscribedStatus: AnalyticsReport | null;
                    country: AnalyticsReport | null;
                    deviceType: AnalyticsReport | null;
                };
            }
        );

        // Cache the video-scoped parts
        if (!cachedVideo) {
            writeCache(videoCacheKey, {
                trafficSource: data.trafficSource,
                subscribedStatus: data.subscribedStatus,
                country: data.country,
                deviceType: data.deviceType,
            });
        }

        // Cache gender/ageGroup separately (and only if they actually came back with data)
        if (!cachedChannel && (data.gender || data.ageGroup)) {
            writeCache(channelCacheKey, { gender: data.gender, ageGroup: data.ageGroup });
        }

        this.perfLog('analytics.getDimensionsBundle.total', totalStart, { source: 'network', hasFilters: !!params.filters });

        return data;
    }


    /**
     * Fetch all dashboard analytics in a single server-side bundled request.
     * The backend fans out all YouTube Analytics API calls in parallel and
     * returns everything: chart data (current + previous), channel metrics,
     * and 7d/30d/90d stat pill data.
     */
    async getDashboardBundle(params: {
        channelId: string;
        period?: number;
        startDate?: string;
        endDate?: string;
        compare: boolean;
        trueDelta: boolean;
        filters?: string;
        latestDate?: string;
        fields?: string[];
    }): Promise<DashboardBundle> {
        const totalStart = performance.now();
        const normalizedFilters = this.normalizeFilters(params.filters);
        const cacheKey = 'bundle:' + buildCacheKey({
            channelId: params.channelId,
            period: params.period,
            startDate: params.startDate ?? '',
            endDate: params.endDate ?? '',
            compare: params.compare,
            trueDelta: params.trueDelta,
            filters: normalizedFilters ?? '',
            latestDate: params.latestDate ?? ''
        });

        const cached = readCache<DashboardBundle>(cacheKey);
        if (cached) {
            devDebug('[AnalyticsCache] Bundle HIT');
            this.perfLog('analytics.getDashboardBundle.total', totalStart, { source: 'cache-hit', hasFilters: !!params.filters, period: params.period });
            return cached;
        }
        const data = await withInFlightTimeout(
            AnalyticsService.inFlightBundles,
            cacheKey,
            async () => {
                const url = `${this.baseUrl}/dashboard/bundle`;
                const requestStart = performance.now();
                const response = await fetch(url, {
                    method: 'POST',
                    headers: await this.getHeaders(),
                    body: JSON.stringify({ ...params, filters: normalizedFilters })
                });
                this.perfLog('analytics.getDashboardBundle.fetch', requestStart, { status: response.status, hasFilters: !!params.filters, period: params.period });

                if (!response.ok) {
                    const errData = (await readJsonResponse(response, 'analytics.getDashboardBundle')) as {
                        error?: { message?: string; code?: string; limit?: number; used?: number; pageKey?: string };
                    };
                    if (response.status === 429 && errData.error?.code === 'LIMIT_EXCEEDED') {
                        const e = errData.error;
                        throw new UsageLimitError(
                            e.message || 'Usage limit exceeded',
                            e.limit ?? 0,
                            e.used ?? 0,
                            e.pageKey || 'dashboard'
                        );
                    }
                    throw new Error(errData.error?.message || `Bundle request failed: ${response.status}`);
                }

                const result = (await readJsonResponse(response, 'analytics.getDashboardBundle')) as DashboardBundle;
                writeCache(cacheKey, result);
                return result;
            }
        );
        this.perfLog('analytics.getDashboardBundle.total', totalStart, { source: 'network', hasFilters: !!params.filters, period: params.period });
        return data;
    }

    /**
     * 7d / 30d / 90d pill stats + latestDate only. Call before getDashboardBundle so the UI can
     * paint numbers while charts load; backend reuses the same cache for the full bundle.
     */
    async getDashboardSummary(params: {
        channelId: string;
        period?: number;
        startDate?: string;
        endDate?: string;
        compare: boolean;
        trueDelta: boolean;
        filters?: string;
        latestDate?: string;
    }): Promise<DashboardSummaryResponse> {
        const totalStart = performance.now();
        const normalizedFilters = this.normalizeFilters(params.filters);
        const cacheKey =
            'summary:' +
            buildCacheKey({
                channelId: params.channelId,
                period: params.period,
                startDate: params.startDate ?? '',
                endDate: params.endDate ?? '',
                compare: params.compare,
                trueDelta: params.trueDelta,
                filters: normalizedFilters ?? '',
                latestDate: params.latestDate ?? '',
            });

        const cached = readCache<DashboardSummaryResponse>(cacheKey);
        if (cached) {
            this.perfLog('analytics.getDashboardSummary.total', totalStart, { source: 'cache-hit' });
            return cached;
        }

        const url = `${this.baseUrl}/dashboard/summary`;
        const response = await fetch(url, {
            method: 'POST',
            headers: await this.getHeaders(),
            body: JSON.stringify({ ...params, filters: normalizedFilters }),
        });

        if (!response.ok) {
            const errData = (await readJsonResponse(response, 'analytics.getDashboardSummary')) as {
                error?: { message?: string; code?: string; limit?: number; used?: number; pageKey?: string };
            };
            if (response.status === 429 && errData.error?.code === 'LIMIT_EXCEEDED') {
                const e = errData.error;
                throw new UsageLimitError(
                    e.message || 'Usage limit exceeded',
                    e.limit ?? 0,
                    e.used ?? 0,
                    e.pageKey || 'dashboard'
                );
            }
            throw new Error(errData.error?.message || `Summary request failed: ${response.status}`);
        }

        const data = (await readJsonResponse(response, 'analytics.getDashboardSummary')) as DashboardSummaryResponse;
        writeCache(cacheKey, data);
        this.perfLog('analytics.getDashboardSummary.total', totalStart, { source: 'network' });
        return data;
    }
}

