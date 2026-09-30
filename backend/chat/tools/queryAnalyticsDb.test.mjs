import { describe, it, expect, vi } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const tool = require('./queryAnalyticsDb');

const ADMIN = { uid: 'admin1', email: 'admin@example.com', role: 'admin' };
const USER = { uid: 'u1', email: 'user@example.com', role: 'user' };

function makeDeps(rows = []) {
  const query = vi.fn(async () => ({ rows }));
  return { query, isPostgresConfigured: () => true };
}

describe('queryAnalyticsDb.validateSql', () => {
  it('accepts a plain SELECT over an allowed table', () => {
    const r = tool.validateSql('SELECT channel_id, SUM(views) FROM analytics_video_metrics_daily GROUP BY 1');
    expect(r.ok).toBe(true);
  });

  it('accepts WITH ... SELECT and a single trailing semicolon', () => {
    const r = tool.validateSql('WITH d AS (SELECT * FROM analytics_videos) SELECT * FROM d;');
    expect(r.ok).toBe(true);
    expect(r.cleaned.endsWith(';')).toBe(false);
  });

  it('accepts schema-qualified table names (public.table)', () => {
    const r = tool.validateSql('SELECT channel_id, SUM(views) FROM public.analytics_video_metrics_daily GROUP BY 1');
    expect(r.ok).toBe(true);
  });

  it('accepts the request-shaped query: CTEs + window function + NULL handling', () => {
    const q = `WITH cur AS (
      SELECT channel_id, SUM(views) AS views, SUM(estimated_minutes_watched) AS watch_min,
             SUM(subscribers_gained) AS gained, SUM(subscribers_lost) AS lost
      FROM analytics_video_metrics_daily
      WHERE metric_date >= CURRENT_DATE - INTERVAL '30 days' GROUP BY channel_id
    ),
    prev AS (
      SELECT channel_id, SUM(views) AS views FROM analytics_video_metrics_daily
      WHERE metric_date >= CURRENT_DATE - INTERVAL '60 days'
        AND metric_date < CURRENT_DATE - INTERVAL '30 days' GROUP BY channel_id
    ),
    ranked AS (
      SELECT channel_id, video_id, title, view_count,
             RANK() OVER (PARTITION BY channel_id ORDER BY view_count DESC NULLS LAST) AS rnk,
             COUNT(*) OVER (PARTITION BY channel_id) AS total_videos
      FROM analytics_videos
    )
    SELECT c.channel_id, COALESCE(cur.views, 0) AS views,
      CASE WHEN COALESCE(prev.views, 0) = 0 THEN NULL
           ELSE ROUND(100.0 * (cur.views - prev.views) / NULLIF(prev.views, 0), 1) END AS growth_pct,
      r.title AS top_video, r.total_videos
    FROM analytics_channels c LEFT JOIN cur ON cur.channel_id = c.channel_id
    LEFT JOIN prev ON prev.channel_id = c.channel_id
    LEFT JOIN ranked r ON r.channel_id = c.channel_id AND r.rnk = 1
    ORDER BY cur.views DESC NULLS LAST`;
    expect(tool.validateSql(q).ok).toBe(true);
  });

  it('rejects planning tables (goals/focus are not measured data)', () => {
    expect(tool.validateSql('SELECT * FROM channel_goals').error).toMatch(/restricted/);
    expect(tool.validateSql('SELECT * FROM channel_focus').error).toMatch(/restricted/);
    expect(tool.validateSql('SELECT c.title, g.target_value FROM analytics_channels c JOIN channel_goals g ON g.channel_id = c.channel_id').ok).toBe(false);
  });

  it('rejects writes and DDL', () => {
    for (const sql of [
      'INSERT INTO analytics_videos SELECT * FROM analytics_videos',
      'UPDATE analytics_videos SET title = \'x\'',
      'DELETE FROM analytics_videos',
      'DROP TABLE analytics_videos',
      'WITH x AS (DELETE FROM analytics_videos RETURNING *) SELECT * FROM x',
    ]) {
      expect(tool.validateSql(sql).ok, sql).toBe(false);
    }
  });

  it('rejects stacked statements', () => {
    expect(tool.validateSql('SELECT 1; SELECT 2').ok).toBe(false);
  });

  it('rejects SQL comments', () => {
    expect(tool.validateSql('SELECT * FROM analytics_videos -- dump').ok).toBe(false);
    expect(tool.validateSql('SELECT /* x */ 1').ok).toBe(false);
  });

  it('rejects non-SELECT statements', () => {
    expect(tool.validateSql('EXPLAIN SELECT 1').ok).toBe(false);
    expect(tool.validateSql('').ok).toBe(false);
  });

  it('rejects restricted and unknown tables', () => {
    expect(tool.validateSql('SELECT * FROM user_access_flags').error).toMatch(/restricted/);
    expect(tool.validateSql('SELECT * FROM audits').error).toMatch(/restricted/);
    expect(tool.validateSql('SELECT * FROM users').error).toMatch(/not queryable/);
  });

  it('rejects system catalogs', () => {
    expect(tool.validateSql('SELECT * FROM information_schema.tables').ok).toBe(false);
    expect(tool.validateSql('SELECT * FROM pg_stat_activity').ok).toBe(false);
  });

  it('rejects PII columns but allows them inside string literals', () => {
    expect(tool.validateSql('SELECT email FROM channel_goals').ok).toBe(false);
    expect(tool.validateSql("SELECT title FROM analytics_videos WHERE title LIKE '%email%'").ok).toBe(true);
  });
});

