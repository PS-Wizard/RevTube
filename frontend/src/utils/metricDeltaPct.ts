export type VideoDeltaMetric = 'views' | 'watchTime' | 'retention';

export type VideoPeriodStat = {
  current?: Record<string, unknown> | null;
  previous?: Record<string, unknown> | null;
};

export type VideoMultiPeriodStats = {
  d7?: VideoPeriodStat | null;
  d30?: VideoPeriodStat | null;
  d90?: VideoPeriodStat | null;
} | null | undefined;

export type VideoChartRow = {
  date?: string;
  views?: number;
  minutesWatched?: number;
  watchTime?: number;
  retention?: number;
  prevViews?: number;
  prevMinutesWatched?: number;
  prevWatchTime?: number;
  prevRetention?: number;
};

const WATCH_TIME_KEYS = ['watchTime', 'watch_time', 'minutesWatched', 'estimatedMinutesWatched'];
const RETENTION_KEYS = ['retention', 'averageViewPercentage', 'avgRetention'];

export function calcMetricDeltaPct(curr?: number | null, prev?: number | null): number | null {
  if (curr === undefined || curr === null || prev === undefined || prev === null) return null;
  const c = Number(curr);
  const p = Number(prev);
  if (isNaN(c) || isNaN(p)) return null;
  if (p === 0) {
    return c === 0 ? 0 : c > 0 ? 100 : -100;
  }
  const pct = ((c - p) / p) * 100;
  return isFinite(pct) ? pct : null;
}

function firstNumeric(obj: Record<string, unknown> | null | undefined, keys: string[]): number | null {
  if (!obj) return null;
  for (const key of keys) {
    const raw = obj[key];
    if (raw === undefined || raw === null) continue;
    const n = Number(raw);
    if (!isNaN(n)) return n;
  }
  return null;
}

function reportMetricIndex(report: Record<string, unknown>, names: string[]): number {
  const headers = report.columnHeaders;
  if (!Array.isArray(headers)) return -1;
  return headers.findIndex(
    (h: { name?: string }) => typeof h?.name === 'string' && names.includes(h.name),
  );
}

function aggregateReportMetric(
  report: Record<string, unknown>,
  metric: VideoDeltaMetric,
): number | null {
  const rows = report.rows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  if (metric === 'views') {
    const idx = reportMetricIndex(report, ['views', 'playlistViews']);
    const col = idx >= 0 ? idx : 1;
    return rows.reduce((sum, r) => sum + (Number((r as unknown[])[col]) || 0), 0);
  }
  if (metric === 'watchTime') {
    const idx = reportMetricIndex(report, ['estimatedMinutesWatched', 'playlistEstimatedMinutesWatched']);
    const col = idx >= 0 ? idx : 2;
    return rows.reduce((sum, r) => sum + (Number((r as unknown[])[col]) || 0), 0);
  }
  const idx = reportMetricIndex(report, ['averageViewPercentage']);
  const col = idx >= 0 ? idx : 3;
  const valid = rows.filter((r) => {
    const v = (r as unknown[])[col];
    return v !== undefined && v !== null && !isNaN(Number(v));
  });
  if (!valid.length) return 0;
  return valid.reduce((sum, r) => sum + Number((r as unknown[])[col]), 0) / valid.length;
}

function readMetricValue(
  obj: Record<string, unknown> | null | undefined,
  metric: VideoDeltaMetric,
): number | null {
  if (!obj) return null;
  if (Array.isArray(obj.rows)) {
    return aggregateReportMetric(obj, metric);
  }
  if (metric === 'views') return firstNumeric(obj, ['views']);
  if (metric === 'watchTime') return firstNumeric(obj, WATCH_TIME_KEYS);
  return firstNumeric(obj, RETENTION_KEYS);
}

function unwrapPeriodSide(
  stat: VideoPeriodStat | Record<string, unknown> | null | undefined,
  side: 'current' | 'previous',
): Record<string, unknown> | null {
  if (!stat) return null;
  const nested = (stat as VideoPeriodStat)[side];
  if (nested && typeof nested === 'object') return nested as Record<string, unknown>;
  if (side === 'current' && typeof (stat as Record<string, unknown>).views === 'number') {
    return stat as Record<string, unknown>;
  }
  return null;
}

