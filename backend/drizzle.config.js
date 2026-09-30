/** @type { import("drizzle-kit").Config } */
module.exports = {
  dialect: 'postgresql',
  schema: './db/schema.js',
  out: './db/drizzle',
  dbCredentials: {
    host: process.env.POSTGRES_HOST || '127.0.0.1',
    port: Number(process.env.POSTGRES_PORT || 5432),
    database: process.env.POSTGRES_DB || 'revtube',
    user: process.env.POSTGRES_USER || 'revtube',
    password: process.env.POSTGRES_PASSWORD || '',
    ssl: false,
  },
};
