import React from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Card, CardContent, Flex, Spinner, Typography } from '@/components/ui';
import { usePlaylistsQuery } from '@/hooks/queries/usePlaylistsQuery';

interface TopPlaylistsWidgetProps {
  channelId: string | null;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
}

/**
 * Biggest playlists by video count. Reads the shared DB-backed playlists
 * catalog query (same key as `/dashboard`) and drains it so the ranking
 * covers the whole catalog.
 */
export function TopPlaylistsWidget({ channelId, getEffectiveToken }: TopPlaylistsWidgetProps): React.ReactElement {
  const navigate = useNavigate();
  const catalog = usePlaylistsQuery({ channelId, getEffectiveToken, enabled: !!channelId });
  const playlists = React.useMemo(() => catalog.data ?? [], [catalog.data]);

  const { hasNextPage, fetchNextPage } = catalog;
  React.useEffect(() => {
    if (!hasNextPage || !fetchNextPage) return;
    let cancelled = false;
    let guard = 0;
    const drain = async () => {
      let next: boolean = hasNextPage;
      while (next && !cancelled && guard < 50) {
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
    () => [...playlists].sort((a, b) => b.itemCount - a.itemCount).slice(0, 5),
    [playlists],
  );
  const total = catalog.playlistsTotal ?? playlists.length;

  return (
    <Card size="sm">
      <CardContent>
        {catalog.isLoading && playlists.length === 0 ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Spinner size="sm" />
            <Typography variant="caption" noWrap>Loading top playlists…</Typography>
          </Flex>
        ) : catalog.error && playlists.length === 0 ? (
          <Flex gap={1} alignItems="center" sx={{ minWidth: 0, padding: '8px 0' }}>
            <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
              Couldn&apos;t load the playlist catalog.
            </Typography>
            <Button size="sm" variant="outline" onClick={() => catalog.refetch()}>
              <span>Retry</span>
            </Button>
          </Flex>
        ) : top.length === 0 ? (
          <Typography variant="caption">No playlists on this channel yet.</Typography>
        ) : (
          <ul className="flex min-w-0 flex-col gap-2">
            {top.map((playlist, index) => (
              <li key={playlist.id} className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 text-right text-[11px] font-semibold text-[var(--rt-color-text-tertiary)]">
                  {index + 1}
                </span>
                {playlist.thumbnailUrl ? (
                  <img
                    src={playlist.thumbnailUrl}
                    alt=""
                    loading="lazy"
                    className="h-9 w-16 shrink-0 rounded-[var(--rt-radius-sm)] object-cover"
                  />
                ) : null}
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-xs font-medium text-[var(--rt-color-text)]" title={playlist.title}>
                    {playlist.title}
                  </span>
                  <span className="block text-[11px] tabular-nums text-[var(--rt-color-text-secondary)]">
                    {`${playlist.itemCount.toLocaleString()} ${playlist.itemCount === 1 ? 'video' : 'videos'}`}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0, marginTop: 1 }}>
          <Typography variant="caption" noWrap sx={{ minWidth: 0, flex: 1 }}>
            {`Top 5 of ${total.toLocaleString()} playlists`}
          </Typography>
          <Button size="sm" variant="ghost" onClick={() => navigate('/playlist')}>
            <span>Open Playlists</span>
          </Button>
        </Flex>
      </CardContent>
    </Card>
  );
}
