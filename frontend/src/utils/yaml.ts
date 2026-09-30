// ─────────────────────────────────────────────────────────────────────────────
// YAML serialization for Playlist Optimizer exports
// ─────────────────────────────────────────────────────────────────────────────
import * as YAML from 'js-yaml';
import type { AnalysisResult } from '../types/playlistOptimizer';

/**
 * Serialize an analysis result to a YAML document.
 *
 * `lineWidth: -1` keeps long/multi-line strings as proper block scalars
 * instead of wrapping them, and `noRefs: true` avoids `&ref` alias markers.
 */
export function analysisToYaml(
  result: AnalysisResult,
  meta?: { generatedAt?: string },
): string {
  return YAML.dump(
    { generatedAt: meta?.generatedAt ?? new Date().toISOString(), result },
    { noRefs: true, lineWidth: -1 },
  );
}
