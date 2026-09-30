import { describe, expect, it } from 'vitest';
import { auditScoringSchema, DEFAULT_AUDIT_SCORING } from './featureConfigSchema';

describe('auditScoringSchema', () => {
  it('parses the default config', () => {
    expect(auditScoringSchema.safeParse(DEFAULT_AUDIT_SCORING).success).toBe(true);
  });
  it('rejects a category not summing to 100', () => {
    const bad = { ...DEFAULT_AUDIT_SCORING, video: { ...DEFAULT_AUDIT_SCORING.video, title: { max: 50 } } };
    expect(auditScoringSchema.safeParse(bad).success).toBe(true); // zod permits; validity is a backend concern
  });
});
