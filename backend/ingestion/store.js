const { query, withClient } = require('../db/client');
const { getAnomalyConfig } = require('../config/anomalyConfig');

function isMissingRelationError(err) {
  return err?.code === '42P01' || /relation .* does not exist/i.test(String(err?.message || ''));
}

function normalizeFiltersKey(filters) {
  if (typeof filters !== 'string') return '';
  const trimmed = filters.trim();
  if (!trimmed) return '';
  const [lhs, rhs] = trimmed.split('==');
  if (!lhs || !rhs) return trimmed;
  const key = lhs.trim();
  if (key !== 'video' && key !== 'playlist') return trimmed;
  const normalizedIds = rhs
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean)
    .sort();
  if (!normalizedIds.length) return '';
  return `${key}==${normalizedIds.join(',')}`;
}

async function recordSyncRunStart(channelId) {
  const res = await query(
    `INSERT INTO analytics_sync_runs(channel_id, status, stats) VALUES ($1, 'running', '{}'::jsonb) RETURNING id`,
    [channelId || null]
  );
  return res?.rows?.[0]?.id || null;
}

async function recordSyncRunDone(runId, status, stats = {}, errorMessage = null) {
  if (!runId) return;
  await query(
    `UPDATE analytics_sync_runs
     SET status = $2, completed_at = NOW(), stats = $3::jsonb, error_message = $4
     WHERE id = $1`,
    [runId, status, JSON.stringify(stats || {}), errorMessage]
  );
}

async function upsertChannel({ channelId, title = null, uploadsPlaylistId = null, lastSyncedAt = null }) {
  await query(
    `INSERT INTO analytics_channels(channel_id, title, uploads_playlist_id, last_synced_at, updated_at)
     VALUES ($1, $2, $3, $4, NOW())
     ON CONFLICT(channel_id) DO UPDATE SET
       title = EXCLUDED.title,
       uploads_playlist_id = EXCLUDED.uploads_playlist_id,
       last_synced_at = EXCLUDED.last_synced_at,
       updated_at = NOW()`,
    [channelId, title, uploadsPlaylistId, lastSyncedAt]
  );
}

/**
 * Pick the catalog videos worth snapshotting for anomaly attribution: the top N
 * by lifetime views (they dominate channel-level moves) plus every video
 * published within `recentDays` (new uploads are the usual spike driver).
 * Pure — exported for tests.
 */
function selectVideosToSnapshot(videos, { maxVideos = 200, recentDays = 90, now = Date.now() } = {}) {
  const list = (Array.isArray(videos) ? videos : []).filter((v) => v && v.videoId);
  const cutoff = now - Math.max(0, recentDays) * 86400000;
  const recent = list.filter((v) => {
    const ts = v.publishedAt ? Date.parse(v.publishedAt) : NaN;
    return Number.isFinite(ts) && ts >= cutoff;
  });
  const top = [...list]
    .sort((a, b) => Number(b.viewCount || 0) - Number(a.viewCount || 0))
    .slice(0, Math.max(0, maxVideos));
  const byId = new Map();
  for (const v of [...top, ...recent]) byId.set(v.videoId, v);
  return Array.from(byId.values());
}

/**
 * Upsert today's per-video view counters (one row per video per UTC day; the
 * last sync of the day wins). Feeds per-video day-over-day deltas for anomaly
 * driver attribution with ZERO extra YouTube API calls — the counters come from
 * the catalog we already refetch every 6h.
 *
 * Best-effort by design: called after the catalog write commits (so a missing
 * table or a transient failure can never abort/roll back ingestion).
 */
async function snapshotVideoViews(channelId, videos, config = getAnomalyConfig()) {
  const targets = selectVideosToSnapshot(videos, {
    maxVideos: config.snapshotMaxVideos,
    recentDays: config.snapshotRecentDays,
  });
  if (!targets.length) return 0;

  const params = [];
  const values = targets.map((v) => {
    const base = params.length;
    params.push(v.videoId, channelId, Number(v.viewCount || 0), Number(v.likeCount || 0), Number(v.commentCount || 0));
    return `($${base + 1}, $${base + 2}, CURRENT_DATE, $${base + 3}, $${base + 4}, $${base + 5}, NOW())`;
  });

  try {
    await query(
      `INSERT INTO analytics_video_view_snapshots(
         video_id, channel_id, snapshot_date, view_count, like_count, comment_count, captured_at
       ) VALUES ${values.join(',')}
       ON CONFLICT(video_id, snapshot_date) DO UPDATE SET
         channel_id = EXCLUDED.channel_id,
         view_count = EXCLUDED.view_count,
         like_count = EXCLUDED.like_count,
         comment_count = EXCLUDED.comment_count,
         captured_at = NOW()`,
      params,
    );
    return targets.length;
  } catch (err) {
    if (!isMissingRelationError(err)) {
      console.warn(`[ingest] View snapshot failed for ${channelId}:`, err.message);
    }
    return 0;
  }
}

