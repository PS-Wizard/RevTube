-- ─────────────────────────────────────────────────────────────────────────────
-- Anomaly Detection (deterministic engine + AI explanation layer)
--
--  · analytics_anomalies           -- one row per (channel, metric, day) anomaly,
--    upserted by the scanner so repeated scans never duplicate history. Carries
--    the full statistical evidence (baseline/z-score/delta) plus the ranked
--    driver payload and the cached AI explanation.
--  · analytics_video_view_snapshots -- dated per-video lifetime counters captured
--    from the catalog we already refetch every 6h (zero extra YouTube API calls).
--    Used to compute true per-video day-over-day deltas for attribution.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS analytics_anomalies (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  organization_id TEXT,
  metric TEXT NOT NULL,
  kind TEXT NOT NULL,                   -- 'spike' | 'dip' | 'trend'
  severity TEXT NOT NULL,               -- 'info' | 'low' | 'medium' | 'high' | 'critical'
  score DOUBLE PRECISION NOT NULL DEFAULT 0,
  anomaly_date DATE NOT NULL,
  baseline_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  actual_value DOUBLE PRECISION NOT NULL DEFAULT 0,
  delta DOUBLE PRECISION NOT NULL DEFAULT 0,
  delta_pct DOUBLE PRECISION NOT NULL DEFAULT 0,
  z_score DOUBLE PRECISION NOT NULL DEFAULT 0,
  method TEXT NOT NULL DEFAULT 'weekday-median-mad',
  window_days INTEGER NOT NULL DEFAULT 28,
  run_length INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL DEFAULT 'open',  -- 'open' | 'acknowledged' | 'dismissed'
  evidence JSONB NOT NULL DEFAULT '{}'::jsonb,
  ai_explanation JSONB,
  ai_model TEXT,
  ai_generated_at TIMESTAMPTZ,
  detected_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_anomaly_channel_metric_date UNIQUE (channel_id, metric, anomaly_date),
  CONSTRAINT fk_anomaly_channel
    FOREIGN KEY (channel_id) REFERENCES analytics_channels(channel_id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_anomalies_channel_date
  ON analytics_anomalies (channel_id, anomaly_date DESC, detected_at DESC);

CREATE INDEX IF NOT EXISTS idx_anomalies_severity_status
  ON analytics_anomalies (severity, status);

CREATE INDEX IF NOT EXISTS idx_anomalies_metric_date
  ON analytics_anomalies (metric, anomaly_date DESC);

CREATE TABLE IF NOT EXISTS analytics_video_view_snapshots (
  video_id TEXT NOT NULL,
  channel_id TEXT NOT NULL,
  snapshot_date DATE NOT NULL,
  view_count BIGINT NOT NULL DEFAULT 0,
  like_count BIGINT NOT NULL DEFAULT 0,
  comment_count BIGINT NOT NULL DEFAULT 0,
  captured_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (video_id, snapshot_date)
);

CREATE INDEX IF NOT EXISTS idx_video_view_snapshots_channel_date
  ON analytics_video_view_snapshots (channel_id, snapshot_date DESC);
