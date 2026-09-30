/**
 * Org Analytics Service
 *
 * Aggregates PostgreSQL read models (analytics_video_metrics_daily) across
 * ALL channels connected to an organization so owners can compare channel
 * performance. Zero YouTube quota -- pure read-model aggregation.
 */
const PERIOD_DAYS = { "7d": 7, "30d": 30, "90d": 90 };
const CACHE_TTL_MS = 30 * 60 * 1000; // 30 minutes
const crypto = require("crypto");

const METRIC_KEYS = [
  "views", "watchMinutes", "likes", "comments", "shares", "subsGained", "subsLost",
];

const EMPTY_METRICS = Object.freeze({
  views: 0, watchMinutes: 0, likes: 0, comments: 0,
  shares: 0, subsGained: 0, subsLost: 0, netSubs: 0,
});

function toUtcDateStr(d) {
  return d.toISOString().slice(0, 10);
}

function num(v) {
  const n = Number(v || 0);
  return Number.isFinite(n) ? n : 0;
}

/** Percent delta current vs previous; null when previous is 0 (avoid /0). */
function pctDelta(current, previous) {
  if (!previous) return null;
  return Math.round(((current - previous) / previous) * 1000) / 10;
}

function emptyTotals() {
  return { ...EMPTY_METRICS };
}

function accumulate(totals, row) {
  for (const key of METRIC_KEYS) totals[key] += num(row[key]);
  totals.netSubs = totals.subsGained - totals.subsLost;
}

function buildDeltas(totals, prevTotals) {
  const deltas = {};
  for (const key of METRIC_KEYS) deltas[key] = pctDelta(totals[key], prevTotals[key]);
  deltas.netSubs = pctDelta(totals.netSubs, prevTotals.netSubs);
  return deltas;
}

