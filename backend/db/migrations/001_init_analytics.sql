CREATE TABLE IF NOT EXISTS analytics_channels (
  channel_id TEXT PRIMARY KEY,
  title TEXT,
  uploads_playlist_id TEXT,
  last_synced_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS analytics_videos (
  video_id TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  title TEXT,
  description TEXT,
  published_at TIMESTAMPTZ,
  thumbnail_url TEXT,
  duration TEXT,
  tags JSONB NOT NULL DEFAULT '[]'::jsonb,
  view_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  comment_count BIGINT NOT NULL DEFAULT 0,
  position INT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT fk_analytics_videos_channel
    FOREIGN KEY(channel_id) REFERENCES analytics_channels(channel_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analytics_channel_metrics_daily (
  channel_id TEXT NOT NULL,
  metric_date DATE NOT NULL,
  subscribers_gained BIGINT NOT NULL DEFAULT 0,
  subscribers_lost BIGINT NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, metric_date),
  CONSTRAINT fk_channel_daily_channel
    FOREIGN KEY(channel_id) REFERENCES analytics_channels(channel_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analytics_video_metrics_daily (
  channel_id TEXT NOT NULL,
  metric_date DATE NOT NULL,
  views BIGINT NOT NULL DEFAULT 0,
  estimated_minutes_watched BIGINT NOT NULL DEFAULT 0,
  average_view_percentage DOUBLE PRECISION NOT NULL DEFAULT 0,
  subscribers_gained BIGINT NOT NULL DEFAULT 0,
  subscribers_lost BIGINT NOT NULL DEFAULT 0,
  likes BIGINT NOT NULL DEFAULT 0,
  shares BIGINT NOT NULL DEFAULT 0,
  comments BIGINT NOT NULL DEFAULT 0,
  filters_key TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (channel_id, metric_date, filters_key),
  CONSTRAINT fk_video_daily_channel
    FOREIGN KEY(channel_id) REFERENCES analytics_channels(channel_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS analytics_sync_runs (
  id BIGSERIAL PRIMARY KEY,
  channel_id TEXT,
  status TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  error_message TEXT,
  stats JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_analytics_videos_channel_id
  ON analytics_videos(channel_id);

CREATE INDEX IF NOT EXISTS idx_analytics_videos_published_at
  ON analytics_videos(published_at DESC);

CREATE INDEX IF NOT EXISTS idx_video_metrics_daily_channel_date
  ON analytics_video_metrics_daily(channel_id, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_video_metrics_daily_filters
  ON analytics_video_metrics_daily(channel_id, filters_key, metric_date DESC);

CREATE INDEX IF NOT EXISTS idx_channel_metrics_daily_channel_date
  ON analytics_channel_metrics_daily(channel_id, metric_date DESC);
