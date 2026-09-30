import { describe, it, expect } from 'vitest';
const { splitDateWindows, INGEST_CHUNK_DAYS, INGEST_LOOKBACK_DAYS } = require('./ingestWindow');

describe('ingestion lookback windows', () => {
  it('defaults to a two-year lookback', () => {
    expect(INGEST_LOOKBACK_DAYS).toBe(730);
    expect(INGEST_CHUNK_DAYS).toBe(180);
  });

  it('splits a two-year range into contiguous chunks', () => {
    const windows = splitDateWindows('2024-08-27', '2026-08-26', 180);
    expect(windows.length).toBeGreaterThan(3);
    expect(windows[0].startDate).toBe('2024-08-27');
    expect(windows[windows.length - 1].endDate).toBe('2026-08-26');
    for (let i = 1; i < windows.length; i++) {
      const prevEnd = new Date(`${windows[i - 1].endDate}T00:00:00.000Z`);
      prevEnd.setUTCDate(prevEnd.getUTCDate() + 1);
      expect(windows[i].startDate).toBe(prevEnd.toISOString().slice(0, 10));
    }
  });
});
