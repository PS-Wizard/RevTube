// Full Audit export — workbook builder tests.
// Pure: builds the workbook in memory (never writes a file, no DOM/network).

import { describe, it, expect } from 'vitest';
import * as XLSX from 'xlsx';
import { buildFullAuditWorkbook, fullAuditFileName } from './auditOrchestratorExport';
import type { AuditRunRow, AuditSubRunResultRow } from './auditOrchestratorService';

const run: AuditRunRow = {
  id: 9,
  uid: 'u1',
  channel_id: 'UC123',
  channel_title: 'Demo Channel',
  org_id: null,
  status: 'completed',
  overall_score: 72,
  overall_grade: 'B',
  profile_version: 1,
  include_thumbnail_ai: true,
  started_at: '2026-09-20T10:00:00.000Z',
  completed_at: '2026-09-20T10:30:00.000Z',
  created_at: '2026-09-20T10:30:01.000Z',
};

const subRuns: AuditSubRunResultRow[] = [
  {
    id: 1,
    audit_run_id: 9,
    type: 'channelIdentity',
    status: 'completed',
    score: 80,
    grade: 'B',
    results: {
      params: [
        { key: 'name', label: 'Channel name', earned: 16, max: 20, detail: [{ key: 'len', label: 'Length', earned: 8, max: 10, engine: 'algo' }] },
      ],
      recommendations: [
        { auditType: 'channelIdentity', paramKey: 'name', severity: 'medium', message: 'Lengthen the name.', impactGain: 4 },
      ],
      meta: {},
    },
    report_url: null,
    created_at: '2026-09-20T10:20:00.000Z',
  },
  {
    id: 2,
    audit_run_id: 9,
    type: 'video',
    status: 'completed',
    score: 64,
    grade: 'C',
    results: {
      params: [],
      recommendations: [],
      meta: {
        videos: [
          { videoId: 'v1', title: 'T1', publishedAt: '2026-01-01', viewCount: 1000, likeCount: 50, commentCount: 5, url: 'https://www.youtube.com/watch?v=v1', score: 70, projectedTotal: 85 },
        ],
      },
    },
    report_url: null,
    created_at: '2026-09-20T10:25:00.000Z',
  },
];

const sheetRows = (wb: XLSX.WorkBook, name: string): Record<string, unknown>[] =>
  XLSX.utils.sheet_to_json(wb.Sheets[name] as XLSX.WorkSheet);

describe('auditOrchestratorExport', () => {
  it('builds one sheet per audit area', async () => {
    const wb = await buildFullAuditWorkbook(run, subRuns);
    expect(wb.SheetNames).toEqual(['Overview', 'Categories', 'Criteria', 'Recommendations', 'Videos']);
  });

  it('Overview carries run identity + per-category scores', async () => {
    const wb = await buildFullAuditWorkbook(run, subRuns);
    const flat = Object.fromEntries(
      (XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets.Overview as XLSX.WorkSheet, { header: 1 }) as unknown[][]).slice(1).map((r) => [r[0], r[1]]),
    );
    expect(flat).toMatchObject({ 'Channel title': 'Demo Channel', 'Overall score': 72, Grade: 'B', 'Channel Identity & Branding score': 80 });
  });

  it('Criteria flattens params with engine detail, Recommendations keep severity', async () => {
    const wb = await buildFullAuditWorkbook(run, subRuns);
    expect(sheetRows(wb, 'Criteria')).toMatchObject([{ Category: 'Channel Identity & Branding', Criterion: 'Channel name', Earned: 16, Max: 20 }]);
    expect(sheetRows(wb, 'Recommendations')).toMatchObject([{ Severity: 'medium', Param: 'name' }]);
  });

  it('Videos sheet lists audited videos with stats + links', async () => {
    const wb = await buildFullAuditWorkbook(run, subRuns);
    expect(sheetRows(wb, 'Videos')).toMatchObject([
      { 'Video ID': 'v1', Title: 'T1', Views: 1000, Score: 70, 'Video URL': 'https://www.youtube.com/watch?v=v1' },
    ]);
  });

  it('handles empty sub-runs without throwing', async () => {
    const wb = await buildFullAuditWorkbook(run, []);
    expect(wb.SheetNames).toHaveLength(5);
    expect(sheetRows(wb, 'Videos')).toEqual([]);
  });

  it('names the file after the channel + completion date', () => {
    expect(fullAuditFileName(run)).toBe('RevKeter_FullAudit_Demo_Channel_2026-09-20.xlsx');
  });
});
