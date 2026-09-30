const { drizzle } = require('drizzle-orm/node-postgres');
const { getPool, isPostgresConfigured } = require('./client');
const schema = require('./schema');

let db = null;

/**
 * Get the Drizzle ORM client, backed by the same pg Pool that the rest
 * of the app uses.  Returns null when Postgres is not configured.
 */
function getDb() {
  if (!isPostgresConfigured()) return null;
  if (!db) {
    const pool = getPool();
    if (!pool) return null;
    db = drizzle(pool, { schema });
  }
  return db;
}

module.exports = { getDb, schema };
