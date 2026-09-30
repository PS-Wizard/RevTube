import { scoreColor } from "./auditOrchestratorUtils";

export function CircularScoreRing({
  pct,
  size = 50,
  strokeWidth = 5,
  color,
}: {
  pct: number;
  size?: number;
  strokeWidth?: number;
  color?: string;
}) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const clampedPct = Math.max(0, Math.min(100, pct));
  const strokeDashoffset = circumference - (clampedPct / 100) * circumference;
  const strokeColor = color || scoreColor(clampedPct).text;

  return (
    <div
      style={{
        position: "relative",
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <svg width={size} height={size} style={{ transform: "rotate(-90deg)" }}>
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="var(--rt-color-bg-muted)"
          strokeWidth={strokeWidth}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke={strokeColor}
          strokeWidth={strokeWidth}
          strokeDasharray={circumference}
          strokeDashoffset={strokeDashoffset}
          strokeLinecap="round"
          style={{ transition: "stroke-dashoffset 0.4s ease" }}
        />
      </svg>
      <span
        style={{
          position: "absolute",
          fontSize: size < 46 ? "10px" : "11px",
          fontWeight: "var(--rt-weight-bold)",
          color: "var(--rt-color-text)",
        }}
      >
        {Math.round(clampedPct)}%
      </span>
    </div>
  );
}
