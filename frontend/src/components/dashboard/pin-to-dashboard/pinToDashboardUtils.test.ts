import { describe, it, expect } from 'vitest';
import {
  CUSTOM_DASHBOARD_ROUTE,
  PINNABLE_WIDGET_IDS,
  isPinnableWidgetId,
  pinTitle,
  pinnableWidgetLabel,
} from './pinToDashboardUtils';

describe('pin-to-dashboard catalogue', () => {
  it('covers every custom-dashboard widget', () => {
    expect(PINNABLE_WIDGET_IDS).toEqual([
      'channel-kpis',
      'audience',
      'insights',
      'goals',
      'anomalies',
      'video-performance',
      'playlist-performance',
      'top-videos',
      'top-playlists',
    ]);
    for (const id of PINNABLE_WIDGET_IDS) {
      expect(isPinnableWidgetId(id)).toBe(true);
      expect(pinnableWidgetLabel(id)).not.toBe(id);
    }
    expect(isPinnableWidgetId('nope')).toBe(false);
  });

  it('treats user-built custom cards as pinnable', () => {
    expect(isPinnableWidgetId('custom:my-card-ab12')).toBe(true);
    // Unknown custom ids fall back to the raw id until a definition exists.
    expect(pinnableWidgetLabel('custom:missing-0000')).toBe('custom:missing-0000');
  });

  it('builds pin/unpin titles and a stable dashboard route', () => {
    expect(CUSTOM_DASHBOARD_ROUTE).toBe('/my-dashboard');
    expect(pinTitle('goals', false)).toMatch(/Pin .* to your dashboard/);
    expect(pinTitle('goals', true)).toMatch(/is on your dashboard/);
  });
});
