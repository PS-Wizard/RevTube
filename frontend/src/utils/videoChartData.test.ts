import { describe, expect, it } from 'vitest';
import { buildVideoChartRows, selectVideoChartSeries, shiftIsoDate } from './videoChartData';

const ytHeaders = [
  { name: 'day' },
  { name: 'views' },
  { name: 'estimatedMinutesWatched' },
  { name: 'averageViewPercentage' },
  { name: 'subscribersGained' },
  { name: 'subscribersLost' },
  { name: 'likes' },
  { name: 'shares' },
  { name: 'comments' },
];

const pgHeaders = [
  { name: 'day' },
  { name: 'views' },
  { name: 'estimatedMinutesWatched' },
  { name: 'averageViewPercentage' },
  { name: 'averageViewDuration' },
  { name: 'engagedViews' },
  { name: 'viewerPercentage' },
  { name: 'subscribersGained' },
  { name: 'subscribersLost' },
  { name: 'likes' },
  { name: 'shares' },
  { name: 'comments' },
];

describe('shiftIsoDate', () => {
  it('shifts UTC calendar days', () => {
    expect(shiftIsoDate('2026-08-21', -30)).toBe('2026-07-22');
    expect(shiftIsoDate('2026-03-01', -1)).toBe('2026-02-28');
  });
});

describe('buildVideoChartRows', () => {
  it('maps previous days by calendar shift, not row index', () => {
    const current = {
      columnHeaders: ytHeaders,
      rows: [
        ['2026-08-20', 100, 10, 20],
        ['2026-08-21', 200, 20, 30],
      ],
    };
    const previous = {
      columnHeaders: ytHeaders,
      rows: [['2026-07-22', 80, 8, 15]],
    };
    const rows = buildVideoChartRows(current, previous, 30);
    expect(rows).toHaveLength(2);
    expect(rows[0].prevViews).toBeUndefined();
    expect(rows[1].date).toBe('2026-08-21');
    expect(rows[1].prevDate).toBe('2026-07-22');
    expect(rows[1].prevViews).toBe(80);
    expect(rows[1].prevMinutesWatched).toBe(8);
  });

  it('reads postgres extra-column reports via header names', () => {
    const current = {
      columnHeaders: pgHeaders,
      rows: [['2026-08-21', 50, 12, 40, 90, 0, 0, 3, 1, 9, 2, 4]],
    };
    const previous = {
      columnHeaders: pgHeaders,
      rows: [['2026-07-22', 25, 6, 20, 90, 0, 0, 1, 0, 4, 1, 2]],
    };
    const [row] = buildVideoChartRows(current, previous, 30);
    expect(row.views).toBe(50);
    expect(row.likes).toBe(9);
    expect(row.prevViews).toBe(25);
    expect(row.prevLikes).toBe(4);
    expect(row.prevSubscribers).toBe(1);
  });

  it('omits prev series when previous rows are missing', () => {
    const current = {
      columnHeaders: ytHeaders,
      rows: [['2026-08-21', 10, 1, 2]],
    };
    const [row] = buildVideoChartRows(current, { columnHeaders: ytHeaders, rows: [] }, 30);
    expect(row.views).toBe(10);
    expect(row.prevViews).toBeUndefined();
  });
});

describe('selectVideoChartSeries', () => {
  const chartData = [{ date: '2026-08-21', views: 100 }];
  const channelChartData = [{ date: '2026-08-21', subscribersGained: 5 }];
  const overlayRows = [{ date: '2026-08-21', views_l1: 60, views_l2: 40 }];
  const overlayConfig = [
    { name: 'L1', color: 'red', viewsKey: 'views_l1', watchTimeKey: 'mins_l1', retentionKey: 'ret_l1' },
    { name: 'L2', color: 'blue', viewsKey: 'views_l2', watchTimeKey: 'mins_l2', retentionKey: 'ret_l2' },
  ];

  it('prefers the overlay when 2+ lists are active and it has rows', () => {
    const sel = selectVideoChartSeries({
      activeChart: 'views',
      chartData,
      channelChartData,
      multiSeriesChartData: overlayRows,
      multiSeriesConfig: overlayConfig,
      activeListCount: 2,
    });
    expect(sel.data).toBe(overlayRows);
    expect(sel.multiSeriesData).toHaveLength(2);
  });

  it('falls back to the aggregate chart when the overlay is empty (pills/table still have data)', () => {
    const sel = selectVideoChartSeries({
      activeChart: 'views',
      chartData,
      channelChartData,
      multiSeriesChartData: [],
      multiSeriesConfig: overlayConfig,
      activeListCount: 2,
    });
    expect(sel.data).toBe(chartData);
    expect(sel.multiSeriesData).toBeUndefined();
  });

  it('falls back to the aggregate chart when the overlay is missing', () => {
    const sel = selectVideoChartSeries({
      activeChart: 'views',
      chartData,
      channelChartData,
      multiSeriesChartData: null,
      multiSeriesConfig: overlayConfig,
      activeListCount: 2,
    });
    expect(sel.data).toBe(chartData);
    expect(sel.multiSeriesData).toBeUndefined();
  });

  it('falls back to the aggregate chart for chart types with no overlay key (e.g. CTR)', () => {
    const sel = selectVideoChartSeries({
      activeChart: 'ctr',
      chartData,
      channelChartData,
      multiSeriesChartData: overlayRows,
      multiSeriesConfig: overlayConfig,
      activeListCount: 2,
    });
    expect(sel.data).toBe(chartData);
    expect(sel.multiSeriesData).toBeUndefined();
  });

  it('uses the aggregate chart when at most one list is active', () => {
    const sel = selectVideoChartSeries({
      activeChart: 'views',
      chartData,
      channelChartData,
      multiSeriesChartData: overlayRows,
      multiSeriesConfig: overlayConfig,
      activeListCount: 1,
    });
    expect(sel.data).toBe(chartData);
    expect(sel.multiSeriesData).toBeUndefined();
  });

  it('uses channel data for the subscriber charts', () => {
    const sel = selectVideoChartSeries({
      activeChart: 'subscribersGained',
      chartData,
      channelChartData,
      multiSeriesChartData: overlayRows,
      multiSeriesConfig: overlayConfig,
      activeListCount: 2,
    });
    expect(sel.data).toBe(channelChartData);
    expect(sel.multiSeriesData).toBeUndefined();
  });
});
