import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Flex, Spinner, Typography } from '@/components/ui';
import { useVideosQuery } from '@/hooks/queries/useVideosQuery';

interface TopVideosWidgetProps {
  channelId: string | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
}

/**
 * Top videos by lifetime views. Reads the shared DB-backed videos catalog
 * query (same key as `/dashboard`, so a prior visit costs nothing extra)
 * and drains it so the ranking covers the whole catalog.
 */
export function TopVideosWidget({ channelId, getEffectiveToken }: TopVideosWidgetProps): React.ReactElement {
  const navigate = useNavigate();
  const catalog = useVideosQuery({
    channelId,
    getEffectiveToken,
    videoLimit: 'all',
    customLimit: 50,
    enabled: !!channelId,
  });
  const videos = React.useMemo(() => catalog.data ?? [], [catalog.data]);

  const { hasNextPage, fetchNextPage } = catalog;
  React.useEffect(() => {
    if (!hasNextPage || !fetchNextPage) return;
    let cancelled = false;
    let guard = 0;
    const drain = async () => {
      let next: boolean = hasNextPage;
      while (next && !cancelled && guard < 200) {
        guard += 1;
        const result = await fetchNextPage();
        next = result?.hasNextPage ?? false;
      }
    };
    void drain();
    return () => {
      cancelled = true;
    };
  }, [hasNextPage, fetchNextPage]);

  const top = React.useMemo(
    () =>
      [...videos]
        .sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0))
        .slice(0, 5),
    [videos],
  );
  const total = catalog.videosTotal ?? videos.length;

  return (
    <Card size="sm">
      <CardContent>
        {catalog.isLoading && videos.length === 0 ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Spinner size="sm" />
            <Typography variant="caption" noWrap>Loading top videos…</Typography>
          </Flex>
        ) : catalog.error && videos.length === 0 ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
              Couldn&apos;t load the video catalog.
            </Typography>
            <Button size="sm" variant="outline" onClick={() => catalog.refetch()}>
              <span>Retry</span>
            </Button>
          </Flex>
        ) : top.length === 0 ? (
          <Typography variant="caption">No videos on this channel yet.</Typography>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {top.map((video, index) => (
              <li key={video.videoId} className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-right text-[11px] font-semibold text-[var(--rt-color-text-tertiary)]">
                  {index + 1}
                </span>
                {video.thumbnailUrl ? (
                  <img
                    src={video.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-9 w-16 shrink-0 rounded-[var(--rt-radius-sm)] object-cover"
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--rt-color-text)]" title={video.title}>
                    {video.title}
                  </span>
                  <span className="block text-[11px] tabular-nums text-[var(--rt-color-text-secondary)]">
                    {(video.viewCount ?? 0).toLocaleString()} views
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0, marginTop: 1 }}>
          <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
            {`Top 5 of ${total.toLocaleString()} videos`}
          </Typography>
          <Button size="sm" variant="ghost" onClick={() => navigate('/videos')}>
            <span>Open Videos</span>
          </Button>
        </Flex>
      </CardContent>
    </Card>
  );
}
