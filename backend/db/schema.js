const { sql, isNotNull } = require('drizzle-orm');
const {
  pgTable, text, timestamp, bigint, doublePrecision, integer, jsonb, date, serial, uniqueIndex, primaryKey,
} = require('drizzle-orm/pg-core');

function now() { return sql`now()`; }

// ── Analytics Channels ──────────────────────────────────────────────────────

const analyticsChannels = pgTable('analytics_channels', {
  channelId: text('channel_id').primaryKey(),
  title: text('title'),
  uploadsPlaylistId: text('uploads_playlist_id'),
  lastSyncedAt: timestamp('last_synced_at', { withTimezone: true }),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
});

// ── Analytics Videos ────────────────────────────────────────────────────────

const analyticsVideos = pgTable('analytics_videos', {
  videoId: text('video_id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => analyticsChannels.channelId, { onDelete: 'cascade' }),
  title: text('title'),
  description: text('description'),
  publishedAt: timestamp('published_at', { withTimezone: true }),
  thumbnailUrl: text('thumbnail_url'),
  duration: text('duration'),
  tags: jsonb('tags').notNull().default('[]'),
  viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0),
  likeCount: bigint('like_count', { mode: 'number' }).notNull().default(0),
  commentCount: bigint('comment_count', { mode: 'number' }).notNull().default(0),
  averageViewDuration: doublePrecision('average_view_duration').notNull().default(0),
  position: integer('position'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
});

// ── Analytics Channel Metrics Daily ─────────────────────────────────────────

const analyticsChannelMetricsDaily = pgTable('analytics_channel_metrics_daily', {
  channelId: text('channel_id').notNull().references(() => analyticsChannels.channelId, { onDelete: 'cascade' }),
  metricDate: date('metric_date').notNull(),
  subscribersGained: bigint('subscribers_gained', { mode: 'number' }).notNull().default(0),
  subscribersLost: bigint('subscribers_lost', { mode: 'number' }).notNull().default(0),
  likes: bigint('likes', { mode: 'number' }).notNull().default(0),
  shares: bigint('shares', { mode: 'number' }).notNull().default(0),
  comments: bigint('comments', { mode: 'number' }).notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.metricDate] }),
]);

// ── Analytics Video Metrics Daily ───────────────────────────────────────────

const analyticsVideoMetricsDaily = pgTable('analytics_video_metrics_daily', {
  channelId: text('channel_id').notNull().references(() => analyticsChannels.channelId, { onDelete: 'cascade' }),
  metricDate: date('metric_date').notNull(),
  views: bigint('views', { mode: 'number' }).notNull().default(0),
  estimatedMinutesWatched: bigint('estimated_minutes_watched', { mode: 'number' }).notNull().default(0),
  averageViewPercentage: doublePrecision('average_view_percentage').notNull().default(0),
  averageViewDuration: doublePrecision('average_view_duration').notNull().default(0),
  engagedViews: bigint('engaged_views', { mode: 'number' }).notNull().default(0),
  viewerPercentage: doublePrecision('viewer_percentage').notNull().default(0),
  subscribersGained: bigint('subscribers_gained', { mode: 'number' }).notNull().default(0),
  subscribersLost: bigint('subscribers_lost', { mode: 'number' }).notNull().default(0),
  likes: bigint('likes', { mode: 'number' }).notNull().default(0),
  shares: bigint('shares', { mode: 'number' }).notNull().default(0),
  comments: bigint('comments', { mode: 'number' }).notNull().default(0),
  cardImpressions: bigint('card_impressions', { mode: 'number' }).notNull().default(0),
  cardClicks: bigint('card_clicks', { mode: 'number' }).notNull().default(0),
  cardClickRate: doublePrecision('card_click_rate').notNull().default(0),
  cardTeaserImpressions: bigint('card_teaser_impressions', { mode: 'number' }).notNull().default(0),
  cardTeaserClicks: bigint('card_teaser_clicks', { mode: 'number' }).notNull().default(0),
  cardTeaserClickRate: doublePrecision('card_teaser_click_rate').notNull().default(0),
  averageConcurrentViewers: bigint('average_concurrent_viewers', { mode: 'number' }).notNull().default(0),
  peakConcurrentViewers: bigint('peak_concurrent_viewers', { mode: 'number' }).notNull().default(0),
  filtersKey: text('filters_key').notNull().default(''),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
}, (table) => [
  primaryKey({ columns: [table.channelId, table.metricDate, table.filtersKey] }),
]);

// ── Analytics Sync Runs ─────────────────────────────────────────────────────

const analyticsSyncRuns = pgTable('analytics_sync_runs', {
  id: serial('id').primaryKey(),
  channelId: text('channel_id'),
  status: text('status').notNull(),
  startedAt: timestamp('started_at', { withTimezone: true }).notNull().default(now()),
  completedAt: timestamp('completed_at', { withTimezone: true }),
  errorMessage: text('error_message'),
  stats: jsonb('stats').notNull().default('{}'),
});

// ── Analytics Dashboard Snapshots ───────────────────────────────────────────

