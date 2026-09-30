/**
 * Drizzle ORM-based analytics read models.
 *
 * Replaces raw SQL in readModels.js with Drizzle's query builder,
 * guaranteeing parameterized queries (zero SQL injection risk).
 *
 * Uses the same `getDb()` from the shared pg Pool so connection limits,
 * timeouts, and pooling are identical to the raw-path.
 *
 * Import alongside or instead of readModels.js -- both return the same
 * shapes so the rest of the app doesn't notice.
 */
const { and, eq, sql, asc, desc } = require('drizzle-orm');
const {
  analyticsVideos,
  analyticsVideoMetricsDaily,
  analyticsChannelMetricsDaily,
  analyticsChannels,
} = require('../db/schema');

// ── Helpers ─────────────────────────────────────────────────────────────────

function dayStr(value) {
  if (!value) return null;
  return new Date(value).toISOString().split('T')[0];
}

/**
 * Get the Drizzle instance or warn once.
 */
let warned = false;
function useDb(getDb) {
  const db = getDb();
  if (!db) {
    if (!warned) {
      warned = true;
      console.warn('[Drizzle] Postgres not configured -- read models return null.');
    }
    return null;
  }
  return db;
}

// ── Read Models ─────────────────────────────────────────────────────────────

/**
 * Get the latest metric date for a channel + filters key.
 */
async function getLatestMetricDate(getDb, channelId, filters = '') {
  const db = useDb(getDb);
  if (!db) return null;

  const rows = await db
    .select({ metricDate: analyticsVideoMetricsDaily.metricDate })
    .from(analyticsVideoMetricsDaily)
    .where(
      and(
        eq(analyticsVideoMetricsDaily.channelId, channelId),
        eq(analyticsVideoMetricsDaily.filtersKey, filters),
      ),
    )
    .orderBy(desc(analyticsVideoMetricsDaily.metricDate))
    .limit(1);

  return rows.length ? dayStr(rows[0].metricDate) : null;
}

/**
 * Get daily video metric rows for a channel + date range + filters.
 * Returns the same array-of-arrays shape as readModels.js so callers
 * that reshape the data (asReportVideo, computeStatsFromReports) work
 * identically.
 */
