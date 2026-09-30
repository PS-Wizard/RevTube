/** Shared monthly quota pool for all Channel Analytics tabs (Channel, Playlists, Videos, Audience). */
export const CHANNEL_ANALYTICS_QUOTA_KEY = 'dashboard';

export function isDashboardQuotaUrl(url: string): boolean {
  return url.includes('/dashboard/');
}

/** Map API usage metadata to the correct quota bucket for display and store updates. */
export function normalizeUsagePageKey(pageKey: string, requestUrl?: string): string {
  if (requestUrl && isDashboardQuotaUrl(requestUrl)) {
    return CHANNEL_ANALYTICS_QUOTA_KEY;
  }
  return pageKey;
}
