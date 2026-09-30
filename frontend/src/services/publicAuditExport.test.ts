
// Public Audit export â€” workbook builder tests.
// Pure: builds the workbook in memory (never writes a file, no DOM/network).

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildPublicAuditVideoWorkbook, buildPublicAuditWorkbook, publicAuditFileName } from './publicAuditExport';
import type { PublicAuditReport } from './publicAuditService';

const report: PublicAuditReport = {
  id: 42,
  channelInput: '@demo',
  channelId: 'UC123',
  channelTitle: 'Demo Channel',
  videoCount: 2,
  overall: 61,
  videoAuditOverall: 82,
  auditedAt: '2026-09-24T10:00:00.000Z',
  createdAt: '2026-09-24T10:00:05.000Z',
  createdByEmail: 'admin@x.com',
  snapshot: {
    title: 'Demo Channel',
    handle: '@demo',
    country: 'US',
    avatarUrl: 'http://a/1.jpg',
    bannerUrl: 'http://b/1.jpg',
    channelPublishedAt: '2020-01-01T00:00:00.000Z',
    description: 'A demo channel',
    channelKeywords: 'demo, videos',
    topics: ['Technology'],
    statistics: { subscriberCount: '1200', viewCount: '50000', videoCount: '88', hiddenSubscriberCount: false },
  },
  channelLifetime: {
    auditedVideoCount: 2,
    totalViewsAudited: 2000,
    totalLikesAudited: 200,
    totalCommentsAudited: 100,
    avgViewsPerVideo: 1000,
    engagementRatePct: 15,
    oldestAuditedAt: '2026-01-01T00:00:00.000Z',
    newestAuditedAt: '2026-01-11T00:00:00.000Z',
    uploadCadenceDays: 10,
    shortsCount: 1,
    longformCount: 1,
  },
  playlists: [
    { playlistId: 'PL1', title: 'Series', description: 'PD', publishedAt: '2025-05-05T00:00:00.000Z', itemCount: 12, thumbnailUrl: 'http://p/1.jpg' },
  ],
  fullAudit: {
    overall: 61,
    scoredVideos: 2,
    source: 'public-data',
    categories: [
      {
        key: 'channel',
        label: 'Channel Identity',
        score: 80,
        max: 100,
        breakdown: [{ key: 'name', label: 'Name', earned: 16, max: 20 }],
      },
      {
        key: 'video',
        label: 'Video SEO',
        score: 60,
        max: 100,
        breakdown: [{ key: 'title', label: 'Title', earned: 18, max: 30 }],
      },
      {
        key: 'playlist',
        label: 'Playlist Flow',
        score: 40,
        max: 100,
        breakdown: [{ key: 'size', label: 'Coverage / Size', earned: 8, max: 20 }],
      },
      {
        key: 'general',
        label: 'Publishing Trends & Engagement',
        score: 64,
        max: 100,
        breakdown: [{ key: 'engagement', label: 'Engagement', earned: 22, max: 35 }],
      },
    ],
    issues: [
      {
        key: 'video-tags',
        label: 'Missing or few tags',
        hint: 'Add 10+ relevant tags to every video.',
        severity: 'high',
        count: 1,
        affected: [{ type: 'video', id: 'v2', title: 'T2', url: 'https://www.youtube.com/watch?v=v2' }],
      },
      {
        key: 'channel-name',
        label: 'Channel name too short',
        hint: 'Use a distinctive, keyword-rich channel name (4-30 chars).',
        severity: 'medium',
        count: 1,
        affected: [],
      },
    ],
    health: {
      channel: {
        name: { value: 'Demo Channel', health: 90, hint: 'Clear, distinctive channel name.' },
        username: { value: '@demo', health: 90, hint: 'Clear, distinctive channel name.' },
        description: { value: 'A demo channel', health: 20, hint: 'Description thin (14 chars). Add 200+ chars.' },
        keywords: { values: ['demo', 'videos'], health: 40, hint: 'Only 2 tag(s). Add 10+ relevant tags.' },
      },
      playlists: [{ playlistId: 'PL1', title: 'Series', size: 12, health: 75, hint: 'Description thin (2 chars). Add 200+ chars.' }],
      general: [{ key: 'engagement', label: 'Engagement', health: 64, hint: 'Good audience engagement.' }],
    },
  },
  results: [
    {
      videoId: 'v1',
      videoTitle: 'T1',
      total: 82,
      projectedTotal: 90,
      suggestions: {},
      recommendations: [{ element: 'title', current: 18, projected: 30, delta: 12, targetPerElement: 30 }],
      elements: [
        { element: 'title', score: 18, max: 30, breakdown: [{ criterion: 'Length', earned: 10, max: 12 }] },
        { element: 'thumbnail', score: 20, max: 20, breakdown: [] },
      ],
      categories: [
        { key: 'discoverability', label: 'Discoverability', score: 30, max: 45, elements: ['title'] },
        { key: 'visualHook', label: 'Visual Hook', score: 20, max: 20, elements: ['thumbnail'] },
      ],
      statistics: { viewCount: '1000', likeCount: '100', commentCount: '50' },
      publishedAt: '2026-01-01T00:00:00.000Z',
      durationLabel: '2:00',
      definition: 'hd',
    },
    {
      videoId: 'v2',
      videoTitle: 'T2',
      total: 55,
      projectedTotal: 70,
      suggestions: {},
      recommendations: [],
      elements: [{ element: 'title', score: 12, max: 30, breakdown: [] }],
      categories: [{ key: 'discoverability', label: 'Discoverability', score: 12, max: 45, elements: ['title'] }],
      statistics: { viewCount: '1000', likeCount: '100', commentCount: '50' },
      publishedAt: '2026-01-11T00:00:00.000Z',
      durationLabel: '0:30',
      definition: 'sd',
    },
  ],
};

