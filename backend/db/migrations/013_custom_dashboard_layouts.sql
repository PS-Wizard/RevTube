-- Custom user dashboard layouts (per-user, personal + per-org scopes).
--
--  custom_dashboard_layouts -- one row per (owner_uid, org_id, name).
--    org_id '' = personal scope; otherwise the organization id (the writer
--    must be an org member, enforced in the service layer, not here).
--    layout is a 12-column grid matrix:
--      {"cells":[{"id":"channel-kpis","x":0,"y":0,"w":12,"h":1}],"hidden":["goals"]}
--    Cells outside the matrix contract are rejected by the API sanitizer
--    (utils/customDashboardPrefs.js), so this table never stores junk.
--    Cheaper than Firestore user-doc reads/writes for a high-churn UI pref.

CREATE TABLE IF NOT EXISTS custom_dashboard_layouts (
  id SERIAL PRIMARY KEY,
  owner_uid TEXT NOT NULL,
  org_id TEXT NOT NULL DEFAULT '',
  name TEXT NOT NULL DEFAULT 'default',
  layout JSONB NOT NULL DEFAULT '{"cells":[],"hidden":[]}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT uq_custom_dashboard_layouts_scope UNIQUE (owner_uid, org_id, name)
);

CREATE INDEX IF NOT EXISTS idx_custom_dashboard_layouts_owner
  ON custom_dashboard_layouts (owner_uid, org_id);
