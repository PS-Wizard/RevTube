const { query } = require('../db/client');

function isMissingRelationError(err) {
  return err?.code === '42P01' || /relation .* does not exist/i.test(String(err?.message || ''));
}

async function safeQuery(text, params = []) {
  try {
    return await query(text, params);
  } catch (err) {
    if (isMissingRelationError(err)) return null;
    throw err;
  }
}

async function getDashboardSnapshot(snapshotKey) {
  const res = await safeQuery(
    `SELECT payload, updated_at, expires_at
     FROM analytics_dashboard_snapshots
     WHERE snapshot_key = $1
     LIMIT 1`,
    [snapshotKey]
  );
  if (!res?.rowCount) return null;
  const row = res.rows[0];
  if (row.expires_at && new Date(row.expires_at).getTime() < Date.now()) return null;
  return {
    payload: row.payload,
    updatedAt: row.updated_at,
    expiresAt: row.expires_at,
  };
}

async function upsertDashboardSnapshot({ snapshotKey, channelId, snapshotType, payload, ttlSeconds = 21600 }) {
  const expiresAt = ttlSeconds > 0 ? new Date(Date.now() + ttlSeconds * 1000).toISOString() : null;
  await safeQuery(
    `INSERT INTO analytics_dashboard_snapshots(
      snapshot_key, channel_id, snapshot_type, payload, updated_at, expires_at
    ) VALUES ($1, $2, $3, $4::jsonb, NOW(), $5::timestamptz)
    ON CONFLICT(snapshot_key) DO UPDATE SET
      payload = EXCLUDED.payload,
      updated_at = NOW(),
      expires_at = EXCLUDED.expires_at`,
    [snapshotKey, channelId, snapshotType, JSON.stringify(payload), expiresAt]
  );
}

async function deleteDashboardSnapshots(channelId) {
  if (!channelId) return 0;
  try {
    const res = await safeQuery(
      `DELETE FROM analytics_dashboard_snapshots WHERE channel_id = $1`,
      [channelId]
    );
    const count = res?.rowCount || 0;
    if (count > 0) {
      console.log(`[Snapshots] Deleted ${count} Postgres snapshot(s) for channel ${channelId}`);
    }
    return count;
  } catch (err) {
    console.warn(`[Snapshots] Failed to delete snapshots for channel ${channelId}:`, err.message);
    return 0;
  }
}

module.exports = {
  getDashboardSnapshot,
  upsertDashboardSnapshot,
  deleteDashboardSnapshots,
};
