-- ─────────────────────────────────────────────────────────────────────────────
-- Public Audits (admin-only) -- audit any public channel with the shared
-- video-audit engine fed by YouTube Data API public endpoints (no OAuth).
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public_audits (
  id SERIAL PRIMARY KEY,
  channel_input TEXT NOT NULL,
  channel_id TEXT,
  channel_title TEXT,
  video_count INT NOT NULL DEFAULT 0,
  overall INT,
  snapshot JSONB NOT NULL DEFAULT '{}',
  results JSONB NOT NULL DEFAULT '{}',
  created_by_uid TEXT,
  created_by_email TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_public_audits_channel_id ON public_audits (channel_id);
CREATE INDEX IF NOT EXISTS idx_public_audits_created_at ON public_audits (created_at DESC);
