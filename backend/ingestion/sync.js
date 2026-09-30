const axios = require('axios');
const {
  recordSyncRunStart,
  recordSyncRunDone,
  upsertChannel,
  upsertVideos,
  upsertVideoMetricsDaily,
  upsertChannelMetricsDaily,
  upsertPlaylists,
  upsertPlaylistItems,
} = require('./store');
const {
  INGEST_LOOKBACK_DAYS,
  computeDateWindow,
  splitDateWindows,
} = require('./ingestWindow');
const { deleteDashboardSnapshots } = require('./snapshots');

const YOUTUBE_API_BASE = 'https://www.googleapis.com/youtube/v3';
const YT_ANALYTICS_BASE = 'https://youtubeanalytics.googleapis.com/v2/reports';

/**
 * Single source of truth for the ingestion catalog cap. Configurable via
 * MAX_VIDEOS_PER_CHANNEL env (default 10000) -- large catalogs need the headroom
 * (channels with 558+ videos already exceed the old 500). Shared by the cron
 * schedule, queue workers and admin endpoints so the env var is actually honored.
 *
 * Quota note: video listing costs ~1 YouTube unit per 50 videos, so a full
 * 10k-video channel costs ~200 units per run plus metrics. Lower the env var
 * if the daily 10k-unit quota is shared across many channels.
 */
const DEFAULT_MAX_VIDEOS_PER_CHANNEL = Math.max(1, parseInt(process.env.MAX_VIDEOS_PER_CHANNEL || '10000', 10) || 10000);

/**
 * Playlist ingestion caps (quota guard-rails).
 *  - PLAYLIST_SYNC_LIMIT: playlists fetched per channel per run (default 10000).
 *    The /playlists listing returns 50 per page = 1 YouTube unit per page.
 *  - PLAYLIST_ITEMS_SYNC_LIMIT: membership rows fetched per playlist. 50 items
 *    = 1 unit per playlist; set 0 to skip membership sync entirely (catalog
 *    only) and let the read path fall back to the live API for video lists.
 */
const DEFAULT_MAX_PLAYLISTS_PER_CHANNEL = Math.max(1, parseInt(process.env.PLAYLIST_SYNC_LIMIT || '10000', 10) || 10000);
const MAX_PLAYLIST_ITEMS_PER_PLAYLIST = Math.max(0, parseInt(process.env.PLAYLIST_ITEMS_SYNC_LIMIT ?? '50', 10) || 0);

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/** Mirror the service's canonical privacy normalizer: PRIVACY_PUBLIC|UNLISTED|PRIVATE or lowercase → public|unlisted|private; undefined when unknown. */
function normalizePrivacy(value) {
  if (!value) return undefined;
  const s = String(value).toLowerCase();
  if (s.includes('unlisted')) return 'unlisted';
  if (s.includes('private')) return 'private';
  if (s.includes('public')) return 'public';
  return undefined;
}

async function withRetry(fn, label, retries = 3) {
  let lastErr = null;
  for (let i = 0; i < retries; i += 1) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      const status = err?.response?.status;
      const retryable = status === 429 || (status >= 500 && status < 600);
      if (!retryable || i === retries - 1) break;
      const waitMs = Math.min(1000 * (2 ** i), 8000);
      console.warn(`[Ingestion] ${label} retry ${i + 1}/${retries} after ${waitMs}ms`, err.message);
      await sleep(waitMs);
    }
  }
  const responseBody = lastErr?.response?.data ? JSON.stringify(lastErr.response.data).slice(0, 500) : '';
  const enhanced = responseBody
    ? `[${label}] ${lastErr.message} -- body: ${responseBody}`
    : `[${label}] ${lastErr.message}`;
  const wrapped = new Error(enhanced);
  // Preserve axios response so callers can inspect err.response.status (e.g. to
  // tolerate 400 "query not supported" from optional metric groups).
  wrapped.response = lastErr?.response;
  throw wrapped;
}

