CREATE TABLE IF NOT EXISTS user_access_flags (
  uid TEXT PRIMARY KEY,
  email TEXT,
  role TEXT NOT NULL DEFAULT 'user',
  package TEXT NOT NULL DEFAULT 'free',
  source TEXT NOT NULL DEFAULT 'firestore-sync',
  updated_by TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_user_access_flags_email_lower
  ON user_access_flags (LOWER(email))
  WHERE email IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_user_access_flags_role
  ON user_access_flags (role);
