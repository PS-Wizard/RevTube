// ─────────────────────────────────────────────────────────────────────────────
// useColumnWidths -- column resize state for fixed-layout tables
// ─────────────────────────────────────────────────────────────────────────────
import { useCallback, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent } from 'react';

/** Minimum width a column can be dragged down to (px). */
const MIN_COLUMN_WIDTH = 40;

export interface ColumnWidths {
  widths: number[];
  /** Total of all widths -- use as the table's minWidth so the wrapper can
   *  scroll horizontally once the columns exceed the container. */
  total: number;
  startResize: (index: number, e: ReactMouseEvent) => void;
}

/**
 * Column resize state for fixed-layout tables. Pair with <ColGroup /> and a
 * <ResizeHandle /> in every header cell (see ResizableColumns.tsx):
 *
 *   const { widths, total, startResize } = useColumnWidths([120, 200, 90]);
 *   <Table sx={{ tableLayout: 'fixed', minWidth: total, width: '100%' }}>
 *     <ColGroup widths={widths} />
 *     ...header cells get <ResizeHandle onResizeStart={(e) => startResize(i, e)} />
 */
export function useColumnWidths(initialWidths: number[]): ColumnWidths {
  const [widths, setWidths] = useState<number[]>(initialWidths);
  const dragRef = useRef<{ index: number; startX: number; startWidth: number } | null>(null);

  const startResize = useCallback(
    (index: number, e: ReactMouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = { index, startX: e.clientX, startWidth: widths[index] };
      document.body.style.userSelect = 'none';
      document.body.style.cursor = 'col-resize';

      const onMove = (ev: MouseEvent) => {
        const drag = dragRef.current;
        if (!drag) return;
        const next = Math.max(MIN_COLUMN_WIDTH, drag.startWidth + (ev.clientX - drag.startX));
        setWidths((prev) => {
          const copy = [...prev];
          copy[drag.index] = next;
          return copy;
        });
      };
      const onUp = () => {
        dragRef.current = null;
        document.body.style.userSelect = '';
        document.body.style.cursor = '';
        document.removeEventListener('mousemove', onMove);
        document.removeEventListener('mouseup', onUp);
      };
      document.addEventListener('mousemove', onMove);
      document.addEventListener('mouseup', onUp);
    },
    [widths],
  );

  const total = widths.reduce((a, b) => a + b, 0);
  return { widths, total, startResize };
}