function mapRowsByHeaders(report, expected) {
  if (!report?.rows?.length) return [];
  const idx = Object.fromEntries(expected.map((k) => [k, report.columnHeaders?.findIndex((h) => h.name === k) ?? -1]));
  return report.rows.map((row) => ({
    metricDate: row[idx.day],
    views: idx.views !== -1 ? Number(row[idx.views] || 0) : 0,
    estimatedMinutesWatched: idx.estimatedMinutesWatched !== -1 ? Number(row[idx.estimatedMinutesWatched] || 0) : 0,
    averageViewPercentage: idx.averageViewPercentage !== -1 ? Number(row[idx.averageViewPercentage] || 0) : 0,
    averageViewDuration: idx.averageViewDuration !== -1 ? Number(row[idx.averageViewDuration] || 0) : 0,
    engagedViews: idx.engagedViews !== -1 ? Number(row[idx.engagedViews] || 0) : 0,
    viewerPercentage: idx.viewerPercentage !== -1 ? Number(row[idx.viewerPercentage] || 0) : 0,
    subscribersGained: idx.subscribersGained !== -1 ? Number(row[idx.subscribersGained] || 0) : 0,
    subscribersLost: idx.subscribersLost !== -1 ? Number(row[idx.subscribersLost] || 0) : 0,
    likes: idx.likes !== -1 ? Number(row[idx.likes] || 0) : 0,
    shares: idx.shares !== -1 ? Number(row[idx.shares] || 0) : 0,
    comments: idx.comments !== -1 ? Number(row[idx.comments] || 0) : 0,
    cardImpressions: idx.cardImpressions !== -1 ? Number(row[idx.cardImpressions] || 0) : 0,
    cardClicks: idx.cardClicks !== -1 ? Number(row[idx.cardClicks] || 0) : 0,
    cardClickRate: idx.cardClickRate !== -1 ? Number(row[idx.cardClickRate] || 0) : 0,
    cardTeaserImpressions: idx.cardTeaserImpressions !== -1 ? Number(row[idx.cardTeaserImpressions] || 0) : 0,
    cardTeaserClicks: idx.cardTeaserClicks !== -1 ? Number(row[idx.cardTeaserClicks] || 0) : 0,
    cardTeaserClickRate: idx.cardTeaserClickRate !== -1 ? Number(row[idx.cardTeaserClickRate] || 0) : 0,
    averageConcurrentViewers: idx.averageConcurrentViewers !== -1 ? Number(row[idx.averageConcurrentViewers] || 0) : 0,
    peakConcurrentViewers: idx.peakConcurrentViewers !== -1 ? Number(row[idx.peakConcurrentViewers] || 0) : 0,
  }));
}

async function fetchChannelUploadsId(channelId, authHeader) {
  const res = await withRetry(
    () =>
      axios.get(`${YOUTUBE_API_BASE}/channels`, {
        params: { part: 'contentDetails,snippet', id: channelId },
        headers: { Authorization: authHeader },
      }),
    'fetchChannelUploadsId'
  );
  const item = res.data?.items?.[0];
  if (!item) throw new Error('Channel not found for ingestion');
  return {
    uploadsId: item.contentDetails?.relatedPlaylists?.uploads,
    title: item.snippet?.title || null,
  };
}

async function fetchAllVideosForChannel(channelId, uploadsId, authHeader, maxResults = DEFAULT_MAX_VIDEOS_PER_CHANNEL) {
  const videos = [];
  let pageToken;
  do {
    const remaining = maxResults - videos.length;
    if (remaining <= 0) break;
    const limit = Math.min(50, remaining);
    const params = { part: 'snippet', playlistId: uploadsId, maxResults: limit };
    if (pageToken) params.pageToken = pageToken;

    const plRes = await withRetry(
      () =>
        axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
          params,
          headers: { Authorization: authHeader },
        }),
      'fetchPlaylistItems'
    );

    const chunk = (plRes.data?.items || []).map((item) => ({
      position: item.snippet?.position,
      title: item.snippet?.title,
      videoId: item.snippet?.resourceId?.videoId,
      publishedAt: item.snippet?.publishedAt,
      channelTitle: item.snippet?.channelTitle,
      description: item.snippet?.description,
      thumbnailUrl: item.snippet?.thumbnails?.medium?.url || item.snippet?.thumbnails?.default?.url || '',
    })).filter((row) => row.videoId);

    if (chunk.length) {
      const ids = chunk.map((v) => v.videoId).join(',');
      const statsRes = await withRetry(
        () =>
          axios.get(`${YOUTUBE_API_BASE}/videos`, {
            params: { part: 'statistics,contentDetails,snippet,status', id: ids },
            headers: { Authorization: authHeader },
          }),
        'fetchVideoStats'
      );
      const detailsMap = new Map(
        (statsRes.data?.items || []).map((item) => [
          item.id,
          {
            viewCount: Number(item.statistics?.viewCount || 0),
            likeCount: Number(item.statistics?.likeCount || 0),
            commentCount: Number(item.statistics?.commentCount || 0),
            duration: item.contentDetails?.duration || null,
            tags: item.snippet?.tags || [],
            privacyStatus: normalizePrivacy(item.status?.privacyStatus),
          },
        ])
      );
      videos.push(
        ...chunk.map((v) => ({
          ...v,
          ...detailsMap.get(v.videoId),
        }))
      );
    }

    pageToken = plRes.data?.nextPageToken;
  } while (pageToken && videos.length < maxResults);

  return videos;
}

