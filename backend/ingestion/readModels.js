const { query, isPostgresConfigured } = require('../db/client');
const { normalizeFiltersKey } = require('./store');

function isMissingRelationError(err) {
  return err?.code === '42P01' || /relation .* does not exist/i.test(String(err?.message || ''));
}

async function safeQuery(text, params = []) {
  try {
    return await query(text, params);
  } catch (err) {
    if (isMissingRelationError(err)) {
      console.warn('[Postgres ReadModel] Missing table, falling back to YouTube path:', err.message);
      return null;
    }
    throw err;
  }
}

function dayStr(value) {
  if (!value) return null;
  return new Date(value).toISOString().split('T')[0];
}

async function getLatestMetricDate(channelId, filters = '') {
  if (!isPostgresConfigured()) return null;
  const filtersKey = normalizeFiltersKey(filters);
  const res = await safeQuery(
    `SELECT metric_date
     FROM analytics_video_metrics_daily
     WHERE channel_id = $1 AND filters_key = $2
     ORDER BY metric_date DESC
     LIMIT 1`,
    [channelId, filtersKey]
  );
  if (!res?.rowCount) return null;
  return dayStr(res.rows[0].metric_date);
}

function buildRange({ period = 90, startDate, endDate, latestDate }) {
  if (startDate && endDate) {
    return { startDate, endDate };
  }
  const safeLatest = latestDate ? new Date(latestDate) : new Date();
  const end = safeLatest;
  const days = Math.max(1, Number(period || 90));
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: dayStr(start), endDate: dayStr(end) };
}

function shiftRange(range, days) {
  const end = new Date(new Date(range.startDate).getTime() - 86400000);
  const start = new Date(end.getTime() - (days - 1) * 86400000);
  return { startDate: dayStr(start), endDate: dayStr(end) };
}