const analyticsDashboardSnapshots = pgTable('analytics_dashboard_snapshots', {
  snapshotKey: text('snapshot_key').primaryKey(),
  channelId: text('channel_id').notNull(),
  snapshotType: text('snapshot_type').notNull(),
  payload: jsonb('payload').notNull(),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
  expiresAt: timestamp('expires_at', { withTimezone: true }),
});

// ── User Access Flags ───────────────────────────────────────────────────────

const userAccessFlags = pgTable('user_access_flags', {
  uid: text('uid').primaryKey(),
  email: text('email'),
  role: text('role').notNull().default('user'),
  package: text('package').notNull().default('free'),
  source: text('source').notNull().default('firestore-sync'),
  updatedBy: text('updated_by'),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
}, (table) => [
  uniqueIndex('idx_user_access_flags_email_lower')
    .on(table.email)
    .where(isNotNull(table.email)),
]);

// ── Channel Focus & Knowledge ─────────────────────────────────────────────

const channelFocus = pgTable('channel_focus', {
  id: serial('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  organizationId: text('organization_id'),
  createdBy: text('created_by').notNull(),
  niche: text('niche'),
  audience: text('audience'),
  contentPillars: jsonb('content_pillars').notNull().default('[]'),
  tone: text('tone'),
  goalsNotes: text('goals_notes'),
  aiSnapshot: jsonb('ai_snapshot').notNull().default('{}'),
  source: text('source').notNull().default('manual'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
});

// ── Channel Goals ─────────────────────────────────────────────────────────

const channelGoals = pgTable('channel_goals', {
  id: serial('id').primaryKey(),
  channelId: text('channel_id').notNull(),
  organizationId: text('organization_id'),
  createdBy: text('created_by').notNull(),
  title: text('title'),
  metric: text('metric').notNull(),
  periodType: text('period_type').notNull(),
  periodKey: text('period_key'),
  startDate: date('start_date').notNull(),
  endDate: date('end_date').notNull(),
  targetValue: doublePrecision('target_value').notNull(),
  notes: text('notes'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
});

// ── Anomaly Detection ───────────────────────────────────────────────────────

const analyticsAnomalies = pgTable('analytics_anomalies', {
  id: serial('id').primaryKey(),
  channelId: text('channel_id').notNull().references(() => analyticsChannels.channelId, { onDelete: 'cascade' }),
  organizationId: text('organization_id'),
  metric: text('metric').notNull(),
  kind: text('kind').notNull(),
  severity: text('severity').notNull(),
  score: doublePrecision('score').notNull().default(0),
  anomalyDate: date('anomaly_date').notNull(),
  baselineValue: doublePrecision('baseline_value').notNull().default(0),
  actualValue: doublePrecision('actual_value').notNull().default(0),
  delta: doublePrecision('delta').notNull().default(0),
  deltaPct: doublePrecision('delta_pct').notNull().default(0),
  zScore: doublePrecision('z_score').notNull().default(0),
  method: text('method').notNull().default('weekday-median-mad'),
  windowDays: integer('window_days').notNull().default(28),
  runLength: integer('run_length').notNull().default(1),
  status: text('status').notNull().default('open'),
  evidence: jsonb('evidence').notNull().default('{}'),
  aiExplanation: jsonb('ai_explanation'),
  aiModel: text('ai_model'),
  aiGeneratedAt: timestamp('ai_generated_at', { withTimezone: true }),
  detectedAt: timestamp('detected_at', { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
}, (table) => [
  uniqueIndex('uq_anomaly_channel_metric_date').on(table.channelId, table.metric, table.anomalyDate),
]);

// ── Video view snapshots (dated catalog counters → per-video daily deltas) ──

const analyticsVideoViewSnapshots = pgTable('analytics_video_view_snapshots', {
  videoId: text('video_id').notNull(),
  channelId: text('channel_id').notNull(),
  snapshotDate: date('snapshot_date').notNull(),
  viewCount: bigint('view_count', { mode: 'number' }).notNull().default(0),
  likeCount: bigint('like_count', { mode: 'number' }).notNull().default(0),
  commentCount: bigint('comment_count', { mode: 'number' }).notNull().default(0),
  capturedAt: timestamp('captured_at', { withTimezone: true }).notNull().default(now()),
}, (table) => [
  primaryKey({ columns: [table.videoId, table.snapshotDate] }),
]);

// ── Custom dashboard layouts (per-user grid matrix, personal + per-org) ──

const customDashboardLayouts = pgTable('custom_dashboard_layouts', {
  id: serial('id').primaryKey(),
  ownerUid: text('owner_uid').notNull(),
  orgId: text('org_id').notNull().default(''),
  name: text('name').notNull().default('default'),
  layout: jsonb('layout').notNull().default('{"cells":[],"hidden":[]}'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().default(now()),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().default(now()),
}, (table) => [
  uniqueIndex('uq_custom_dashboard_layouts_scope').on(table.ownerUid, table.orgId, table.name),
]);

module.exports = {
  analyticsChannels,
  analyticsVideos,
  analyticsChannelMetricsDaily,
  analyticsVideoMetricsDaily,
  analyticsSyncRuns,
  analyticsDashboardSnapshots,
  userAccessFlags,
  channelGoals,
  channelFocus,
  analyticsAnomalies,
  analyticsVideoViewSnapshots,
  customDashboardLayouts,
};
