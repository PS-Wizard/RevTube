const { query } = require('./client');

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

function normalizeAccessRow(row, fallbackEmail = null) {
  return {
    uid: row?.uid || null,
    email: row?.email || fallbackEmail || null,
    role: row?.role || 'user',
    package: row?.package || 'free',
  };
}

async function getUserAccessByEmail(email) {
  if (!email) return null;
  const res = await safeQuery(
    `SELECT uid, email, role, package
     FROM user_access_flags
     WHERE LOWER(email) = LOWER($1)
     LIMIT 1`,
    [email]
  );
  if (!res?.rowCount) return null;
  return normalizeAccessRow(res.rows[0], email);
}

async function getUserAccessByUid(uid) {
  if (!uid) return null;
  const res = await safeQuery(
    `SELECT uid, email, role, package
     FROM user_access_flags
     WHERE uid = $1
     LIMIT 1`,
    [uid]
  );
  if (!res?.rowCount) return null;
  return normalizeAccessRow(res.rows[0]);
}

async function upsertUserAccess({
  uid,
  email = null,
  role = 'user',
  packageName = 'free',
  source = 'firestore-sync',
  updatedBy = null,
}) {
  if (!uid) return;
  try {
    await safeQuery(
      `INSERT INTO user_access_flags(uid, email, role, package, source, updated_by, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, NOW())
       ON CONFLICT(uid) DO UPDATE SET
         email = COALESCE(EXCLUDED.email, user_access_flags.email),
         role = EXCLUDED.role,
         package = EXCLUDED.package,
         source = EXCLUDED.source,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()`,
      [uid, email, role, packageName, source, updatedBy]
    );
  } catch (err) {
    // ON CONFLICT(uid) won't catch a conflict when the same email exists under a
    // different UID (two Firebase Auth accounts sharing an email).  The unique
    // index on lower(email) fires first.  Fall back to an UPDATE by email so
    // the caller never sees a spurious 500.
    if (err?.constraint === 'idx_user_access_flags_email_lower' && email) {
      await safeQuery(
        `UPDATE user_access_flags
         SET uid = $1, role = $2, package = $3, source = $4,
             updated_by = $5, updated_at = NOW()
         WHERE LOWER(email) = LOWER($6)`,
        [uid, role, packageName, source, updatedBy, email]
      );
      return;
    }
    throw err;
  }
}

module.exports = {
  getUserAccessByEmail,
  getUserAccessByUid,
  upsertUserAccess,
};