function addUtcDays(iso, n) {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function fillDailyRows(rows, startDate, endDate) {
  if (!startDate || !endDate) return rows || [];
  const byDate = new Map();
  for (const r of rows || []) {
    if (r && r[0]) byDate.set(String(r[0]).slice(0, 10), r);
  }
  const width = (rows && rows[0] && rows[0].length) || 4;
  const out = [];
  let d = startDate;
  for (let i = 0; i < 1100 && d <= endDate; i++) {
    out.push(byDate.get(d) || [d, ...new Array(width - 1).fill(0)]);
    d = addUtcDays(d, 1);
  }
  return out;
}

async function getVideoMetricsRows(channelId, startDate, endDate, filters = '') {
  if (!isPostgresConfigured()) return [];
  const filtersKey = normalizeFiltersKey(filters);
  const res = await safeQuery(
    `SELECT metric_date, views, estimated_minutes_watched, average_view_percentage,
            average_view_duration, engaged_views, viewer_percentage,
            subscribers_gained, subscribers_lost, likes, shares, comments,
            card_impressions, card_clicks, card_click_rate,
            card_teaser_impressions, card_teaser_clicks, card_teaser_click_rate,
            average_concurrent_viewers, peak_concurrent_viewers
     FROM analytics_video_metrics_daily
     WHERE channel_id = $1
       AND filters_key = $2
       AND metric_date BETWEEN $3::date AND $4::date
     ORDER BY metric_date ASC`,
    [channelId, filtersKey, startDate, endDate]
  );
  return (res?.rows || []).map((r) => [
    dayStr(r.metric_date),
    Number(r.views || 0),
    Number(r.estimated_minutes_watched || 0),
    Number(r.average_view_percentage || 0),
    Number(r.average_view_duration || 0),
    Number(r.engaged_views || 0),
    Number(r.viewer_percentage || 0),
    Number(r.subscribers_gained || 0),
    Number(r.subscribers_lost || 0),
    Number(r.likes || 0),
    Number(r.shares || 0),
    Number(r.comments || 0),
    Number(r.card_impressions || 0),
    Number(r.card_clicks || 0),
    Number(r.card_click_rate || 0),
    Number(r.card_teaser_impressions || 0),
    Number(r.card_teaser_clicks || 0),
    Number(r.card_teaser_click_rate || 0),
    Number(r.average_concurrent_viewers || 0),
    Number(r.peak_concurrent_viewers || 0),
  ]);
}

async function getChannelMetricsRows(channelId, startDate, endDate) {
  if (!isPostgresConfigured()) return [];
  const res = await safeQuery(
    `SELECT metric_date, subscribers_gained, subscribers_lost, likes, shares, comments
     FROM analytics_channel_metrics_daily
     WHERE channel_id = $1
       AND metric_date BETWEEN $2::date AND $3::date
     ORDER BY metric_date ASC`,
    [channelId, startDate, endDate]
  );
  return (res?.rows || []).map((r) => [
    dayStr(r.metric_date),
    Number(r.subscribers_gained || 0),
    Number(r.subscribers_lost || 0),
    Number(r.likes || 0),
    Number(r.shares || 0),
    Number(r.comments || 0),
  ]);
}

function asReportVideo(rows) {
  return {
    columnHeaders: [
      { name: 'day' },
      { name: 'views' },
      { name: 'estimatedMinutesWatched' },
      { name: 'averageViewPercentage' },
      { name: 'averageViewDuration' },
      { name: 'engagedViews' },
      { name: 'viewerPercentage' },
      { name: 'subscribersGained' },
      { name: 'subscribersLost' },
      { name: 'likes' },
      { name: 'shares' },
      { name: 'comments' },
      { name: 'cardImpressions' },
      { name: 'cardClicks' },
      { name: 'cardClickRate' },
      { name: 'cardTeaserImpressions' },
      { name: 'cardTeaserClicks' },
      { name: 'cardTeaserClickRate' },
      { name: 'averageConcurrentViewers' },
      { name: 'peakConcurrentViewers' },
    ],
    rows,
  };
}

function asReportChannel(rows) {
  return {
    columnHeaders: [
      { name: 'day' },
      { name: 'subscribersGained' },
      { name: 'subscribersLost' },
      { name: 'likes' },
      { name: 'shares' },
      { name: 'comments' },
    ],
    rows,
  };
}

function sumRows(rows, metricName, columnHeaders) {
  if (!rows?.length) return 0;
  const idx = columnHeaders.findIndex((h) => h.name === metricName);
  if (idx < 0) return 0;
  return rows.reduce((acc, r) => acc + Number(r[idx] || 0), 0);
}

function avgRows(rows, metricName, columnHeaders) {
  if (!rows?.length) return 0;
  const idx = columnHeaders.findIndex((h) => h.name === metricName);
  if (idx < 0) return 0;
  const total = rows.reduce((acc, r) => acc + Number(r[idx] || 0), 0);
  return total / rows.length;
}

function computeStatsFromReports(videoReport, channelReport) {
  const videoRows = videoReport?.rows || [];
  const videoHeaders = videoReport?.columnHeaders || [];
  const subRows = channelReport?.rows || [];
  const subHeaders = channelReport?.columnHeaders || [];
  return {
    views: sumRows(videoRows, 'views', videoHeaders),
    watchTime: sumRows(videoRows, 'estimatedMinutesWatched', videoHeaders),
    retention: avgRows(videoRows, 'averageViewPercentage', videoHeaders),
    avgViewDuration: avgRows(videoRows, 'averageViewDuration', videoHeaders),
    engagedViews: sumRows(videoRows, 'engagedViews', videoHeaders),
    viewerPercentage: avgRows(videoRows, 'viewerPercentage', videoHeaders),
    cardImpressions: sumRows(videoRows, 'cardImpressions', videoHeaders),
    cardClicks: sumRows(videoRows, 'cardClicks', videoHeaders),
    cardClickRate: avgRows(videoRows, 'cardClickRate', videoHeaders),
    cardTeaserImpressions: sumRows(videoRows, 'cardTeaserImpressions', videoHeaders),
    cardTeaserClicks: sumRows(videoRows, 'cardTeaserClicks', videoHeaders),
    cardTeaserClickRate: avgRows(videoRows, 'cardTeaserClickRate', videoHeaders),
    averageConcurrentViewers: sumRows(videoRows, 'averageConcurrentViewers', videoHeaders),
    peakConcurrentViewers: sumRows(videoRows, 'peakConcurrentViewers', videoHeaders),
    subscribersGained: sumRows(subRows, 'subscribersGained', subHeaders),
    subscribersLost: sumRows(subRows, 'subscribersLost', subHeaders),
    likes: sumRows(subRows, 'likes', subHeaders),
    shares: sumRows(subRows, 'shares', subHeaders),
    comments: sumRows(subRows, 'comments', subHeaders),
  };
}

async function loadBundleFromPostgres({ channelId, period, startDate, endDate, compare = true, trueDelta = false, filters = '', latestDate }) {
  if (!isPostgresConfigured()) return null;
  const latest = latestDate || (await getLatestMetricDate(channelId, filters));
  if (!latest) return null;
  const curr = buildRange({ period, startDate, endDate, latestDate: latest });
  const days = Math.max(
    1,
    Math.round((new Date(curr.endDate).getTime() - new Date(curr.startDate).getTime()) / 86400000) + 1
  );
  const prev = shiftRange(curr, days);

  const [currentRows, channelCurrentRows] = await Promise.all([
    getVideoMetricsRows(channelId, curr.startDate, curr.endDate, filters),
    getChannelMetricsRows(channelId, curr.startDate, curr.endDate),
  ]);
  if (!currentRows.length) return null;

  let previousRows = [];
  let channelPreviousRows = [];
  if (compare) {
    [previousRows, channelPreviousRows] = await Promise.all([
      getVideoMetricsRows(channelId, prev.startDate, prev.endDate, filters),
      getChannelMetricsRows(channelId, prev.startDate, prev.endDate),
    ]);
  }

  const current = asReportVideo(currentRows);
  const previous = compare ? asReportVideo(fillDailyRows(previousRows, prev.startDate, prev.endDate)) : null;
  const channelCurrent = asReportChannel(channelCurrentRows);
  const channelPrevious = compare ? asReportChannel(fillDailyRows(channelPreviousRows, prev.startDate, prev.endDate)) : null;

  // periodWindow mirrors the trueDelta logic used in the live YT API path:
  //   trueDelta=false → standard overlapping windows (0–7d, 0–30d, 0–90d)
  //   trueDelta=true  → non-overlapping windows (7d=0–7, 30d=8–37, 90d=38–127)
  const periodWindow = (windowDays, offsetDays = 0) => {
    const latestMs = new Date(latest).getTime();
    const endCurr = new Date(latestMs - offsetDays * 86400000);
    const startCurr = new Date(endCurr.getTime() - (windowDays - 1) * 86400000);
    const endPrev = new Date(startCurr.getTime() - 86400000);
    const startPrev = new Date(endPrev.getTime() - (windowDays - 1) * 86400000);
    return {
      curr: { startDate: dayStr(startCurr), endDate: dayStr(endCurr) },
      prev: { startDate: dayStr(startPrev), endDate: dayStr(endPrev) },
    };
  };

  const pw7  = periodWindow(trueDelta ? 8 : 7, 0);
  const pw30 = periodWindow(30, trueDelta ? 8 : 0);
  const pw90 = periodWindow(90, trueDelta ? 38 : 0);

  const d7Curr  = pw7.curr;  const d7Prev  = pw7.prev;
  const d30Curr = pw30.curr; const d30Prev = pw30.prev;
  const d90Curr = pw90.curr; const d90Prev = pw90.prev;

  const [d7v, d7c, d7pv, d7pc, d30v, d30c, d30pv, d30pc, d90v, d90c, d90pv, d90pc] = await Promise.all([
    getVideoMetricsRows(channelId, d7Curr.startDate, d7Curr.endDate, filters),
    getChannelMetricsRows(channelId, d7Curr.startDate, d7Curr.endDate),
    getVideoMetricsRows(channelId, d7Prev.startDate, d7Prev.endDate, filters),
    getChannelMetricsRows(channelId, d7Prev.startDate, d7Prev.endDate),
    getVideoMetricsRows(channelId, d30Curr.startDate, d30Curr.endDate, filters),
    getChannelMetricsRows(channelId, d30Curr.startDate, d30Curr.endDate),
    getVideoMetricsRows(channelId, d30Prev.startDate, d30Prev.endDate, filters),
    getChannelMetricsRows(channelId, d30Prev.startDate, d30Prev.endDate),
    getVideoMetricsRows(channelId, d90Curr.startDate, d90Curr.endDate, filters),
    getChannelMetricsRows(channelId, d90Curr.startDate, d90Curr.endDate),
    getVideoMetricsRows(channelId, d90Prev.startDate, d90Prev.endDate, filters),
    getChannelMetricsRows(channelId, d90Prev.startDate, d90Prev.endDate),
  ]);

  return {
    latestDate: latest,
    current,
    previous,
    channelCurrent,
    channelPrevious,
    d7: { current: computeStatsFromReports(asReportVideo(d7v), asReportChannel(d7c)), previous: computeStatsFromReports(asReportVideo(d7pv), asReportChannel(d7pc)) },
    d30: { current: computeStatsFromReports(asReportVideo(d30v), asReportChannel(d30c)), previous: computeStatsFromReports(asReportVideo(d30pv), asReportChannel(d30pc)) },
    d90: { current: computeStatsFromReports(asReportVideo(d90v), asReportChannel(d90c)), previous: computeStatsFromReports(asReportVideo(d90pv), asReportChannel(d90pc)) },
  };
}

async function loadSummaryFromPostgres({ channelId, filters = '', latestDate, trueDelta = false }) {
  if (!isPostgresConfigured()) return null;
  const latest = latestDate || (await getLatestMetricDate(channelId, filters));
  if (!latest) return null;
  const bundle = await loadBundleFromPostgres({ channelId, period: 90, compare: true, trueDelta, filters, latestDate: latest });
  if (!bundle) return null;
  return {
    latestDate: bundle.latestDate,
    d7: bundle.d7,
    d30: bundle.d30,
    d90: bundle.d90,
  };
}

async function loadChannelVideosFromPostgres(channelId, limit) {
  if (!isPostgresConfigured()) return null;
  // No numeric limit → full catalog (dashboard "All" must see every video,
  // e.g. channels with >500 uploads). A positive number keeps the old
  // clamped LIMIT behavior for callers that page explicitly.
  const maxRows = Number(limit);
  const useLimit = Number.isFinite(maxRows) && maxRows > 0;
  const res = await safeQuery(
    `SELECT video_id, title, description, published_at, thumbnail_url, duration, tags,
            view_count, like_count, comment_count, average_view_duration, position, privacy_status
     FROM analytics_videos
     WHERE channel_id = $1
     ORDER BY COALESCE(position, 999999) ASC, published_at DESC
     ${useLimit ? 'LIMIT $2' : ''}`,
    useLimit ? [channelId, Math.max(1, Math.floor(maxRows))] : [channelId]
  );
  if (!res?.rows?.length) return null;
  return res.rows.map((r) => ({
    videoId: r.video_id,
    title: r.title,
    description: r.description,
    publishedAt: r.published_at,
    thumbnailUrl: r.thumbnail_url,
    duration: r.duration,
    tags: Array.isArray(r.tags) ? r.tags : [],
    viewCount: Number(r.view_count || 0),
    likeCount: Number(r.like_count || 0),
    commentCount: Number(r.comment_count || 0),
    averageViewDuration: Number(r.average_view_duration || 0),
    position: Number(r.position || 0),
    privacyStatus: r.privacy_status || undefined,
  }));
}

async function getChannelLastSyncedAt(channelId) {
  if (!isPostgresConfigured()) return null;
  const res = await query('SELECT last_synced_at FROM analytics_channels WHERE channel_id = $1', [channelId]);
  if (!res?.rowCount) return null;
  return res.rows[0].last_synced_at || null;
}

/**
 * Postgres-first lookup for a batch of video IDs. Returns a map keyed by
 * video ID for any videos already ingested into analytics_videos (the user's
 * connected channels, refreshed by the 6-hour ingestion cron). Unresolvable
 * IDs are simply absent from the map so callers can fall back to the live
 * YouTube API for them (e.g. pasted URLs from channels not ingested).
 *
 * @param {string[]} ids - YouTube video IDs (max 50)
 * @returns {Promise<Object<string, object>>}
 */
async function getVideosByIds(ids) {
  if (!isPostgresConfigured() || !Array.isArray(ids) || ids.length === 0) return {};
  const clean = ids.filter((x) => typeof x === 'string' && x).slice(0, 50);
  if (!clean.length) return {};
  const res = await safeQuery(
    `SELECT v.video_id, v.channel_id, v.title, v.description, v.published_at,
            v.thumbnail_url, v.duration, v.tags, v.privacy_status,
            v.view_count, v.like_count, v.comment_count, v.average_view_duration, c.title AS channel_title
     FROM analytics_videos v
     JOIN analytics_channels c ON c.channel_id = v.channel_id
     WHERE v.video_id = ANY($1)`,
    [clean]
  );
  const out = {};
  for (const r of res?.rows || []) {
    out[r.video_id] = {
      videoId: r.video_id,
      channelId: r.channel_id,
      channelTitle: r.channel_title,
      title: r.title,
      description: r.description,
      publishedAt: r.published_at,
      thumbnailUrl: r.thumbnail_url,
      duration: r.duration,
      tags: Array.isArray(r.tags) ? r.tags : [],
      viewCount: Number(r.view_count || 0),
      likeCount: Number(r.like_count || 0),
      commentCount: Number(r.comment_count || 0),
      averageViewDuration: Number(r.average_view_duration || 0),
      privacyStatus: r.privacy_status || undefined,
    };
  }
  return out;
}

async function loadChannelTotalsFromPostgres(channelId, startDate, endDate) {
  if (!isPostgresConfigured()) return null;
  const { rows } = await safeQuery(`
    SELECT
      COALESCE(SUM(views), 0)               AS views,
      COALESCE(SUM(estimated_minutes_watched), 0)  AS watch_time,
      COALESCE(SUM(subscribers_gained), 0)  AS subscribers_gained,
      COALESCE(SUM(subscribers_lost), 0)    AS subscribers_lost,
      COALESCE(SUM(likes), 0)               AS likes,
      COALESCE(SUM(comments), 0)            AS comments,
      COALESCE(SUM(shares), 0)              AS shares
    FROM analytics_video_metrics_daily
    WHERE channel_id = $1
      AND metric_date BETWEEN $2::date AND $3::date
      AND filters_key = ''
  `, [channelId, startDate, endDate]);
  if (!rows?.length) return null;
  return {
    views: Number(rows[0].views),
    watch_time: Number(rows[0].watch_time),
    subscribers_gained: Number(rows[0].subscribers_gained),
    subscribers_lost: Number(rows[0].subscribers_lost),
    likes: Number(rows[0].likes),
    comments: Number(rows[0].comments),
    shares: Number(rows[0].shares),
  };
}

// ── Playlist read-model ───────────────────────────────────────────────────────
// Playlists follow the same ladder as the video catalog: L1 serverCache →
// L2 Postgres (these tables, warmed by the 6-hour ingestion cron) → L3 live
// YouTube API. The API is only consulted when Postgres has nothing usable or
// the catalog is older than the staleness window below, so the playlist paths
// carry near-zero steady-state YouTube quota.

/** Reads a non-negative hour count from env; invalid values fall back. */
function envHours(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

/**
 * Max age of the ingested playlist catalog before the read path refreshes from
 * YouTube. Defaults to 6h to line up with the ingestion cron
 * (`0 3,9,15,21 * * *`). Set to 0 to always treat Postgres as stale.
 */
const PLAYLIST_READ_MODEL_MAX_AGE_HOURS = envHours('PLAYLISTS_READ_MODEL_MAX_AGE_HOURS', 6);

/**
 * Pure staleness check for read-model timestamps. Missing/unparseable stamps
 * count as stale (never synced), and a maxAgeHours of 0 disables the tier.
 */
function isStale(syncedAt, maxAgeHours = PLAYLIST_READ_MODEL_MAX_AGE_HOURS, now = Date.now()) {
  if (!syncedAt) return true;
  if (!(maxAgeHours > 0)) return true;
  const ts = new Date(syncedAt).getTime();
  if (!Number.isFinite(ts)) return true;
  return now - ts > maxAgeHours * 60 * 60 * 1000;
}

function mapPlaylistRow(r) {
  return {
    playlistId: r.playlist_id,
    channelId: r.channel_id,
    title: r.title,
    description: r.description,
    channelTitle: r.channel_title,
    publishedAt: r.published_at,
    thumbnailUrl: r.thumbnail_url,
    itemCount: r.item_count === null || r.item_count === undefined ? null : Number(r.item_count),
    privacyStatus: r.privacy_status || undefined,
    lastSyncedAt: r.last_synced_at,
    itemsSyncedAt: r.items_synced_at,
  };
}

/** Channel-level playlist-catalog freshness stamp (NULL = never synced). */
async function getPlaylistsSyncedAt(channelId) {
  if (!isPostgresConfigured()) return null;
  const res = await safeQuery(
    'SELECT playlists_synced_at FROM analytics_channels WHERE channel_id = $1',
    [channelId]
  );
  if (!res?.rowCount) return null;
  return res.rows[0].playlists_synced_at || null;
}

/**
 * Playlist catalog for a channel. Returns null when Postgres has no rows so
 * callers fall through to the live API.
 *
 * @param {string} channelId
 * @param {object} [opts]
 * @param {number} [opts.maxResults] - cap the number of rows
 * @param {boolean} [opts.includePrivate] - include unlisted/private rows
 *   (only meaningful when the sync ran with an owner OAuth token). Defaults to
 *   false: the public-only contract the playlist tool always had.
 */
async function loadPlaylistsFromPostgres(channelId, { maxResults, includePrivate = false } = {}) {
  if (!isPostgresConfigured()) return null;
  const limit = Number(maxResults);
  const useLimit = Number.isFinite(limit) && limit > 0;
  const res = await safeQuery(
    `SELECT playlist_id, channel_id, title, description, channel_title, published_at,
            thumbnail_url, item_count, privacy_status, last_synced_at, items_synced_at
     FROM analytics_playlists
     WHERE channel_id = $1
       ${includePrivate ? '' : "AND COALESCE(privacy_status, 'public') = 'public'"}
     ORDER BY published_at DESC NULLS LAST, title ASC
     ${useLimit ? 'LIMIT $2' : ''}`,
    useLimit ? [channelId, Math.floor(limit)] : [channelId]
  );
  if (!res?.rows?.length) return null;
  return res.rows.map(mapPlaylistRow);
}

/** Single playlist metadata row, or null when it has never been ingested. */
async function loadPlaylistMetaFromPostgres(playlistId) {
  if (!isPostgresConfigured()) return null;
  const res = await safeQuery(
    `SELECT playlist_id, channel_id, title, description, channel_title, published_at,
            thumbnail_url, item_count, privacy_status, last_synced_at, items_synced_at
     FROM analytics_playlists
     WHERE playlist_id = $1`,
    [playlistId]
  );
  if (!res?.rows?.length) return null;
  return mapPlaylistRow(res.rows[0]);
}

/** Playlist membership in playlist order, or null when never ingested. */
async function loadPlaylistItemsFromPostgres(playlistId, maxItems) {
  if (!isPostgresConfigured()) return null;
  const limit = Number(maxItems);
  const useLimit = Number.isFinite(limit) && limit > 0;
  const res = await safeQuery(
    `SELECT playlist_id, video_id, position, title, published_at, thumbnail_url, privacy_status
     FROM analytics_playlist_items
     WHERE playlist_id = $1
     ORDER BY COALESCE(position, 999999) ASC, published_at DESC
     ${useLimit ? 'LIMIT $2' : ''}`,
    useLimit ? [playlistId, Math.floor(limit)] : [playlistId]
  );
  if (!res?.rows?.length) return null;
  return res.rows.map((r) => ({
    playlistId: r.playlist_id,
    videoId: r.video_id,
    position: r.position === null || r.position === undefined ? null : Number(r.position),
    title: r.title,
    publishedAt: r.published_at,
    thumbnailUrl: r.thumbnail_url,
    privacyStatus: r.privacy_status || undefined,
  }));
}

module.exports = {
  loadBundleFromPostgres,
  loadSummaryFromPostgres,
  loadChannelVideosFromPostgres,
  getChannelLastSyncedAt,
  loadChannelTotalsFromPostgres,
  getLatestMetricDate,
  getVideosByIds,
  isStale,
  PLAYLIST_READ_MODEL_MAX_AGE_HOURS,
  getPlaylistsSyncedAt,
  loadPlaylistsFromPostgres,
  loadPlaylistMetaFromPostgres,
  loadPlaylistItemsFromPostgres,
};