/**
 * Fetch a channel's playlist catalog (paginated, capped).
 *
 * Requests part=status so the read model can distinguish public from
 * unlisted/private: ingestion always runs with an owner OAuth token, so unlike
 * the API-key chat path it CAN see non-public playlists.
 */
async function fetchChannelPlaylists(channelId, authHeader, maxResults = DEFAULT_MAX_PLAYLISTS_PER_CHANNEL) {
  const playlists = [];
  let pageToken;
  do {
    const remaining = maxResults - playlists.length;
    if (remaining <= 0) break;
    const params = {
      part: 'snippet,contentDetails,status',
      channelId,
      maxResults: Math.min(50, remaining),
    };
    if (pageToken) params.pageToken = pageToken;

    const res = await withRetry(
      () =>
        axios.get(`${YOUTUBE_API_BASE}/playlists`, {
          params,
          headers: { Authorization: authHeader },
        }),
      'fetchChannelPlaylists'
    );

    for (const item of res.data?.items || []) {
      if (!item?.id) continue;
      playlists.push({
        playlistId: item.id,
        title: item.snippet?.title || 'Untitled',
        description: item.snippet?.description || '',
        channelTitle: item.snippet?.channelTitle || null,
        publishedAt: item.snippet?.publishedAt || null,
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          null,
        itemCount: item.contentDetails?.itemCount ?? null,
        privacyStatus: normalizePrivacy(item.status?.privacyStatus) || null,
      });
    }
    pageToken = res.data?.nextPageToken;
  } while (pageToken && playlists.length < maxResults);
  return playlists;
}

/** Fetch up to `maxItems` membership rows for one playlist, in playlist order. */
async function fetchPlaylistItemsForSync(playlistId, authHeader, maxItems = MAX_PLAYLIST_ITEMS_PER_PLAYLIST) {
  const items = [];
  let pageToken;
  do {
    const remaining = maxItems - items.length;
    if (remaining <= 0) break;
    const params = { part: 'snippet', playlistId, maxResults: Math.min(50, remaining) };
    if (pageToken) params.pageToken = pageToken;

    const res = await withRetry(
      () =>
        axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
          params,
          headers: { Authorization: authHeader },
        }),
      'fetchPlaylistItemsForSync'
    );

    for (const item of res.data?.items || []) {
      const videoId = item.snippet?.resourceId?.videoId;
      if (!videoId) continue;
      items.push({
        videoId,
        position: item.snippet?.position ?? null,
        title: item.snippet?.title || 'Untitled',
        publishedAt: item.snippet?.publishedAt || null,
        thumbnailUrl:
          item.snippet?.thumbnails?.medium?.url ||
          item.snippet?.thumbnails?.default?.url ||
          null,
      });
    }
    pageToken = res.data?.nextPageToken;
  } while (pageToken && items.length < maxItems);
  return items;
}

/**
 * Sync a channel's playlist catalog (+ optional membership) into Postgres.
 *
 * Catalog rows are written atomically with the channel freshness stamp; the
 * membership pass is best-effort per playlist so one unreadable playlist can
 * never abort the rest of the sync.
 */
async function syncChannelPlaylists(channelId, authHeader, { maxPlaylists, maxItemsPerPlaylist } = {}) {
  const playlists = await fetchChannelPlaylists(
    channelId,
    authHeader,
    maxPlaylists || DEFAULT_MAX_PLAYLISTS_PER_CHANNEL
  );
  await upsertPlaylists(channelId, playlists);

  const itemsLimit =
    maxItemsPerPlaylist === undefined ? MAX_PLAYLIST_ITEMS_PER_PLAYLIST : maxItemsPerPlaylist;
  let itemsSynced = 0;
  if (itemsLimit > 0) {
    for (const pl of playlists) {
      try {
        const items = await fetchPlaylistItemsForSync(pl.playlistId, authHeader, itemsLimit);
        await upsertPlaylistItems(pl.playlistId, items);
        itemsSynced += items.length;
      } catch (err) {
        console.warn(`[ingest] Playlist items failed for ${pl.playlistId}:`, err.message);
      }
    }
  }
  return { playlists: playlists.length, items: itemsSynced };
}

