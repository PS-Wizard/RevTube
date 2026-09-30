import type { YouTubeApiResponse, VideoMetadata, VideoDetailsResponse, PlaylistMetadata, PlaylistsApiResponse, ChannelApiResponse, ChannelMetadata } from '../types/youtube';
import { UsageLimitError, tryExtractUsage } from './analyticsService';
import { readCache, writeCache } from './analyticsCache';
import { readJsonResponse } from '../utils/readJsonResponse';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';

interface ChannelResponse {
  items: Array<{
    id: string;
    contentDetails: {
      relatedPlaylists: {
        uploads: string;
      };
    };
  }>;
}

/** A single server-paginated page of the dashboard video catalog. */
export interface DashboardVideoPage {
  items: VideoMetadata[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
  /** 1-based page from the backend envelope (absent on legacy responses). */
  currentPage?: number;
  /** Total pages from the backend envelope (absent on legacy responses). */
  totalPages?: number;
}

/** A single server-paginated page of the playlist catalog (mirrors DashboardVideoPage). */
export interface DashboardPlaylistPage {
  items: PlaylistMetadata[];
  total: number;
  hasMore: boolean;
  offset: number;
  limit: number;
  /** 1-based page from the backend envelope (absent on legacy responses). */
  currentPage?: number;
  /** Total pages from the backend envelope (absent on legacy responses). */
  totalPages?: number;
  /** True when the private-inclusive page failed/came back empty and public
   *  rows were substituted -- the table must label this, never silently show
   *  a subset as the whole catalog. */
  partial?: boolean;
  /** Why the page is partial (human-readable, for the UI notice). */
  partialError?: string;
}

/**
 * Next offset for infinite catalog queries (videos + playlists).
 *
 * An empty page -- or hasMore=false -- ends pagination. Without the empty
 * stop, a stale-high backend total keeps hasMore=true past the rows that
 * actually exist and the client refetches the same phantom empty page
 * forever ("loading" that never completes).
 */
export function resolveNextOffsetParam(
  lastPage: { offset: number; items: unknown[]; hasMore: boolean },
): number | undefined {
  if (!lastPage.hasMore || lastPage.items.length === 0) return undefined;
  return lastPage.offset + lastPage.items.length;
}

/** Map one YouTube playlists.list resource onto PlaylistMetadata (shared by all playlist fetches). */
function mapPlaylistItem(item: PlaylistsApiResponse['items'][number]): PlaylistMetadata {
  const description = item.snippet.description || '';
  const hashtags = description.match(/#[\w֐-׿]+/g)?.map(t => t.slice(1)) || [];
  const apiTags = item.snippet.tags || [];
  const combinedTags = Array.from(new Set([...apiTags, ...hashtags]));

  return {
    id: item.id,
    title: item.snippet.title,
    description: item.snippet.description,
    thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
    // The Postgres tier may omit the size (null) where the live API always
    // reports it -- coerce at this single boundary so every table/sort/CSV
    // consumer keeps its plain `number` contract.
    itemCount: item.contentDetails.itemCount ?? 0,
    channelTitle: item.snippet.channelTitle,
    publishedAt: item.snippet.publishedAt,
    keywords: combinedTags,
    privacyStatus: (item as unknown as { status?: { privacyStatus?: string } }).status?.privacyStatus,
  };
}

/** Raw playlist page envelope shared by POST /dashboard/playlists and GET /playlists/:channelId. */
interface PlaylistPageEnvelope {
  status?: number;
  message?: string;
  playlists?: PlaylistsApiResponse['items'];
  items?: PlaylistsApiResponse['items'];
  catalogTotal?: number;
  pageInfo?: { totalResults?: number; resultsPerPage?: number };
  nextPageToken?: string;
  pagination?: { totaldata?: number; currentpage?: number; perpageitem?: number; totalpages?: number; hasMore?: boolean };
}

/**
 * Parse one playlist page envelope into a DashboardPlaylistPage.
 *
 * New envelope: { playlists/items, pagination: { totaldata, currentpage,
 * perpageitem, totalpages, hasMore }, catalogTotal }. Legacy fallback:
 * YouTube-shaped { items, pageInfo, nextPageToken, catalogTotal } (single
 * token window, pre-paged backend). The paged backend merges owner-only rows
 * once server-side, so no client-side dedupe is needed.
 */
function parsePlaylistPageResponse(
  raw: unknown,
  opts: { perPage: number; page: number; fallbackOffset: number },
): DashboardPlaylistPage {
  const obj = raw as PlaylistPageEnvelope;
  const rows = Array.isArray(obj.playlists) ? obj.playlists
    : Array.isArray(obj.items) ? obj.items : [];
  if (obj.pagination) {
    const p = obj.pagination;
    const resolvedPerPage = typeof p.perpageitem === 'number' && p.perpageitem > 0 ? p.perpageitem : opts.perPage;
    const resolvedPage = typeof p.currentpage === 'number' && p.currentpage >= 1 ? Math.floor(p.currentpage) : opts.page;
    return {
      items: rows.map(mapPlaylistItem),
      total: typeof p.totaldata === 'number' ? p.totaldata
        : typeof obj.catalogTotal === 'number' ? obj.catalogTotal : rows.length,
      hasMore: p.hasMore ?? false,
      offset: (resolvedPage - 1) * resolvedPerPage,
      limit: resolvedPerPage,
      currentPage: resolvedPage,
      totalPages: typeof p.totalpages === 'number' ? p.totalpages : undefined,
    };
  }
  return {
    items: rows.map(mapPlaylistItem),
    total: typeof obj.catalogTotal === 'number' ? obj.catalogTotal
      : typeof obj.pageInfo?.totalResults === 'number' ? obj.pageInfo.totalResults : rows.length,
    hasMore: obj.nextPageToken != null,
    offset: opts.fallbackOffset,
    limit: opts.perPage,
  };
}

/** Picker video lists (browse dialog) live for only this long client-side. */
const PICKER_CACHE_TTL_MS = 60 * 1000;

export class YouTubeService {
  private baseUrl: string;
  private accessToken: string | null;
  private orgId: string | null;

  constructor(_userEmail: string = '', accessToken: string | null = null, orgId: string | null = null) {
    this.baseUrl = getResolvedApiBaseUrl();
    this.accessToken = accessToken;
    this.orgId = orgId;
  }

  private async getHeaders(): Promise<HeadersInit> {
    const headers: HeadersInit = {
      'Content-Type': 'application/json',
      ...(await getFirebaseAuthHeader())
    };

    if (this.accessToken) {
      (headers as any)['Authorization'] = `Bearer ${this.accessToken}`;
    }

    if (this.orgId) {
      (headers as any)['X-Org-Id'] = this.orgId;
    }

    return headers;
  }

  /** Headers for background ID-resolution calls (handle → uploads playlist).
   *  Identical to getHeaders() -- previously sent X-Usage-Context: resolve but
   *  the header is no longer read by the backend. Resolve-scope is determined
   *  server-side by route middleware (markResolveScope). */
  private async getResolveHeaders(): Promise<HeadersInit> {
    return this.getHeaders();
  }

  async getChannelByUsername(username: string): Promise<string> {
    const url = new URL(`${this.baseUrl}/channel/username/${encodeURIComponent(username)}`);

    try {
      const response = await fetch(url.toString(), { headers: await this.getResolveHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429) {
          if (errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey || 'channel'
            );
          }
          if (errorData.error?.code === 'RATE_LIMITED') {
            const retryAfter = errorData.error.retryAfterSeconds
              ? ` Please retry in ${errorData.error.retryAfterSeconds}s.`
              : '';
            throw new Error(`Channel lookup rate limit reached.${retryAfter}`);
          }
        }
        throw new Error(
          errorData.error?.message || `Failed to fetch channel: ${response.status}`
        );
      }

      const data: ChannelResponse = await response.json();

      if (!data.items || data.items.length === 0) {
        throw new Error(`Channel not found for username: ${username}`);
      }

      return data.items[0].contentDetails.relatedPlaylists.uploads;
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      if (error instanceof Error) {
        throw new Error(`Failed to get channel: ${error.message}`);
      }
      throw new Error('Failed to get channel: Unknown error');
    }
  }

  async getChannelById(channelId: string): Promise<string> {
    const cacheKey = `yt:uploadsId:${channelId}`;
    const cached = readCache<string>(cacheKey);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl}/channel/id/${encodeURIComponent(channelId)}`);

    try {
      const response = await fetch(url.toString(), { headers: await this.getResolveHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429) {
          if (errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey || 'channel'
            );
          }
          if (errorData.error?.code === 'RATE_LIMITED') {
            const retryAfter = errorData.error.retryAfterSeconds
              ? ` Please retry in ${errorData.error.retryAfterSeconds}s.`
              : '';
            throw new Error(`Channel lookup rate limit reached.${retryAfter}`);
          }
        }
        throw new Error(
          errorData.error?.message || `Failed to fetch channel: ${response.status}`
        );
      }

      const data: ChannelResponse = await response.json();

      if (!data.items || data.items.length === 0) {
        throw new Error(`Channel not found for ID: ${channelId}`);
      }

      const uploadsId = data.items[0].contentDetails.relatedPlaylists.uploads;
      writeCache(cacheKey, uploadsId);
      return uploadsId;
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      if (error instanceof Error) {
        throw new Error(`Failed to get channel: ${error.message}`);
      }
      throw new Error('Failed to get channel: Unknown error');
    }
  }

  async getUploadsPlaylistFromHandle(handle: string): Promise<string> {
    // Strip leading @ -- YouTube's forHandle expects the raw handle
    const cleanHandle = handle.startsWith('@') ? handle.slice(1) : handle;
    // Use URL object to handle encoding correctly
    const url = new URL(`${this.baseUrl}/channel/handle/${encodeURIComponent(cleanHandle)}`);

    try {
      const response = await fetch(url.toString(), { headers: await this.getResolveHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        // Handle 429 Usage Limit Exceeded
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(
          errorData.error?.message || `Failed to fetch channel: ${response.status}`
        );
      }

      const data: ChannelResponse = await response.json();

      if (!data.items || data.items.length === 0) {
        throw new Error(`Channel not found for handle: ${handle}`);
      }

      return data.items[0].contentDetails.relatedPlaylists.uploads;
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      if (error instanceof Error) {
        throw new Error(`Failed to get channel: ${error.message}`);
      }
      throw new Error('Failed to get channel: Unknown error');
    }
  }

  /**
   * Fetch full channel details (needs snippet, statistics, brandingSettings, contentDetails)
   * It attempts to resolve handle, then username, then channel ID.
   * Uses standard headers so channel lookups count against the user's monthly quota.
   */
  async getFullChannelDetails(input: string): Promise<ChannelMetadata | null> {
    let cleanInput = input.trim();

    // 1. Try as handle -- strip @, YouTube API forHandle expects the raw handle
    const handle = cleanInput.startsWith('@') ? cleanInput.slice(1) : cleanInput;
    const handleUrl = new URL(`${this.baseUrl}/channel/handle/${encodeURIComponent(handle)}`);

    try {
      const handleResponse = await fetch(handleUrl.toString(), { headers: await this.getHeaders() });
      if (handleResponse.ok) {
        const handleData: ChannelApiResponse & { _usage?: unknown } = await handleResponse.json();
        tryExtractUsage(handleData);
        if (handleData.items && handleData.items.length > 0) {
          return handleData.items[0];
        }
      } else if (handleResponse.status === 429) {
        const errorData = await handleResponse.json();
        if (errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey || 'channel'
          );
        }
        if (errorData.error?.code === 'RATE_LIMITED') {
          const retryAfter = errorData.error.retryAfterSeconds
            ? ` Please retry in ${errorData.error.retryAfterSeconds}s.`
            : '';
          throw new Error(`Channel lookup rate limit reached.${retryAfter}`);
        }
      }
      // If handle endpoint returned 403 (premium required) or any non-ok status,
      // skip the username/ID fallbacks -- they will hit the same gate.
      if (!handleResponse.ok && handleResponse.status !== 404) return null;
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      console.warn("Failed to fetch by handle", e);
    }

    // 2. Try as username (only when handle endpoint returned 404 not found)
    const usernameUrl = new URL(`${this.baseUrl}/channel/username/${encodeURIComponent(cleanInput.replace('@', ''))}`);
    try {
      const usernameResponse = await fetch(usernameUrl.toString(), { headers: await this.getHeaders() });
      if (usernameResponse.ok) {
        const usernameData: ChannelApiResponse & { _usage?: unknown } = await usernameResponse.json();
        tryExtractUsage(usernameData);
        if (usernameData.items && usernameData.items.length > 0) {
          return usernameData.items[0];
        }
      } else if (usernameResponse.status === 429) {
        const errorData = await usernameResponse.json();
        if (errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey || 'channel'
          );
        }
        if (errorData.error?.code === 'RATE_LIMITED') {
          const retryAfter = errorData.error.retryAfterSeconds
            ? ` Please retry in ${errorData.error.retryAfterSeconds}s.`
            : '';
          throw new Error(`Channel lookup rate limit reached.${retryAfter}`);
        }
      }
      if (!usernameResponse.ok && usernameResponse.status !== 404) return null;
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      console.warn("Failed to fetch by username", e);
    }

    // 3. Try as channel ID (only when handle and username returned 404 not found)
    const idUrl = new URL(`${this.baseUrl}/channel/id/${encodeURIComponent(cleanInput)}`);
    try {
      const idResponse = await fetch(idUrl.toString(), { headers: await this.getHeaders() });
      if (idResponse.ok) {
        const idData: ChannelApiResponse & { _usage?: unknown } = await idResponse.json();
        tryExtractUsage(idData);
        if (idData.items && idData.items.length > 0) {
          return idData.items[0];
        }
      } else if (idResponse.status === 429) {
        const errorData = await idResponse.json();
        if (errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
      }
    } catch (e) {
      if (e instanceof UsageLimitError) throw e;
      console.warn("Failed to fetch by ID", e);
    }

    throw new Error(`Channel not found for input: ${input}`);
  }

  /**
   * Fetch full channel details + optional trailer video in a single API call.
   * Uses ?includeTrailer=true on the handle endpoint to bundle the trailer video
   * data so the frontend only makes one roundtrip.
   */
  async getChannelWithTrailer(input: string): Promise<{
    channel: ChannelMetadata;
    trailerVideo: VideoMetadata | null;
  }> {
    const cleanInput = input.trim();
    const isId = cleanInput.startsWith('UC') && cleanInput.length === 24;
    const isHandle = cleanInput.startsWith('@');
    const handle = isHandle ? cleanInput.slice(1) : cleanInput;

    const endpointsToTry: string[] = isId
      ? [
          `${this.baseUrl}/channel/id/${encodeURIComponent(cleanInput)}?includeTrailer=true`,
          `${this.baseUrl}/channel/handle/${encodeURIComponent(handle)}?includeTrailer=true`,
        ]
      : [
          `${this.baseUrl}/channel/handle/${encodeURIComponent(handle)}?includeTrailer=true`,
          `${this.baseUrl}/channel/username/${encodeURIComponent(cleanInput)}?includeTrailer=true`,
          `${this.baseUrl}/channel/id/${encodeURIComponent(cleanInput)}?includeTrailer=true`,
        ];

    let lastError: Error | null = null;

    for (const urlStr of endpointsToTry) {
      try {
        const response = await fetch(urlStr, { headers: await this.getHeaders() });

        if (!response.ok) {
          if (response.status === 429) {
            const errorData = await response.json();
            if (errorData.error?.code === 'LIMIT_EXCEEDED') {
              throw new UsageLimitError(
                errorData.error.message,
                errorData.error.limit,
                errorData.error.used,
                errorData.error.pageKey || 'channel'
              );
            }
            if (errorData.error?.code === 'RATE_LIMITED') {
              const retryAfter = errorData.error.retryAfterSeconds
                ? ` Please retry in ${errorData.error.retryAfterSeconds}s.`
                : '';
              throw new Error(`Channel lookup rate limit reached.${retryAfter}`);
            }
          }
          if (response.status === 404) {
            continue; // try next endpoint
          }
          const errorData = await response.json().catch(() => ({ error: { message: `Request failed with status ${response.status}` } }));
          lastError = new Error(errorData.error?.message || `Failed to fetch channel: ${response.status}`);
          continue;
        }

        const data = await response.json();

        // Handle both { channel: ..., trailerVideo: ... } and direct { items: [...] }
        const channelItems = data.channel?.items || data.items;
        if (!channelItems || !channelItems.length) {
          continue; // try next endpoint
        }

        const channel: ChannelMetadata = channelItems[0];
        tryExtractUsage(data.channel || data);

        // Parse trailer video if present
        let trailerVideo: VideoMetadata | null = null;
        if (data.trailerVideo?.items?.length) {
          const item = data.trailerVideo.items[0];
          trailerVideo = {
            videoId: item.id,
            title: item.snippet.title,
            publishedAt: item.snippet.publishedAt,
            channelTitle: item.snippet.channelTitle,
            description: item.snippet.description,
            thumbnailUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || '',
            viewCount: parseInt(item.statistics?.viewCount || '0', 10),
            likeCount: parseInt(item.statistics?.likeCount || '0', 10),
            commentCount: parseInt(item.statistics?.commentCount || '0', 10),
            duration: item.contentDetails?.duration,
            tags: item.snippet?.tags,
          };
        }

        return { channel, trailerVideo };
      } catch (e) {
        if (e instanceof UsageLimitError) throw e;
        lastError = e instanceof Error ? e : new Error(String(e));
      }
    }

    if (lastError && !lastError.message.includes('404')) {
      throw lastError;
    }
    throw new Error(`Channel not found for input: ${input}`);
  }

  /**
   * Fetch all videos for a compare operation from the backend.
   *
   * Delegates to POST /api/compare/videos, which paginates through the
   * uploads playlist, enriches with statistics, and caches server-side
   * (1-hour TTL).  Returns the already-filtered video list.
   *
   * @param playlistId - YouTube uploads playlist ID (UU...)
   * @param startDate  - optional ISO date for earliest publish cutoff
   * @param endDate    - optional ISO date for latest publish cutoff
   */
  async fetchCompareVideos(
    playlistId: string,
    startDate?: string | null,
    endDate?: string | null,
  ): Promise<{
    videos: VideoMetadata[];
    channelTitle: string | null;
    metrics: {
      totalVideos: number;
      totalViews: number;
      totalLikes: number;
      totalComments: number;
      avgViewsPerVideo: number;
      avgLikesPerVideo: number;
      avgCommentsPerVideo: number;
      avgLikesPerView: number;
    } | null;
  }> {
    const url = `${this.baseUrl}/compare/videos`;
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(await this.getHeaders()) },
      body: JSON.stringify({ playlistId, startDate, endDate }),
    });

    if (!response.ok) {
      if (response.status === 429) {
        const errorData = await response.json();
        if (errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey || 'compare'
          );
        }
      }
      const errorData = await response.json().catch(() => ({ error: { message: `Request failed with status ${response.status}` } }));
      throw new Error(errorData.error?.message || `Failed to compare videos: ${response.status}`);
    }

    const data = await response.json();
    tryExtractUsage(data);
    return { videos: data.videos || [], channelTitle: data.channelTitle || null, metrics: data.metrics || null };
  }

  /**
   * Fetch all playlists from a channel.
   * 
   * @param channelId - The YouTube channel ID
   */
  async fetchChannelPlaylists(channelId: string, limit?: number, includePrivate?: boolean): Promise<PlaylistMetadata[]> {
    const allPlaylists: PlaylistMetadata[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const remaining = limit ? limit - allPlaylists.length : 50;
      if (limit && remaining <= 0) break;

      const url = new URL(`${this.baseUrl}/playlists/${encodeURIComponent(channelId)}`);
      url.searchParams.append('maxResults', Math.min(remaining, 50).toString());
      if (includePrivate) {
        url.searchParams.append('includePrivate', '1');
      }
      if (pageToken) {
        url.searchParams.append('pageToken', pageToken);
      }

      try {
        const response = await fetch(url.toString(), { headers: await this.getHeaders() });

        if (!response.ok) {
          const errorData = await response.json();
          // Handle 429 Usage Limit Exceeded
          if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey
            );
          }
          throw new Error(
            errorData.error?.message || `Failed to fetch playlists: ${response.status}`
          );
        }

        const data: PlaylistsApiResponse = await response.json();
        tryExtractUsage(data);

        allPlaylists.push(...data.items.map(mapPlaylistItem));
        pageToken = data.nextPageToken;

      } catch (error) {
        if (error instanceof Error) {
          throw new Error(`Failed to fetch playlists: ${error.message}`);
        }
        throw new Error('Failed to fetch playlists: Unknown error');
      }
    } while (pageToken);

    return allPlaylists;
  }

  /**
   * Dashboard-scoped playlist page fetch -- uses the /dashboard/playlists endpoint
   * which is server-locked to the "dashboard" usage key (collective quota).
   *
   * Returns a single page (server-side pagination) so large catalogs are
   * loaded incrementally instead of all at once. `limit` is the page size,
   * `offset` skips already-loaded rows. The backend envelope carries the true
   * catalog total on the first page (`pagination.totaldata`), so callers know
   * the full count upfront. `hasMore` tells the caller whether a next page exists.
   */
  async fetchDashboardChannelPlaylists(
    channelId: string,
    limit?: number,
    includePrivate?: boolean,
    offset = 0,
  ): Promise<DashboardPlaylistPage> {
    const perPage = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 50;
    const safeOffset = offset >= 0 ? Math.floor(offset) : 0;
    const page = Math.floor(safeOffset / perPage) + 1;
    const privacyKey = includePrivate ? 'p1' : 'p0';
    // v2: pre-fallback builds cached successful-but-empty inclusive pages,
    // which then triggered the fallback + warning on every load. The bump
    // drops those poisoned entries; they expire naturally otherwise.
    const cacheKey = `yt:dashboard:playlists:v2:${channelId}:${perPage}:p${page}:${privacyKey}`;
    const cached = readCache<DashboardPlaylistPage>(cacheKey);
    if (cached) return cached;

    const fetchPage = async (asPrivate: boolean): Promise<DashboardPlaylistPage> => {
      const response = await fetch(`${this.baseUrl}/dashboard/playlists`, {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({
          channelId,
          // New-style page params (preferred); legacy offset params kept so an
          // older backend still answers correctly during rollout.
          page,
          perPage,
          maxResults: limit,
          offset,
          includePrivate: asPrivate || undefined,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(
          errorData.error?.message || `Failed to fetch dashboard playlists: ${response.status}`
        );
      }

      const raw: unknown = await response.json();
      tryExtractUsage(raw);
      return parsePlaylistPageResponse(raw, { perPage, page, fallbackOffset: safeOffset });
    };

    // Public-only: straight fetch, errors propagate as today.
    if (!includePrivate) {
      try {
        const pageResult = await fetchPage(false);
        writeCache(cacheKey, pageResult);
        return pageResult;
      } catch (error) {
        if (error instanceof UsageLimitError) throw error;
        throw new Error(`Failed to fetch dashboard playlists: ${(error as Error).message}`);
      }
    }

    // Private-inclusive: public rows are a strict subset of this catalog, so a
    // failed or empty inclusive page falls back to the public page (tagged
    // partial) instead of blanking a table that has real rows to show.
    // The fallback is deliberately NOT client-cached: the next mount retries
    // the inclusive leg instead of pinning the subset.
    try {
      const pageResult = await fetchPage(true);
      if (pageResult.items.length === 0 && safeOffset === 0) {
        // Answered empty while public rows are expected: always a bogus
        // upstream state (stale cache, mixed-version backend), never proof of
        // missing rows -- substitute silently, note it in the console only.
        console.info('[Playlists] Inclusive page came back empty; serving public subset.');
        try {
          const publicResult = await fetchPage(false);
          if (publicResult.items.length === 0) return publicResult;
          return { ...publicResult, partial: true };
        } catch {
          return pageResult;
        }
      }
      writeCache(cacheKey, pageResult);
      return pageResult;
    } catch (originalError) {
      // Quota exhaustion would fail the retry identically (and double-count
      // usage) -- surface it immediately.
      if (originalError instanceof UsageLimitError) throw originalError;
      const reason = originalError instanceof Error
        ? originalError.message
        : 'Private playlists could not be loaded.';
      try {
        const publicResult = await fetchPage(false);
        // Both legs agree the catalog is empty: genuine empty channel, not a
        // failure -- resolve without the partial tag.
        if (publicResult.items.length === 0) return publicResult;
        return { ...publicResult, partial: true, partialError: reason };
      } catch (fallbackError) {
        // Public leg failed too (or the channel is genuinely empty): surface
        // the original inclusive-leg error, never the fallback's.
        if (fallbackError instanceof UsageLimitError) throw fallbackError;
        throw originalError instanceof Error
          ? originalError
          : new Error(`Failed to fetch dashboard playlists: ${String(originalError)}`);
      }
    }
  }

  /**
   * Channel playlist page fetch for the Playlist explorer -- uses
   * GET /playlists/:channelId with page/perPage (DB-backed catalog on the
   * server, sliced per page). Returns one DashboardPlaylistPage; the caller
   * advances with page + 1 while hasMore is true.
   */
  async fetchChannelPlaylistPage(
    channelId: string,
    page = 1,
    perPage = 20,
    includePrivate?: boolean,
  ): Promise<DashboardPlaylistPage> {
    const safePage = page >= 1 ? Math.floor(page) : 1;
    const safePerPage = perPage > 0 ? Math.floor(perPage) : 20;
    const privacyKey = includePrivate ? 'p1' : 'p0';
    const cacheKey = `yt:playlists:${channelId}:${safePerPage}:p${safePage}:${privacyKey}`;
    const cached = readCache<DashboardPlaylistPage>(cacheKey);
    if (cached) return cached;

    try {
      const url = new URL(`${this.baseUrl}/playlists/${encodeURIComponent(channelId)}`);
      url.searchParams.append('page', String(safePage));
      url.searchParams.append('perPage', String(safePerPage));
      if (includePrivate) {
        url.searchParams.append('includePrivate', '1');
      }

      const response = await fetch(url.toString(), { headers: await this.getHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(
          errorData.error?.message || `Failed to fetch playlists: ${response.status}`
        );
      }

      const raw: unknown = await response.json();
      tryExtractUsage(raw);
      const pageResult = parsePlaylistPageResponse(raw, {
        perPage: safePerPage,
        page: safePage,
        fallbackOffset: (safePage - 1) * safePerPage,
      });
      writeCache(cacheKey, pageResult);
      return pageResult;
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      if (error instanceof Error) {
        throw new Error(`Failed to fetch playlists: ${error.message}`);
      }
      throw new Error('Failed to fetch playlists: Unknown error');
    }
  }

  /**
   * Fetch metadata for a single playlist.
   * 
   * @param playlistId - The YouTube playlist ID
   */
  async fetchPlaylistMetadata(playlistId: string): Promise<PlaylistMetadata | null> {
    const url = new URL(`${this.baseUrl}/playlist/${encodeURIComponent(playlistId)}`);

    try {
      const response = await fetch(url.toString(), { headers: await this.getHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        // Handle 429 Usage Limit Exceeded
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(
          errorData.error?.message || `Failed to fetch playlist metadata: ${response.status}`
        );
      }

      const data: PlaylistsApiResponse = await response.json();
      tryExtractUsage(data);

      if (!data.items || data.items.length === 0) {
        return null;
      }

      const item = data.items[0];

      const description = item.snippet.description || '';
      const hashtags = description.match(/#[\w\u0590-\u05ff]+/g)?.map(t => t.slice(1)) || [];
      const apiTags = item.snippet.tags || [];
      const combinedTags = Array.from(new Set([...apiTags, ...hashtags]));

      return {
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
        itemCount: item.contentDetails.itemCount,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        keywords: combinedTags,
      };
    } catch (error) {
      if (error instanceof Error) {
        throw new Error(`Failed to fetch playlist metadata: ${error.message}`);
      }
      throw new Error('Failed to fetch playlist metadata: Unknown error');
    }
  }

  /**
   * Fetch metadata for multiple playlists by ID.
   * @param playlistIds - Array of YouTube playlist IDs
   * @returns Array of playlist metadata objects
   */
  async fetchPlaylistsByIds(playlistIds: string[]): Promise<PlaylistMetadata[]> {
    if (!playlistIds || playlistIds.length === 0) return [];
    
    // Fetch in parallel (in chunks to avoid too many simultaneous requests if needed, but simple Promise.all is fine for now)
    const promises = playlistIds.map(id => this.fetchPlaylistMetadata(id).catch(() => null));
    const results = await Promise.all(promises);
    
    // Filter out nulls (failed fetches)
    return results.filter((p): p is PlaylistMetadata => p !== null);
  }

  /**
   * Fetch all videos for a channel utilizing the pre-cached backend endpoint.
   * 
   * @param channelId - The YouTube channel ID
   * @param limit - Optional limit of videos to return. Omit for all.
   * @param shortTtl - Picker mode (browse dialog): the client cache entry lives
   *                only 60s (own ":pick" key, so the dashboard keeps its 24h
   *                entries) and the request asks the backend to "top up" the
   *                server-cached list with the newest uploads page (2 API
   *                units) so uploads made minutes ago appear without the full
   *                ~1-min live pagination. Reopening the picker within 60s is
   *                served straight from this client cache.
   */
  async fetchChannelVideos(
    channelId: string,
    limit?: number,
    includePrivate?: boolean,
    privacy?: 'public' | 'private' | 'unlisted' | 'all',
    shortTtl = false,
  ): Promise<VideoMetadata[]> {
    const privacyKey = privacy || (includePrivate ? 'all' : 'public');
    const cacheKey = `yt:channelVideos:${channelId}:${limit || 'all'}:${privacyKey}${shortTtl ? ':pick' : ''}`;
    const cached = readCache<VideoMetadata[]>(cacheKey);
    if (cached) return cached;

    const url = new URL(`${this.baseUrl}/channel-videos/${encodeURIComponent(channelId)}`);
    if (limit !== undefined) {
      url.searchParams.append('limit', limit.toString());
    } else {
      url.searchParams.append('limit', 'all');
    }
    url.searchParams.append('privacy', privacyKey);
    // Picker requests keep the server cache but top it up with the newest
    // uploads page instead of running the full live fetch every open.
    if (shortTtl) url.searchParams.append('topUp', '1');

    try {
      const response = await fetch(url.toString(), { headers: await this.getHeaders() });
      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(errorData.error?.message || `Failed to fetch channel videos: ${response.status}`);
      }

      const raw: unknown = await response.json();
      const data: VideoMetadata[] = Array.isArray(raw) ? raw : (raw as { items: VideoMetadata[] }).items;
      tryExtractUsage(raw);
      // Picker entries expire in 60s (instant reopen) while all other callers
      // keep the standard 24h entry.
      writeCache(cacheKey, data, shortTtl ? PICKER_CACHE_TTL_MS : undefined);
      return data;
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      throw new Error(`Failed to fetch channel videos: ${(error as Error).message}`);
    }
  }

  /**
   * Dashboard-scoped video list fetch -- uses the /dashboard/videos endpoint
   * which is server-locked to the "dashboard" usage key (collective quota).
   *
   * Returns a single page (server-side pagination) so large catalogs are
   * loaded incrementally instead of all at once. `limit` is the page size,
   * `offset` skips already-loaded rows. The backend envelope carries the true
   * catalog total on the first page (`pagination.totaldata`), so callers know
   * the full count upfront. `hasMore` tells the caller whether a next page exists.
   */
  async fetchDashboardChannelVideos(
    channelId: string,
    limit?: number,
    includePrivate?: boolean,
    privacy?: 'public' | 'private' | 'unlisted' | 'all',
    offset = 0,
  ): Promise<DashboardVideoPage> {
    const privacyKey = privacy || (includePrivate ? 'all' : 'public');
    const perPage = typeof limit === 'number' && limit > 0 ? Math.floor(limit) : 50;
    const safeOffset = offset >= 0 ? Math.floor(offset) : 0;
    const page = Math.floor(safeOffset / perPage) + 1;
    const cacheKey = `yt:dashboard:videos:${channelId}:${perPage}:p${page}:${privacyKey}`;
    const cached = readCache<DashboardVideoPage>(cacheKey);
    if (cached) return cached;

    try {
      const response = await fetch(`${this.baseUrl}/dashboard/videos`, {
        method: 'POST',
        headers: await this.getHeaders(),
        body: JSON.stringify({
          channelId,
          // New-style page params (preferred); legacy offset params kept so an
          // older backend still answers correctly during rollout.
          page,
          perPage,
          maxResults: limit,
          offset,
          privacy: privacyKey,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(errorData.error?.message || `Failed to fetch dashboard videos: ${response.status}`);
      }

      const raw: unknown = await response.json();
      tryExtractUsage(raw);
      // New envelope: { status, message, videos, pagination: { totaldata,
      // currentpage, perpageitem, totalpages, hasMore } }. Legacy fallback:
      // { items, total, hasMore, offset, limit }.
      const obj = (raw as {
        status?: number;
        message?: string;
        videos?: VideoMetadata[];
        pagination?: { totaldata?: number; currentpage?: number; perpageitem?: number; totalpages?: number; hasMore?: boolean };
        items?: VideoMetadata[];
        total?: number;
        hasMore?: boolean;
        offset?: number;
        limit?: number;
      });
      let pageResult: DashboardVideoPage;
      if (Array.isArray(obj.videos) && obj.pagination) {
        const p = obj.pagination;
        const resolvedPerPage = typeof p.perpageitem === 'number' && p.perpageitem > 0 ? p.perpageitem : perPage;
        const resolvedPage = typeof p.currentpage === 'number' && p.currentpage >= 1 ? Math.floor(p.currentpage) : page;
        pageResult = {
          items: obj.videos,
          total: typeof p.totaldata === 'number' ? p.totaldata : obj.videos.length,
          hasMore: p.hasMore ?? false,
          offset: (resolvedPage - 1) * resolvedPerPage,
          limit: resolvedPerPage,
          currentPage: resolvedPage,
          totalPages: typeof p.totalpages === 'number' ? p.totalpages : undefined,
        };
      } else {
        pageResult = {
          items: Array.isArray(obj.items) ? obj.items : [],
          total: typeof obj.total === 'number' ? obj.total : obj.items?.length ?? 0,
          hasMore: obj.hasMore ?? false,
          offset: typeof obj.offset === 'number' ? obj.offset : offset,
          limit: typeof obj.limit === 'number' ? obj.limit : perPage,
        };
      }
      writeCache(cacheKey, pageResult);
      return pageResult;
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      throw new Error(`Failed to fetch dashboard videos: ${(error as Error).message}`);
    }
  }

  /**
   * Resolve a YouTube video ID to its channel ID.
   * No quota consumed -- uses the backend's resolve-style rate-limited endpoint.
   * Results are cached server-side for 24h (video→channel mapping never changes).
   *
   * @param videoId - The YouTube video ID (11 chars)
   * @returns The channelId and channelTitle
   */
  async getChannelIdFromVideo(videoId: string): Promise<{ channelId: string; channelTitle: string }> {
    const cleanId = videoId.replace(/[^0-9A-Za-z_-]/g, '');
    if (!cleanId) {
      throw new Error('Invalid video ID');
    }

    const url = new URL(`${this.baseUrl}/video/${encodeURIComponent(cleanId)}`);
    const response = await fetch(url.toString(), { headers: await this.getHeaders() });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error?.message || `Failed to resolve video: ${response.status}`);
    }

    return response.json();
  }

  /**
   * Fetch playlist items (standalone Playlist / Videos pages -- playlists quota).
   */
  async fetchPlaylistItems(
    playlistId: string,
    maxResults: number = 50,
    fetchAll: boolean = false,
    onProgress?: (videos: VideoMetadata[]) => void,
    skipStatistics: boolean = false
  ): Promise<VideoMetadata[]> {
    if (!fetchAll && !onProgress) {
      const cacheKey = `yt:playlist:${playlistId}:${maxResults}:${skipStatistics}`;
      const cached = readCache<VideoMetadata[]>(cacheKey);
      if (cached) return cached;

      const result = await this._fetchPlaylistItemsRaw(playlistId, maxResults, false, undefined, skipStatistics);
      writeCache(cacheKey, result);
      return result;
    }
    return this._fetchPlaylistItemsRaw(playlistId, maxResults, fetchAll, onProgress, skipStatistics);
  }

  private async _fetchPlaylistItemsRaw(
    playlistId: string,
    maxResults: number = 50,
    fetchAll: boolean = false,
    onProgress?: (videos: VideoMetadata[]) => void,
    skipStatistics: boolean = false
  ): Promise<VideoMetadata[]> {
    const allVideos: VideoMetadata[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const remainingNeeded = fetchAll ? 50 : (maxResults - allVideos.length);
      const limit = Math.min(remainingNeeded, 50);
      if (limit <= 0 && !fetchAll) break;

      const url = new URL(`${this.baseUrl}/playlist-items/items/${encodeURIComponent(playlistId)}`);
      url.searchParams.append('maxResults', limit.toString());
      if (pageToken) url.searchParams.append('pageToken', pageToken);

      try {
        const response = await fetch(url.toString(), { headers: await this.getHeaders() });

        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey,
            );
          }
          throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
        }

        const data: YouTubeApiResponse = await response.json();
        tryExtractUsage(data);

        const rawVideos = data.items.map((item) => ({
          position: item.snippet.position,
          title: item.snippet.title,
          videoId: item.snippet.resourceId.videoId,
          publishedAt: item.snippet.publishedAt,
          channelTitle: item.snippet.channelTitle,
          description: item.snippet.description,
          thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
        }));

        let processedBatch: VideoMetadata[] = rawVideos;
        if (!skipStatistics) {
          processedBatch = await this.enrichWithStatistics(rawVideos);
        }

        allVideos.push(...processedBatch);
        if (onProgress) onProgress([...allVideos]);
        pageToken = data.nextPageToken;
        if (!fetchAll && allVideos.length >= maxResults) break;
      } catch (error) {
        if (error instanceof UsageLimitError) throw error;
        if (error instanceof Error) {
          throw new Error(`Failed to fetch playlist items: ${error.message}`);
        }
        throw new Error('Failed to fetch playlist items: Unknown error');
      }
    } while (pageToken);

    return allVideos;
  }

  /**
   * Dashboard-scoped bulk video fetch by ID -- bills against the shared dashboard quota.
   */
  async fetchDashboardVideosByIds(ids: string[]): Promise<VideoMetadata[]> {
    if (ids.length === 0) return [];

    const idChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) {
      idChunks.push(ids.slice(i, i + 50));
    }

    const allVideos: VideoMetadata[] = [];

    for (const chunk of idChunks) {
      const url = `${this.baseUrl}/dashboard/videos/by-ids`;
      try {
        const response = await fetch(url, {
          method: 'POST',
          headers: await this.getHeaders(),
          body: JSON.stringify({ ids: chunk.join(',') }),
        });

        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey,
              url,
            );
          }
          throw new Error(errorData.error?.message || `Failed to fetch dashboard videos: ${response.status}`);
        }

        const data = (await readJsonResponse(response, 'youtube.fetchDashboardVideosByIds')) as VideoDetailsResponse;

        const videos = data.items.map((item) => ({
          videoId: item.id,
          title: item.snippet.title,
          description: item.snippet.description,
          thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
          publishedAt: item.snippet.publishedAt,
          viewCount: parseInt(item.statistics?.viewCount || '0', 10),
          likeCount: parseInt(item.statistics?.likeCount || '0', 10),
          commentCount: parseInt(item.statistics?.commentCount || '0', 10),
          duration: item.contentDetails?.duration || '',
          channelTitle: item.snippet.channelTitle,
          channelId: item.snippet.channelId,
        }));

        allVideos.push(...videos);
      } catch (error) {
        if (error instanceof UsageLimitError) throw error;
        throw new Error(`Failed to fetch dashboard videos: ${(error as Error).message}`);
      }
    }

    return allVideos;
  }

  /**
   * Dashboard-scoped playlist metadata -- bills against the shared dashboard quota.
   */
  async fetchDashboardPlaylistMetadata(playlistId: string): Promise<PlaylistMetadata | null> {
    const url = `${this.baseUrl}/dashboard/playlist/${encodeURIComponent(playlistId)}`;
    try {
      const response = await fetch(url, { headers: await this.getHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey,
            url,
          );
        }
        throw new Error(errorData.error?.message || `Failed to fetch dashboard playlist: ${response.status}`);
      }

      const data = (await readJsonResponse(response, 'youtube.fetchDashboardPlaylistMetadata')) as PlaylistsApiResponse;

      if (!data.items || data.items.length === 0) return null;
      const item = data.items[0];
      const description = item.snippet.description || '';
      const hashtags = description.match(/#[\w֐-׿]+/g)?.map(t => t.slice(1)) || [];
      const apiTags = item.snippet.tags || [];
      const combinedTags = Array.from(new Set([...apiTags, ...hashtags]));

      return {
        id: item.id,
        title: item.snippet.title,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
        itemCount: item.contentDetails.itemCount,
        channelTitle: item.snippet.channelTitle,
        publishedAt: item.snippet.publishedAt,
        keywords: combinedTags,
      };
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      return null;
    }
  }

  async fetchDashboardPlaylistsByIds(playlistIds: string[]): Promise<PlaylistMetadata[]> {
    if (!playlistIds || playlistIds.length === 0) return [];
    const promises = playlistIds.map(id => this.fetchDashboardPlaylistMetadata(id).catch(() => null));
    const results = await Promise.all(promises);
    return results.filter((p): p is PlaylistMetadata => p !== null);
  }

  /**
   * Dashboard-scoped playlist items -- bills against the shared dashboard quota.
   */
  async fetchDashboardPlaylistItems(
    playlistId: string,
    maxResults: number = 50,
    fetchAll: boolean = false,
    onProgress?: (videos: VideoMetadata[]) => void,
    skipStatistics: boolean = false
  ): Promise<VideoMetadata[]> {
    if (!fetchAll && !onProgress) {
      const cacheKey = `yt:dsh:playlist:${playlistId}:${maxResults}:${skipStatistics}`;
      const cached = readCache<VideoMetadata[]>(cacheKey);
      if (cached) return cached;

      const result = await this._fetchDashboardPlaylistItemsRaw(
        playlistId, maxResults, false, undefined, skipStatistics,
      );
      writeCache(cacheKey, result);
      return result;
    }
    return this._fetchDashboardPlaylistItemsRaw(
      playlistId, maxResults, fetchAll, onProgress, skipStatistics,
    );
  }

  private async _fetchDashboardPlaylistItemsRaw(
    playlistId: string,
    maxResults: number = 50,
    fetchAll: boolean = false,
    onProgress?: (videos: VideoMetadata[]) => void,
    skipStatistics: boolean = false
  ): Promise<VideoMetadata[]> {
    const allVideos: VideoMetadata[] = [];
    let pageToken: string | undefined = undefined;

    do {
      const remainingNeeded = fetchAll ? 50 : (maxResults - allVideos.length);
      const limit = Math.min(remainingNeeded, 50);
      if (limit <= 0 && !fetchAll) break;

      const url = new URL(`${this.baseUrl}/dashboard/playlist-items/${encodeURIComponent(playlistId)}`);
      url.searchParams.append('maxResults', limit.toString());
      if (pageToken) url.searchParams.append('pageToken', pageToken);

      try {
        const response = await fetch(url.toString(), { headers: await this.getHeaders() });

        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey,
              url.toString(),
            );
          }
          throw new Error(errorData.error?.message || `API request failed with status ${response.status}`);
        }

        const data = (await readJsonResponse(response, 'youtube.fetchDashboardPlaylistItems')) as YouTubeApiResponse;

        const rawVideos = data.items.map((item) => ({
          position: item.snippet.position,
          title: item.snippet.title,
          videoId: item.snippet.resourceId.videoId,
          publishedAt: item.snippet.publishedAt,
          channelTitle: item.snippet.channelTitle,
          description: item.snippet.description,
          thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
        }));

        // Enrich current batch with statistics if needed
        let processedBatch: VideoMetadata[] = rawVideos;
        if (!skipStatistics) {
          processedBatch = await this.enrichWithStatistics(rawVideos);
        }

        // Add to total collection
        allVideos.push(...processedBatch);

        // Notify progress with the accumulated list so far
        if (onProgress) {
          onProgress([...allVideos]);
        }

        pageToken = data.nextPageToken;

        // If we're not fetching all and we've reached the limit, break
        if (!fetchAll && allVideos.length >= maxResults) {
          break;
        }

      } catch (error) {
        if (error instanceof UsageLimitError) throw error;
        if (error instanceof Error) {
          throw new Error(`Failed to fetch playlist items: ${error.message}`);
        }
        throw new Error('Failed to fetch playlist items: Unknown error');
      }
    } while (pageToken);

    return allVideos;
  }

  /**
   * Fetch a single page of playlist items.
   * Useful for manual pagination or checking conditions between pages.
   * 
   * @param playlistId - The YouTube playlist ID
   * @param pageToken - Optional page token for pagination
   * @param maxResults - Maximum results per page (default 50)
   */
  async fetchPlaylistItemsPage(
    playlistId: string,
    pageToken?: string,
    maxResults: number = 50
  ): Promise<{ items: VideoMetadata[], nextPageToken?: string }> {
    const url = new URL(`${this.baseUrl}/playlist-items/items/${encodeURIComponent(playlistId)}`);
    url.searchParams.append('maxResults', maxResults.toString());
    if (pageToken) {
      url.searchParams.append('pageToken', pageToken);
    }

    try {
      const response = await fetch(url.toString(), { headers: await this.getHeaders() });

      if (!response.ok) {
        const errorData = await response.json();
        // Handle 429 Usage Limit Exceeded
        if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
          throw new UsageLimitError(
            errorData.error.message,
            errorData.error.limit,
            errorData.error.used,
            errorData.error.pageKey
          );
        }
        throw new Error(
          errorData.error?.message || `API request failed with status ${response.status}`
        );
      }

      const data: YouTubeApiResponse = await response.json();
      tryExtractUsage(data);

      const items: VideoMetadata[] = data.items.map((item) => ({
        position: item.snippet.position,
        title: item.snippet.title,
        videoId: item.snippet.resourceId.videoId,
        publishedAt: item.snippet.publishedAt,
        channelTitle: item.snippet.channelTitle,
        description: item.snippet.description,
        thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
      }));

      return {
        items,
        nextPageToken: data.nextPageToken
      };
    } catch (error) {
      if (error instanceof UsageLimitError) throw error;
      if (error instanceof Error) {
        throw new Error(`Failed to fetch playlist items page: ${error.message}`);
      }
      throw new Error('Failed to fetch playlist items page: Unknown error');
    }
  }

  /**
   * Enrich video metadata with view and comment statistics.
   * Optimized to batch up to 50 video IDs per API request (YouTube API limit).
   * 
   * @param videos - Array of video metadata to enrich
   */
  async enrichWithStatistics(videos: VideoMetadata[]): Promise<VideoMetadata[]> {
    if (videos.length === 0) return videos;

    const chunks: VideoMetadata[][] = [];
    for (let i = 0; i < videos.length; i += 50) {
      chunks.push(videos.slice(i, i + 50));
    }

    const enrichedVideos: VideoMetadata[] = [];

    for (const chunk of chunks) {
      const videoIds = chunk.map(v => v.videoId).join(',');
      const cacheKey = `yt:stats:${videoIds}`;
      const cachedChunk = readCache<VideoMetadata[]>(cacheKey);
      if (cachedChunk) {
        enrichedVideos.push(...cachedChunk);
        continue;
      }

      const url = new URL(`${this.baseUrl}/videos`);
      url.searchParams.append('ids', videoIds);

      try {
        const response = await fetch(url.toString(), { headers: await this.getHeaders() });

        if (!response.ok) {
          const errorData = await response.json();
          if (response.status === 429 && errorData?.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey
            );
          }
          console.warn('Failed to fetch video statistics');
          enrichedVideos.push(...chunk);
          continue;
        }

        const data: VideoDetailsResponse = await response.json();
        tryExtractUsage(data);

        const detailsMap = new Map(
          data.items.map(item => [
            item.id,
            {
              viewCount: parseInt(item.statistics.viewCount) || 0,
              likeCount: parseInt(item.statistics.likeCount) || 0,
              commentCount: parseInt(item.statistics.commentCount) || 0,
              duration: item.contentDetails?.duration,
              tags: item.snippet?.tags
            }
          ])
        );

        const enrichedChunk = chunk.map(video => {
          const details = detailsMap.get(video.videoId);
          return {
            ...video,
            viewCount: details?.viewCount || 0,
            likeCount: details?.likeCount || 0,
            commentCount: details?.commentCount || 0,
            duration: details?.duration,
            tags: details?.tags
          };
        });

        writeCache(cacheKey, enrichedChunk);
        enrichedVideos.push(...enrichedChunk);

      } catch (error) {
        if (error instanceof UsageLimitError) throw error;
        console.warn('Error fetching statistics:', error);
        enrichedVideos.push(...chunk);
      }
    }

    return enrichedVideos;
  }

  /**
   * Fetch video metadata for a list of video IDs.
   * 
   * @param ids - Array of video IDs
   */
  async fetchVideosByIds(ids: string[]): Promise<VideoMetadata[]> {
    if (ids.length === 0) return [];

    // YouTube API allows up to 50 video IDs per request
    const idChunks: string[][] = [];
    for (let i = 0; i < ids.length; i += 50) {
      idChunks.push(ids.slice(i, i + 50));
    }

    const allVideos: VideoMetadata[] = [];

    for (const chunk of idChunks) {
      const videoIds = chunk.join(',');
      const url = new URL(`${this.baseUrl}/specific-videos`);
      url.searchParams.append('ids', videoIds);

      try {
        const response = await fetch(url.toString(), { headers: await this.getHeaders() });

        if (!response.ok) {
          const errorData = await response.json();
          // Handle 429 Usage Limit Exceeded
          if (response.status === 429 && errorData.error?.code === 'LIMIT_EXCEEDED') {
            throw new UsageLimitError(
              errorData.error.message,
              errorData.error.limit,
              errorData.error.used,
              errorData.error.pageKey
            );
          }
          throw new Error(errorData.error?.message || `Failed to fetch videos: ${response.status}`);
        }

        const data: VideoDetailsResponse = await response.json();
        tryExtractUsage(data);

        // Create a set of IDs that were actually returned
        const returnedIds = new Set(data.items.map(item => item.id));

        const videos = data.items.map((item) => ({
          videoId: item.id,
          title: item.snippet.title,
          publishedAt: item.snippet.publishedAt,
          channelTitle: item.snippet.channelTitle,
          description: item.snippet.description,
          thumbnailUrl: item.snippet.thumbnails.medium?.url || item.snippet.thumbnails.default?.url || '',
          viewCount: parseInt(item.statistics.viewCount) || 0,
          likeCount: parseInt(item.statistics.likeCount) || 0,
          commentCount: parseInt(item.statistics.commentCount) || 0,
          duration: item.contentDetails?.duration,
          tags: item.snippet?.tags,
          isUnavailable: false
        }));

        allVideos.push(...videos);

        // Add placeholder for IDs that weren't returned (unavailable videos)
        for (const id of chunk) {
          if (!returnedIds.has(id)) {
            allVideos.push({
              videoId: id,
              title: 'Video Unavailable',
              publishedAt: new Date().toISOString(),
              channelTitle: 'N/A',
              description: 'This video is unavailable or private.',
              thumbnailUrl: '',
              isUnavailable: true
            });
          }
        }
      } catch (error) {
        console.error('Error fetching videos by IDs:', error);
        throw error;
      }
    }

    return allVideos;
  }
}
