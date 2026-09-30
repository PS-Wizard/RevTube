-- Centralized Audit System -- parent run + child sub-runs
-- One Channel Audit (audit-orchestrator job) spawns 4 sub-audits
-- (channelIdentity, video, playlist, general) computed in-process and
-- persisted as a parent row + 4 child rows.

CREATE TABLE IF NOT EXISTS audit_runs (
  id               SERIAL PRIMARY KEY,
  uid              TEXT NOT NULL,
  channel_id       TEXT,
  channel_title    TEXT,
  org_id           TEXT,
  status           TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|partial
  overall_score    INTEGER,
  overall_grade    TEXT,
  profile_version  INTEGER,                            -- snapshotted scoring profile version
  include_thumbnail_ai BOOLEAN NOT NULL DEFAULT FALSE,
  started_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at     TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_runs_uid ON audit_runs (uid);
CREATE INDEX IF NOT EXISTS idx_audit_runs_channel ON audit_runs (channel_id);

CREATE TABLE IF NOT EXISTS audit_sub_runs (
  id            SERIAL PRIMARY KEY,
  audit_run_id  INTEGER NOT NULL REFERENCES audit_runs (id) ON DELETE CASCADE,
  type          TEXT NOT NULL,   -- channelIdentity|video|playlist|general
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending|running|completed|failed|skipped
  score         INTEGER,
  grade         TEXT,
  results       JSONB NOT NULL DEFAULT '{}',
  report_url    TEXT,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_sub_runs_run ON audit_sub_runs (audit_run_id);
CREATE INDEX IF NOT EXISTS idx_audit_sub_runs_type ON audit_sub_runs (audit_run_id, type);
