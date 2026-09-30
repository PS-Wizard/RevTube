import { describe, expect, it } from 'vitest';
import { buildCacheKey } from './analyticsCache';

describe('buildCacheKey', () => {
  it('is deterministic for the same params', () => {
    expect(buildCacheKey({ channelId: 'c', range: '30d' })).toBe(
      buildCacheKey({ channelId: 'c', range: '30d' }),
    );
  });

  it('is independent of key order', () => {
    expect(buildCacheKey({ a: '1', b: '2' })).toBe(buildCacheKey({ b: '2', a: '1' }));
  });

  it('excludes undefined and empty values', () => {
    expect(buildCacheKey({ a: '1', b: undefined, d: '', e: 0 })).toBe('a=1&e=0');
  });

  it('isolates caches by org context (org id is part of the key)', () => {
    const personal = buildCacheKey({ channelId: 'chan1', orgId: undefined });
    const orgA = buildCacheKey({ channelId: 'chan1', orgId: 'orgA' });
    const orgB = buildCacheKey({ channelId: 'chan1', orgId: 'orgB' });
    expect(orgA).not.toBe(personal);
    expect(orgA).not.toBe(orgB);
    // org scoping is order-independent
    expect(orgA).toBe(buildCacheKey({ orgId: 'orgA', channelId: 'chan1' }));
  });
});
