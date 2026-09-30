-- Custom user dashboard layouts (per-user, personal + per-org scopes).
-- Drizzle-kit counterpart of db/migrations/013_custom_dashboard_layouts.sql.
-- Both runners apply with IF NOT EXISTS guards, so overlap is safe.

CREATE TABLE IF NOT EXISTS "custom_dashboard_layouts" (
  "id" SERIAL PRIMARY KEY,
  "owner_uid" TEXT NOT NULL,
  "org_id" TEXT NOT NULL DEFAULT '',
  "name" TEXT NOT NULL DEFAULT 'default',
  "layout" JSONB NOT NULL DEFAULT '{"cells":[],"hidden":[]}',
  "created_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "uq_custom_dashboard_layouts_scope" UNIQUE ("owner_uid", "org_id", "name")
);

CREATE INDEX IF NOT EXISTS "idx_custom_dashboard_layouts_owner"
  ON "custom_dashboard_layouts" ("owner_uid", "org_id");
