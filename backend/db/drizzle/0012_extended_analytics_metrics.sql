-- Extended YouTube Analytics metrics for daily video metrics + per-video avg view duration.
-- Additive columns only; mirroring the analyticsVideoMetricsDaily / analyticsVideos Drizzle schema.

ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS average_view_duration DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS engaged_views BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS viewer_percentage DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS card_impressions BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS card_clicks BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS card_click_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS card_teaser_impressions BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS card_teaser_clicks BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS card_teaser_click_rate DOUBLE PRECISION NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS average_concurrent_viewers BIGINT NOT NULL DEFAULT 0;
ALTER TABLE analytics_video_metrics_daily ADD COLUMN IF NOT EXISTS peak_concurrent_viewers BIGINT NOT NULL DEFAULT 0;

ALTER TABLE analytics_videos ADD COLUMN IF NOT EXISTS average_view_duration DOUBLE PRECISION NOT NULL DEFAULT 0;
