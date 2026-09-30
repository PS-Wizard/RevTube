type Header = { name?: string };
type ReportRow = Array<string | number>;

export type DailyReport = {
  columnHeaders?: Header[];
  rows?: ReportRow[];
} | null;

export type VideoChartPoint = {
  date: string;
  views: number;
  minutesWatched: number;
  retention: number;
  subscribersGained: number;
  subscribersLost: number;
  subscribers: number;
  likes: number;
  shares: number;
  comments: number;
  ctr: number;
  prevDate?: string;
  prevViews?: number;
  prevMinutesWatched?: number;
  prevRetention?: number;
  prevSubscribers?: number;
  prevLikes?: number;
  prevShares?: number;
  prevComments?: number;
};

const FALLBACK_IDX = {
  views: 1,
  minutesWatched: 2,
  retention: 3,
  subscribersGained: 4,
  subscribersLost: 5,
  likes: 6,
  shares: 7,
  comments: 8,
} as const;

function colIndex(headers: Header[] | undefined, names: string[], fallback: number): number {
  if (!headers?.length) return fallback;
  const idx = headers.findIndex((h) => typeof h?.name === 'string' && names.includes(h.name));
  return idx >= 0 ? idx : fallback;
}

function num(row: ReportRow, idx: number): number {
  const raw = row[idx];
  if (raw === undefined || raw === null || raw === '') return 0;
  const n = Number(raw);
  return Number.isFinite(n) ? n : 0;
}

function isoDay(value: string | number | undefined): string {
  return String(value || '').slice(0, 10);
}

export function shiftIsoDate(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) return iso;
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** Multi-list overlay row: a date plus one metric column per active list. */
export type OverlayPoint = Record<string, string | number>;

/** Per-list series config for the multi-list overlay chart. */
export interface OverlaySeriesConfig {
  name: string;
  color: string;
  viewsKey: string;
  watchTimeKey: string;
  retentionKey: string;
}

/** A resolved overlay series (dataKey picked for the active chart). */
export interface OverlaySeries {
  name: string;
  dataKey: string;
  color: string;
}

export interface VideoChartSeriesSelection<TAggregate, TChannel> {
  data: TAggregate[] | TChannel[] | OverlayPoint[];
  multiSeriesData: OverlaySeries[] | undefined;
}

const OVERLAY_KEY_BY_CHART: Partial<
  Record<string, 'viewsKey' | 'watchTimeKey' | 'retentionKey'>
> = {
  views: 'viewsKey',
  watchTime: 'watchTimeKey',
  retention: 'retentionKey',
};

/**
 * Picks the rows + overlay series for the video analytics chart.
 *
 * The multi-list overlay wins only when it actually contains data. An empty
 * overlay (or a chart type with no overlay key, e.g. CTR) falls back to the
 * aggregate series — the same source the stat pills and table are computed
 * from — so the chart can never show "No data for this period." while stats
 * exist. (An empty array is truthy, so callers must not rely on `||`/`?:`
 * truthiness here.)
 */
export function selectVideoChartSeries<TAggregate, TChannel>(args: {
  activeChart: string;
  chartData: TAggregate[];
  channelChartData: TChannel[];
  multiSeriesChartData: OverlayPoint[] | null | undefined;
  multiSeriesConfig: OverlaySeriesConfig[] | null | undefined;
  activeListCount: number;
}): VideoChartSeriesSelection<TAggregate, TChannel> {
  if (args.activeChart === 'subscribersGained' || args.activeChart === 'subscribersLost') {
    return { data: args.channelChartData, multiSeriesData: undefined };
  }
  const keyProp = OVERLAY_KEY_BY_CHART[args.activeChart];
  const overlayRows = args.multiSeriesChartData ?? [];
  if (
    keyProp &&
    args.activeListCount > 1 &&
    overlayRows.length > 0 &&
    args.multiSeriesConfig
  ) {
    const multiSeriesData = args.multiSeriesConfig
      .map((cfg) => ({ name: cfg.name, dataKey: cfg[keyProp], color: cfg.color }))
      .filter((s) => !!s.dataKey);
    if (multiSeriesData.length > 0) {
      return { data: overlayRows, multiSeriesData };
    }
  }
  return { data: args.chartData, multiSeriesData: undefined };
}

function readPoint(row: ReportRow, headers?: Header[]): Omit<VideoChartPoint, 'ctr'> {
  const views = num(row, colIndex(headers, ['views', 'playlistViews'], FALLBACK_IDX.views));
  const minutesWatched = num(
    row,
    colIndex(headers, ['estimatedMinutesWatched', 'playlistEstimatedMinutesWatched', 'minutesWatched'], FALLBACK_IDX.minutesWatched),
  );
  const retention = num(row, colIndex(headers, ['averageViewPercentage', 'retention'], FALLBACK_IDX.retention));
  const subscribersGained = num(row, colIndex(headers, ['subscribersGained'], FALLBACK_IDX.subscribersGained));
  const subscribersLost = num(row, colIndex(headers, ['subscribersLost'], FALLBACK_IDX.subscribersLost));
  const likes = num(row, colIndex(headers, ['likes'], FALLBACK_IDX.likes));
  const shares = num(row, colIndex(headers, ['shares'], FALLBACK_IDX.shares));
  const comments = num(row, colIndex(headers, ['comments'], FALLBACK_IDX.comments));
  return {
    date: isoDay(row[0]),
    views,
    minutesWatched,
    retention,
    subscribersGained,
    subscribersLost,
    subscribers: subscribersGained - subscribersLost,
    likes,
    shares,
    comments,
  };
}

/**
 * Overlay previous-period daily rows onto the current series by calendar shift
 * (current day D maps to D - periodDays), not by row index. Postgres and YouTube
 * both omit zero-traffic days, so index-zipping flattened the compare line to y=0.
 */
export function buildVideoChartRows(
  current: DailyReport,
  previous: DailyReport,
  periodDays: number,
): VideoChartPoint[] {
  if (!current?.rows?.length) return [];
  const currHeaders = current.columnHeaders;
  const prevHeaders = previous?.columnHeaders || currHeaders;
  const shift = Math.max(1, Math.round(Number(periodDays) || 30));

  const prevByDate = new Map<string, ReportRow>();
  for (const row of previous?.rows || []) {
    const date = isoDay(row?.[0]);
    if (date) prevByDate.set(date, row);
  }

  return [...current.rows]
    .map((row) => {
      const point: VideoChartPoint = { ...readPoint(row, currHeaders), ctr: 0 };
      if (!point.date || !prevByDate.size) return point;
      const prevDate = shiftIsoDate(point.date, -shift);
      const prevRow = prevByDate.get(prevDate);
      if (!prevRow) return point;
      const prev = readPoint(prevRow, prevHeaders);
      point.prevDate = prev.date;
      point.prevViews = prev.views;
      point.prevMinutesWatched = prev.minutesWatched;
      point.prevRetention = prev.retention;
      point.prevSubscribers = prev.subscribers;
      point.prevLikes = prev.likes;
      point.prevShares = prev.shares;
      point.prevComments = prev.comments;
      return point;
    })
    .filter((p) => !!p.date)
    .sort((a, b) => a.date.localeCompare(b.date));
}
