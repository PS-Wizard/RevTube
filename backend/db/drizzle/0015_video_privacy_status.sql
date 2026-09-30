-- Add privacy/public visibility so the dashboard L2 (Postgres read-model) path can
-- serve correct status filters (public/unlisted/private) without forcing a live
-- YouTube round-trip. Mirrors the canonical public|unlisted|private values.
ALTER TABLE analytics_videos ADD COLUMN IF NOT EXISTS privacy_status TEXT;