function createOrgAnalyticsService(deps) {
  const {
    db,
    serverCache,
    getCachedOrgMembership,
    query: pgQuery,
    isPostgresConfigured,
    withInFlightTimeout,
  } = deps;

  const inflightMap = new Map();

  /** Daily metric rows for a channel set covering prevStart..end. */
  async function fetchDailyRows(channelIds, prevStart, end) {
    const { rows } = await pgQuery(
      `SELECT channel_id, metric_date,
              SUM(views)                     AS views,
              SUM(estimated_minutes_watched) AS "watchMinutes",
              SUM(likes)                     AS likes,
              SUM(comments)                  AS comments,
              SUM(shares)                    AS shares,
              SUM(subscribers_gained)        AS "subsGained",
              SUM(subscribers_lost)          AS "subsLost"
       FROM analytics_video_metrics_daily
       WHERE channel_id = ANY($1::text[])
         AND metric_date BETWEEN $2::date AND $3::date
         AND filters_key = ''
       GROUP BY channel_id, metric_date
       ORDER BY channel_id, metric_date`,
      [channelIds, prevStart, end],
    );
    return rows || [];
  }

  /**
   * All-time (lifetime) aggregates per channel — main KPI card values.
   *
   * IMPORTANT: analytics_video_metrics_daily is a rolling ingestion window
   * (~90 days of daily deltas), NOT a lifetime ledger — summing it does NOT
   * give lifetime totals. True cumulative counters live on analytics_videos
   * (view_count / like_count / comment_count synced from YouTube).
   * Watch minutes and subscriber deltas have no cumulative source, so they
   * fall back to the full daily history (earliest row onward) and the
   * frontend labels them with that history start.
   */
  async function fetchLifetimeRows(channelIds) {
    const videoRes = await pgQuery(
      `SELECT channel_id,
              COALESCE(SUM(view_count), 0)    AS views,
              COALESCE(SUM(like_count), 0)    AS likes,
              COALESCE(SUM(comment_count), 0) AS comments
       FROM analytics_videos
       WHERE channel_id = ANY($1::text[])
       GROUP BY channel_id`,
      [channelIds],
    );
    const dailyRes = await pgQuery(
      `SELECT channel_id,
              SUM(estimated_minutes_watched) AS "watchMinutes",
              SUM(subscribers_gained)        AS "subsGained",
              SUM(subscribers_lost)          AS "subsLost",
              MIN(metric_date)               AS "historyStart"
       FROM analytics_video_metrics_daily
       WHERE channel_id = ANY($1::text[])
         AND filters_key = ''
       GROUP BY channel_id`,
      [channelIds],
    );
    const byChannel = new Map();
    const dailyByChannel = new Map();
    for (const row of dailyRes.rows || []) dailyByChannel.set(row.channel_id, row);
    for (const row of videoRes.rows || []) {
      const daily = dailyByChannel.get(row.channel_id) || {};
      byChannel.set(row.channel_id, {
        views: row.views,
        likes: row.likes,
        comments: row.comments,
        watchMinutes: daily.watchMinutes ?? 0,
        subsGained: daily.subsGained ?? 0,
        subsLost: daily.subsLost ?? 0,
        historyStart: daily.historyStart ?? null,
      });
    }
    // Channels with daily history but no video rows yet
    for (const [channelId, daily] of dailyByChannel) {
      if (!byChannel.has(channelId)) {
        byChannel.set(channelId, {
          views: 0, likes: 0, comments: 0,
          watchMinutes: daily.watchMinutes ?? 0,
          subsGained: daily.subsGained ?? 0,
          subsLost: daily.subsLost ?? 0,
          historyStart: daily.historyStart ?? null,
        });
      }
    }
    return byChannel;
  }

  /** Channel meta (title, video count, last sync) from read models. */
  async function fetchChannelMeta(channelIds) {
    const { rows } = await pgQuery(
      `SELECT c.channel_id    AS "channelId",
              c.title,
              c.last_synced_at AS "lastSyncedAt",
              (SELECT COUNT(*) FROM analytics_videos v
                WHERE v.channel_id = c.channel_id) AS "videoCount"
       FROM analytics_channels c
       WHERE c.channel_id = ANY($1::text[])`,
      [channelIds],
    );
    const meta = new Map();
    for (const r of rows || []) {
      meta.set(r.channelId, {
        title: r.title || null,
        videoCount: num(r.videoCount),
        lastSyncedAt: r.lastSyncedAt ? new Date(r.lastSyncedAt).toISOString() : null,
      });
    }
    return meta;
  }

  /** Org channel IDs from Firestore `organizations/{orgId}/channels`. */
  async function listOrgChannels(orgId) {
    const snap = await db
      .collection("organizations")
      .doc(String(orgId))
      .collection("channels")
      .get();
    const ids = [];
    snap.forEach((doc) => {
      const data = doc.data() || {};
      const id = data.channelId || data.id || doc.id;
      if (id && !ids.includes(id)) ids.push(id);
    });
    return ids;
  }

  async function computeAnalytics(orgId, orgChannelIds, period, customRange) {
    const end = toUtcDateStr(new Date());
    let days;
    let start;
    if (period === "custom" && customRange?.start && customRange?.end) {
      start = customRange.start;
      days =
        Math.round(
          (Date.parse(`${customRange.end}T00:00:00Z`) -
            Date.parse(`${start}T00:00:00Z`)) / 86400000,
        ) + 1;
    } else {
      days = PERIOD_DAYS[period] || PERIOD_DAYS["30d"];
      start = toUtcDateStr(new Date(Date.now() - (days - 1) * 86400000));
    }
    const prevStart = toUtcDateStr(new Date(Date.parse(`${start}T00:00:00Z`) - days * 86400000));

    const [dailyRows, meta, lifetimeRows] = await Promise.all([
      fetchDailyRows(orgChannelIds, prevStart, end),
      fetchChannelMeta(orgChannelIds),
      fetchLifetimeRows(orgChannelIds),
    ]);

    // channelId -> { current: Map<date, row>, prev: Map<date, row> }
    const byChannel = new Map();
    const orgCurrentByDate = new Map(); // date -> totals
    for (const row of dailyRows) {
      const date = String(row.metric_date).slice(0, 10);
      const bucket = date >= start ? "current" : "prev";
      let entry = byChannel.get(row.channel_id);
      if (!entry) {
        entry = { current: new Map(), prev: new Map() };
        byChannel.set(row.channel_id, entry);
      }
      entry[bucket].set(date, row);
      if (bucket === "current") {
        let agg = orgCurrentByDate.get(date);
        if (!agg) {
          agg = emptyTotals();
          orgCurrentByDate.set(date, agg);
        }
        accumulate(agg, row);
      }
    }

    const buildTotals = (map) => {
      const totals = emptyTotals();
      for (const row of map.values()) accumulate(totals, row);
      return totals;
    };

    const mapToSeries = (map) =>
      [...map.entries()]
        .sort((a, b) => (a[0] < b[0] ? -1 : 1))
        .map(([date, row]) => {
          const point = { date };
          for (const key of METRIC_KEYS) point[key] = num(row[key]);
          point.netSubs = point.subsGained - point.subsLost;
          return point;
        });

    const orgTotals = buildTotals(
      new Map([...orgCurrentByDate.entries()].map(([d, t]) => [d, t])),
    );
    const orgPrevTotals = emptyTotals();
    for (const entry of byChannel.values()) {
      for (const row of entry.prev.values()) accumulate(orgPrevTotals, row);
    }

    const orgLifetime = emptyTotals();
    for (const row of lifetimeRows.values()) accumulate(orgLifetime, row);

    const channels = [];
    for (const channelId of orgChannelIds) {
      const entry =
        byChannel.get(channelId) || { current: new Map(), prev: new Map() };
      const totals = buildTotals(entry.current);
      const prevTotals = buildTotals(entry.prev);
      const lifetime = emptyTotals();
      const lifeRow = lifetimeRows.get(channelId);
      if (lifeRow) accumulate(lifetime, lifeRow);
      const m = meta.get(channelId) || {};
      channels.push({
        channelId,
        title: m.title || null,
        videoCount: m.videoCount || 0,
        lastSyncedAt: m.lastSyncedAt || null,
        // Earliest day of ingested daily metrics — watch-minutes & subscriber
        // lifetime figures only cover this window (views/likes/comments are
        // true cumulative totals from analytics_videos).
        historyStart: lifeRow?.historyStart
          ? String(lifeRow.historyStart).slice(0, 10)
          : null,
        totals,
        prevTotals,
        lifetime,
        deltas: buildDeltas(totals, prevTotals),
        series: mapToSeries(entry.current),
      });
    }
    // Leaderboard order: best-performing (most views) first
    channels.sort((a, b) => b.totals.views - a.totals.views);

    return {
      configured: true,
      orgId,
      period,
      range: { start, end, prevStart },
      totals: orgTotals,
      prevTotals: orgPrevTotals,
      lifetime: orgLifetime,
      historyStart: [...lifetimeRows.values()]
        .map((r) => r?.historyStart)
        .filter(Boolean)
        .sort()[0] || null,
      deltas: buildDeltas(orgTotals, orgPrevTotals),
      series: mapToSeries(orgCurrentByDate),
      channels,
    };
  }

  const ISO_DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_CUSTOM_RANGE_DAYS = 730;

  async function getOrgAnalytics({ orgId, uid, period = "30d", start, end }) {
    if (!orgId) throw new Error("Missing orgId");
    if (!uid) throw Object.assign(new Error("Missing authenticated user"), { statusCode: 401 });
    let normalizedPeriod = PERIOD_DAYS[period] ? period : "30d";
    let customRange = null;
    if (period === "custom") {
      if (!ISO_DATE_RE.test(String(start || "")) || !ISO_DATE_RE.test(String(end || ""))) {
        throw Object.assign(new Error("Custom range requires start and end dates (YYYY-MM-DD)"), { statusCode: 400 });
      }
      if (start > end) {
        throw Object.assign(new Error("Custom range start must be before end"), { statusCode: 400 });
      }
      const spanDays =
        (Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`)) / 86400000 + 1;
      if (spanDays > MAX_CUSTOM_RANGE_DAYS) {
        throw Object.assign(
          new Error(`Custom range is limited to ${MAX_CUSTOM_RANGE_DAYS} days`),
          { statusCode: 400 },
        );
      }
      customRange = { start, end };
      normalizedPeriod = "custom";
    }

    const membership = await getCachedOrgMembership(orgId, uid);
    if (!membership?.isMember) {
      throw Object.assign(new Error("Not a member of this organization"), { statusCode: 403 });
    }

    // Cache key includes a hash of the org's channel set so adding/removing a
    // channel immediately produces a fresh computation (channels are added
    // client-side to Firestore, so there is no backend invalidation hook).
    const orgChannelIds = await listOrgChannels(orgId);
    const channelSetHash = crypto
      .createHash("sha1")
      .update([...orgChannelIds].sort().join(","))
      .digest("hex")
      .slice(0, 8);
    const cacheKey = `org:analytics:${orgId}:${channelSetHash}:${normalizedPeriod}${
      customRange ? `:${customRange.start}:${customRange.end}` : ""
    }`;
    const cached = await serverCache.get(cacheKey);
    if (cached) return cached;

    if (!isPostgresConfigured()) {
      return {
        configured: false,
        orgId,
        period: normalizedPeriod,
        totals: emptyTotals(),
        prevTotals: emptyTotals(),
        lifetime: emptyTotals(),
        deltas: {},
        series: [],
        channels: [],
      };
    }

    const result = await withInFlightTimeout(inflightMap, cacheKey, () =>
      computeAnalytics(orgId, orgChannelIds, normalizedPeriod, customRange),
    );
    await serverCache.set(cacheKey, result, CACHE_TTL_MS).catch(() => {});
    return result;
  }

  return { getOrgAnalytics, PERIOD_DAYS };
}

module.exports = { createOrgAnalyticsService, EMPTY_METRICS, PERIOD_DAYS };

