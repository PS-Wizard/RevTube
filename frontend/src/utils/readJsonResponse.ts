import { useUsageStore } from '../stores/usageStore';
import { normalizeUsagePageKey } from './quotaScope';

/**
 * Read fetch Response body as text and parse JSON. Fails with a clear message when the
 * server returns HTML (SPA fallback, proxy misroute) or other non-JSON bodies.
 */
export function parseJsonFromText(text: string, status: number, context: string): unknown {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error(`${context}: empty response body (HTTP ${status})`);
  }
  const first = trimmed[0];
  if (first !== '{' && first !== '[') {
    const hint = trimmed.length > 200 ? `${trimmed.slice(0, 200)}…` : trimmed;
    const oneLine = hint.replace(/\s+/g, ' ').trim();
    throw new Error(
      `${context}: expected JSON but received non-JSON (HTTP ${status}). ` +
        `Verify VITE_BACKEND_URL and API routing. Body starts with: ${oneLine.slice(0, 180)}`
    );
  }
  try {
    return JSON.parse(trimmed);
  } catch {
    throw new Error(`${context}: invalid JSON (HTTP ${status})`);
  }
}

export async function readJsonResponse(response: Response, context: string): Promise<unknown> {
  const text = await response.text();
  const body = parseJsonFromText(text, response.status, context);
  // Real-time usage store update: every API response carries _usage when quota is involved
  if (body && typeof body === 'object' && !Array.isArray(body)) {
    const maybe = body as { _usage?: { pageKey: string; used: number; limit: number } };
    if (maybe._usage) {
      const pageKey = normalizeUsagePageKey(maybe._usage.pageKey, response.url);
      useUsageStore.getState().updateUsage(pageKey, maybe._usage.used, maybe._usage.limit);
    }
  }
  return body;
}
