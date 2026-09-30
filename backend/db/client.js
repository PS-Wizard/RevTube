const { Pool } = require('pg');

let pool = null;
let warnedDisabled = false;

function getPostgresConfig() {
  return {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'revtube',
    user: process.env.POSTGRES_USER || 'revtube',
    password: process.env.POSTGRES_PASSWORD || '',
    max: Number(process.env.POSTGRES_POOL_MAX || 10),
    idleTimeoutMillis: Number(process.env.POSTGRES_IDLE_TIMEOUT_MS || 30000),
    statement_timeout: Number(process.env.POSTGRES_STATEMENT_TIMEOUT_MS || 30000),
  };
}

function isPostgresConfigured() {
  return Boolean(process.env.POSTGRES_HOST && process.env.POSTGRES_DB && process.env.POSTGRES_USER);
}

function getPool() {
  if (!isPostgresConfigured()) {
    if (!warnedDisabled) {
      warnedDisabled = true;
      console.warn('[Postgres] Not configured; postgres-first features will fallback.');
    }
    return null;
  }
  if (!pool) {
    pool = new Pool(getPostgresConfig());
  }
  return pool;
}

async function query(text, params = []) {
  const p = getPool();
  if (!p) return null;
  return p.query(text, params);
}

async function withClient(fn) {
  const p = getPool();
  if (!p) return null;
  const client = await p.connect();
  try {
    return await fn(client);
  } finally {
    client.release();
  }
}

module.exports = {
  getPool,
  query,
  withClient,
  isPostgresConfigured,
};
