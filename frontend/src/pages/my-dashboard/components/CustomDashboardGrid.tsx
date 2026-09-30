import React from 'react';
import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  arrayMove,
  rectSortingStrategy,
  sortableKeyboardCoordinates,
} from '@dnd-kit/sortable';
import { Grid } from '@/components/ui';
import type { DashboardCell } from '@/types/customDashboard';
import { WidgetCard } from './WidgetCard';

interface CustomDashboardGridProps {
  cells: DashboardCell[];
  onReorder: (nextVisibleOrder: string[]) => void;
  renderWidget: (id: string) => React.ReactNode;
}

/**
 * Responsive 2D widget grid driven by the stored matrix: row-major cell
 * order decides DOM order, each cell's `w` decides its column span (full
 * rows vs side-by-side halves on lg+). Drag any card by its handle to
 * reposition; the new order re-packs into matrix cells on drop. Touch uses
 * a long-press so scrolling still works on phones.
 */
export function CustomDashboardGrid(props: CustomDashboardGridProps): React.ReactElement {
  const { cells, onReorder, renderWidget } = props;
  const visibleIds = React.useMemo(
    () => [...cells].sort((a, b) => a.y - b.y || a.x - b.x).map((c) => c.id),
    [cells],
  );
  const widthById = React.useMemo(() => new Map(cells.map((c) => [c.id, c.w])), [cells]);

  const pointerSensor = useSensor(PointerSensor, {
    activationConstraint: { distance: 6 },
  });
  const touchSensor = useSensor(TouchSensor, {
    activationConstraint: { delay: 250, tolerance: 8 },
  });
  const keyboardSensor = useSensor(KeyboardSensor, {
    coordinateGetter: sortableKeyboardCoordinates,
  });
  const sensors = useSensors(pointerSensor, touchSensor, keyboardSensor);

  const handleDragEnd = React.useCallback(
    (event: DragEndEvent) => {
      const { active, over } = event;
      if (!over || active.id === over.id) return;
      const oldIndex = visibleIds.indexOf(String(active.id));
      const newIndex = visibleIds.indexOf(String(over.id));
      if (oldIndex === -1 || newIndex === -1) return;
      onReorder(arrayMove(visibleIds, oldIndex, newIndex));
    },
    [visibleIds, onReorder],
  );

  return (
    <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
      <SortableContext items={visibleIds} strategy={rectSortingStrategy}>
        <Grid container spacing={1.5}>
          {visibleIds.map((id) => (
            <WidgetCard key={id} id={id} w={widthById.get(id) ?? 12}>
              {renderWidget(id)}
            </WidgetCard>
          ))}
        </Grid>
      </SortableContext>
    </DndContext>
  );
}
