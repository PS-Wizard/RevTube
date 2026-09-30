-- ─────────────────────────────────────────────────────────────────────────────
-- Playlist Optimizer -- Saved Analysis Results
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS playlist_audits (
  id            BIGSERIAL PRIMARY KEY,
  uid           TEXT NOT NULL,
  name          TEXT NOT NULL DEFAULT '',
  channel_id    TEXT,
  channel_title TEXT,
  total_videos  INTEGER NOT NULL DEFAULT 0,
  audits        JSONB NOT NULL DEFAULT '{}'::jsonb,
  errors        JSONB,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_playlist_audits_uid
  ON playlist_audits(uid);

CREATE INDEX IF NOT EXISTS idx_playlist_audits_uid_created
  ON playlist_audits(uid, created_at DESC);
