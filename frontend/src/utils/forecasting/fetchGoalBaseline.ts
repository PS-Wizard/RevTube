import type { AnalyticsReport, AnalyticsService } from '../../services/analyticsService';
import type { GoalMetric } from '../../types/goals';
import type { SubFrameGranularity } from '../../components/goals/milestones';
import { getFirebaseAuthHeader } from '../../services/authHeaders';
import { getResolvedApiBaseUrl } from '../../utils/apiBase';

function headerIndex(report: AnalyticsReport, name: string): number {
  return report.columnHeaders?.findIndex((h) => h.name === name) ?? -1;
}

function numAt(row: unknown[], idx: number): number {
  if (idx < 0) return 0;
  return Number(row[idx] ?? 0) || 0;
}

function periodKey(date: string, granularity: SubFrameGranularity): string {
  const [y, m] = date.split('-').map(Number);
  if (granularity === 'quarters') return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
  if (granularity === 'months') return `${y}-${String(m).padStart(2, '0')}`;
  return date.slice(0, 10);
}

/**
 * YouTube Analytics rejects some *mixtures* of metrics with an HTTP 400
 * ("The query is not supported") when they are combined in a single `day`
 * report -- e.g. `averageViewPercentage` (session group) combined with the
 * card metrics, or either combined with the subscribers group. The dashboard
 * (`backend/routes/dashboardTabs.js`) already works around this by fetching
 * each YT-supported metric group as its own report.
 *
 * A failing combined report used to collapse the whole goal baseline to 0 —
 * every metric showed "0.00%" / all zeros in production. Here we instead ask
 * only for the YT-compatible group the selected goal actually needs, so a
 * real goal never gets blanked out just because an unrelated metric group is
 * unsupported.
 */
function baselineMetrics(metric: GoalMetric): string {
  switch (metric) {
    // Core engagement group fetches cleanly in one `day` report.
    case 'engagement_rate':
      return 'views,likes,comments,shares';
    // Retention: `averageViewPercentage` must be grouped with views.
    case 'retention':
      return 'views,averageViewPercentage';
    // Card group: include views (for weighting) + cardClickRate -- YouTube
    // supplies the click-through rate directly and some channels return
    // impressions/clicks but a usable rate column (or vice versa).
    case 'ctr':
      return 'views,cardImpressions,cardClicks,cardClickRate';
    case 'subscribers':
      return 'subscribersGained,subscribersLost';
    case 'views':
    default:
      return 'views';
  }
}

export interface GoalBaselineSnapshot {
  current: number;
  /** The metric's value as of today (lifetime total for views/subs, recent-window average for level metrics). */
  today?: number;
  historyAdds: number[];
  daily: Array<{ date: string; value: number }>;
  /** Full lifetime channel total for Views / Subscribers (statistics.viewCount / subscriberCount). */
  lifetime?: number;
}

/**
 * Public channel lookup (`GET /api/channel/id/:id`). Works with Firebase auth
 * alone — no YouTube OAuth on the requesting user — so it resolves statistics
 * for organization-owned channels that `/channels/mine` does not list.
 */
async function fetchChannelStatisticsById(
  channelId: string,
): Promise<{ viewCount?: string; subscriberCount?: string } | null> {
  const url = `${getResolvedApiBaseUrl()}/channel/id/${encodeURIComponent(channelId)}`;
  const res = await fetch(url, { headers: await getFirebaseAuthHeader() });
  if (!res.ok) return null;
  const data = (await res.json()) as {
    items?: Array<{ statistics?: { viewCount?: string; subscriberCount?: string } }>;
  };
  return data.items?.[0]?.statistics ?? null;
}

