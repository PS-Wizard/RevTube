-- ─────────────────────────────────────────────────────────────────────────────
-- Channel Focus & Knowledge (per-channel, personal + org scoped)
-- AI generates the initial focus from channel data; users can edit afterwards.
-- Mirrors channel_goals scoping: organization_id NULL = personal context.
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_focus (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  organization_id TEXT,
  created_by TEXT NOT NULL,
  niche TEXT,
  audience TEXT,
  content_pillars JSONB NOT NULL DEFAULT '[]',
  tone TEXT,
  goals_notes TEXT,
  ai_snapshot JSONB NOT NULL DEFAULT '{}',
  source TEXT NOT NULL DEFAULT 'manual', -- 'ai' | 'manual'
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- One focus row per (channel, scope). COALESCE because UNIQUE treats NULLs as distinct.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_channel_focus_scope
  ON channel_focus (channel_id, COALESCE(organization_id, ''));

CREATE INDEX IF NOT EXISTS idx_channel_focus_channel_id ON channel_focus (channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_focus_organization_id ON channel_focus (organization_id);