const sheetRows = (wb: XLSX.WorkBook, name: string): Record<string, unknown>[] =>
  XLSX.utils.sheet_to_json(wb.Sheets[name] as XLSX.WorkSheet);

describe('publicAuditExport', async () => {
  it('builds one sheet per audit area (full report, no data loss)', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    expect(wb.SheetNames).toEqual(['Overview', 'Categories', 'Criteria', 'Videos', 'Elements', 'Issues', 'Playlists']);
  });

  it('Overview sheet carries the full channel stats and lifetime aggregates', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    const pairs = XLSX.utils.sheet_to_json<string[]>(wb.Sheets.Overview as XLSX.WorkSheet, { header: 1 });
    const value = (field: unknown) => pairs.find((r) => r[0] === field)?.[1];
    expect(value('Channel title')).toBe('Demo Channel');
    expect(value('Subscribers')).toBe('1200');
    expect(value('Channel lifetime views')).toBe('50000');
    expect(value('Videos audited')).toBe(2);
    expect(value('FULL audit score (headline)')).toBe(61);
    expect(value('Video sub-audit score')).toBe(82);
    expect(value('Engagement rate (likes+comments / views)')).toBe('15%');
    expect(value('Playlists found')).toBe(1);
    expect(value('Categories scored')).toBe(4);
  });

  it('Categories + Criteria sheets expose every category and criterion', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    const cats = sheetRows(wb, 'Categories');
    expect(cats).toHaveLength(4);
    expect(cats[0]).toMatchObject({ Category: 'Channel Identity', Score: 80, Max: 100, 'Score %': '80%', 'Points lost': 20 });
    const criteria = sheetRows(wb, 'Criteria');
    expect(criteria.map((c) => c.Criterion)).toEqual(['Name', 'Title', 'Coverage / Size', 'Engagement']);
    expect(criteria[1]).toMatchObject({ Category: 'Video SEO', Earned: 18, Max: 30, 'Score %': '60%', 'Points lost': 12 });
  });

  it('Videos sheet merges public stats with element and category scores', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    const rows = sheetRows(wb, 'Videos');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      '#': 1,
      'Video ID': 'v1',
      Views: 1000,
      Likes: 100,
      Comments: 50,
      'Engagement %': '15.00%',
      'Video sub-audit score': 82,
      'Projected if fixed': 90,
      'Fix first': 'Title (+12)',
      'Title element': 18,
      'Thumbnail max': 20,
      'Discoverability score': 30,
    });
    expect(rows[1]).toMatchObject({ 'Video ID': 'v2', 'Discoverability score': 12 });
    expect(rows[1]).not.toHaveProperty('Thumbnail element');
  });

  it('Elements sheet rolls up the video sub-audit dimensions', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    const rows = sheetRows(wb, 'Elements');
    const title = rows.find((r) => r.Element === 'Title');
    expect(title).toMatchObject({ 'Videos measured': 2, 'Avg score': 15, 'Max points': 30, 'Avg %': '50%' });
    const caps = rows.find((r) => r.Element === 'Captions');
    expect(caps).toMatchObject({ 'Videos measured': 0, 'Avg %': '—' });
  });

  it('Issues sheet flattens affected items and keeps issue-only rows', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    const rows = sheetRows(wb, 'Issues');
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ Issue: 'Missing or few tags', Severity: 'high', Affected: 1, Type: 'video', Title: 'T2' });
    expect(rows[1]).toMatchObject({ Issue: 'Channel name too short', Type: '', Title: '' });
  });

  it('Playlists sheet carries the per-playlist audit score + top fix', async () => {
    const wb = await buildPublicAuditWorkbook(report);
    const rows = sheetRows(wb, 'Playlists');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Playlist: 'Series',
      'Playlist ID': 'PL1',
      Score: 75,
      'Top fix': 'Description thin (2 chars). Add 200+ chars.',
      Videos: 12,
    });
  });

  it('handles a report with no Full Audit / no playlists without throwing', async () => {
    const wb = await buildPublicAuditWorkbook({ ...report, fullAudit: null, playlists: [], results: [] });
    expect(wb.SheetNames).toHaveLength(7);
    expect(sheetRows(wb, 'Categories')).toEqual([]);
    expect(XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Issues as XLSX.WorkSheet, { header: 1 })[0]).toEqual(['No data']);
  });

  it('names the file after the channel + audit date', async () => {
    expect(publicAuditFileName(report)).toBe('RevKeter_PublicAudit_Demo_Channel_2026-09-24.xlsx');
  });

  it('builds a one-row Video sheet for a single-video download', async () => {
    const wb = await buildPublicAuditVideoWorkbook(report.results[0], report.channelTitle, report.channelId);
    expect(wb.SheetNames).toEqual(['Video']);
    const rows = sheetRows(wb, 'Video');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      Channel: 'Demo Channel',
      'Video ID': 'v1',
      'Video title': 'T1',
      'Video URL': 'https://www.youtube.com/watch?v=v1',
      Views: 1000,
      Score: 82,
      'Projected if fixed': 90,
      'Title score': 18,
      'Title max': 30,
      'Channel URL': 'https://www.youtube.com/channel/UC123',
    });
  });
});
