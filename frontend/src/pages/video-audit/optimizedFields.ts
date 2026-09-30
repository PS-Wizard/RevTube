import type { OptimizedField } from '../../services/optimizedFlagService';

/**
 * Map each Video Audit element to the per-field optimization flag tracked by
 * the "Optimized" list (OptimizedListPage toggles the same fields). Fields
 * without a crisp counterpart (captions) reuse the closest metadata field.
 */
export const ELEMENT_FIELD_MAP: Record<string, OptimizedField> = {
  title: 'titleKeywords',
  description: 'description',
  tags: 'tags',
  keywords: 'tags',
  thumbnail: 'thumbnail',
  captions: 'description',
};