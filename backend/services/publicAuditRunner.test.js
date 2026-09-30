import { describe, it, expect, vi } from 'vitest';
const { runPublicAuditReport, filterCaptionCriteria } = require('./publicAuditRunner');

const CHANNEL = { channelId: 'UC123', title: 'Chan' };

function makeRunner(overrides = {}) {
  const calls = { videos: [], playlists: [] };
  const publicAuditService = {
    resolvePublicChannel: vi.fn(async () => CHANNEL),
    fetchPublicVideos: vi.fn(async (...args) => {
      calls.videos.push(Date.now());
      await new Promise((r) => setTimeout(r, 20));
      return [{ videoId: 'v1', title: 'T' }];
    }),
    fetchPublicPlaylists: vi.fn(async (...args) => {
      calls.playlists.push(Date.now());
      await new Promise((r) => setTimeout(r, 20));
      return [{ playlistId: 'pl1', title: 'P' }];
    }),
    computeChannelLifetime: () => ({ auditedVideoCount: 1 }),
    buildFullAuditInput: (c, v, p) => ({ channel: c, videos: v, playlists: p }),
    ...overrides.publicAuditService,
  };
  const auditBatch = vi.fn(async (inputs, criteria, niche, mode, onProgress) => {
    try { onProgress?.(0); } catch { /* best-effort */ }
    try { onProgress?.(100); } catch { /* best-effort */ }
    return { overall: 80, results: inputs.map((v) => ({ ...v, total: 80 })), auditedAt: '2026-01-01' };
  });
  const serviceDeps = {
    publicAuditService,
    videoAuditService: { auditBatch },
    query: vi.fn(async () => ({ rows: [{ id: 3, created_at: '2026-01-01' }] })),
    db: {},
    getAuditCriteria: async () => ({ video: [] }),
    createAuditScoringService: () => ({ scoreAll: async () => ({}) }),
    ...overrides.serviceDeps,
  };
  return { serviceDeps, publicAuditService, auditBatch, calls };
}

describe('runPublicAuditReport pipeline', () => {
  it('fetches videos and playlists concurrently after channel resolve', async () => {
    const { serviceDeps, publicAuditService } = makeRunner();
    const marks = [];
    const t0 = Date.now();
    await runPublicAuditReport(serviceDeps, {
      channelInput: '@demo',
      onProgress: (pct) => marks.push(pct),
    });
    expect(publicAuditService.resolvePublicChannel).toHaveBeenCalledWith('@demo');
    expect(publicAuditService.fetchPublicVideos).toHaveBeenCalledTimes(1);
    expect(publicAuditService.fetchPublicPlaylists).toHaveBeenCalledTimes(1);
    // Concurrent: total fetch wall time is one 20ms window, not two.
    expect(Date.now() - t0).toBeLessThan(60);
    expect(marks[0]).toBe(10);
    expect(marks).toContain(55);
    expect(marks.at(-1)).toBe(100);
  });

  it('maps batch scoring progress onto the 70-85 band', async () => {
    const { serviceDeps } = makeRunner();
    const marks = [];
    await runPublicAuditReport(serviceDeps, {
      channelInput: '@demo',
      onProgress: (pct) => marks.push(pct),
    });
    expect(marks).toContain(70);
    expect(marks).toContain(85);
  });

  it('rejects empty video catalogs with 400 without persisting', async () => {
    const { serviceDeps } = makeRunner({
      publicAuditService: { fetchPublicVideos: async () => [] },
    });
    await expect(runPublicAuditReport(serviceDeps, { channelInput: '@demo' })).rejects.toMatchObject({
      status: 400,
    });
    expect(serviceDeps.query).not.toHaveBeenCalled();
  });

  it('degrades to videos-only when playlists fetch fails', async () => {
    const { serviceDeps } = makeRunner({
      publicAuditService: {
        fetchPublicPlaylists: async () => { throw new Error('playlists down'); },
      },
    });
    const report = await runPublicAuditReport(serviceDeps, { channelInput: '@demo' });
    expect(report.playlists).toEqual([]);
    expect(report.results).toHaveLength(1);
  });

  it('filterCaptionCriteria drops caption elements unless opted in', () => {
    const criteria = [
      { key: 'title_clear', element: 'title', weight: 10 },
      { key: 'caption_value', element: 'caption', weight: 11 },
      { key: 'legacy_caps', element: 'captions', weight: 5 },
    ];
    expect(filterCaptionCriteria(criteria, false)).toEqual([criteria[0]]);
    expect(filterCaptionCriteria(criteria, true)).toEqual(criteria);
    expect(filterCaptionCriteria(criteria)).toEqual([criteria[0]]);
    expect(filterCaptionCriteria(null, false)).toEqual([]);
    expect(filterCaptionCriteria('nope', true)).toEqual([]);
  });

  it('excludes caption criteria from the engine by default, keeps them when opted in', async () => {
    const criteria = [
      { key: 'title_clear', element: 'title', weight: 10 },
      { key: 'caption_value', element: 'caption', weight: 11 },
    ];
    const off = makeRunner({
      serviceDeps: { getAuditCriteria: async () => ({ video: criteria }) },
    });
    const offReport = await runPublicAuditReport(off.serviceDeps, { channelInput: '@demo' });
    expect(off.auditBatch).toHaveBeenCalledWith(
      expect.anything(), [criteria[0]], '', 'lite', expect.any(Function),
    );
    expect(offReport.snapshot.includeCaptions).toBe(false);

    const on = makeRunner({
      serviceDeps: { getAuditCriteria: async () => ({ video: criteria }) },
    });
    const onReport = await runPublicAuditReport(on.serviceDeps, { channelInput: '@demo', includeCaptions: true });
    expect(on.auditBatch).toHaveBeenCalledWith(
      expect.anything(), criteria, '', 'lite', expect.any(Function),
    );
    expect(onReport.snapshot.includeCaptions).toBe(true);
  });

  it('persists per-playlist + channel health from the deterministic engine', async () => {
    const health = {
      channel: {
        name: { value: 'Chan', health: 90, hint: 'Clear name.' },
        username: { value: '@chan', health: 90, hint: 'Clear handle.' },
        description: { value: 'D', health: 40, hint: 'Add 200+ chars.' },
        keywords: { values: [], health: 0, hint: 'Add keywords.' },
      },
      playlists: [{ playlistId: 'PL1', title: 'P', size: 3, health: 42, hint: 'Only 3 items.' }],
      general: [{ key: 'engagement', label: 'Engagement', health: 70, hint: 'OK.' }],
    };
    const withHealth = makeRunner({
      serviceDeps: { createAuditScoringService: () => ({ scoreAll: async () => ({}), rateHealth: () => health }) },
    });
    const report = await runPublicAuditReport(withHealth.serviceDeps, { channelInput: '@demo' });
    expect(report.fullAudit.health).toEqual({
      channel: health.channel,
      playlists: health.playlists,
      general: health.general,
    });
    // Per-video health is NOT duplicated (result rows carry the sub-audit).
    expect(report.fullAudit.health).not.toHaveProperty('videos');
  });

  it('leaves fullAudit.health null when the scoring service predates rateHealth', async () => {
    const { serviceDeps } = makeRunner();
    const report = await runPublicAuditReport(serviceDeps, { channelInput: '@demo' });
    expect(report.fullAudit.health).toBeNull();
  });
});
