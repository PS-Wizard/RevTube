// ─────────────────────────────────────────────────────────────────────────────
// OptimizedToggle -- small chip button that adds/removes an audited item to
// the channel's default "Optimized" list for its audit kind.
// Composes the shared ToggleChip: no local chrome, SVGs, or utilities here.
// ─────────────────────────────────────────────────────────────────────────────
import { CheckCircle2, Circle } from 'lucide-react';
import { Tooltip, ToggleChip } from '../ui';

interface OptimizedToggleProps {
  optimized: boolean;
  onClick: (e: React.MouseEvent) => void;
  kindLabel: string;
  /** compact variant fits dense result tables */
  compact?: boolean;
  /** label shown when the item is optimized (default "Optimized") */
  labelOn?: string;
  /** label shown when the item is not optimized (default "Mark Optimized") */
  labelOff?: string;
}

export const OptimizedToggle: React.FC<OptimizedToggleProps> = ({
  optimized,
  onClick,
  kindLabel,
  compact = false,
  labelOn,
  labelOff,
}) => (
  <Tooltip title={optimized ? `Click to remove from Optimized list` : `Save this video to your Optimized list (${kindLabel})`}>
    <ToggleChip
      pressed={optimized}
      size={compact ? 'compact' : 'sm'}
      icon={optimized ? <CheckCircle2 size={compact ? 13 : 14} /> : <Circle size={compact ? 13 : 14} />}
      label={optimized ? (labelOn ?? 'Optimized') : (labelOff ?? 'Mark Optimized')}
      aria-label={optimized ? `Remove from Optimized (${kindLabel})` : `Mark as Optimized (${kindLabel})`}
      onPressedChange={(_pressed, e) => {
        e.stopPropagation();
        e.preventDefault();
        onClick(e);
      }}
    />
  </Tooltip>
);
