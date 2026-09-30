// ─────────────────────────────────────────────────────────────────────────────
// Canonical audit-history writers -- the SINGLE persistence path for the
// standalone audit history tables (video_audits / playlist_audits). Used by
// the Video Audit route (POST /history), the Optimizer queue worker, and the
// Full Audit orchestrator, so every flow persists identical row shapes via
// one implementation (DRY).
// ─────────────────────────────────────────────────────────────────────────────

function createAuditHistoryService(deps) {
  const { query, isPostgresConfigured } = deps;
  const pgReady = () =>
    typeof isPostgresConfigured === "function" ? isPostgresConfigured() : !!query;

  /** Insert a video_audits history row. Returns { id, createdAt } or null. */
  async function saveVideoAuditHistory({ uid, name, channelId, channelTitle, results }) {
    if (!pgReady() || !uid || !results) return null;
    const { rows } = await query(
      `INSERT INTO video_audits (uid, name, channel_id, channel_title, results, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, now(), now())
       RETURNING id, created_at AS "createdAt"`,
      [uid, name || "Video Audit", channelId || null, channelTitle || null, JSON.stringify(results)],
    );
    return rows[0] || null;
  }

  /** Insert a playlist_audits history row. Returns { id } or null. */
  async function savePlaylistAuditHistory({ uid, name, channelId, channelTitle, audits, errors }) {
    if (!pgReady() || !uid || !audits) return null;
    const { rows } = await query(
      `INSERT INTO playlist_audits (uid, name, channel_id, channel_title, total_videos, audits, errors)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       RETURNING id`,
      [
        uid,
        name || "Analysis",
        channelId || null,
        channelTitle || null,
        Array.isArray(audits.playlists)
          ? audits.playlists.reduce((sum, p) => sum + (p.videos?.length || 0), 0)
          : 0,
        JSON.stringify(audits),
        Array.isArray(errors) ? JSON.stringify(errors) : null,
      ],
    );
    return rows[0] || null;
  }

  return { saveVideoAuditHistory, savePlaylistAuditHistory };
}

module.exports = { createAuditHistoryService };
