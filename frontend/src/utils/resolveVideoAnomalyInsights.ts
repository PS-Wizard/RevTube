import type { AnalyticsReport, AnalyticsService } from '../services/analyticsService';
import type { VideoMetadata } from '../types/youtube';

export type VideoAnomalyInsight = {
  kind: 'spike' | 'dip';
  date: string;
  prevDate?: string;
  deltaViews: number;
  topVideoId?: string;
  topVideoTitle?: string;
  topVideoViews?: number;
  topVideoDeltaViews?: number;
  topVideoThumbnailUrl?: string;
};

export async function resolveVideoAnomalyInsights(params: {
  activeTab: string;
  selectedVideo: VideoMetadata | null;
  currentReport: AnalyticsReport | null;
  videoFilters: string | undefined;
  videos: VideoMetadata[];
  svc: AnalyticsService;
  channelIds: string;
  signal?: AbortSignal;
}): Promise<VideoAnomalyInsight[]> {
  const { activeTab, selectedVideo, currentReport, videoFilters, videos, svc, channelIds, signal } = params;

  if (activeTab !== 'videoAnalytics' || selectedVideo) {
    return [];
  }

  const rows = (currentReport?.rows || [])
    .map((row: unknown[]) => ({
      date: String(row[0] || ''),
      views: Number(row[1]) || 0,
    }))
    .filter(r => !!r.date)
    .sort((a, b) => a.date.localeCompare(b.date));

  if (rows.length < 2) {
    return [];
  }

  const deltas = rows.slice(1).map((r, idx) => ({
    date: r.date,
    prevDate: rows[idx].date,
    delta: r.views - rows[idx].views,
  }));

  const mean = deltas.reduce((sum, d) => sum + d.delta, 0) / Math.max(1, deltas.length);
  const variance =
    deltas.reduce((sum, d) => {
      const diff = d.delta - mean;
      return sum + diff * diff;
    }, 0) / Math.max(1, deltas.length);
  const stdDev = Math.sqrt(variance);
  const anomalyThreshold = Math.max(100, stdDev * 1.2);

  const candidates = deltas
    .filter(d => Math.abs(d.delta) >= anomalyThreshold)
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6)
    .map(d => ({
      kind: d.delta >= 0 ? ('spike' as const) : ('dip' as const),
      date: d.date,
      prevDate: d.prevDate,
      deltaViews: d.delta,
    }));

  if (candidates.length === 0) {
    return [];
  }

  const titleById = new Map(videos.map(v => [v.videoId, v.title]));
  const thumbnailById = new Map(videos.map(v => [v.videoId, v.thumbnailUrl]));

  const insights = await Promise.all(
    candidates.map(async c => {
      if (signal?.aborted) {
        return c as VideoAnomalyInsight;
      }
      try {
        // YouTube Analytics API does not support dimensions: 'day,video'.
        // Fetch daily views over the 2-day range with existing filters (if any).
        // Without video-level breakdown, we identify the driver video by querying
        // the top N videos individually.
        let driverVideoId: string | undefined;
        let driverDelta = c.kind === 'spike' ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

        if (videoFilters) {
          // If we have a video filter, use it directly - the report gives us
          // aggregate daily views for the filtered set.
          const twoDayReport = await svc.getReport({
            ids: channelIds,
            startDate: c.prevDate,
            endDate: c.date,
            metrics: 'views',
            dimensions: 'day',
            sort: 'day',
            filters: videoFilters,
          });

          const prevViews = (twoDayReport.rows || []).find(r => String(r[0]) === c.prevDate)?.[1] || 0;
          const currViews = (twoDayReport.rows || []).find(r => String(r[0]) === c.date)?.[1] || 0;
          driverDelta = Number(currViews) - Number(prevViews);
        } else {
          // No video filter: query each video individually to find the one driving the anomaly.
          const topVideos = videos;
          for (const video of topVideos) {
            if (signal?.aborted) return c as VideoAnomalyInsight;
            try {
              const videoReport = await svc.getReport({
                ids: channelIds,
                startDate: c.prevDate,
                endDate: c.date,
                metrics: 'views',
                dimensions: 'day',
                sort: 'day',
                filters: `video==${video.videoId}`,
              });

              const prevViews = Number((videoReport.rows || []).find(r => String(r[0]) === c.prevDate)?.[1] || 0);
              const currViews = Number((videoReport.rows || []).find(r => String(r[0]) === c.date)?.[1] || 0);
              const delta = currViews - prevViews;

              if (c.kind === 'spike' && delta > driverDelta) {
                driverDelta = delta;
                driverVideoId = video.videoId;
              } else if (c.kind === 'dip' && delta < driverDelta) {
                driverDelta = delta;
                driverVideoId = video.videoId;
              }
            } catch {
              // skip this video
            }
          }
        }

        if ((c.kind === 'spike' && driverDelta <= 0) || (c.kind === 'dip' && driverDelta >= 0)) {
          driverVideoId = undefined;
        }

        return {
          ...c,
          topVideoId: driverVideoId,
          topVideoTitle: driverVideoId ? titleById.get(driverVideoId) : undefined,
          topVideoViews: driverVideoId ? undefined : undefined,
          topVideoDeltaViews: driverVideoId ? driverDelta : undefined,
          topVideoThumbnailUrl: driverVideoId ? thumbnailById.get(driverVideoId) : undefined,
        } as VideoAnomalyInsight;
      } catch {
        return c as VideoAnomalyInsight;
      }
    })
  );

  if (signal?.aborted) {
    return [];
  }

  return insights;
}