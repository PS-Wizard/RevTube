import {
  Box,
  Button,
  Flex,
  Spinner,
  ToggleChip,
  Typography,
} from "@/components/ui";
import React from "react";
import { MdFilterList, MdRefresh } from "react-icons/md";
import type {
  AnomalyKind,
  AnomalyMetricMeta,
  AnomalySeverity,
  AnomalyStatus,
} from "../../../types/anomaly";
import { KIND_LABELS, SEVERITY_LABELS, STATUS_LABELS } from "../anomaliesUtils";

interface Props {
  metrics: AnomalyMetricMeta[];
  metricsLoading: boolean;
  selectedMetrics: string[];
  onToggleMetric: (key: string) => void;
  kinds: AnomalyKind[];
  onToggleKind: (k: AnomalyKind) => void;
  severities: AnomalySeverity[];
  onToggleSeverity: (s: AnomalySeverity) => void;
  statuses: AnomalyStatus[];
  onToggleStatus: (s: AnomalyStatus) => void;
  onScan: () => void;
  scanPending: boolean;
  hasChannel: boolean;
  total: number;
  hasActiveFilters?: boolean;
  onClearFilters?: () => void;
}

const ALL_KINDS: AnomalyKind[] = ["spike", "dip", "trend"];
const ALL_SEVERITIES: AnomalySeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
  "info",
];
const ALL_STATUSES: AnomalyStatus[] = ["open", "acknowledged", "dismissed"];

const panelSx = {
  border: "1px solid var(--rt-table-header-border)",
  borderRadius: 12,
  backgroundColor: "var(--rt-color-bg-highlight)",
  padding: 16,
};

const labelSx = { fontWeight: 600 };

export function AnomalyFiltersBar(props: Props): React.ReactElement {
  const {
    metrics,
    metricsLoading,
    selectedMetrics,
    onToggleMetric,
    kinds,
    onToggleKind,
    severities,
    onToggleSeverity,
    statuses,
    onToggleStatus,
    onScan,
    scanPending,
    hasChannel,
    total,
    onClearFilters,
  } = props;
  const statusesModified =
    statuses.length !== 2 ||
    !statuses.includes("open") ||
    !statuses.includes("acknowledged");
  const activeCount =
    selectedMetrics.length +
    kinds.length +
    severities.length +
    (statusesModified ? 1 : 0);

  return (
    <Box sx={panelSx}>
      <Flex gap={1.5} sx={{ flexWrap: "wrap" }}>
        <Flex gap={0.75} sx={{ minWidth: 0, flexGrow: 1 }}>
          <MdFilterList size={17} aria-hidden />
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            Filters
          </Typography>
          <Typography variant="caption" noWrap>
            {total} {total === 1 ? "anomaly" : "anomalies"} · newest first
          </Typography>
        </Flex>

        <Button
          size="sm"
          variant="outline"
          onClick={onScan}
          disabled={scanPending || !hasChannel}
          title={
            hasChannel ? "Re-scan this channel now" : "Select a channel first"
          }
        >
          {scanPending ? (
            <Spinner size="xs" />
          ) : (
            <MdRefresh size={15} aria-hidden />
          )}
          <span>{scanPending ? "Scanning…" : "Scan now"}</span>
        </Button>
      </Flex>

      <Flex
        gap={1}
        alignItems="center"
        sx={{ flexWrap: "wrap", marginTop: 12 }}
      >
        <Typography variant="caption" sx={labelSx}>
          Metric:
        </Typography>
        {metricsLoading ? (
          <Spinner size="xs" />
        ) : (
          metrics.map((m) => (
            <ToggleChip
              key={m.key}
              tone="primary"
              size="sm"
              pressed={selectedMetrics.includes(m.key)}
              label={m.label}
              onPressedChange={() => onToggleMetric(m.key)}
            />
          ))
        )}
      </Flex>

      <Flex gap={1} alignItems="center" sx={{ flexWrap: "wrap", marginTop: 8 }}>
        <Typography variant="caption" sx={labelSx}>
          Type:
        </Typography>
        {ALL_KINDS.map((k) => (
          <ToggleChip
            key={k}
            tone="primary"
            size="sm"
            pressed={kinds.includes(k)}
            label={KIND_LABELS[k]}
            onPressedChange={() => onToggleKind(k)}
          />
        ))}
        <Typography variant="caption" sx={{ ...labelSx, marginLeft: 8 }}>
          Severity:
        </Typography>
        {ALL_SEVERITIES.map((s) => (
          <ToggleChip
            key={s}
            tone="primary"
            size="sm"
            pressed={severities.includes(s)}
            label={SEVERITY_LABELS[s]}
            onPressedChange={() => onToggleSeverity(s)}
          />
        ))}
      </Flex>

      <Flex gap={1} alignItems="center" sx={{ flexWrap: "wrap", marginTop: 8 }}>
        <Typography variant="caption" sx={labelSx}>
          Status:
        </Typography>
        {ALL_STATUSES.map((s) => (
          <ToggleChip
            key={s}
            tone="primary"
            size="sm"
            pressed={statuses.includes(s)}
            label={STATUS_LABELS[s]}
            onPressedChange={() => onToggleStatus(s)}
          />
        ))}
        {activeCount > 0 && (
          <Typography variant="caption" sx={{ marginLeft: "auto" }}>
            {activeCount} active ·{" "}
            {onClearFilters ? (
              <button
                type="button"
                onClick={onClearFilters}
                className="cursor-pointer underline underline-offset-2 hover:opacity-80"
                aria-label="Clear all anomaly filters"
              >
                reset to default
              </button>
            ) : (
              "reset to default"
            )}
          </Typography>
        )}
      </Flex>
    </Box>
  );
}
