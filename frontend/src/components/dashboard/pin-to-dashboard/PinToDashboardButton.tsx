import React from 'react';
import { Pin, PinOff } from 'lucide-react';
import { Link } from 'react-router-dom';
import { toast } from 'react-hot-toast';
import { IconButton } from '@/components/ui';
import { usePinToDashboard } from './usePinToDashboard';
import {
  CUSTOM_DASHBOARD_ROUTE,
  isPinnableWidgetId,
  pinnableWidgetLabel,
  pinTitle,
} from './pinToDashboardUtils';

interface PinToDashboardButtonProps {
  /** `dashboard:custom` widget id (e.g. `channel-kpis`). Unknown ids render nothing. */
  widgetId: string;
  /** Icon size in px. Defaults to 14 so it sits inline in dense panel headers. */
  iconSize?: number;
  className?: string;
}

/**
 * Pin affordance for source sections — one click adds the section's widget
 * to My Dashboard (active workspace scope), a second click removes it.
 * Always visible (never hover-only) with an `aria-pressed` pinned state.
 */
export function PinToDashboardButton({
  widgetId,
  iconSize = 14,
  className = '',
}: PinToDashboardButtonProps): React.ReactElement | null {
  const { isPinned, togglePin, scopeLabel } = usePinToDashboard(widgetId);

  if (!widgetId || !isPinnableWidgetId(widgetId)) return null;

  const label = pinnableWidgetLabel(widgetId);
  const title = pinTitle(widgetId, isPinned);

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    togglePin();
    if (!isPinned) {
      toast.success(`${label} pinned to your ${scopeLabel} dashboard`, {
        duration: 4000,
      });
    }
  };

  return (
    <span className={`inline-flex min-w-0 items-center ${className}`}>
      <IconButton
        size="xs"
        variant="ghost"
        type="button"
        aria-label={title}
        title={title}
        aria-pressed={isPinned}
        onClick={handleClick}
        className={isPinned ? 'text-[var(--rt-color-accent)]' : ''}
      >
        {isPinned ? <PinOff size={iconSize} aria-hidden /> : <Pin size={iconSize} aria-hidden />}
      </IconButton>
      {isPinned ? (
        <Link
          to={CUSTOM_DASHBOARD_ROUTE}
          title={`Open ${label} on your dashboard`}
          aria-label={`Open ${label} on your dashboard`}
          className="min-w-0 truncate text-[11px] font-medium text-[var(--rt-color-accent)] hover:underline"
          onClick={(e) => e.stopPropagation()}
        >
          View
        </Link>
      ) : null}
    </span>
  );
}
