import { describe, it, expect } from 'vitest';
import { CUSTOM_DASHBOARD_SURFACE } from '../../config/statCardRegistry';
import {
  defaultWidgetIds,
  isKnownWidget,
  widgetLabel,
  widgetSpan,
} from './customDashboardUtils';

const DEFAULTS = defaultWidgetIds();

describe('custom dashboard catalogue', () => {
  it('has a stable default order covering every widget', () => {
    expect(DEFAULTS).toEqual([
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
  });

  it('labels every widget and assigns a grid span', () => {
    for (const id of DEFAULTS) {
      expect(widgetLabel(id)).not.toBe(id);
      expect(['full', 'half']).toContain(widgetSpan(id));
    }
    expect(widgetSpan('channel-kpis')).toBe('full');
  });

  it('recognizes catalogue ids only', () => {
    expect(isKnownWidget('goals')).toBe(true);
    expect(isKnownWidget('nope')).toBe(false);
  });

  it('surface/widget ids match the backend sanitizer patterns', () => {
    expect(CUSTOM_DASHBOARD_SURFACE).toMatch(/^[a-z][A-Za-z0-9]*:[A-Za-z0-9]+$/);
    for (const id of DEFAULTS) {
      expect(id).toMatch(/^[A-Za-z0-9][A-Za-z0-9:_-]{0,63}$/);
    }
  });
});
