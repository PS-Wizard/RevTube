// ─────────────────────────────────────────────────────────────────────────────
// ResizableColumns -- <ColGroup /> + header <ResizeHandle /> for fixed-layout
// tables whose widths come from useColumnWidths (see useColumnWidths.ts)
//
// Tailwind for layout; only the drag-hit width stays as a constant.
// ─────────────────────────────────────────────────────────────────────────────
import type { MouseEvent as ReactMouseEvent, ReactElement } from 'react';

/** Hit area of the drag handle at the right edge of a header cell (px). */
const HANDLE_WIDTH = 8;

/** Fixed-layout colgroup driving the column widths. */
export function ColGroup({ widths }: { widths: number[] }): ReactElement {
  return (
    <colgroup>
      {widths.map((w, i) => (
        <col key={i} style={{ width: w, minWidth: w }} />
      ))}
    </colgroup>
  );
}

/** Drag handle anchored to the right edge of a (position:relative) header cell. */
export function ResizeHandle({ onResizeStart }: { onResizeStart: (e: ReactMouseEvent) => void }): ReactElement {
  return (
    <span
      aria-hidden
      onMouseDown={onResizeStart}
      onClick={(e) => e.stopPropagation()}
      className="absolute top-0 right-0 h-full cursor-col-resize touch-none select-none"
      style={{ width: HANDLE_WIDTH }}
    />
  );
}
