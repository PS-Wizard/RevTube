import { describe, it, expect } from 'vitest';
import { normalizePrivacyStatus, matchesVisibilityFilter, mergeReportsByDay } from './dashboardUtils';
import type { AnalyticsReport } from '../services/analyticsService';

const report = (rows: unknown[][]): AnalyticsReport => ({
  kind: 'youtubeAnalytics#resultTable',
  columnHeaders: [
    { name: 'day', dataType: 'string', columnType: 'DIMENSION' },
    { name: 'views', dataType: 'integer', columnType: 'METRIC' },
    { name: 'estimatedMinutesWatched', dataType: 'float', columnType: 'METRIC' },
  ],
  rows: rows as AnalyticsReport['rows'],
});

describe('mergeReportsByDay', () => {
  it('sums metrics over shared dates across chunked reports', () => {
    const merged = mergeReportsByDay([
      report([['2026-09-01', '5', '10'], ['2026-09-02', '7', '14']]),
      report([['2026-09-02', '3', '6'], ['2026-09-03', '9', '18']]),
    ]);
    expect(merged?.rows).toEqual([
      ['2026-09-01', '5', '10'],
      ['2026-09-02', 10, 20],
      ['2026-09-03', '9', '18'],
    ]);
  });

  it('returns a header-preserving report when chunks have no rows', () => {
    const merged = mergeReportsByDay([report([]), null]);
    expect(merged?.rows).toEqual([]);
    expect(merged?.columnHeaders?.[0].name).toBe('day');
  });

  it('returns the single report unchanged when only one chunk has data', () => {
    const only = report([['2026-09-01', '5', '9']]);
    expect(mergeReportsByDay([only, null])).toBe(only);
  });
});

describe('normalizePrivacyStatus', () => {
  it('maps enum form (PRIVACY_*) to canonical lowercase', () => {
    expect(normalizePrivacyStatus('PRIVACY_PUBLIC')).toBe('public');
    expect(normalizePrivacyStatus('PRIVACY_UNLISTED')).toBe('unlisted');
    expect(normalizePrivacyStatus('PRIVACY_PRIVATE')).toBe('private');
  });

  it('passes through already-lowercase values', () => {
    expect(normalizePrivacyStatus('public')).toBe('public');
    expect(normalizePrivacyStatus('unlisted')).toBe('unlisted');
    expect(normalizePrivacyStatus('private')).toBe('private');
  });

  it('returns undefined for missing/unknown values', () => {
    expect(normalizePrivacyStatus(undefined)).toBeUndefined();
    expect(normalizePrivacyStatus('')).toBeUndefined();
    expect(normalizePrivacyStatus('scheduled_release')).toBeUndefined();
  });
});

describe('matchesVisibilityFilter', () => {
  it('treats unknown/missing status as public so legacy rows do not disappear in the default view', () => {
    expect(matchesVisibilityFilter(undefined, 'public')).toBe(true);
    expect(matchesVisibilityFilter(undefined, 'all')).toBe(true);
    // Strict: unknown does NOT match private/unlisted-only views
    expect(matchesVisibilityFilter(undefined, 'private')).toBe(false);
    expect(matchesVisibilityFilter(undefined, 'unlisted')).toBe(false);
  });

  it('filters strictly to public / private / unlisted with enum-form statuses', () => {
    // Public
    expect(matchesVisibilityFilter('PRIVACY_PUBLIC', 'public')).toBe(true);
    expect(matchesVisibilityFilter('PRIVACY_PUBLIC', 'all')).toBe(true);
    expect(matchesVisibilityFilter('PRIVACY_PUBLIC', 'private')).toBe(false);
    expect(matchesVisibilityFilter('PRIVACY_PUBLIC', 'unlisted')).toBe(false);

    // Unlisted
    expect(matchesVisibilityFilter('PRIVACY_UNLISTED', 'unlisted')).toBe(true);
    expect(matchesVisibilityFilter('PRIVACY_UNLISTED', 'all')).toBe(true);
    expect(matchesVisibilityFilter('PRIVACY_UNLISTED', 'public')).toBe(false);
    expect(matchesVisibilityFilter('PRIVACY_UNLISTED', 'private')).toBe(false);

    // Private
    expect(matchesVisibilityFilter('PRIVACY_PRIVATE', 'private')).toBe(true);
    expect(matchesVisibilityFilter('PRIVACY_PRIVATE', 'all')).toBe(true);
    expect(matchesVisibilityFilter('PRIVACY_PRIVATE', 'public')).toBe(false);
    expect(matchesVisibilityFilter('PRIVACY_PRIVATE', 'unlisted')).toBe(false);
  });

  it('filters strictly with lowercase-form statuses', () => {
    expect(matchesVisibilityFilter('private', 'private')).toBe(true);
    expect(matchesVisibilityFilter('private', 'public')).toBe(false);
    expect(matchesVisibilityFilter('unlisted', 'unlisted')).toBe(true);
    expect(matchesVisibilityFilter('unlisted', 'public')).toBe(false);
    expect(matchesVisibilityFilter('public', 'public')).toBe(true);
    expect(matchesVisibilityFilter('public', 'private')).toBe(false);
    expect(matchesVisibilityFilter('public', 'unlisted')).toBe(false);
  });
});