async function upsertVideos(channelId, videos) {
  if (!Array.isArray(videos) || videos.length === 0) return;
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const video of videos) {
        await client.query(
          `INSERT INTO analytics_videos(
            video_id, channel_id, title, description, published_at, thumbnail_url, duration, tags,
            view_count, like_count, comment_count, average_view_duration, position, privacy_status, updated_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11,$12,$13,$14,NOW())
          ON CONFLICT(video_id) DO UPDATE SET
            channel_id = EXCLUDED.channel_id,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            published_at = EXCLUDED.published_at,
            thumbnail_url = EXCLUDED.thumbnail_url,
            duration = EXCLUDED.duration,
            tags = EXCLUDED.tags,
            view_count = EXCLUDED.view_count,
            like_count = EXCLUDED.like_count,
            comment_count = EXCLUDED.comment_count,
            average_view_duration = EXCLUDED.average_view_duration,
            position = EXCLUDED.position,
            privacy_status = EXCLUDED.privacy_status,
            updated_at = NOW()`,
          [
            video.videoId,
            channelId,
            video.title || null,
            video.description || null,
            video.publishedAt || null,
            video.thumbnailUrl || null,
            video.duration || null,
            JSON.stringify(Array.isArray(video.tags) ? video.tags : []),
            Number(video.viewCount || 0),
            Number(video.likeCount || 0),
            Number(video.commentCount || 0),
            Number(video.averageViewDuration || 0),
            Number.isFinite(video.position) ? Number(video.position) : null,
            video.privacyStatus || null,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  // Dated counters for anomaly attribution, captured from the payload we just
  // wrote (no extra API calls). After COMMIT + best-effort so it can never
  // break ingestion.
  await snapshotVideoViews(channelId, videos);
}

async function upsertVideoMetricsDaily(channelId, rows, filters) {
  const filtersKey = normalizeFiltersKey(filters);
  if (!Array.isArray(rows) || rows.length === 0) return;
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const r of rows) {
        const metricDate = r.metricDate;
        await client.query(
          `INSERT INTO analytics_video_metrics_daily(
            channel_id, metric_date, views, estimated_minutes_watched, average_view_percentage,
            average_view_duration, engaged_views, viewer_percentage,
            subscribers_gained, subscribers_lost, likes, shares, comments,
            card_impressions, card_clicks, card_click_rate,
            card_teaser_impressions, card_teaser_clicks, card_teaser_click_rate,
            average_concurrent_viewers, peak_concurrent_viewers,
            filters_key, updated_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,NOW())
          ON CONFLICT(channel_id, metric_date, filters_key) DO UPDATE SET
            views = EXCLUDED.views,
            estimated_minutes_watched = EXCLUDED.estimated_minutes_watched,
            average_view_percentage = EXCLUDED.average_view_percentage,
            average_view_duration = EXCLUDED.average_view_duration,
            engaged_views = EXCLUDED.engaged_views,
            viewer_percentage = EXCLUDED.viewer_percentage,
            subscribers_gained = EXCLUDED.subscribers_gained,
            subscribers_lost = EXCLUDED.subscribers_lost,
            likes = EXCLUDED.likes,
            shares = EXCLUDED.shares,
            comments = EXCLUDED.comments,
            card_impressions = EXCLUDED.card_impressions,
            card_clicks = EXCLUDED.card_clicks,
            card_click_rate = EXCLUDED.card_click_rate,
            card_teaser_impressions = EXCLUDED.card_teaser_impressions,
            card_teaser_clicks = EXCLUDED.card_teaser_clicks,
            card_teaser_click_rate = EXCLUDED.card_teaser_click_rate,
            average_concurrent_viewers = EXCLUDED.average_concurrent_viewers,
            peak_concurrent_viewers = EXCLUDED.peak_concurrent_viewers,
            updated_at = NOW()`,
          [
            channelId,
            metricDate,
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
            filtersKey,
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

async function upsertChannelMetricsDaily(channelId, rows) {
  if (!Array.isArray(rows) || rows.length === 0) return;
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const r of rows) {
        await client.query(
          `INSERT INTO analytics_channel_metrics_daily(
            channel_id, metric_date, subscribers_gained, subscribers_lost, likes, shares, comments, updated_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,NOW())
          ON CONFLICT(channel_id, metric_date) DO UPDATE SET
            subscribers_gained = EXCLUDED.subscribers_gained,
            subscribers_lost = EXCLUDED.subscribers_lost,
            likes = EXCLUDED.likes,
            shares = EXCLUDED.shares,
            comments = EXCLUDED.comments,
            updated_at = NOW()`,
          [
            channelId,
            r.metricDate,
            Number(r.subscribersGained || 0),
            Number(r.subscribersLost || 0),
            Number(r.likes || 0),
            Number(r.shares || 0),
            Number(r.comments || 0),
          ]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
}

/**
 * Upsert a channel's playlist catalog and stamp the channel-level freshness
 * marker the read path gates on.
 *
 * Pruning: rows for this channel that this run did NOT see are deleted -- but
 * only when their `last_synced_at` predates `syncedAt`, so a partially-paged
 * or failed fetch can never wipe good rows. An empty array is meaningful
 * (channel genuinely has no playlists) and prunes everything for the channel.
 */
async function upsertPlaylists(channelId, playlists, { syncedAt = new Date().toISOString(), prune = true } = {}) {
  if (!Array.isArray(playlists)) return 0;
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const p of playlists) {
        if (!p?.playlistId) continue;
        await client.query(
          `INSERT INTO analytics_playlists(
            playlist_id, channel_id, title, description, channel_title, published_at,
            thumbnail_url, item_count, privacy_status, last_synced_at, updated_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::timestamptz, NOW())
          ON CONFLICT(playlist_id) DO UPDATE SET
            channel_id = EXCLUDED.channel_id,
            title = EXCLUDED.title,
            description = EXCLUDED.description,
            channel_title = EXCLUDED.channel_title,
            published_at = EXCLUDED.published_at,
            thumbnail_url = EXCLUDED.thumbnail_url,
            item_count = EXCLUDED.item_count,
            privacy_status = EXCLUDED.privacy_status,
            last_synced_at = EXCLUDED.last_synced_at,
            updated_at = NOW()`,
          [
            p.playlistId,
            channelId,
            p.title || null,
            p.description || null,
            p.channelTitle || null,
            p.publishedAt || null,
            p.thumbnailUrl || null,
            p.itemCount === undefined || p.itemCount === null ? null : Number(p.itemCount),
            p.privacyStatus || null,
            syncedAt,
          ]
        );
      }

      // Pruning + the channel freshness stamp only make sense for a FULL
      // catalog sync. A single-row write-through (e.g. one playlist looked up
      // on demand) must not delete the channel's other rows, so it passes
      // prune:false and leaves the freshness stamp alone.
      if (prune) {
        const seenIds = playlists.map((p) => p?.playlistId).filter(Boolean);
        await client.query(
          `DELETE FROM analytics_playlists
           WHERE channel_id = $1
             AND COALESCE(last_synced_at, created_at) < $2::timestamptz
             ${seenIds.length ? 'AND NOT (playlist_id = ANY($3))' : ''}`,
          seenIds.length ? [channelId, syncedAt, seenIds] : [channelId, syncedAt]
        );

        await client.query(
          `UPDATE analytics_channels
           SET playlists_synced_at = $2::timestamptz, updated_at = NOW()
           WHERE channel_id = $1`,
          [channelId, syncedAt]
        );
      }

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  return playlists.length;
}

/**
 * Upsert playlist membership (order + per-item metadata).
 *
 * Deliberately does NOT prune: the caller caps how many items it fetches, so
 * absence only means "beyond the sync cap", never "removed from the playlist".
 * Item deletes are rare and the cap is refreshed on the next run anyway.
 * Stamps the playlist's `items_synced_at` so the read path can gate on it.
 */
async function upsertPlaylistItems(playlistId, items, { syncedAt = new Date().toISOString() } = {}) {
  if (!Array.isArray(items) || items.length === 0) return 0;
  await withClient(async (client) => {
    await client.query('BEGIN');
    try {
      for (const it of items) {
        if (!it?.videoId) continue;
        await client.query(
          `INSERT INTO analytics_playlist_items(
            playlist_id, video_id, position, title, published_at, thumbnail_url, privacy_status, updated_at
          ) VALUES($1,$2,$3,$4,$5,$6,$7, NOW())
          ON CONFLICT(playlist_id, video_id) DO UPDATE SET
            position = EXCLUDED.position,
            title = EXCLUDED.title,
            published_at = EXCLUDED.published_at,
            thumbnail_url = EXCLUDED.thumbnail_url,
            privacy_status = EXCLUDED.privacy_status,
            updated_at = NOW()`,
          [
            playlistId,
            it.videoId,
            it.position === undefined || it.position === null ? null : Number(it.position),
            it.title || null,
            it.publishedAt || null,
            it.thumbnailUrl || null,
            it.privacyStatus || null,
          ]
        );
      }

      await client.query(
        `UPDATE analytics_playlists
         SET items_synced_at = $2::timestamptz, updated_at = NOW()
         WHERE playlist_id = $1`,
        [playlistId, syncedAt]
      );

      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    }
  });
  return items.length;
}

module.exports = {
  recordSyncRunStart,
  recordSyncRunDone,
  upsertChannel,
  upsertVideos,
  snapshotVideoViews,
  selectVideosToSnapshot,
  upsertVideoMetricsDaily,
  upsertChannelMetricsDaily,
  upsertPlaylists,
  upsertPlaylistItems,
  normalizeFiltersKey,
};
