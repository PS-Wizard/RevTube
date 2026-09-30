-- ─────────────────────────────────────────────────────────────────────────────
-- Playlist read-model
--
-- The playlist catalog was previously live-per-request only (serverCache with
-- a 2h TTL and no durable copy), which meant every playlist read depended on
-- YouTube availability + a warm cache. These tables give playlists the same
-- Postgres-first tier the video catalog has had since 001_init_analytics:
-- ingested by the 6-hour cron, read from here first, live YouTube API only
-- when the row set is missing or older than the staleness window.
--
-- NOTE: `playlist_audits` (005) is unrelated -- that stores Playlist Optimizer
-- analysis results, not the channel's playlist catalog.
--
-- No FK to analytics_channels: the catalog is also warmed by on-demand paths
-- (chat / OAuth playlist routes) for channels that ingestion may not cover.
-- ─────────────────────────────────────────────────────────────────────────────

-- Channel-level freshness stamp for the whole playlist catalog. Per-playlist
-- timestamps cannot express "this channel has zero playlists", so the gate
-- reads this column instead (NULL = never synced = stale).
ALTER TABLE analytics_channels
  ADD COLUMN IF NOT EXISTS playlists_synced_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS analytics_playlists (
  playlist_id      TEXT PRIMARY KEY,
  channel_id       TEXT NOT NULL,
  title            TEXT,
  description      TEXT,
  channel_title    TEXT,
  published_at     TIMESTAMPTZ,
  thumbnail_url    TEXT,
  item_count       INTEGER,
  privacy_status   TEXT,
  -- Catalog row refresh (the /playlists listing).
  last_synced_at   TIMESTAMPTZ,
  -- Membership refresh (the /playlistItems listing) -- separate because it can
  -- be disabled or capped independently of the catalog sync.
  items_synced_at  TIMESTAMPTZ,
  created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_analytics_playlists_channel
  ON analytics_playlists(channel_id);

CREATE INDEX IF NOT EXISTS idx_analytics_playlists_channel_synced
  ON analytics_playlists(channel_id, last_synced_at DESC);

-- Playlist membership + ordering. Video STATS are deliberately not duplicated
-- here -- they live in analytics_videos and are joined by video_id, so a
-- playlist read never serves a stale view count.
CREATE TABLE IF NOT EXISTS analytics_playlist_items (
  playlist_id     TEXT NOT NULL,
  video_id        TEXT NOT NULL,
  position        INTEGER,
  title           TEXT,
  published_at    TIMESTAMPTZ,
  thumbnail_url   TEXT,
  privacy_status  TEXT,
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (playlist_id, video_id)
);

CREATE INDEX IF NOT EXISTS idx_analytics_playlist_items_playlist
  ON analytics_playlist_items(playlist_id, position);

CREATE INDEX IF NOT EXISTS idx_analytics_playlist_items_video
  ON analytics_playlist_items(video_id);