import React from 'react';

export interface SparkHoverPoint {
  x: number;
  y: number;
  date: string;
  value: string;
  cardId: string;
}

interface ChannelSparklineProps {
  /** Unique card id, echoed back on hover so one tooltip shows at a time. */
  cardId: string;
  /** Accessible name for the graphic. */
  title: string;
  /** Inner SVG content (trend path or bars). */
  children: React.ReactNode;
  /** Hover-capture targets across the graphic. */
  hoverTargets: Array<{ x: number; y: number; date: string; value: string }>;
  hovered: SparkHoverPoint | null;
  onHover: (point: SparkHoverPoint | null) => void;
}

/**
 * Mini trend graphic for a channel insight card: subtle framed SVG with
 * crosshair hover capture and a pinned tooltip. Tailwind only — replaces
 * the legacy `.channel-mini-chart` / `.sparkline-tooltip` classes.
 */
export function ChannelSparkline({
  cardId,
  title,
  children,
  hoverTargets,
  hovered,
  onHover,
}: ChannelSparklineProps): React.ReactElement {
  const active = hovered && hovered.cardId === cardId ? hovered : null;
  return (
    <div className="relative mt-4 grid gap-2 pt-2">
      <svg
        className="block h-32 w-full cursor-crosshair rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] sm:h-32"
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
        role="img"
        aria-label={title}
      >
        {children}
        {hoverTargets.map((t, i) => (
          <rect
            key={i}
            x={t.x - 1.5}
            y="0"
            width="3"
            height="100"
            fill="transparent"
            style={{ cursor: 'crosshair' }}
            onMouseEnter={() => onHover({ ...t, cardId })}
            onMouseLeave={() => onHover(null)}
          />
        ))}
      </svg>
      {active && (
        <div
          className="pointer-events-none absolute z-[100] -translate-x-1/2 -translate-y-full whitespace-nowrap rounded-[var(--rt-radius-md)] border-[var(--rt-card-border)] bg-[var(--rt-color-bg-elevated)] px-2.5 py-1.5 text-[11px] text-[var(--rt-color-text)] shadow-[var(--rt-shadow-md)]"
          style={{ left: `${active.x}%`, top: `${active.y}%`, marginTop: -8 }}
        >
          <span className="mr-1.5 text-[var(--rt-color-text-secondary)]">{active.date}</span>
          <span className="font-bold">{active.value}</span>
        </div>
      )}
    </div>
  );
}