async function getVideoMetricsRows(getDb, channelId, startDate, endDate, filters = '') {
  const db = useDb(getDb);
  if (!db) return [];

  const rows = await db
    .select({
      metricDate: analyticsVideoMetricsDaily.metricDate,
      views: analyticsVideoMetricsDaily.views,
      estimatedMinutesWatched: analyticsVideoMetricsDaily.estimatedMinutesWatched,
      averageViewPercentage: analyticsVideoMetricsDaily.averageViewPercentage,
      averageViewDuration: analyticsVideoMetricsDaily.averageViewDuration,
      engagedViews: analyticsVideoMetricsDaily.engagedViews,
      viewerPercentage: analyticsVideoMetricsDaily.viewerPercentage,
      subscribersGained: analyticsVideoMetricsDaily.subscribersGained,
      subscribersLost: analyticsVideoMetricsDaily.subscribersLost,
      likes: analyticsVideoMetricsDaily.likes,
      shares: analyticsVideoMetricsDaily.shares,
      comments: analyticsVideoMetricsDaily.comments,
      cardImpressions: analyticsVideoMetricsDaily.cardImpressions,
      cardClicks: analyticsVideoMetricsDaily.cardClicks,
      cardClickRate: analyticsVideoMetricsDaily.cardClickRate,
      cardTeaserImpressions: analyticsVideoMetricsDaily.cardTeaserImpressions,
      cardTeaserClicks: analyticsVideoMetricsDaily.cardTeaserClicks,
      cardTeaserClickRate: analyticsVideoMetricsDaily.cardTeaserClickRate,
      averageConcurrentViewers: analyticsVideoMetricsDaily.averageConcurrentViewers,
      peakConcurrentViewers: analyticsVideoMetricsDaily.peakConcurrentViewers,
    })
    .from(analyticsVideoMetricsDaily)
    .where(
      and(
        eq(analyticsVideoMetricsDaily.channelId, channelId),
        eq(analyticsVideoMetricsDaily.filtersKey, filters),
        sql`${analyticsVideoMetricsDaily.metricDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
      ),
    )
    .orderBy(asc(analyticsVideoMetricsDaily.metricDate));

  return rows.map((r) => [
    dayStr(r.metricDate),
    Number(r.views || 0),
    Number(r.estimatedMinutesWatched || 0),
    Number(r.averageViewPercentage || 0),
    Number(r.averageViewDuration || 0),
    Number(r.engagedViews || 0),
    Number(r.viewerPercentage || 0),
    Number(r.subscribersGained || 0),
    Number(r.subscribersLost || 0),
    Number(r.likes || 0),
    Number(r.shares || 0),
    Number(r.comments || 0),
    Number(r.cardImpressions || 0),
    Number(r.cardClicks || 0),
    Number(r.cardClickRate || 0),
    Number(r.cardTeaserImpressions || 0),
    Number(r.cardTeaserClicks || 0),
    Number(r.cardTeaserClickRate || 0),
    Number(r.averageConcurrentViewers || 0),
    Number(r.peakConcurrentViewers || 0),
  ]);
}

/**
 * Get daily channel metric rows for a channel + date range.
 */
async function getChannelMetricsRows(getDb, channelId, startDate, endDate) {
  const db = useDb(getDb);
  if (!db) return [];

  const rows = await db
    .select({
      metricDate: analyticsChannelMetricsDaily.metricDate,
      subscribersGained: analyticsChannelMetricsDaily.subscribersGained,
      subscribersLost: analyticsChannelMetricsDaily.subscribersLost,
      likes: analyticsChannelMetricsDaily.likes,
      shares: analyticsChannelMetricsDaily.shares,
      comments: analyticsChannelMetricsDaily.comments,
    })
    .from(analyticsChannelMetricsDaily)
    .where(
      and(
        eq(analyticsChannelMetricsDaily.channelId, channelId),
        sql`${analyticsChannelMetricsDaily.metricDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
      ),
    )
    .orderBy(asc(analyticsChannelMetricsDaily.metricDate));

  return rows.map((r) => [
    dayStr(r.metricDate),
    Number(r.subscribersGained || 0),
    Number(r.subscribersLost || 0),
    Number(r.likes || 0),
    Number(r.shares || 0),
    Number(r.comments || 0),
  ]);
}

/**
 * Get a channel's last synced timestamp.
 */
async function getChannelLastSyncedAt(getDb, channelId) {
  const db = useDb(getDb);
  if (!db) return null;

  const rows = await db
    .select({ lastSyncedAt: analyticsChannels.lastSyncedAt })
    .from(analyticsChannels)
    .where(eq(analyticsChannels.channelId, channelId))
    .limit(1);

  return rows.length ? rows[0].lastSyncedAt : null;
}

/**
 * Get channel totals (aggregated sums) for a date range.
 */
async function loadChannelTotalsFromPostgres(getDb, channelId, startDate, endDate) {
  const db = useDb(getDb);
  if (!db) return null;

  const rows = await db
    .select({
      views: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.views}), 0)`,
      watchTime: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.estimatedMinutesWatched}), 0)`,
      subscribersGained: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.subscribersGained}), 0)`,
      subscribersLost: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.subscribersLost}), 0)`,
      likes: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.likes}), 0)`,
      comments: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.comments}), 0)`,
      shares: sql`COALESCE(SUM(${analyticsVideoMetricsDaily.shares}), 0)`,
    })
    .from(analyticsVideoMetricsDaily)
    .where(
      and(
        eq(analyticsVideoMetricsDaily.channelId, channelId),
        sql`${analyticsVideoMetricsDaily.metricDate} BETWEEN ${startDate}::date AND ${endDate}::date`,
        eq(analyticsVideoMetricsDaily.filtersKey, ''),
      ),
    );

  if (!rows.length) return null;
  const r = rows[0];
  return {
    views: Number(r.views),
    watch_time: Number(r.watchTime),
    subscribers_gained: Number(r.subscribersGained),
    subscribers_lost: Number(r.subscribersLost),
    likes: Number(r.likes),
    comments: Number(r.comments),
    shares: Number(r.shares),
  };
}

/**
 * Load channel videos from Postgres.
 */
async function loadChannelVideosFromPostgres(getDb, channelId, limit) {
  const db = useDb(getDb);
  if (!db) return null;

  // Mirror of the pg read model: no numeric limit → full catalog.
  const maxRows = Number(limit);
  const useLimit = Number.isFinite(maxRows) && maxRows > 0;
  const baseQuery = db
    .select()
    .from(analyticsVideos)
    .where(eq(analyticsVideos.channelId, channelId))
    .orderBy(
      sql`COALESCE(${analyticsVideos.position}, 999999) ASC`,
      desc(analyticsVideos.publishedAt),
    );

  const rows = useLimit
    ? await baseQuery.limit(Math.max(1, Math.floor(maxRows)))
    : await baseQuery;

  if (!rows.length) return null;

  return rows.map((r) => ({
    videoId: r.videoId,
    title: r.title,
    description: r.description,
    publishedAt: r.publishedAt,
    thumbnailUrl: r.thumbnailUrl,
    duration: r.duration,
    tags: Array.isArray(r.tags) ? r.tags : [],
    viewCount: Number(r.viewCount || 0),
    likeCount: Number(r.likeCount || 0),
    commentCount: Number(r.commentCount || 0),
    averageViewDuration: Number(r.averageViewDuration || 0),
    position: Number(r.position || 0),
  }));
}

module.exports = {
  getLatestMetricDate,
  getVideoMetricsRows,
  getChannelMetricsRows,
  getChannelLastSyncedAt,
  loadChannelTotalsFromPostgres,
  loadChannelVideosFromPostgres,
};
