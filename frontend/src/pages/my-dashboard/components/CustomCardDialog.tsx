import React from 'react';
import {
  Flex,
  Modal,
  NativeSelect,
  SegmentedControl,
  Stack,
  TextField,
  Typography,
} from '@/components/ui';
import { CUSTOM_DASHBOARD_SURFACE, getStatCardDefinitions } from '@/config/statCardRegistry';
import { scopeKey, useCustomDashboardStore } from '@/stores/customDashboardStore';
import {
  selectCustomCardIds,
  useCustomCardsStore,
  type CustomCardPeriod,
} from '@/stores/customCardsStore';
import { cellsToOrder, defaultDbLayout, packOrderToCells } from '@/utils/dashboardLayoutMatrix';
import { useDashboardScope } from '../useCustomDashboard';
import { customCardMetricOptions, validateCustomCard } from '../customKpiUtils';

interface CustomCardDialogProps {
  open: boolean;
  onClose: () => void;
}

/**
 * Builder for user-defined KPI cards: name + channel metric + window.
 * Creates the definition, then appends the widget to the visible layout
 * of the active scope (Personal or current organization).
 */
export function CustomCardDialog({ open, onClose }: CustomCardDialogProps): React.ReactElement {
  const scope = useDashboardScope();
  const cardsByScope = useCustomCardsStore((s) => s.cardsByScope);
  const addCard = useCustomCardsStore((s) => s.addCard);

  const [label, setLabel] = React.useState('');
  const [metric, setMetric] = React.useState('views');
  const [period, setPeriod] = React.useState('30');
  const [error, setError] = React.useState<string | null>(null);

  const options = React.useMemo(() => customCardMetricOptions(), []);

  const resetAndClose = React.useCallback(() => {
    setLabel('');
    setMetric('views');
    setPeriod('30');
    setError(null);
    onClose();
  }, [onClose]);

  const handleCreate = React.useCallback(() => {
    const parsedPeriod = Number(period) as CustomCardPeriod;
    const validation = validateCustomCard({ label, metric, period: parsedPeriod });
    if (validation) {
      setError(validation);
      return;
    }
    const id = addCard(scope, { label: label.trim(), metric, period: parsedPeriod });
    if (!id) {
      setError('Could not create the card — the scope already has the maximum.');
      return;
    }
    // Append the new widget to the visible grid (setLayout normalizes
    // against the scope, which now includes the new custom id).
    const store = useCustomDashboardStore.getState();
    const registryIds = getStatCardDefinitions(CUSTOM_DASHBOARD_SURFACE).map((d) => d.id);
    const known = [...registryIds, ...selectCustomCardIds(cardsByScope, scope), id];
    const current = store.scopes[scopeKey(scope)]?.layout ?? defaultDbLayout(known);
    store.setLayout(scope, {
      cells: packOrderToCells([...cellsToOrder(current.cells), id]),
      hidden: current.hidden,
    });
    resetAndClose();
  }, [label, metric, period, addCard, scope, cardsByScope, resetAndClose]);

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Add custom card"
      description="Pick any channel metric — the card pins its value and period delta to your dashboard."
      maxWidth="sm"
      primaryAction={{ label: 'Add card', onClick: handleCreate }}
      secondaryAction={{ label: 'Cancel', onClick: resetAndClose }}
    >
      <Stack gap={1.5}>
        <TextField
          label="Card name"
          value={label}
          maxLength={60}
          fullWidth
          placeholder="e.g. Weekend views"
          error={!!error && label.trim().length === 0}
          helperText={label.trim().length === 0 ? 'Give the card a name.' : `${label.trim().length}/60`}
          onChange={(e) => setLabel(e.target.value)}
        />
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0, flexWrap: 'wrap' }}>
          <Typography variant="caption" component="span" sx={{ minWidth: 64 }}>
            Metric
          </Typography>
          <NativeSelect
            id="custom-card-metric"
            value={metric}
            onChange={(e) => setMetric(e.target.value)}
            aria-label="Card metric"
            style={{ flex: 1, minWidth: 0 }}
          >
            {options.map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </NativeSelect>
        </Flex>
        <Flex gap={1} alignItems="center" sx={{ minWidth: 0, flexWrap: 'wrap' }}>
          <Typography variant="caption" component="span" sx={{ minWidth: 64 }}>
            Window
          </Typography>
          <SegmentedControl
            value={period}
            ariaLabel="Comparison window"
            onChange={setPeriod}
            options={[
              { value: '7', label: '7d' },
              { value: '30', label: '30d' },
              { value: '90', label: '90d' },
            ]}
          />
        </Flex>
        {error ? (
          <Typography variant="caption" component="span" sx={{ color: 'var(--rt-color-danger)' }}>
            {error}
          </Typography>
        ) : null}
      </Stack>
    </Modal>
  );
}