async function fetchAnalyticsReport({ channelId, startDate, endDate, metrics, dimensions = 'day', filters, authHeader }) {
  const params = {
    ids: `channel==${channelId}`,
    startDate,
    endDate,
    metrics,
    dimensions,
    sort: 'day',
  };
  if (filters) params.filters = filters;
  return withRetry(
    () =>
      axios.get(YT_ANALYTICS_BASE, {
        params,
        headers: { Authorization: authHeader },
      }),
    'fetchAnalyticsReport'
  ).then((res) => res.data);
}

function mergeReportRows(reports) {
  const byDate = new Map();
  let columnHeaders = [];
  for (const report of reports) {
    if (report?.columnHeaders?.length) columnHeaders = report.columnHeaders;
    for (const row of report?.rows || []) {
      if (row && row[0]) byDate.set(String(row[0]).slice(0, 10), row);
    }
  }
  return {
    columnHeaders,
    rows: Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, row]) => row),
  };
}

/**
 * Column-wise date join across metric-group reports. Unlike mergeReportRows
 * (row replace), this unions the metric columns of each group per date so
 * optional groups (cards, concurrent viewers) can be absent without losing
 * the core metrics.
 */
function mergeReportColumns(reports) {
  const valid = reports.filter(Boolean);
  if (valid.length === 0) return null;
  if (valid.length === 1) return valid[0];
  const byDate = new Map();
  const columnHeaders = [];
  for (const report of valid) {
    const headers = report.columnHeaders || [];
    for (const h of headers) {
      if (h.name !== 'day' && !columnHeaders.some((c) => c.name === h.name)) columnHeaders.push(h);
    }
    for (const row of report.rows || []) {
      const date = String(row[0]).slice(0, 10);
      if (!date) continue;
      if (!byDate.has(date)) byDate.set(date, { day: date, values: new Map() });
      const entry = byDate.get(date);
      for (let i = 1; i < headers.length; i++) {
        if (headers[i].name !== 'day') entry.values.set(headers[i].name, row[i]);
      }
    }
  }
  const names = columnHeaders.map((c) => c.name);
  return {
    columnHeaders: [{ name: 'day', columnType: 'DIMENSION', dataType: 'string' }, ...columnHeaders],
    rows: Array.from(byDate.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([, e]) => [e.day, ...names.map((n) => (e.values.has(n) ? e.values.get(n) : ''))]),
  };
}

/** Optional metric groups: 400 (unsupported query) is tolerated, others rethrow. */
async function fetchOptionalMetricGroup({ channelId, startDate, endDate, metrics, authHeader }) {
  try {
    return await fetchAnalyticsReportRange({ channelId, startDate, endDate, metrics, dimensions: 'day', authHeader });
  } catch (err) {
    const status = err?.response?.status
      ?? Number(String(err?.message).match(/status code (\d+)/)?.[1] || 0);
    if (status === 400 || status === 403) {
      console.warn(`[ingest] Skipping unsupported metric group (${metrics.split(',')[0]}...): HTTP ${status}`);
      return null;
    }
    throw err;
  }
}

async function fetchAnalyticsReportRange(params) {
  const windows = splitDateWindows(params.startDate, params.endDate);
  const reports = [];
  for (const window of windows) {
    reports.push(await fetchAnalyticsReport({ ...params, startDate: window.startDate, endDate: window.endDate }));
  }
  return mergeReportRows(reports);
}

