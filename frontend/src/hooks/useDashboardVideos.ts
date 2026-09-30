import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import type { Dayjs } from 'dayjs';
import type { VideoMetadata, PlaylistMetadata } from '../types/youtube';
import { YouTubeService } from '../services/youtubeService';
import { AnalyticsService } from '../services/analyticsService';
import type { FilterableVideo } from '../utils/dashboardUtils';
import { getVideosByActiveFilters } from '../utils/dashboardUtils';
import { useDashboardStore } from '../stores/dashboardStore';
import { devLog } from '../utils/devLog';

const MAX_VIDEO_ANALYTICS_ENRICHMENT = 250;

interface UseDashboardVideosProps {
  selectedChannel: string | null;
  loadingChannels: boolean;
  getEffectiveToken: () => Promise<string | null>;
  activeTab: string;
  activeListIds: Set<string>;
  userEmail?: string;
  period: number | null;
  customStartDate: Dayjs | null;
  customEndDate: Dayjs | null;
  latestDataDate: string;
  channelsLength: number;
  showAllTimeViews?: boolean;
}

export const useDashboardVideos = ({
  selectedChannel,
  loadingChannels,
  getEffectiveToken,
  activeTab,
  activeListIds,
  userEmail,
  period,
  customStartDate,
  customEndDate,
  latestDataDate,
  channelsLength,
  showAllTimeViews = false,
}: UseDashboardVideosProps) => {
  const selectedChannelRef = useRef<string | null>(selectedChannel);
  const visibility = useDashboardStore((state) => state.filters.visibility);
  const lastPlaylistAnalyticsFetchKeyRef = useRef<string | null>(null);
  const lastPlaylistLoadKeyRef = useRef<string | null>(null);
  useEffect(() => {
    selectedChannelRef.current = selectedChannel;
  }, [selectedChannel]);

  const getVideoLimitStorageKey = () => `videoLimit_${selectedChannel || 'default'}`;
  const getCustomLimitStorageKey = () => `customLimit_${selectedChannel || 'default'}`;

  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [videoLimit, setVideoLimit] = useState<number | 'all' | 'custom'>(() => {
    try {
      const stored = localStorage.getItem(`videoLimit_default`);
      if (stored) {
        const parsed = stored === 'all' || stored === 'custom' ? stored : parseInt(stored, 10);
        return isNaN(parsed as number) ? 10 : parsed;
      }
    } catch {
      /* ignore */
    }
    return 10;
  });
  const [customLimit, setCustomLimit] = useState<number>(() => {
    try {
      const stored = localStorage.getItem(`customLimit_default`);
      if (stored) {
        const parsed = parseInt(stored, 10);
        return isNaN(parsed) ? 50 : parsed;
      }
    } catch {
      /* ignore */
    }
    return 50;
  });

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    try {
      const vl = localStorage.getItem(getVideoLimitStorageKey());
      if (vl) {
        const parsed = vl === 'all' || vl === 'custom' ? vl : parseInt(vl, 10);
        setVideoLimit(isNaN(parsed as number) ? 10 : parsed);
      } else {
        setVideoLimit(10);
      }
      const cl = localStorage.getItem(getCustomLimitStorageKey());
      if (cl) {
        const p = parseInt(cl, 10);
        setCustomLimit(isNaN(p) ? 50 : p);
      } else {
        setCustomLimit(50);
      }
    } catch {
      /* ignore */
    }
    /* eslint-enable react-hooks/set-state-in-effect */
  }, [getCustomLimitStorageKey, getVideoLimitStorageKey, selectedChannel]);

  const [loadingVideos, setLoadingVideos] = useState(false);
  const [videoTypeFilter, setVideoTypeFilter] = useState<'all' | 'shorts' | 'long'>('all');
  const [videoSearchQuery, setVideoSearchQuery] = useState('');
  const [filterByPlaylists, setFilterByPlaylists] = useState(false);
  const [selectedPlaylists, setSelectedPlaylists] = useState<Set<string>>(new Set());
  const [filterByVideos, setFilterByVideos] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [playlists, setPlaylists] = useState<PlaylistMetadata[]>([]);
  const [isLoadingPlaylists, setIsLoadingPlaylists] = useState(false);
  const [videoPlaylistMap, setVideoPlaylistMap] = useState<Map<string, string[]>>(new Map());
  const [videosError, setVideosError] = useState<string | null>(null);

  useEffect(() => {
    /* eslint-disable react-hooks/set-state-in-effect */
    setVideos([]);
    /* eslint-enable react-hooks/set-state-in-effect */
    setPlaylists([]);
    lastPlaylistAnalyticsFetchKeyRef.current = null;
    lastPlaylistLoadKeyRef.current = null;
    setVideoPlaylistMap(new Map());
    setSelectedPlaylists(new Set());
    setFilterByPlaylists(false);
    setFilterByVideos(false);
    setSelectedVideos(new Set());
    setVideoSearchQuery('');
    setVideosError(null);
  }, [selectedChannel]);

  useEffect(() => {
    if (selectedChannel) {
      try {
        localStorage.setItem(getVideoLimitStorageKey(), String(videoLimit));
      } catch {
        /* ignore */
      }
    }
  }, [videoLimit, selectedChannel]);

  useEffect(() => {
    if (selectedChannel) {
      try {
        localStorage.setItem(getCustomLimitStorageKey(), String(customLimit));
      } catch {
        /* ignore */
      }
    }
  }, [customLimit, selectedChannel]);

  const fetchChannelPlaylists = useCallback(async () => {
    if (!selectedChannel || loadingChannels || !userEmail) return;
    const requestChannel = selectedChannel;
    const stillCurrent = () => selectedChannelRef.current === requestChannel;

    const limit = videoLimit === 'all' ? undefined : (videoLimit === 'custom' ? customLimit : Number(videoLimit));
    const cacheKey = `playlists_${requestChannel}_${limit || 'all'}`;
    const cacheMapKey = `playlist_map_${requestChannel}_${limit || 'all'}`;

    try {
      const cachedPlaylists = sessionStorage.getItem(cacheKey);
      const cachedMap = sessionStorage.getItem(cacheMapKey);
      const cacheTime = sessionStorage.getItem(`${cacheKey}_time`);

      if (cachedPlaylists && cachedMap && cacheTime && Date.now() - parseInt(cacheTime) < 24 * 60 * 60 * 1000) {
        const parsedPlaylists = JSON.parse(cachedPlaylists);
        const parsedMapArray = JSON.parse(cachedMap);
        const restoredMap = new Map<string, string[]>(parsedMapArray);

        if (!stillCurrent()) return;
        setPlaylists(parsedPlaylists);
        setSelectedPlaylists(new Set(parsedPlaylists.map((p: PlaylistMetadata) => p.id)));
        setVideoPlaylistMap(restoredMap);
        return;
      }
    } catch (err) {
      console.warn('Failed to read playlist cache:', err);
    }

    setIsLoadingPlaylists(true);
    try {
      const token = await getEffectiveToken();
      if (!token) return;
      if (!stillCurrent()) return;

      const service = new YouTubeService(userEmail, token);
      const fetchedPlaylists = await service.fetchChannelPlaylists(requestChannel, limit);
      if (!stillCurrent()) return;
      setPlaylists(fetchedPlaylists);
      setSelectedPlaylists(new Set(fetchedPlaylists.map((p: PlaylistMetadata) => p.id)));

      const newVideoPlaylistMap = new Map<string, string[]>();
      const batchSize = 10;
      for (let i = 0; i < fetchedPlaylists.length; i += batchSize) {
        const batch = fetchedPlaylists.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async (playlist: { id: string; title?: string }) => {
            try {
              const playlistVideos = await service.fetchPlaylistItems(playlist.id, 500, true, undefined, true);
              playlistVideos.forEach(video => {
                const videoId = video.videoId;
                if (!newVideoPlaylistMap.has(videoId)) {
                  newVideoPlaylistMap.set(videoId, []);
                }
                newVideoPlaylistMap.get(videoId)!.push(playlist.id);
              });
            } catch (playlistError) {
              console.warn(`Failed to fetch videos for playlist ${playlist.title}:`, playlistError);
            }
          })
        );
      }
      setVideoPlaylistMap(newVideoPlaylistMap);

      try {
        sessionStorage.setItem(cacheKey, JSON.stringify(fetchedPlaylists));
        sessionStorage.setItem(cacheMapKey, JSON.stringify(Array.from(newVideoPlaylistMap.entries())));
        sessionStorage.setItem(`${cacheKey}_time`, String(Date.now()));
      } catch (err) {
        console.warn('Failed to write playlist cache:', err);
      }

      setVideos(prevVideos =>
        prevVideos.map(video => ({
          ...video,
          sourcePlaylistIds: newVideoPlaylistMap.get(video.videoId) || [],
        }))
      );
    } catch (error) {
      console.error('Error fetching playlists:', error);
    } finally {
      if (stillCurrent()) {
        setIsLoadingPlaylists(false);
      }
    }
  }, [selectedChannel, loadingChannels, getEffectiveToken, userEmail, videoLimit, customLimit]);

  const fetchVideoTrends = useCallback(
    async (videoList: VideoMetadata[], requestChannel: string) => {
      if (!videoList.length || !requestChannel || !userEmail) return;
      const stillCurrent = () => selectedChannelRef.current === requestChannel;

      try {
        const tokenToUse = await getEffectiveToken();
        if (!tokenToUse) return;
        if (!stillCurrent()) return;

        const currentAnalytics = new AnalyticsService(tokenToUse, userEmail);
        const videoIds = videoList.map(v => v.videoId);

        const chunks: string[][] = [];
        for (let i = 0; i < videoIds.length; i += 25) {
          chunks.push(videoIds.slice(i, i + 25));
        }

        const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
        const endDate = endRefDate.toISOString().split('T')[0];
        const trendStart = new Date(endRefDate);
        trendStart.setDate(trendStart.getDate() - 7);
        const trendStartDate = trendStart.toISOString().split('T')[0];

        // YouTube Analytics API does not support dimensions: 'day,video'.
        // Query each video individually with dimensions: 'day' to get per-video daily trends.
        const trendsMap: Record<string, number[]> = {};

        await Promise.all(
          videoIds.map(async videoId => {
            try {
              const filter = `video==${videoId}`;
              const channelIds = `channel==${requestChannel}`;
              const trendReport = await currentAnalytics.getReport({
                ids: channelIds,
                startDate: trendStartDate,
                endDate,
                metrics: 'views',
                dimensions: 'day',
                filters: filter,
                sort: 'day',
              });

              (trendReport.rows || []).forEach(row => {
                const views = parseInt(row[1]) || 0;
                if (!trendsMap[videoId]) trendsMap[videoId] = [];
                trendsMap[videoId].push(views);
              });
            } catch (e) {
              console.warn(`Failed to fetch video trends for ${videoId}`, e);
            }
          })
        );

        if (!stillCurrent()) return;
        setVideos((prev: VideoMetadata[]) =>
          prev.map((v: VideoMetadata) => ({
            ...v,
            ...(trendsMap[v.videoId] ? { trends: trendsMap[v.videoId] } : {}),
          }))
        );
      } catch (err) {
        console.warn('Failed to fetch video trends:', err);
      }
    },
    [userEmail, getEffectiveToken, latestDataDate]
  );

  const fetchVideoRetention = useCallback(
    async (videoList: VideoMetadata[], requestChannel: string) => {
      if (!videoList.length || !requestChannel || !userEmail) return;
      const stillCurrent = () => selectedChannelRef.current === requestChannel;

      try {
        const tokenToUse = await getEffectiveToken();
        if (!tokenToUse) return;
        if (!stillCurrent()) return;

        const currentAnalytics = new AnalyticsService(tokenToUse, userEmail);
        const videoIds = videoList.map(v => v.videoId);
        const chunks: string[][] = [];
        for (let i = 0; i < videoIds.length; i += 25) {
          chunks.push(videoIds.slice(i, i + 25));
        }

        const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
        const retentionEnd = endRefDate.toISOString().split('T')[0];
        const retentionStartDate = (() => {
          if (customStartDate && customEndDate) {
            return customStartDate.format('YYYY-MM-DD');
          }
          const d = new Date(endRefDate);
          d.setDate(d.getDate() - (period ?? 30));
          return d.toISOString().split('T')[0];
        })();

        const retentionMap: Record<string, number> = {};
        const avgViewDurationMap: Record<string, number> = {};
        const engagedViewsMap: Record<string, number> = {};
        const watchTimeMap: Record<string, number> = {};
        await Promise.all(
          chunks.map(async chunk => {
            try {
              const filter = `video==${chunk.join(',')}`;
              const channelIds = `channel==${requestChannel}`;
              const retentionReport = await currentAnalytics.getReport({
                ids: channelIds,
                startDate: retentionStartDate,
                endDate: retentionEnd,
                metrics: 'averageViewPercentage,averageViewDuration,engagedViews,estimatedMinutesWatched',
                dimensions: 'video',
                filters: filter,
              });

              (retentionReport.rows || []).forEach((row: string[]) => {
                retentionMap[row[0]] = parseFloat(row[1]) || 0;
                avgViewDurationMap[row[0]] = parseFloat(row[2]) || 0;
                engagedViewsMap[row[0]] = parseFloat(row[3]) || 0;
                watchTimeMap[row[0]] = parseFloat(row[4]) || 0;
              });
            } catch (e) {
              console.warn('Failed to fetch video retention chunk', e);
            }
          })
        );

        if (!stillCurrent()) return;
        setVideos((prev: VideoMetadata[]) =>
          prev.map((v: VideoMetadata) => ({
            ...v,
            ...(retentionMap[v.videoId] !== undefined ? { retention: retentionMap[v.videoId] } : {}),
            ...(avgViewDurationMap[v.videoId] !== undefined
              ? { averageViewDuration: avgViewDurationMap[v.videoId] }
              : {}),
            ...(engagedViewsMap[v.videoId] !== undefined
              ? { engagedViews: engagedViewsMap[v.videoId] }
              : {}),
            ...(watchTimeMap[v.videoId] !== undefined
              ? { estimatedMinutesWatched: watchTimeMap[v.videoId] }
              : {}),
          }))
        );
      } catch (err) {
        console.warn('Failed to fetch video retention:', err);
      }
    },
    [userEmail, getEffectiveToken, period, latestDataDate, customStartDate, customEndDate]
  );

  const fetchVideoPeriodViews = useCallback(
    async (videoList: VideoMetadata[], requestChannel: string) => {
      if (!videoList.length || !requestChannel || !userEmail) return;
      const stillCurrent = () => selectedChannelRef.current === requestChannel;

      try {
        const tokenToUse = await getEffectiveToken();
        if (!tokenToUse) return;
        if (!stillCurrent()) return;

        const currentAnalytics = new AnalyticsService(tokenToUse, userEmail);
        const videoIds = videoList.map(v => v.videoId);
        const chunks: string[][] = [];
        for (let i = 0; i < videoIds.length; i += 25) {
          chunks.push(videoIds.slice(i, i + 25));
        }

        const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
        const periodEnd = customEndDate ? customEndDate.format('YYYY-MM-DD') : endRefDate.toISOString().split('T')[0];
        const periodStart = (() => {
          if (customStartDate && customEndDate) {
            return customStartDate.format('YYYY-MM-DD');
          }
          const d = new Date(endRefDate);
          d.setDate(d.getDate() - ((period ?? 30) - 1));
          return d.toISOString().split('T')[0];
        })();

        const periodViewsMap: Record<string, number> = {};

        await Promise.all(
          chunks.map(async chunk => {
            try {
              const filter = `video==${chunk.join(',')}`;
              const channelIds = `channel==${requestChannel}`;
              const report = await currentAnalytics.getReport({
                ids: channelIds,
                startDate: periodStart,
                endDate: periodEnd,
                metrics: 'views',
                dimensions: 'video',
                filters: filter,
              });

              (report.rows || []).forEach((row: string[]) => {
                periodViewsMap[row[0]] = Number(row[1]) || 0;
              });
            } catch (e) {
              console.warn('Failed to fetch date-range views chunk', e);
            }
          })
        );

        if (!stillCurrent()) return;
        setVideos((prev: VideoMetadata[]) =>
          prev.map((v: VideoMetadata) => ({
            ...v,
            periodViewCount: periodViewsMap[v.videoId] ?? 0,
          }))
        );
      } catch (err) {
        console.warn('Failed to fetch date-range views:', err);
      }
    },
    [userEmail, getEffectiveToken, period, latestDataDate, customStartDate, customEndDate]
  );

  const fetchPlaylistAnalytics = useCallback(
    async (playlistList: PlaylistMetadata[], requestChannel: string) => {
      if (!playlistList.length || !requestChannel || !userEmail) return;
      const stillCurrent = () => selectedChannelRef.current === requestChannel;

      try {
        const tokenToUse = await getEffectiveToken();
        if (!tokenToUse) return;
        if (!stillCurrent()) return;

        const currentAnalytics = new AnalyticsService(tokenToUse, userEmail);
        
        const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
        const periodEnd = customEndDate ? customEndDate.format('YYYY-MM-DD') : endRefDate.toISOString().split('T')[0];
        const periodStart = showAllTimeViews 
          ? '2005-01-01' // Practically all-time for YouTube
          : (() => {
              if (customStartDate && customEndDate) {
                return customStartDate.format('YYYY-MM-DD');
              }
              const d = new Date(endRefDate);
              d.setDate(d.getDate() - ((period ?? 30) - 1));
              return d.toISOString().split('T')[0];
            })();

        devLog(`Fetching playlist analytics for ${requestChannel} from ${periodStart} to ${periodEnd}`);

        const periodViewsMap: Record<string, number> = {};
        const upsertFromReport = (report: { columnHeaders: Array<{ name: string }>; rows?: Array<Array<string | number>> }) => {
          if (!report.rows || report.rows.length === 0) return;

          const playlistIdIdx = report.columnHeaders.findIndex(h => h.name === 'playlist');
          const playlistViewsIdx = report.columnHeaders.findIndex(h => h.name === 'playlistViews');
          const viewsIdx = report.columnHeaders.findIndex(h => h.name === 'views');
          const startsIdx = report.columnHeaders.findIndex(h => h.name === 'playlistStarts');

          report.rows.forEach((row) => {
            const playlistId = String(row[playlistIdIdx !== -1 ? playlistIdIdx : 0]);
            const playlistViews = playlistViewsIdx !== -1 ? Number(row[playlistViewsIdx]) || 0 : 0;
            const views = viewsIdx !== -1 ? Number(row[viewsIdx]) || 0 : 0;
            const starts = startsIdx !== -1 ? Number(row[startsIdx]) || 0 : 0;
            const resolved = playlistViews > 0 ? playlistViews : (views > 0 ? views : starts);
            if (resolved > 0) {
              periodViewsMap[playlistId] = resolved;
            }
          });
        };

        // 1) Try top-playlists report scoped to the selected channel.
        const channelIds = `channel==${requestChannel}`;
        try {
          devLog(`[PlaylistAnalytics] Top-playlists query for ${channelIds}`, {
            startDate: periodStart,
            endDate: periodEnd,
            metrics: 'playlistViews',
            dimensions: 'playlist',
            sort: '-playlistViews',
            maxResults: 200,
          });

          const topPlaylistsReport = await currentAnalytics.getReport({
            ids: channelIds,
            startDate: periodStart,
            endDate: periodEnd,
            metrics: 'playlistViews',
            dimensions: 'playlist',
            sort: '-playlistViews',
            maxResults: 200,
          });

          upsertFromReport(topPlaylistsReport);
        } catch (err) {
          console.warn('[PlaylistAnalytics] Top-playlists query failed for selected channel, trying channel==MINE fallback.', err);
          const mineReport = await currentAnalytics.getReport({
            ids: 'channel==MINE',
            startDate: periodStart,
            endDate: periodEnd,
            metrics: 'playlistViews',
            dimensions: 'playlist',
            sort: '-playlistViews',
            maxResults: 200,
          });
          upsertFromReport(mineReport);
        }

        // 2) For missing playlists, aggregate time-series rows per playlist.
        const missingPlaylistIds = playlistList
          .map(p => p.id)
          .filter(id => periodViewsMap[id] === undefined);

        if (missingPlaylistIds.length > 0) {
          const chunkSize = 8;
          const chunks: string[][] = [];
          for (let i = 0; i < missingPlaylistIds.length; i += chunkSize) {
            chunks.push(missingPlaylistIds.slice(i, i + chunkSize));
          }

          await Promise.all(
            chunks.map(async (chunk) => {
              await Promise.all(
                chunk.map(async (playlistId) => {
                  try {
                    const report = await currentAnalytics.getReport({
                      ids: channelIds,
                      startDate: periodStart,
                      endDate: periodEnd,
                      metrics: 'playlistViews',
                      dimensions: 'day',
                      filters: `playlist==${playlistId}`,
                    });

                    const metricIdx = report.columnHeaders.findIndex(h => h.name === 'playlistViews');
                    if (metricIdx !== -1 && report.rows && report.rows.length > 0) {
                      const total = report.rows.reduce((sum, row) => sum + (Number(row[metricIdx]) || 0), 0);
                      if (total > 0) {
                        periodViewsMap[playlistId] = total;
                      }
                    }
                  } catch (err) {
                    console.warn(`[PlaylistAnalytics] Day-series fallback failed for playlist ${playlistId}`, err);
                  }
                })
              );
            })
          );
        }

        if (!stillCurrent()) return;
        setPlaylists((prev: PlaylistMetadata[]) =>
          prev.map((p: PlaylistMetadata) => ({
            ...p,
            [showAllTimeViews ? 'allTimeViewCount' : 'periodViewCount']: periodViewsMap[p.id] ?? 0,
          }))
        );
      } catch (err) {
        console.error('Failed to fetch playlist analytics:', err);
        // Set to 0 so we stop trying and the UI shows something
        setPlaylists((prev: PlaylistMetadata[]) =>
          prev.map((p: PlaylistMetadata) => ({
            ...p,
            [showAllTimeViews ? 'allTimeViewCount' : 'periodViewCount']: 0,
          }))
        );
      }
    },
    [userEmail, getEffectiveToken, period, latestDataDate, customStartDate, customEndDate, showAllTimeViews]
  );

  const fetchVideosWithTrends = useCallback(async () => {
    if (loadingChannels || !selectedChannel) return;
    const requestChannel = selectedChannel;
    const stillCurrent = () => selectedChannelRef.current === requestChannel;

    const tokenToUse = await getEffectiveToken();
    if (!tokenToUse || !userEmail) return null;
    if (!stillCurrent()) return null;

    const currentYouTube = new YouTubeService(userEmail, tokenToUse);

    setLoadingVideos(true);
    setVideosError(null);
    try {
      const channelId = requestChannel;

      if (channelId) {
        // Always load the full catalog -- the backend serves it from the
        // cron-ingested DB (near-zero quota) and the table paginates client-side.
        let channelVideos: VideoMetadata[] = [];
        try {
          channelVideos = await currentYouTube.fetchChannelVideos(channelId, undefined, undefined, visibility === 'all' ? 'all' : visibility);

        } catch (err) {
          if (!stillCurrent()) return;
          console.error('Failed to fetch channel videos:', err);
          setVideos([]);
          setVideosError('This channel has no public videos available or could not be accessed.');
          setLoadingVideos(false);
          return;
        }

        if (channelVideos.length === 0) {
          if (!stillCurrent()) return;
          setVideos([]);
          setVideosError('This channel has no public videos available.');
          setLoadingVideos(false);
          return;
        }

        const videosWithPlaylists =
          videoPlaylistMap.size > 0
            ? channelVideos.map(v => ({ ...v, sourcePlaylistIds: videoPlaylistMap.get(v.videoId) || [] }))
            : channelVideos;
        if (!stillCurrent()) return;
        setVideos(videosWithPlaylists);

        if (activeTab === 'videoAnalytics' || activeTab === 'audience') {
          // Prevent quota bursts: enrich only the top-N videos with per-video analytics.
          const enrichmentTarget =
            channelVideos.length > MAX_VIDEO_ANALYTICS_ENRICHMENT
              ? channelVideos.slice(0, MAX_VIDEO_ANALYTICS_ENRICHMENT)
              : channelVideos;
          // Fetch trend lines and retention independently, then merge into the same row model.
          void fetchVideoTrends(enrichmentTarget, requestChannel);
          void fetchVideoRetention(enrichmentTarget, requestChannel);
          void fetchVideoPeriodViews(channelVideos, requestChannel);
        }
      }
    } catch {
      if (!stillCurrent()) return;
      setVideos([]);
    } finally {
      if (stillCurrent()) {
        setLoadingVideos(false);
      }
    }
  }, [
    userEmail,
    selectedChannel,
    loadingChannels,
    activeTab,
    videoLimit,
    customLimit,
    fetchVideoTrends,
    fetchVideoRetention,
    fetchVideoPeriodViews,
    getEffectiveToken,
    videoPlaylistMap,
    visibility,
  ]);

  useEffect(() => {
    const autoLoad = async () => {
      if (channelsLength === 0) {
        setLoadingVideos(false);
        return;
      }
      // Channel analytics needs the video list for uploads count / per-day upload series
      if (
        activeTab !== 'videoAnalytics' &&
        activeTab !== 'channelAnalytics' &&
        activeTab !== 'audience' &&
        activeTab !== 'playlistAnalytics' &&
        activeListIds.size === 0
      )
        return;

      if (activeListIds.size > 0 && videos.length > 0) return;

      if (activeTab === 'playlistAnalytics') {
        const resolvedLimit =
          videoLimit === 'all'
            ? 'all'
            : videoLimit === 'custom'
              ? String(customLimit)
              : String(Number(videoLimit));
        const loadKey = `${selectedChannel || 'none'}|${resolvedLimit}`;

        if (!isLoadingPlaylists && lastPlaylistLoadKeyRef.current !== loadKey) {
          lastPlaylistLoadKeyRef.current = loadKey;
          await fetchChannelPlaylists();
        }
      } else {
        await fetchVideosWithTrends();
      }
    };

    void autoLoad();
  }, [
    activeTab,
    selectedChannel,
    videoLimit,
    customLimit,
    fetchVideosWithTrends,
    fetchChannelPlaylists,
    activeListIds,
    videos.length,
    channelsLength,
    playlists.length,
    isLoadingPlaylists,
  ]);

  // Secondary effect to enrich playlists with analytics once they are loaded
  useEffect(() => {
    if (activeTab === 'playlistAnalytics' && playlists.length > 0 && selectedChannel) {
      const endRefDate = latestDataDate ? new Date(latestDataDate) : new Date();
      const periodEnd = customEndDate ? customEndDate.format('YYYY-MM-DD') : endRefDate.toISOString().split('T')[0];
      const periodStart = showAllTimeViews
        ? '2005-01-01'
        : (() => {
            if (customStartDate && customEndDate) {
              return customStartDate.format('YYYY-MM-DD');
            }
            const d = new Date(endRefDate);
            d.setDate(d.getDate() - ((period ?? 30) - 1));
            return d.toISOString().split('T')[0];
          })();

      const playlistIdsKey = playlists.map(p => p.id).join(',');
      const modeKey = showAllTimeViews ? 'all-time' : 'date-range';
      const fetchKey = `${selectedChannel}|${modeKey}|${periodStart}|${periodEnd}|${playlistIdsKey}`;

      // Check if we need data for the current mode
      const needsEnrichment = playlists.some(p =>
        showAllTimeViews
          ? p.allTimeViewCount === undefined
          : p.periodViewCount === undefined
      );
      const rangeChanged = lastPlaylistAnalyticsFetchKeyRef.current !== fetchKey;

      if ((needsEnrichment || rangeChanged) && !isLoadingPlaylists) {
        lastPlaylistAnalyticsFetchKeyRef.current = fetchKey;
        void fetchPlaylistAnalytics(playlists, selectedChannel);
      }
    }
  }, [
    activeTab,
    playlists,
    selectedChannel,
    fetchPlaylistAnalytics,
    showAllTimeViews,
    isLoadingPlaylists,
    period,
    latestDataDate,
    customStartDate,
    customEndDate,
  ]);

  const filteredVideos = useMemo(() => {
    return getVideosByActiveFilters({
      videos: videos as FilterableVideo[],
      videoTypeFilter,
      videoSearchQuery,
      filterByPlaylists,
      selectedPlaylists,
      filterByVideos,
      selectedVideos,
    });
  }, [videos, videoTypeFilter, videoSearchQuery, filterByPlaylists, selectedPlaylists, filterByVideos, selectedVideos]);

  return {
    videos,
    setVideos,
    filteredVideos,
    playlists,
    setPlaylists,
    videoPlaylistMap,
    videoLimit,
    setVideoLimit,
    customLimit,
    setCustomLimit,
    loadingVideos,
    setLoadingVideos,
    videoTypeFilter,
    setVideoTypeFilter,
    videoSearchQuery,
    setVideoSearchQuery,
    filterByPlaylists,
    setFilterByPlaylists,
    selectedPlaylists,
    setSelectedPlaylists,
    filterByVideos,
    setFilterByVideos,
    selectedVideos,
    setSelectedVideos,
    isLoadingPlaylists,
    fetchVideosWithTrends,
    fetchChannelPlaylists,
    videosError,
  };
};
