-- ─────────────────────────────────────────────────────────────────────────────
-- Channel Goals & Real-Time Pacing
-- ─────────────────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS channel_goals (
  id SERIAL PRIMARY KEY,
  channel_id TEXT NOT NULL,
  organization_id TEXT,
  created_by TEXT NOT NULL,
  title TEXT,
  metric TEXT NOT NULL, -- 'views' | 'subscribers' | 'ctr' | 'engagement_rate'
  period_type TEXT NOT NULL, -- 'weekly' | 'monthly' | '90_days' | 'quarterly' | 'half_yearly' | 'yearly' | 'custom'
  period_key TEXT, -- e.g. '2026-Q1', '2026-Q2', '2026-Q3', '2026-W34', '2026-08', '2026-H1', '2026'
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  target_value DOUBLE PRECISION NOT NULL,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_channel_goals_channel_id ON channel_goals (channel_id);
CREATE INDEX IF NOT EXISTS idx_channel_goals_organization_id ON channel_goals (organization_id);
CREATE INDEX IF NOT EXISTS idx_channel_goals_dates ON channel_goals (start_date, end_date);
CREATE INDEX IF NOT EXISTS idx_channel_goals_metric ON channel_goals (metric);