async function ingestChannelDaily({ channelId, authHeader, maxVideos = DEFAULT_MAX_VIDEOS_PER_CHANNEL, days = INGEST_LOOKBACK_DAYS }) {
  const runId = await recordSyncRunStart(channelId);
  const startedAt = Date.now();
  try {
    const { uploadsId, title } = await fetchChannelUploadsId(channelId, authHeader);
    await upsertChannel({ channelId, title, uploadsPlaylistId: uploadsId, lastSyncedAt: new Date().toISOString() });

    const videos = await fetchAllVideosForChannel(channelId, uploadsId, authHeader, maxVideos);
    await upsertVideos(channelId, videos);

    // Playlist catalog + membership (L2 read-model for the playlist paths).
    // Best-effort, exactly like the optional metric groups below: a playlist
    // failure must never fail the video/metric ingestion run.
    let playlistStats = { playlists: 0, items: 0 };
    try {
      playlistStats = await syncChannelPlaylists(channelId, authHeader);
    } catch (plErr) {
      console.warn(`[ingest] Playlist sync failed for ${channelId}:`, plErr.message);
    }

    const { startDate, endDate } = computeDateWindow(days);
    // Metric groups are fetched separately and joined column-wise. YouTube rejects
    // an ENTIRE query when any single metric is unsupported for the channel/report
    // combination (varies per channel), so each group tolerates a 400/403 and
    // degrades to null instead of failing the whole ingestion run.
    const [watchReport, engagementReport, viewerPctReport, cardReport, liveReport] = await Promise.all([
      fetchOptionalMetricGroup({
        channelId,
        startDate,
        endDate,
        metrics: 'views,estimatedMinutesWatched,averageViewPercentage,averageViewDuration,engagedViews',
        authHeader,
      }),
      fetchOptionalMetricGroup({
        channelId,
        startDate,
        endDate,
        metrics: 'subscribersGained,subscribersLost,likes,shares,comments',
        authHeader,
      }),
      fetchOptionalMetricGroup({
        channelId,
        startDate,
        endDate,
        metrics: 'viewerPercentage',
        authHeader,
      }),
      fetchOptionalMetricGroup({
        channelId,
        startDate,
        endDate,
        metrics: 'cardImpressions,cardClicks,cardClickRate,cardTeaserImpressions,cardTeaserClicks,cardTeaserClickRate',
        authHeader,
      }),
      fetchOptionalMetricGroup({
        channelId,
        startDate,
        endDate,
        metrics: 'averageConcurrentViewers,peakConcurrentViewers',
        authHeader,
      }),
    ]);
    const videoReport = mergeReportColumns([watchReport, engagementReport, viewerPctReport, cardReport, liveReport]);

    const videoRows = mapRowsByHeaders(videoReport, [
      'day',
      'views',
      'estimatedMinutesWatched',
      'averageViewPercentage',
      'averageViewDuration',
      'engagedViews',
      'viewerPercentage',
      'subscribersGained',
      'subscribersLost',
      'likes',
      'shares',
      'comments',
      'cardImpressions',
      'cardClicks',
      'cardClickRate',
      'cardTeaserImpressions',
      'cardTeaserClicks',
      'cardTeaserClickRate',
      'averageConcurrentViewers',
      'peakConcurrentViewers',
    ]);
    // Channel-level engagement rows reuse the engagement group report (same metrics,
    // already fetched above) to avoid a duplicate quota-costing API call.
    const channelRows = mapRowsByHeaders(engagementReport, [
      'day',
      'subscribersGained',
      'subscribersLost',
      'likes',
      'shares',
      'comments',
    ]);

    await upsertVideoMetricsDaily(channelId, videoRows, '');
    await upsertChannelMetricsDaily(channelId, channelRows);

    // Invalidate the L2 Postgres snapshot layer for this channel so the next
    // dashboard read rebuilds from the freshly-written daily tables instead of
    // serving a stale precomputed bundle snapshot (Redis L1 is cleared lazily
    // via TTL; the admin "cache/clear" endpoint wipes it eagerly).
    try {
      await deleteDashboardSnapshots(channelId);
    } catch (snapErr) {
      console.warn(`[ingest] Snapshot invalidation failed for ${channelId}:`, snapErr.message);
    }

    const stats = {
      videosSynced: videos.length,
      playlistsSynced: playlistStats.playlists,
      playlistItemsSynced: playlistStats.items,
      videoMetricDays: videoRows.length,
      channelMetricDays: channelRows.length,
      elapsedMs: Date.now() - startedAt,
    };
    await recordSyncRunDone(runId, 'success', stats);
    return stats;
  } catch (err) {
    await recordSyncRunDone(runId, 'failed', {}, err.message);
    throw err;
  }
}

module.exports = {
  ingestChannelDaily,
  syncChannelPlaylists,
  fetchChannelPlaylists,
  DEFAULT_MAX_VIDEOS_PER_CHANNEL,
  DEFAULT_MAX_PLAYLISTS_PER_CHANNEL,
  MAX_PLAYLIST_ITEMS_PER_PLAYLIST,
};
