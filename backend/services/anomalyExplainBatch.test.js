import { describe, it, expect, vi } from 'vitest';
const { createAnomalyService } = require('./anomalyService');
const { buildBatchExplainPrompt } = require('./anomalyPrompts');

function row(id, overrides = {}) {
  return {
    id,
    channel_id: 'UC123',
    channel_title: 'Chan',
    metric: 'views',
    kind: 'spike',
    severity: 'high',
    score: 90,
    anomaly_date: '2026-09-20',
    baseline_value: 1000,
    actual_value: 2000,
    delta: 1000,
    delta_pct: 1.0,
    z_score: 5.5,
    run_length: 1,
    window_days: 28,
    status: 'open',
    evidence: {
      signals: [{ key: 'driver', label: 'Driver', detail: 'One video drove it', weight: 0.8 }],
      drivers: [{ title: 'V', deltaViews: 900 }],
      movements: [],
      uploads: [],
      context: [],
    },
    ai_explanation: null,
    ai_model: null,
    ai_generated_at: null,
    detected_at: '2026-09-21T00:00:00.000Z',
    updated_at: '2026-09-21T00:00:00.000Z',
    ...overrides,
  };
}

function canned(id) {
  return {
    headline: `Views spiked on 2026-09-20 (#${id})`,
    summary: 'Views doubled versus the weekday baseline, driven by one video.',
    likelyCategory: 'content',
    confidence: 0.8,
    rootCauses: [{ signal: 'driver', weight: 0.8, explanation: 'One video drove it' }],
    impactAssessment: 'Big day.',
    recommendedActions: [{ action: 'Post a follow-up', rationale: 'Momentum', priority: 'high' }],
    caveats: ['Estimate'],
  };
}

function makeService({ rows, llm }) {
  const updates = [];
  const llmFn = vi.fn(llm);
  const query = vi.fn(async (sql, params) => {
    if (sql.includes('FROM analytics_channels')) return { rows: [{ title: 'Chan' }] };
    if (sql.startsWith('UPDATE analytics_anomalies')) {
      updates.push({ id: params[0], explanation: JSON.parse(params[1]), model: params[2] });
      return { rows: [] };
    }
    if (sql.includes('WHERE a.id = $1')) {
      const found = rows.find((r) => r.id === params[0]);
      return { rows: found ? [found] : [] };
    }
    throw new Error(`unexpected SQL: ${sql.slice(0, 60)}`);
  });
  const { buildExplainPrompt, normalizeExplanation } = require('./anomalyPrompts');
  const service = createAnomalyService({
    query,
    isPostgresConfigured: () => true,
    deepSeekJson: llmFn,
    buildExplainPrompt,
    buildBatchExplainPrompt,
    normalizeExplanation,
  });
  return { service, query, llmFn, updates };
}

describe('buildBatchExplainPrompt', () => {
  it('covers every id with a compact block and a keyed JSON contract', () => {
    const prompt = buildBatchExplainPrompt({
      items: [
        { id: 1, anomaly: { metricLabel: 'Views', metric: 'views', direction: 'up', anomalyDate: '2026-09-20', actualValue: 2000, baselineValue: 1000, deltaPct: 1, severity: 'high' }, evidence: {} },
        { id: 2, anomaly: { metricLabel: 'Views', metric: 'views', direction: 'down', anomalyDate: '2026-09-19', actualValue: 100, baselineValue: 1000, deltaPct: -0.9, severity: 'critical' }, evidence: {} },
      ],
      channelTitle: 'Chan',
    });
    expect(prompt).toContain('anomaly id 1');
    expect(prompt).toContain('anomaly id 2');
    expect(prompt).toContain('"1"');
    expect(prompt).toContain('"2"');
    expect(prompt).toMatch(/SHORT|1-2 sentences|max 2/);
    expect(prompt).toContain('explanations');
  });
});

describe('explainAnomaliesBatch', () => {
  it('explains many anomalies with ONE llm call and stores each row', async () => {
    const { service, llmFn, updates } = makeService({
      rows: [row(1), row(2)],
      llm: async () => ({ explanations: { 1: canned(1), 2: canned(2) } }),
    });
    const out = await service.explainAnomaliesBatch([1, 2]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ total: 2, explained: 2 });
    expect(updates.map((u) => u.id).sort()).toEqual([1, 2]);
    expect(updates[0].explanation.source).toBe('ai');
  });

  it('skips rows that already carry an AI explanation', async () => {
    const done = { source: 'ai', headline: 'Old', summary: 'Already explained', rootCauses: [], recommendedActions: [], caveats: [] };
    const { service, llmFn, updates } = makeService({
      rows: [row(1, { ai_explanation: done, ai_model: 'm' }), row(2)],
      llm: async ({ prompt }) => {
        expect(prompt).toContain('anomaly id 2');
        expect(prompt).not.toContain('anomaly id 1');
        return { explanations: { 2: canned(2) } };
      },
    });
    const out = await service.explainAnomaliesBatch([1, 2]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ total: 1, explained: 1 });
    expect(updates.map((u) => u.id)).toEqual([2]);
  });

  it('leaves garbled entries unexplained without extra calls', async () => {
    const { service, llmFn, updates } = makeService({
      rows: [row(1), row(2)],
      llm: async () => ({ explanations: { 1: canned(1), 2: { nope: true } } }),
    });
    const out = await service.explainAnomaliesBatch([1, 2]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ total: 2, explained: 1 });
    expect(updates.map((u) => u.id)).toEqual([1]);
    expect(out.results).toContainEqual({ id: 2, source: 'unparsed' });
  });

  it('degrades to zero without throwing when the LLM fails', async () => {
    const { service, llmFn } = makeService({
      rows: [row(1)],
      llm: async () => { throw new Error('down'); },
    });
    const out = await service.explainAnomaliesBatch([1]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ total: 1, explained: 0 });
    expect(out.aiError).toBe('down');
  });

  it('dedupes ids and ignores junk', async () => {
    const { service, llmFn } = makeService({
      rows: [row(1)],
      llm: async () => ({ explanations: { 1: canned(1) } }),
    });
    const out = await service.explainAnomaliesBatch([1, 1, -5, 'x', null]);
    expect(llmFn).toHaveBeenCalledTimes(1);
    expect(out).toMatchObject({ total: 1, explained: 1 });
  });
});
