import React from 'react';
import { useNavigate } from 'react-router-dom';
import { MdAddChart } from 'react-icons/md';
import { Box, Button, Card, CardContent, Flex, Spinner, Typography } from '@/components/ui';
import { useAnomaliesQuery } from '@/hooks/queries/useAnomaliesQuery';

/** Compact anomaly summary card — links out to the full `/anomalies` tool. */
export function AnomaliesWidget({ channelId }: { channelId: string | null }): React.ReactElement {
  const navigate = useNavigate();
  const listQuery = useAnomaliesQuery(channelId ? { channelId } : {}, 1, 0);
  const counts = listQuery.data?.counts;
  const total = listQuery.data?.total ?? 0;

  return (
    <Card size="sm">
      <CardContent>
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0 }}>
          <MdAddChart size={18} aria-hidden />
          <Typography variant="body2" noWrap sx={{ fontWeight: 600 }}>
            Anomaly watch
          </Typography>
          <Box sx={{ marginLeft: 'auto' }}>
            <Button size="sm" variant="ghost" onClick={() => navigate('/anomalies')}>
              <span>Open tool</span>
            </Button>
          </Box>
        </Flex>
        {listQuery.isLoading ? (
          <Box sx={{ paddingTop: 2 }}>
            <Spinner size="sm" />
          </Box>
        ) : listQuery.error ? (
          <Flex gap={1} alignItems="center" sx={{ paddingTop: 1, minWidth: 0 }}>
            <Typography variant="caption" noWrap sx={{ minWidth: 0 }}>
              Couldn&apos;t load anomaly counts.
            </Typography>
            <Button size="sm" variant="outline" onClick={() => listQuery.refetch()}>
              <span>Retry</span>
            </Button>
          </Flex>
        ) : (
          <Typography variant="caption">
            {total} {total === 1 ? 'anomaly' : 'anomalies'} on record
            {counts ? ` · ${counts.critical} critical · ${counts.high} high · ${counts.open} open` : ''}
            . Detection runs automatically after each data sync.
          </Typography>
        )}
      </CardContent>
    </Card>
  );
}
