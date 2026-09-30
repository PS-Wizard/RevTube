CREATE TABLE IF NOT EXISTS analytics_dashboard_snapshots (
  snapshot_key TEXT PRIMARY KEY,
  channel_id TEXT NOT NULL,
  snapshot_type TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_dashboard_snapshots_channel_type_updated
  ON analytics_dashboard_snapshots(channel_id, snapshot_type, updated_at DESC);
