import { z } from 'zod';

export const pageConfigSchema = z.object({
  label: z.string(),
  enabled: z.boolean().default(true),
  premiumOnly: z.boolean(),
  freeLimit: z.number(),
  proLimit: z.number(),
});

export const criterionSchema = z.object({ max: z.number().int().positive() });
export const auditCategorySchema = z.record(z.string(), criterionSchema);
export const auditScoringSchema = z.object({
  video: auditCategorySchema,
  channel: auditCategorySchema,
  playlist: auditCategorySchema,
  general: auditCategorySchema,
});

export const DEFAULT_AUDIT_SCORING = {
  video: { title: { max: 30 }, description: { max: 25 }, tags: { max: 25 }, keywords: { max: 20 } },
  channel: { name: { max: 20 }, username: { max: 15 }, tags: { max: 20 }, niche: { max: 25 }, description: { max: 20 } },
  playlist: { title: { max: 30 }, description: { max: 30 }, tags: { max: 20 }, size: { max: 20 } },
  general: { uploadConsistency: { max: 40 }, engagement: { max: 35 }, contentSwitch: { max: 25 } },
} as const;
export type AuditScoring = z.infer<typeof auditScoringSchema>;

export const CATEGORY_META = {
  video: { label: 'Video Audit' },
  channel: { label: 'Channel Audit' },
  playlist: { label: 'Playlist Audit' },
  general: { label: 'General Audit' },
} as const;

export const featureConfigSchema = z.object({
  pages: z.record(z.string(), pageConfigSchema),
  auditScoring: auditScoringSchema.optional(),
  auditCriteria: z.record(z.string(), z.any()).optional(), // Admin-defined freeform criteria
});

export type PageConfig = z.infer<typeof pageConfigSchema>;
export type FeatureConfig = z.infer<typeof featureConfigSchema>;

export const featureConfigCachePayloadSchema = z.object({
  config: featureConfigSchema,
  cachedAt: z.number(),
});

export type FeatureConfigCachePayload = z.infer<typeof featureConfigCachePayloadSchema>;