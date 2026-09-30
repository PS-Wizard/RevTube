import { describe, it, expect } from 'vitest';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { findRepetitionCutoff, streamCutMarker } = require('./AgentExecutor');
const { createGuardrails } = require('./Guardrails');

const healthy = [
  'Here is an overview of your channel performance for the last 30 days.',
  'Total views reached 125,430, which is up 8.2 percent compared to the previous period.',
  'Your top video earned 18,204 views with an average retention of 42 percent.',
  'Subscribers grew by 312, driven mostly by two Shorts published last week.',
  'Watch time totaled 4,120 hours across 28 published videos in this window.',
  'Engagement looks healthy: likes are up and comments doubled versus last month.',
  'The best posting window appears to be weekday evenings around 6 PM.',
  'Audience retention dips after the first minute, so tighten your video intros.',
  'Compared with the previous period, click-through rate improved slightly overall.',
  'Let me know if you want a deeper breakdown by video or by traffic source.',
].join(' ');

const longHealthy = `${healthy} Traffic sources show browse features leading, followed by search and suggested. Your Shorts shelf placement improved after the thumbnails were refreshed recently. End screens on long-form videos now drive twelve percent of session starts. Posting consistency over the last quarter correlates with steadier subscriber growth. Older catalog videos still contribute a third of total watch time.`;

describe('findRepetitionCutoff', () => {
  it('returns -1 for healthy varied output', () => {
    expect(findRepetitionCutoff(longHealthy)).toBe(-1);
  });

  it('returns -1 for short text', () => {
    expect(findRepetitionCutoff('Hello world. Hello world.')).toBe(-1);
    expect(findRepetitionCutoff('')).toBe(-1);
  });

  it('detects a sentence repeated 3+ times', () => {
    const sentence = 'Your channel gained exactly three hundred and twelve new subscribers this week.';
    const text = `${healthy} ${sentence} Some filler words to separate the repeated content here. ${sentence} More unique filler content in between for realism. ${sentence} Trailing junk that should be cut off from the final answer entirely.`;
    const cutoff = findRepetitionCutoff(text);
    expect(cutoff).toBeGreaterThanOrEqual(0);
    expect(text.slice(0, cutoff)).toContain(sentence);
    expect(text.slice(0, cutoff).split(sentence).length - 1).toBe(1);
  });

  it('detects a long block repeated 4+ times', () => {
    const block =
      'abcdefghijklmnopqrstuvwxyz0123456789-'.repeat(4); // 148 chars, no sentence end
    const text = `${healthy} ${block} filler ${block} filler ${block} filler ${block} tail`;
    expect(findRepetitionCutoff(text)).toBeGreaterThanOrEqual(0);
  });

  it('does not flag a two-column markdown table with similar rows', () => {
    const rows = Array.from(
      { length: 12 },
      (_, i) => `| Video title number ${i + 1} here | ${(i + 1) * 1234} | ${(i + 1) * 56} |`,
    );
    const text = `${healthy}\n${rows.join('\n')}\n${healthy}`;
    expect(findRepetitionCutoff(text)).toBe(-1);
  });
});

describe('sanitizeOutput maxLength', () => {
  const guardrails = createGuardrails({
    PERF_LOG_ENABLED: false,
    perfLog: () => {},
    perfNow: () => 0,
  });

  // Varied text (a uniform run like 'x'.repeat would be redacted as a token).
  const varied = Array.from(
    { length: 300 },
    (_, i) => `Sentence number ${i} with some varied words paddle ${i * 7}.`,
  ).join(' ');

  it('defaults to the legacy cap', () => {
    const { sanitized, truncated } = guardrails.sanitizeOutput(varied);
    expect(truncated).toBe(true);
    expect(sanitized).toContain('[Response truncated]');
  });

  it('honors a larger per-mode cap', () => {
    const { sanitized, truncated } = guardrails.sanitizeOutput(varied, 32768);
    expect(truncated).toBe(false);
    expect(sanitized).toBe(varied);
  });
});

describe('streamCutMarker', () => {
  it('returns empty for a clean stream', () => {
    expect(streamCutMarker({ finishReason: 'stop', interrupted: false, empty: false })).toBe('');
  });

  it('marks max_tokens cuts as continuable, even with no content', () => {
    const marker = streamCutMarker({ finishReason: 'length', interrupted: false, empty: true });
    expect(marker).toContain('ask me to continue');
  });

  it('marks interrupted streams with partial content', () => {
    const marker = streamCutMarker({ finishReason: 'stop', interrupted: true, empty: false });
    expect(marker).toContain('cut off');
  });

  it('leaves empty interrupted streams to the empty-answer fallback', () => {
    expect(streamCutMarker({ finishReason: 'stop', interrupted: true, empty: true })).toBe('');
  });
});