describe('queryAnalyticsDb.clampMaxRows', () => {
  it('defaults and clamps to 1..100', () => {
    expect(tool.clampMaxRows(undefined)).toBe(50);
    expect(tool.clampMaxRows(500)).toBe(100);
    expect(tool.clampMaxRows(0)).toBe(1);
    expect(tool.clampMaxRows(25)).toBe(25);
  });
});

describe('queryAnalyticsDb.execute', () => {
  it('refuses non-admin callers', async () => {
    const res = await tool.execute(
      { sql: 'SELECT * FROM analytics_videos' },
      { deps: makeDeps(), userContext: USER },
    );
    expect(res.error).toMatch(/admin/i);
  });

  it('refuses when postgres is not configured', async () => {
    const res = await tool.execute(
      { sql: 'SELECT * FROM analytics_videos' },
      { deps: { query: vi.fn(), isPostgresConfigured: () => false }, userContext: ADMIN },
    );
    expect(res.error).toMatch(/not configured/i);
  });

  it('runs validated SQL wrapped with a row cap', async () => {
    const deps = makeDeps([{ video_id: 'v1', title: 'T' }]);
    const res = await tool.execute(
      { sql: 'SELECT video_id, title FROM analytics_videos', maxRows: 10 },
      { deps, userContext: ADMIN },
    );
    expect(res.error).toBeUndefined();
    expect(res.columns).toEqual(['video_id', 'title']);
    expect(res.rowCount).toBe(1);
    expect(deps.query).toHaveBeenCalledOnce();
    const sent = deps.query.mock.calls[0][0];
    expect(sent).toMatch(/LIMIT 10/);
    expect(sent).toContain('_sql_query');
  });

  it('flags truncation at the cap', async () => {
    const rows = Array.from({ length: 5 }, (_, i) => ({ video_id: `v${i}` }));
    const deps = makeDeps(rows);
    const res = await tool.execute(
      { sql: 'SELECT video_id FROM analytics_videos', maxRows: 5 },
      { deps, userContext: ADMIN },
    );
    expect(res.truncated).toBe(true);
    expect(res.note).toMatch(/Capped at 5 rows/);
  });

  it('rejects forbidden SQL without touching the database', async () => {
    const deps = makeDeps();
    const res = await tool.execute(
      { sql: 'DROP TABLE analytics_videos' },
      { deps, userContext: ADMIN },
    );
    expect(res.error).toBeTruthy();
    expect(deps.query).not.toHaveBeenCalled();
  });

  it('returns a safe message on DB failure', async () => {
    const deps = { query: vi.fn(async () => { throw new Error('conn failed ?key=SECRET123'); }), isPostgresConfigured: () => true };
    const res = await tool.execute(
      { sql: 'SELECT * FROM analytics_videos' },
      { deps, userContext: ADMIN },
    );
    expect(res.error).toMatch(/Query failed/);
    expect(res.error).not.toContain('SECRET123');
  });

  it('requires sql for the query action', async () => {
    const deps = makeDeps();
    const res = await tool.execute({ action: 'query' }, { deps, userContext: ADMIN });
    expect(res.error).toMatch(/non-empty string/);
    expect(deps.query).not.toHaveBeenCalled();
  });

  it('rejects unknown actions', async () => {
    const res = await tool.execute({ action: 'drop' }, { deps: makeDeps(), userContext: ADMIN });
    expect(res.error).toMatch(/Unknown action/);
  });
});

describe('queryAnalyticsDb.execute schema action', () => {
  it('returns the table inventory without touching the database', async () => {
    const deps = makeDeps();
    const res = await tool.execute({ action: 'schema' }, { deps, userContext: ADMIN });
    expect(res.error).toBeUndefined();
    expect(Object.keys(res.tables)).toHaveLength(tool.ALLOWED_TABLES.length + 2); // +2 UNQUERYABLE stubs (goals/focus)
    expect(res.tables.analytics_video_metrics_daily.columns).toContain('estimated_minutes_watched');
    expect(res.tables.analytics_video_metrics_daily.columns).toContain('filters_key');
    expect(res.tables.analytics_videos.columns).toContain('view_count');
    expect(res.tables.channel_goals.columns).toHaveLength(0);
    expect(deps.query).not.toHaveBeenCalled();
  });

  it('serves schema without a configured database (static inventory)', async () => {
    const deps = { query: vi.fn(), isPostgresConfigured: () => false };
    const res = await tool.execute({ action: 'schema' }, { deps, userContext: ADMIN });
    expect(res.tables).toBeTruthy();
  });

  it('still refuses non-admin callers for schema', async () => {
    const res = await tool.execute({ action: 'schema' }, { deps: makeDeps(), userContext: USER });
    expect(res.error).toMatch(/admin/i);
  });
});
