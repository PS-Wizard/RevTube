CREATE TABLE IF NOT EXISTS thumbnail_audits (
  id            BIGSERIAL PRIMARY KEY,
  uid           TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  channel_id    TEXT,
  channel_title TEXT,
  niche         TEXT,
  target_audience TEXT,
  brand_voice   TEXT,
  total_videos  INTEGER NOT NULL DEFAULT 0,
  audits        JSONB NOT NULL DEFAULT '[]'::jsonb,
  errors        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_thumbnail_audits_uid
  ON thumbnail_audits(uid);

CREATE INDEX IF NOT EXISTS idx_thumbnail_audits_uid_created
  ON thumbnail_audits(uid, created_at DESC);
