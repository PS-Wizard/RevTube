-- ─────────────────────────────────────────────────────────────────────────────
-- Audit Orchestrator -- add user-editable name to saved channel audit runs
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE audit_runs ADD COLUMN IF NOT EXISTS name TEXT NOT NULL DEFAULT '';
CREATE INDEX IF NOT EXISTS idx_audit_runs_name ON audit_runs (uid, name);
