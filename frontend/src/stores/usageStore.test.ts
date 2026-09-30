import { beforeEach, describe, expect, it } from 'vitest';
import { useUsageStore } from './usageStore';

beforeEach(() => {
  useUsageStore.setState({ usage: {} });
});

describe('useUsageStore.updateUsage', () => {
  it('records the first usage value for a page', () => {
    useUsageStore.getState().updateUsage('search', 2, 5);
    expect(useUsageStore.getState().usage['search']).toEqual({ used: 2, limit: 5, pageKey: 'search' });
  });

  it('never decreases an already-stored used count (monotonic guard)', () => {
    useUsageStore.getState().updateUsage('search', 5, 5); // cache-miss: higher, post-increment
    useUsageStore.getState().updateUsage('search', 2, 5); // late cache-hit: lower, pre-increment
    expect(useUsageStore.getState().usage['search'].used).toBe(5);
  });

  it('still updates when the new count is higher', () => {
    useUsageStore.getState().updateUsage('search', 2, 5);
    useUsageStore.getState().updateUsage('search', 7, 5);
    expect(useUsageStore.getState().usage['search'].used).toBe(7);
  });

  it('stores a new limit alongside a higher count', () => {
    useUsageStore.getState().updateUsage('search', 2, 5);
    useUsageStore.getState().updateUsage('search', 9, 10);
    expect(useUsageStore.getState().usage['search']).toEqual({ used: 9, limit: 10, pageKey: 'search' });
  });
});
