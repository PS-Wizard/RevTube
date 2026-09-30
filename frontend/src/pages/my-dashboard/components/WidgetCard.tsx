import React from 'react';
import { useSortable } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { MdDragIndicator } from 'react-icons/md';
import { PinOff } from 'lucide-react';
import { Flex, Grid, IconButton, Typography } from '@/components/ui';
import { usePinToDashboard } from '@/components/dashboard/pin-to-dashboard';
import { widgetLabel } from '../customDashboardUtils';

interface WidgetCardProps {
  id: string;
  /** Grid width in columns (from the stored matrix cell). */
  w: number;
  children: React.ReactNode;
}

/**
 * One dashboard widget: sortable grid item with an always-visible drag
 * handle + title header + unpin (hide) action. Show/hide and arrow-reorder
 * also live in the `WidgetPicker` popover (the management surface, like
 * `StatCardsCustomizer`).
 */
export function WidgetCard({ id, w, children }: WidgetCardProps): React.ReactElement {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const { togglePin } = usePinToDashboard(id);

  const title = widgetLabel(id);
  const lgSpan = w >= 12 ? 12 : w <= 6 ? 6 : w;

  return (
    <Grid
      item
      xs={12}
      lg={lgSpan}
      ref={setNodeRef}
      style={{
        transform: CSS.Transform.toString(transform),
        transition,
        opacity: isDragging ? 0.6 : undefined,
        zIndex: isDragging ? 1 : undefined,
      }}
    >
      <Flex gap={0.5} alignItems="center" sx={{ minWidth: 0, marginBottom: 1 }}>
        <IconButton
          size="xs"
          variant="ghost"
          aria-label={`Drag ${title} to reorder`}
          title={`Drag ${title} to reorder`}
          sx={{ cursor: 'grab', touchAction: 'none' }}
          {...attributes}
          {...listeners}
        >
          <MdDragIndicator size={16} />
        </IconButton>
        <Typography variant="subtitle2" component="span" noWrap sx={{ minWidth: 0, flex: 1 }}>
          {title}
        </Typography>
        <IconButton
          size="xs"
          variant="ghost"
          type="button"
          aria-label={`Remove ${title} from dashboard`}
          title={`Remove ${title} from dashboard`}
          onClick={(e) => {
            e.stopPropagation();
            togglePin();
          }}
        >
          <PinOff size={14} aria-hidden />
        </IconButton>
      </Flex>
      {children}
    </Grid>
  );
}
