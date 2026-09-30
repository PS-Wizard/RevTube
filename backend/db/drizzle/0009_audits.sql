-- Audit Scoring -- Saved Audit History
CREATE TABLE IF NOT EXISTS audits (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Audit',
  channel_id TEXT,
  channel_title TEXT,
  results JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_audits_uid ON audits (uid);