export async function fetchGoalBaseline(
  svc: AnalyticsService,
  channelId: string,
  metric: GoalMetric,
  startDate: string,
  granularity: SubFrameGranularity,
  /** Baseline lookback window (days) used for CTR / Engagement / Retention `current`. */
  rangeDays = 30,
  /**
   * Baseline reference point. `'start'` (default) measures the window ending
   * the day before the goal starts; `'today'` uses the most recent data.
   * `days: 'all'` uses every available row before the reference point.
   */
  baselineWindow?: { ref: 'start' | 'today'; days: number | 'all' },
  /**
   * Fallback lifetime-statistics fetcher (used when the channel is not under
   * the member's own OAuth token — i.e. organization-owned channels). Resolves
   * `{ viewCount, subscriberCount }` from the public channel lookup endpoint.
   */
  statsFetcher: (
    channelId: string,
  ) => Promise<{ viewCount?: string; subscriberCount?: string } | null> =
    fetchChannelStatisticsById,
): Promise<GoalBaselineSnapshot> {
  const end = new Date();
  end.setUTCDate(end.getUTCDate() - 2);
  const endDate = end.toISOString().slice(0, 10);
  const start = new Date(end);
  start.setUTCDate(start.getUTCDate() - 729);
  const lookbackStart = start.toISOString().slice(0, 10);

  // Views / Subscribers: the baseline is the channel's FULL, lifetime total
  // (YouTube `statistics.viewCount` / `subscriberCount`), so a goal tracks
  // current-lifetime → target-lifetime (e.g. 3000 → 5000) rather than a gained
  // amount. Falls back to the in-window report sum when statistics are
  // unavailable.
  //
  // NOTE: `/channels/mine` only returns channels under the *member's own*
  // OAuth token. For organization-owned channels it misses, so we fall back to
  // the public channel lookup (`GET /channel/id/:id`) which returns
  // `statistics` for any channel the user can see (org members included).
  let lifetime = 0;
  if (metric === 'views' || metric === 'subscribers') {
    try {
      const channels = await svc.getAuthorizedChannels();
      const own = channels?.find((c) => c?.id === channelId);
      const raw = own?.statistics
        ? metric === 'views'
          ? own.statistics.viewCount
          : own.statistics.subscriberCount
        : undefined;
      const n = parseInt(raw ?? '0', 10);
      if (Number.isFinite(n) && n > 0) lifetime = n;
    } catch {
      lifetime = 0;
    }
    if (!lifetime && statsFetcher) {
      try {
        const stats = await statsFetcher(channelId);
        const raw = metric === 'views' ? stats?.viewCount : stats?.subscriberCount;
        const n = parseInt(raw ?? '0', 10);
        if (Number.isFinite(n) && n > 0) lifetime = n;
      } catch {
        lifetime = 0;
      }
    }
  }

  const metrics = baselineMetrics(metric);

  const report = await svc.getReport({
    ids: `channel==${channelId}`,
    channelId,
    startDate: lookbackStart,
    endDate,
    metrics,
    dimensions: 'day',
    sort: 'day',
    // The baseline seeds every goal KPI/chart — a 24h-stale browser-cached
    // report (e.g. cached while the org token was broken) would show a fake 0.
    // Always go to the backend; it applies its own short TTL instead.
    bypassCache: true,
  });

  const rows = report.rows || [];
  const di = headerIndex(report, 'day');
  const read = (row: unknown[], name: string): number => numAt(row, headerIndex(report, name));

  const daily = rows
    .map((row) => {
      const date = String(row[di] ?? '').slice(0, 10);
      return {
        date,
        views: read(row, 'views'),
        likes: read(row, 'likes'),
        comments: read(row, 'comments'),
        shares: read(row, 'shares'),
        netSubs: read(row, 'subscribersGained') - read(row, 'subscribersLost'),
        avp: read(row, 'averageViewPercentage'),
        impressions: read(row, 'cardImpressions'),
        clicks: read(row, 'cardClicks'),
        // cardClickRate comes back from YouTube as a percentage (e.g. 4.2 = 4.2%).
        ctrRate: read(row, 'cardClickRate'),
      };
    })
    .filter((r) => r.date);

  // Per-row effective CTR (percent): prefer the explicit rate column, fall back
  // to clicks/impressions. Zero when a channel has no card activity at all.
  const rowCtr = (r: { clicks: number; impressions: number; ctrRate: number }): number => {
    if (r.impressions > 0) return r.clicks / r.impressions > 0 ? (r.clicks / r.impressions) * 100 : r.ctrRate;
    if (r.ctrRate > 0) return r.ctrRate;
    return 0;
  };

  // The "start from current" baseline is the value AS OF the goal's start
  // date, not today:
  //  - level metrics (retention/engagement/CTR): weighted average over the
  //    `rangeDays` window ending the day BEFORE the goal starts;
  //  - views/subscribers: lifetime total minus everything gained on/after the
  //    start date (falls back to the in-window sum up to the start date when
  //    lifetime statistics are unavailable).
  const beforeStart = daily.filter((r) => r.date < startDate);
  const range = Math.max(1, Math.min(beforeStart.length, rangeDays));
  const recent = beforeStart.slice(-range);

  // Baseline reference point: the goal's start date (default) or today.
  const bwRef = baselineWindow?.ref ?? 'start';
  const bwDays = baselineWindow?.days ?? rangeDays;
  const windowRows = (() => {
    if (bwRef === 'today') {
      return bwDays === 'all'
        ? daily
        : daily.slice(-Math.max(1, Math.min(bwDays, daily.length)));
    }
    return bwDays === 'all' ? beforeStart : recent;
  })();

  // Views-weighted level value (retention / engagement / CTR) over a window of
  // daily rows. Includes the CTR fallback retry against the dedicated rate
  // column when the combined group returns zeros.
  const levelValue = async (rows: typeof daily): Promise<number> => {
    const wv = rows.reduce((s, r) => s + r.views, 0);
    if (metric === 'retention') {
      const w = rows.reduce((s, r) => s + r.avp * r.views, 0);
      return wv > 0 ? w / wv : 0;
    }
    if (metric === 'engagement_rate') {
      const eng = rows.reduce((s, r) => s + r.likes + r.comments + r.shares, 0);
      return wv > 0 ? (eng / wv) * 100 : 0;
    }
    // Views-weighted effective CTR: prefer clicks/impressions when impressions
    // exist, else the rate column. Mirrors dashboardTabs.js behavior.
    let val = wv > 0 ? rows.reduce((s, r) => s + rowCtr(r) * r.views, 0) / wv : 0;
    // Nothing usable from the combined group (e.g. some channels reject it or
    // return zeros): one retry asking for cardClickRate alone.
    if (val <= 0 && rows.some((r) => r.views > 0)) {
      try {
        const alt = await svc.getReport({
          ids: `channel==${channelId}`,
          channelId,
          startDate: rows[0].date,
          endDate: rows[rows.length - 1].date,
          metrics: 'cardClickRate',
          dimensions: 'day',
          sort: 'day',
        });
        const rowsAlt = alt.rows || [];
        const diAlt = headerIndex(alt, 'day');
        const byDate = new Map(rowsAlt.map((r) => [String(r[diAlt] ?? '').slice(0, 10), r]));
        let wr = 0;
        for (const d of rows) {
          const ar = byDate.get(d.date);
          if (!ar) continue;
          const rate = numAt(ar, headerIndex(alt, 'cardClickRate'));
          wr += rate * d.views;
        }
        if (wr > 0) val = wr / wv;
      } catch {
        // keep 0 -- channel genuinely has no card data
      }
    }
    return val;
  };

  // Cumulative (views / net subscribers) value as of a reference date:
  // lifetime total minus everything gained on/after it; when lifetime stats
  // are unavailable, falls back to the in-window sum before the reference.
  const cumulativeValue = (refDate: string): number => {
    const use = metric === 'subscribers' ? 'netSubs' : 'views';
    if (lifetime > 0) {
      const gainedSince = daily
        .filter((r) => r.date >= refDate)
        .reduce((s, r) => s + r[use], 0);
      return Math.max(0, Math.round(lifetime - gainedSince));
    }
    return Math.round(
      daily.filter((r) => r.date < refDate).reduce((s, r) => s + r[use], 0),
    );
  };

  const isCumulative = metric === 'views' || metric === 'subscribers';
  // Cumulative metrics reference the start date — unless the user asked for a
  // "before current" window, in which case the baseline is today's value.
  const cumRef = bwRef === 'today' ? '9999-12-31' : startDate;
  const current = isCumulative ? cumulativeValue(cumRef) : await levelValue(windowRows);
  // Value as of today: lifetime total for cumulative metrics (nothing gained
  // after today to subtract); the weighted level average over the last
  // `rangeDays` days of data for level metrics.
  const today = isCumulative
    ? (lifetime > 0 ? lifetime : current)
    : await levelValue(daily.slice(-Math.max(1, rangeDays)));

  const buckets = new Map<string, number>();
  for (const r of daily) {
    if (r.date >= startDate) continue;
    const key = periodKey(r.date, granularity);
    const add = metric === 'subscribers'
      ? r.netSubs
      : metric === 'retention'
        ? r.avp * r.views
        : metric === 'engagement_rate'
          ? r.likes + r.comments + r.shares
          : metric === 'ctr'
            ? r.clicks
            : r.views;
    buckets.set(key, (buckets.get(key) ?? 0) + add);
  }

  const historyAdds = Array.from(buckets.values()).slice(-12);
  const dailyValues = daily.map((r) => ({
    date: r.date,
    value: metric === 'subscribers'
      ? r.netSubs
      : metric === 'retention'
        ? r.avp
        : metric === 'engagement_rate'
          ? (r.views > 0 ? ((r.likes + r.comments + r.shares) / r.views) * 100 : 0)
          : metric === 'ctr'
            ? rowCtr(r)
            : r.views,
  }));
  return { current, today, historyAdds, daily: dailyValues, lifetime: lifetime || undefined };
}
