import React from 'react';
import { MdAutoAwesome, MdRefresh } from 'react-icons/md';
import {
  Alert,
  Badge,
  Box,
  Button,
  IconButton,
  Spinner,
  Stack,
  Tooltip,
  Typography,
} from '@/components/ui';
import type { Anomaly, AnomalyExplanation } from '../../../types/anomaly';

const panelSx = {
  border: '1px solid var(--rt-table-header-border)',
  borderRadius: 12,
  backgroundColor: 'var(--rt-color-bg-highlight)',
  padding: 16,
};

function confidenceColor(level: AnomalyExplanation['confidence']): string {
  if (level === 'high') return 'success';
  if (level === 'medium') return 'warning';
  return 'secondary';
}

/**
 * Compact AI root-cause panel: headline + short summary, top causes and top
 * actions only. Internal model/caching details stay out of the UI.
 */
export function AnomalyExplanationCard({
  anomaly,
  pending,
  onExplain,
}: {
  anomaly: Anomaly;
  pending: boolean;
  onExplain: (refresh: boolean) => void;
}): React.ReactElement {
  const explanation = anomaly.explanation;

  if (!explanation) {
    return (
      <Box sx={{ ...panelSx, borderStyle: 'dashed' }}>
        <Stack gap={1.5} alignItems="center">
          <Box sx={{ color: 'var(--rt-color-accent)' }}>
            <MdAutoAwesome size={22} aria-hidden />
          </Box>
          <Typography variant="subtitle2">Explain this anomaly with AI</Typography>
          <Typography variant="caption" sx={{ textAlign: 'center' }}>
            A short root-cause summary with recommended actions.
          </Typography>
          <Button
            size="sm"
            variant="primary"
            disabled={pending}
            onClick={() => onExplain(false)}
            startIcon={pending ? <Spinner size="xs" /> : <MdAutoAwesome size={14} />}
          >
            {pending ? 'Explaining…' : 'Explain with AI'}
          </Button>
        </Stack>
      </Box>
    );
  }

  const causes = explanation.rootCauses.slice(0, 3);
  const actions = explanation.recommendedActions.slice(0, 3);

  return (
    <Box sx={panelSx}>
      <Stack gap={1.5}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          <Box sx={{ flexShrink: 0, color: 'var(--rt-color-accent)' }}>
            <MdAutoAwesome size={16} aria-hidden />
          </Box>
          <Typography variant="subtitle2" sx={{ minWidth: 0, flexGrow: 1, flexBasis: 120 }}>
            AI Analysis
          </Typography>
          <Badge color={confidenceColor(explanation.confidence)}>
            {explanation.confidence}
          </Badge>
          <Tooltip title="Regenerate explanation">
            <IconButton
              size="xs"
              variant="ghost"
              disabled={pending}
              onClick={() => onExplain(true)}
              aria-label="Regenerate AI explanation"
            >
              {pending ? <Spinner size="xs" /> : <MdRefresh size={14} />}
            </IconButton>
          </Tooltip>
        </Box>

        {explanation.fallback && (
          <Alert severity="warning">
            Rules-based summary (AI was unavailable). Try regenerating later.
          </Alert>
        )}

        <Box sx={{ minWidth: 0 }}>
          <Typography variant="body2" sx={{ fontWeight: 700, lineHeight: 1.6, overflowWrap: 'break-word' }}>
            {explanation.headline}
          </Typography>
          <Typography variant="body2" className="line-clamp-3" sx={{ lineHeight: 1.7, overflowWrap: 'break-word', marginTop: 4 }}>
            {explanation.summary}
          </Typography>
        </Box>

        {causes.length > 0 && (
          <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {causes.map((rc, i) => (
              <Typography key={`${rc.signal}-${i}`} variant="caption" sx={{ lineHeight: 1.6, overflowWrap: 'break-word' }} title={rc.explanation || rc.signal}>
                • <strong>{rc.signal}</strong> ({Math.round(rc.weight * 100)}%){rc.explanation ? ` — ${rc.explanation}` : ''}
              </Typography>
            ))}
          </Box>
        )}

        {actions.length > 0 && (
          <Box sx={{ minWidth: 0, display: 'flex', flexDirection: 'column', gap: 4 }}>
            {actions.map((action, i) => (
              <Typography key={i} variant="caption" sx={{ lineHeight: 1.6, overflowWrap: 'break-word' }} title={action}>
                → {action}
              </Typography>
            ))}
          </Box>
        )}
      </Stack>
    </Box>
  );
}
