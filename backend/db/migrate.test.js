import { describe, it, expect } from 'vitest';
const path = require('path');
const { collectMigrationFiles, simpleHash, isAlreadyApplied } = require('./migrate');

const DB_DIR = __dirname;

describe('migration discovery', () => {
  it('includes the hand-authored playlist read-model migration', () => {
    const files = collectMigrationFiles(DB_DIR).map((e) => e.file);
    expect(files).toContain('009_playlists.sql');
  });

  it('includes both hand-authored and Drizzle-generated sources', () => {
    const entries = collectMigrationFiles(DB_DIR);
    const dirs = new Set(entries.map((e) => path.basename(e.dir)));
    expect(dirs.has('migrations')).toBe(true);
    expect(dirs.has('drizzle')).toBe(true);
  });

  it('runs hand-authored files before Drizzle-generated files', () => {
    const entries = collectMigrationFiles(DB_DIR);
    const firstDrizzle = entries.findIndex((e) => path.basename(e.dir) === 'drizzle');
    const lastHand = entries.map((e) => path.basename(e.dir)).lastIndexOf('migrations');
    expect(firstDrizzle).toBeGreaterThan(lastHand);
  });

  it('sorts files within each source directory', () => {
    const entries = collectMigrationFiles(DB_DIR);
    for (const dir of ['migrations', 'drizzle']) {
      const names = entries.filter((e) => path.basename(e.dir) === dir).map((e) => e.file);
      expect([...names].sort()).toEqual(names);
    }
  });

  it('returns an empty plan for a directory with no SQL sources', () => {
    expect(collectMigrationFiles(path.join(DB_DIR, 'does-not-exist'))).toEqual([]);
  });
});

describe('simpleHash', () => {
  it('is stable and content-sensitive', () => {
    expect(simpleHash('abc')).toBe(simpleHash('abc'));
    expect(simpleHash('abc')).not.toBe(simpleHash('abd'));
  });
});

describe('isAlreadyApplied', () => {
  const entry = { file: '009_playlists.sql' };

  function fakePool({ hashHit = false, legacyHit = false, noLegacyTable = false } = {}) {
    const queries = [];
    return {
      queries,
      query: async (text, params) => {
        queries.push({ text, params });
        if (text.includes('__drizzle_migrations WHERE hash')) {
          return { rows: hashHit ? [{}] : [], rowCount: hashHit ? 1 : 0 };
        }
        if (text.includes('schema_migrations WHERE id')) {
          if (noLegacyTable) throw new Error('relation "schema_migrations" does not exist');
          return { rows: legacyHit ? [{}] : [], rowCount: legacyHit ? 1 : 0 };
        }
        return { rows: [], rowCount: 0 };
      },
    };
  }

  it('skips when the content hash was already applied', async () => {
    const pool = fakePool({ hashHit: true });
    expect(await isAlreadyApplied(pool, entry, 'deadbeef')).toBe(true);
    expect(pool.queries).toHaveLength(1);
  });

  it('treats legacy filename-tracked migrations as applied', async () => {
    const pool = fakePool({ legacyHit: true });
    expect(await isAlreadyApplied(pool, entry, 'deadbeef')).toBe(true);
    expect(pool.queries.some((q) => q.text.startsWith('INSERT INTO __drizzle_migrations'))).toBe(true);
  });

  it('returns false for a never-applied migration', async () => {
    const pool = fakePool();
    expect(await isAlreadyApplied(pool, entry, 'deadbeef')).toBe(false);
  });

  it('ignores a missing legacy tracking table', async () => {
    const pool = fakePool({ noLegacyTable: true });
    expect(await isAlreadyApplied(pool, entry, 'deadbeef')).toBe(false);
  });
});
