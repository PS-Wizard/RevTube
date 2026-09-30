-- Video Audit -- Saved Video Audit History
CREATE TABLE IF NOT EXISTS video_audits (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Video Audit',
  channel_id TEXT,
  channel_title TEXT,
  results JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_video_audits_uid ON video_audits (uid);