function sumField(rows: VideoChartRow[], field: keyof VideoChartRow): number {
  return rows.reduce((sum, r) => sum + (Number(r[field]) || 0), 0);
}

function avgField(rows: VideoChartRow[], field: keyof VideoChartRow): number {
  const valid = rows.filter(
    (r) => r[field] !== undefined && r[field] !== null && !isNaN(Number(r[field])),
  );
  if (!valid.length) return 0;
  return valid.reduce((sum, r) => sum + Number(r[field]), 0) / valid.length;
}

function metricFromChartRows(rows: VideoChartRow[], metric: VideoDeltaMetric, prev = false): number {
  if (metric === 'views') return sumField(rows, prev ? 'prevViews' : 'views');
  if (metric === 'watchTime') {
    const primary = sumField(rows, prev ? 'prevMinutesWatched' : 'minutesWatched');
    if (primary) return primary;
    return sumField(rows, prev ? 'prevWatchTime' : 'watchTime');
  }
  return avgField(rows, prev ? 'prevRetention' : 'retention');
}

export function getMetricDeltaPct(
  days: 7 | 30 | 90,
  metric: VideoDeltaMetric,
  stats: VideoMultiPeriodStats,
  chartData: VideoChartRow[],
  trueDelta: boolean,
): number | null {
  const key = `d${days}` as 'd7' | 'd30' | 'd90';
  const stat = stats?.[key];
  const currVal = readMetricValue(unwrapPeriodSide(stat, 'current'), metric);
  const prevVal = readMetricValue(unwrapPeriodSide(stat, 'previous'), metric);
  if (currVal !== null && prevVal !== null) {
    const pct = calcMetricDeltaPct(currVal, prevVal);
    if (pct !== null) return pct;
  }

  if (!chartData || chartData.length < 2) return null;
  const sorted = [...chartData].sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const len = sorted.length;

  const hasPrevData = sorted.some(
    (r) =>
      Number(r.prevViews || 0) > 0 ||
      Number(r.prevMinutesWatched || r.prevWatchTime || 0) > 0 ||
      Number(r.prevRetention || 0) > 0,
  );

  if (days === 30 && hasPrevData && !trueDelta) {
    return calcMetricDeltaPct(metricFromChartRows(sorted, metric), metricFromChartRows(sorted, metric, true));
  }

  if (days === 7) {
    const curr7 = sorted.slice(Math.max(0, len - 7));
    if (trueDelta || len >= 14) {
      const prev7 = sorted.slice(Math.max(0, len - 14), Math.max(0, len - 7));
      if (curr7.length && prev7.length) {
        return calcMetricDeltaPct(metricFromChartRows(curr7, metric), metricFromChartRows(prev7, metric));
      }
    } else if (hasPrevData) {
      return calcMetricDeltaPct(
        metricFromChartRows(curr7, metric),
        metricFromChartRows(curr7, metric, true),
      );
    }
  }

  let currSlice: VideoChartRow[] = [];
  let prevSlice: VideoChartRow[] = [];

  if (trueDelta) {
    if (days === 7) {
      currSlice = sorted.slice(Math.max(0, len - 7));
      prevSlice = sorted.slice(Math.max(0, len - 14), Math.max(0, len - 7));
    } else if (days === 30) {
      currSlice = sorted.slice(Math.max(0, len - 37), Math.max(0, len - 7));
      prevSlice = sorted.slice(Math.max(0, len - 67), Math.max(0, len - 37));
    } else {
      currSlice = sorted.slice(Math.max(0, len - 127), Math.max(0, len - 37));
      prevSlice = sorted.slice(Math.max(0, len - 217), Math.max(0, len - 127));
    }
  } else {
    currSlice = sorted.slice(Math.max(0, len - days));
    prevSlice = sorted.slice(Math.max(0, len - 2 * days), Math.max(0, len - days));
  }

  if (currSlice.length === 0 || prevSlice.length === 0) return null;
  return calcMetricDeltaPct(metricFromChartRows(currSlice, metric), metricFromChartRows(prevSlice, metric));
}
