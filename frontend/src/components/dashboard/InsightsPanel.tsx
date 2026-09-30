/**
 * Insights Panel -- Best Time to Post (24-hour curve) + Audience Retention trend.
 *
 * Ledger-style redesign using the EvilCharts (Apache ECharts) layer,
 * series toggles, normalize controls, and the rt-chart-tooltip design system.
 *
 * Sections:
 *  1. Best Time to Post -- avg watch time by publish hour across a 24-hour cycle
 *     (AreaChart with reference line at best hour)
 *  2. Audience Retention -- daily view retention trend with normalize toggle
 *     (AreaChart with confidence band)
 *  3. Watch Time by Publish Hour -- 24-hour bar distribution by publish hour
 *     (BarChart with color-coded performance buckets)
 */

import React, { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "../ui";
import { PinToDashboardButton } from "./pin-to-dashboard";
import { EChartsAreaChart } from "@/components/evilcharts/charts/echarts-area-chart";
import { EChartsBarChart } from "@/components/evilcharts/charts/echarts-bar-chart";
import type { ChartConfig } from "@/components/evilcharts/ui/echarts-chart";
import { cssVar, useEvilThemeKey } from "@/components/evilcharts/ui/echarts-chart";
import { useInsightsTabQuery } from "../../hooks/queries/useInsightsTabQuery";
import type {
  AudienceActiveTimeData,
  AudienceDayOfWeekStat,
  BestTimeToPostData,
  BestTimeToPostV2Data,
  ConfidenceTier,
  DayOfWeekStatV2,
  DaypartStat,
  DayStat,
  EstimatedAudienceActiveTimeData,
  EstimatedHourlyActivity,
  InsightsData,
  HourRetentionStat,
  HourStatV2,
  RetentionByHourData,
  RetentionByPublishHourData,
} from "../../types/dashboard";
import { Skeleton } from "../Skeleton";
import { EmptyState } from "../EmptyState";
import "./InsightsPanel.css";

// ── Color identity for the Insights panel ──────────────────────────────
// Resolved live from design tokens (theme-aware) — never hardcoded hex.
// ECharts paints on canvas and cannot read CSS vars, so `cssVar()` resolves
// them at render; `useEvilThemeKey` re-renders on light/dark flips.
interface InsightPalette {
  primary: string;
  positive: string;
  reference: string;
  secondary: string;
  accent: string;
  info: string;
  tierHigh: string;
  tierMedium: string;
  tierLow: string;
  disabled: string;
}

function useInsightPalette(): InsightPalette {
  const themeKey = useEvilThemeKey();
  return useMemo(() => {
    // Re-resolve tokens whenever the light/dark theme flips.
    void themeKey;
    return {
      primary: cssVar("--rt-color-warning") || "#d97706",
      positive: cssVar("--rt-color-success") || "#059669",
      reference: cssVar("--rt-chart-uploads") || "#ca8a04",
      secondary: cssVar("--rt-color-success") || "#059669",
      accent: cssVar("--rt-color-accent") || "#3b82f6",
      info: cssVar("--rt-color-info") || "#a855f7",
      tierHigh: cssVar("--rt-color-success") || "#059669",
      tierMedium: cssVar("--rt-chart-avg-concurrent") || "#eab308",
      tierLow: cssVar("--rt-color-danger") || "#dc2626",
      disabled: cssVar("--rt-color-text-disabled") || "#9ca3af",
    };
  }, [themeKey]);
}

// ── EvilCharts helpers ─────────────────────────────────────────────────
// ECharts data rows need an index signature; dashboard types are interfaces
// (no implicit index signature), so widen once here instead of casting ×7.
const asChartRows = (rows: object[]): Array<Record<string, unknown>> =>
  rows as unknown as Array<Record<string, unknown>>;

const escapeTip = (s: string): string =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

// Shared HTML tooltip shell (mirrors ChannelAnalyticsInsights) -- theme-aware
// via --rt-* tokens so it follows light/dark mode.
function tooltipHtml(
  title: string,
  lines: Array<{ color: string; name: string; value: string; sub?: string }>,
): string {
  const body = lines
    .map(
      (l) =>
        `<div style="display:flex;align-items:center;gap:8px;padding:1px 0;">` +
        `<span style="width:8px;height:8px;border-radius:2px;background:${l.color};flex-shrink:0;"></span>` +
        `<span style="color:var(--rt-color-text-secondary);">${escapeTip(l.name)}</span>` +
        `<span style="margin-left:auto;padding-left:16px;font-weight:600;font-variant-numeric:tabular-nums;">${escapeTip(l.value)}</span>` +
        `</div>` +
        (l.sub
          ? `<div style="padding-left:16px;opacity:0.75;font-size:11px;">${l.sub}</div>`
          : ""),
    )
    .join("");
  return (
    `<div style="min-width:150px;max-width:320px;border-radius:8px;border:1px solid var(--rt-color-border);` +
    `background:var(--rt-card-bg, var(--rt-color-bg-elevated));box-shadow:0 4px 12px rgba(0,0,0,0.12);padding:8px 12px;` +
    `font-family:var(--rt-font-sans);font-size:12px;line-height:1.45;color:var(--rt-color-text);">` +
    `<div style="margin-bottom:6px;font-weight:600;">${escapeTip(title)}</div>${body}</div>`
  );
}

// ── All IANA timezones (loaded via Intl API) ────────────────────────────

let _allTimezones: string[] | null = null;

/** Get all IANA timezones via the Intl API, with a fallback for older browsers.
 *  Calls Intl.supportedValuesOf('timeZone') which returns ~400+ entries. */
function getAllTimezones(): string[] {
  if (_allTimezones) return _allTimezones;
  try {
    _allTimezones = (Intl as { supportedValuesOf?: (key: string) => string[] })
      .supportedValuesOf!("timeZone") as string[];
    // Ensure UTC is always listed (some envs don't include it)
    if (!_allTimezones.includes("UTC")) _allTimezones.unshift("UTC");
  } catch {
    // Fallback for very old browsers -- a curated subset
    _allTimezones = [
      "UTC",
      "America/New_York",
      "America/Chicago",
      "America/Denver",
      "America/Los_Angeles",
      "America/Anchorage",
      "America/Phoenix",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "America/Mexico_City",
      "America/Toronto",
      "America/Vancouver",
      "America/Halifax",
      "America/St_Johns",
      "Europe/London",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Madrid",
      "Europe/Rome",
      "Europe/Amsterdam",
      "Europe/Stockholm",
      "Europe/Moscow",
      "Europe/Istanbul",
      "Europe/Athens",
      "Europe/Helsinki",
      "Europe/Dublin",
      "Asia/Dubai",
      "Asia/Kolkata",
      "Asia/Shanghai",
      "Asia/Tokyo",
      "Asia/Seoul",
      "Asia/Singapore",
      "Asia/Hong_Kong",
      "Asia/Bangkok",
      "Asia/Jakarta",
      "Asia/Manila",
      "Asia/Karachi",
      "Asia/Dhaka",
      "Asia/Riyadh",
      "Asia/Tehran",
      "Asia/Baghdad",
      "Asia/Jerusalem",
      "Australia/Sydney",
      "Australia/Melbourne",
      "Australia/Perth",
      "Australia/Brisbane",
      "Pacific/Auckland",
      "Pacific/Fiji",
      "Pacific/Honolulu",
      "Pacific/Guam",
      "Africa/Cairo",
      "Africa/Johannesburg",
      "Africa/Lagos",
      "Africa/Nairobi",
      "Africa/Casablanca",
      "America/Santiago",
      "America/Bogota",
      "America/Lima",
    ];
  }
  return _allTimezones;
}

/** Read timezone from localStorage or default to browser timezone */
function getStoredTimezone(): string {
  try {
    return (
      localStorage.getItem("revtube:insights:timezone") ||
      Intl.DateTimeFormat().resolvedOptions().timeZone ||
      "UTC"
    );
  } catch {
    return "UTC";
  }
}

/** Persist timezone choice */
function storeTimezone(tz: string) {
  try {
    localStorage.setItem("revtube:insights:timezone", tz);
  } catch {
    /* noop */
  }
}

/** Read segment from localStorage */
function getStoredSegment(): "all" | "shorts" | "long" {
  try {
    const v = localStorage.getItem("revtube:insights:segment");
    if (v === "shorts" || v === "long") return v;
    return "all";
  } catch {
    return "all";
  }
}

function storeSegment(seg: "all" | "shorts" | "long") {
  try {
    localStorage.setItem("revtube:insights:segment", seg);
  } catch {
    /* noop */
  }
}

/** Strip ':' suffix so we handle things like "-" or other chars safely */
function timezoneShortLabel(tz: string): string {
  if (tz === "UTC") return "UTC";
  const parts = tz.split("/");
  return parts[parts.length - 1]?.replace(/_/g, " ") || tz;
}
/**
 * Get a short timezone abbreviation like "EST", "WAT", "CAT" via Intl.
 * Falls back to the city name from the IANA path (e.g. "Lagos").
 */
function getTimezoneAbbr(tz: string): string {
  if (tz === "UTC") return "UTC";
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone: tz,
      timeZoneName: "short",
    });
    const abbr = formatter
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value;
    if (abbr && abbr !== tz) return abbr;
  } catch { /* fall through */ }
  return timezoneShortLabel(tz);
}

/** Get the browser's local IANA timezone */
function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    return "UTC";
  }
}

// timezoneDisplayName -- same as shortLabel; we keep city names from the IANA path

// ── Local types ────────────────────────────────────────────────────────

interface RetentionChartDatum {
  date: string;
  retention: number;
  _isNull: boolean;
}

interface RetentionChartDatumWithBand extends RetentionChartDatum {
  bandTop: number;
  bandBottom: number;
}
// ── Best Time to Post (24-hour curve) ─────────────────────────────────

function BestTimeSection({ data }: { data: RetentionByPublishHourData }) {
  const palette = useInsightPalette();
  const retentionByHour = useMemo(
    () => [...(data.retentionByHour ?? [])].sort((a, b) => a.hour - b.hour),
    [data.retentionByHour],
  );

  const { bestHourLabel, bestHourRetention } = data;

  const totalVideos = useMemo(
    () => retentionByHour.reduce((s, h) => s + h.videoCount, 0),
    [retentionByHour],
  );

  const hoursWithData = useMemo(
    () => retentionByHour.filter((h) => h.videoCount > 0).length,
    [retentionByHour],
  );

  const timeLabels = ["12AM", "3AM", "6AM", "9AM", "12PM", "3PM", "6PM", "9PM"];

  const bestTimeConfig: ChartConfig = useMemo(
    () => ({
      avgRetention: { label: "Avg watch time", color: palette.primary },
    }),
    [palette],
  );

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">Best Time to Post</h3>
          <p className="insights-section__desc">
            Average watch time by publish hour -- 24-hour curve
          </p>
        </div>
      </div>

      {/* Summary stats */}
      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">Best hour</span>
          <span className="insight-stat__value insight-stat__value--highlight">
            {bestHourLabel}
            <span className="insight-stat__unit">
              {" "}
              ({bestHourRetention.toFixed(1)} min)
            </span>
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Peak watch time</span>
          <span className="insight-stat__value">
            {bestHourRetention.toFixed(1)}
            <span className="insight-stat__unit"> min</span>
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Hours with data</span>
          <span className="insight-stat__value">{hoursWithData}</span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Videos analyzed</span>
          <span className="insight-stat__value">{totalVideos}</span>
        </div>
      </div>

      <div className="insight-chart-wrap insight-chart-wrap--area">
        <EChartsAreaChart
          data={asChartRows(retentionByHour)}
          config={bestTimeConfig}
          xDataKey="label"
          height={320}
          curveType="smooth"
          showToolbar
          tooltipFormatter={(rows, axisValue) => {
            const r =
              rows.find((x) => x.seriesKey === "avgRetention") ?? rows[0];
            const v =
              typeof r?.value === "number" ? r.value : Number(r?.value ?? 0);
            const p = (r?.row ?? {}) as unknown as HourRetentionStat;
            return tooltipHtml(String(axisValue ?? ""), [
              {
                color: palette.primary,
                name: "Avg watch time",
                value: `${v.toFixed(2)} min`,
                sub:
                  p.videoCount != null
                    ? `${p.videoCount} videos published`
                    : undefined,
              },
            ]);
          }}
        >
          <EChartsAreaChart.Grid />
          <EChartsAreaChart.XAxis
            dataKey="label"
            tickFormatter={(v) => (timeLabels.includes(v) ? v : "")}
          />
          <EChartsAreaChart.YAxis tickFormatter={(v) => `${v.toFixed(1)}m`} />
          <EChartsAreaChart.Brush />
          <EChartsAreaChart.Legend isClickable />
          <EChartsAreaChart.Tooltip />
          <EChartsAreaChart.Area
            dataKey="avgRetention"
            markLine={
              bestHourLabel
                ? [
                    {
                      x: bestHourLabel,
                      label: `✦ Best: ${bestHourLabel}`,
                      color: palette.positive,
                    },
                  ]
                : undefined
            }
          />
        </EChartsAreaChart>
      </div>
    </section>
  );
}

// ── Audience Retention ────────────────────────────────────────────────

export function RetentionSection({
  data,
  defaultNormalized,
  onNormalizedChange,
}: {
  data: RetentionByHourData;
  defaultNormalized: boolean;
  onNormalizedChange: (v: boolean) => void;
}) {
  const palette = useInsightPalette();
  const dailyRetention = useMemo(
    () => data.dailyRetention ?? [],
    [data.dailyRetention],
  );

  const chartData: RetentionChartDatum[] = useMemo(
    () =>
      dailyRetention.map((p) => ({
        date: p.date,
        retention: p.retention ?? 0,
        _isNull: p.retention === null,
      })),
    [dailyRetention],
  );

  const effectiveAverageRetention = data.averageRetention ?? 0;

  // Build a confidence band ±15% around the trend line for visual depth
  const chartDataWithBand: RetentionChartDatumWithBand[] = useMemo(
    () =>
      chartData.map((d) => ({
        ...d,
        bandTop: d.retention + Math.max(d.retention * 0.12, 2),
        bandBottom: Math.max(d.retention - Math.max(d.retention * 0.12, 2), 0),
      })),
    [chartData],
  );

  const xAxisTickFormatter = (d: string) => {
    const parts = d.split("-");
    return parts.length === 3 ? `${parts[1]}/${parts[2]}` : d;
  };

  // Normalize data to 0-100 scale
  const displayData = useMemo(() => {
    if (!defaultNormalized) return chartDataWithBand;
    const maxRet = Math.max(...chartDataWithBand.map((d) => d.retention), 1);
    return chartDataWithBand.map((d) => ({
      ...d,
      retention: (d.retention / maxRet) * 100,
      bandTop: (d.bandTop / maxRet) * 100,
      bandBottom: (d.bandBottom / maxRet) * 100,
    }));
  }, [chartDataWithBand, defaultNormalized]);

  const normalizedAvgRetention = defaultNormalized
    ? (effectiveAverageRetention /
        Math.max(...chartData.map((d) => d.retention), 1)) *
      100
    : effectiveAverageRetention;

  const retentionConfig: ChartConfig = useMemo(
    () => ({
      retention: { label: "Retention", color: palette.secondary },
      bandTop: { label: "Confidence band", color: palette.secondary },
    }),
    [palette],
  );

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">Audience Retention</h3>
          <p className="insights-section__desc">
            {defaultNormalized
              ? "Daily retention trend (normalized)"
              : "Average view percentage over time"}
          </p>
        </div>
        <div className="insights-section__controls">
          <div className="insight-control-group">
            <span className="insight-control-label">Normalize</span>
            <label className="insight-toggle">
              <input
                type="checkbox"
                checked={defaultNormalized}
                onChange={() => onNormalizedChange(!defaultNormalized)}
              />
              <span className="insight-toggle__track" />
            </label>
          </div>
        </div>
      </div>

      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">Average Retention</span>
          <span className="insight-stat__value">
            {defaultNormalized
              ? `${normalizedAvgRetention.toFixed(1)}%`
              : `${effectiveAverageRetention.toFixed(1)}%`}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Days with data</span>
          <span className="insight-stat__value">{dailyRetention.length}</span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Peak retention</span>
          <span className="insight-stat__value">
            {defaultNormalized
              ? "100%"
              : `${Math.max(...chartData.map((d) => d.retention), 0).toFixed(1)}%`}
          </span>
        </div>
      </div>

      <div className="insight-chart-wrap insight-chart-wrap--area">
        <EChartsAreaChart
          data={asChartRows(displayData)}
          config={retentionConfig}
          xDataKey="date"
          height={320}
          curveType="smooth"
          showToolbar
          tooltipFormatter={(rows, axisValue) => {
            const r =
              rows.find((x) => x.seriesKey === "retention") ?? rows[0];
            const v =
              typeof r?.value === "number" ? r.value : Number(r?.value ?? 0);
            const rawDate = String(
              ((r?.row ?? {}) as { date?: unknown }).date ?? axisValue ?? "",
            );
            const parts = rawDate.split("-");
            const title =
              parts.length === 3 ? `${parts[1]}/${parts[2]}` : rawDate;
            return tooltipHtml(title, [
              {
                color: palette.secondary,
                name: "Retention",
                value: `${v.toFixed(2)}%`,
              },
            ]);
          }}
        >
          <EChartsAreaChart.Grid />
          <EChartsAreaChart.XAxis dataKey="date" tickFormatter={xAxisTickFormatter} />
          <EChartsAreaChart.YAxis
            tickFormatter={(v) =>
              defaultNormalized ? `${Math.round(v)}%` : `${v.toFixed(1)}%`
            }
            domain={
              defaultNormalized
                ? ([0, 105] as [number, number])
                : ([0, "dataMax"] as [number, string])
            }
          />
          <EChartsAreaChart.Brush />
          <EChartsAreaChart.Legend isClickable />
          <EChartsAreaChart.Tooltip />
          {/* Confidence band */}
          <EChartsAreaChart.Area
            dataKey="bandTop"
            opacity={0.12}
            showSymbol={false}
          />
          {/* Main retention line + average reference */}
          <EChartsAreaChart.Area
            dataKey="retention"
            markLine={[
              {
                y: normalizedAvgRetention,
                label: `Avg ${normalizedAvgRetention.toFixed(1)}%`,
                color: palette.reference,
              },
            ]}
          />
        </EChartsAreaChart>
      </div>
    </section>
  );
}

// ── Weekly Performance (day of week) ──────────────────────────────────

function WeeklyMetricsSection({ data }: { data: BestTimeToPostData }) {
  const palette = useInsightPalette();
  const dailyStats = useMemo(() => data.dailyStats ?? [], [data.dailyStats]);

  const { bestDayLabel, bestRetentionDayLabel, bestSubscriberDayLabel } = data;

  const weeklyConfig: ChartConfig = useMemo(
    () => ({
      views: { label: "Views", color: palette.primary },
    }),
    [palette],
  );

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">Weekly Performance</h3>
          <p className="insights-section__desc">
            Performance by day of week -- views, retention, subscribers
          </p>
        </div>
      </div>

      {/* Best day stat pills */}
      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">Best day for views</span>
          <span className="insight-stat__value insight-stat__value--highlight">
            {bestDayLabel}
          </span>
        </div>
        {bestRetentionDayLabel && (
          <div className="insight-stat">
            <span className="insight-stat__label">Best day for retention</span>
            <span className="insight-stat__value insight-stat__value--highlight">
              {bestRetentionDayLabel}
            </span>
          </div>
        )}
        {bestSubscriberDayLabel && (
          <div className="insight-stat">
            <span className="insight-stat__label">
              Best day for subscribers
            </span>
            <span className="insight-stat__value insight-stat__value--highlight">
              {bestSubscriberDayLabel}
            </span>
          </div>
        )}
        <div className="insight-stat">
          <span className="insight-stat__label">Period views</span>
          <span className="insight-stat__value">
            {dailyStats.reduce((s, d) => s + d.views, 0).toLocaleString()}
          </span>
        </div>
      </div>

      <div className="insight-chart-wrap insight-chart-wrap--bar">
        <EChartsBarChart
          data={asChartRows(dailyStats)}
          config={weeklyConfig}
          xDataKey="label"
          height={280}
          tooltipFormatter={(rows, axisValue) => {
            const r = rows.find((x) => x.seriesKey === "views") ?? rows[0];
            const v =
              typeof r?.value === "number" ? r.value : Number(r?.value ?? 0);
            const p = (r?.row ?? {}) as unknown as DayStat;
            const sub =
              p?.averageViewPercentage != null && p.averageViewPercentage > 0
                ? `${p.averageViewPercentage.toFixed(1)}% retention · ${p.subscribersGained ?? 0} subs`
                : undefined;
            return tooltipHtml(String(axisValue ?? ""), [
              {
                color: palette.primary,
                name: "Views",
                value: v.toLocaleString(),
                sub,
              },
            ]);
          }}
        >
          <EChartsBarChart.Grid />
          <EChartsBarChart.XAxis dataKey="label" />
          <EChartsBarChart.YAxis
            tickFormatter={(v) =>
              v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(v)
            }
            domain={[0, "dataMax"] as [number, string]}
          />
          <EChartsBarChart.Tooltip />
          <EChartsBarChart.Bar
            dataKey="views"
            itemColors={(_value, _index, row) =>
              (row as unknown as DayStat).day === data.bestDay
                ? palette.positive
                : palette.primary
            }
          />
        </EChartsBarChart>
      </div>
    </section>
  );
}

// ── V2: Tier Badge ────────────────────────────────────────────────────

function TierBadge({ tier }: { tier: ConfidenceTier }) {
  const palette = useInsightPalette();
  const tierColor =
    tier === "High"
      ? palette.tierHigh
      : tier === "Medium"
        ? palette.tierMedium
        : palette.tierLow;

  return (
    <span
      className="insight-tier-badge"
      style={
        {
          "--tier-color": tierColor,
          backgroundColor: `color-mix(in srgb, ${tierColor} 12%, transparent)`,
          color: tierColor,
        } as React.CSSProperties
      }
    >
      <span
        className="insight-tier-badge__dot"
        style={{ backgroundColor: tierColor }}
      />
      {tier}
    </span>
  );
}

// ── V2: Weekly Performance (DB-powered) ───────────────────────────────

function HourlyAnalysisV2({
  data,
  timezone,
}: {
  data: BestTimeToPostV2Data;
  timezone?: string;
}) {
  const palette = useInsightPalette();
  const [viewMode, setViewMode] = useState<"hour" | "daypart">("hour");
  const hourly = useMemo(() => data.hourly ?? [], [data.hourly]);
  const daypart = useMemo(() => data.daypart ?? [], [data.daypart]);

  const tierColor = (tier: ConfidenceTier) =>
    tier === "High"
      ? palette.tierHigh
      : tier === "Medium"
        ? palette.tierMedium
        : palette.tierLow;

  const chartConfig: ChartConfig = useMemo(
    () => ({
      shrunkScore: { label: "Composite score", color: palette.primary },
    }),
    [palette],
  );

  const bestLabel = viewMode === "hour" ? data.bestHourLabel : data.bestDaypartLabel;
  const bestScore = viewMode === "hour" ? data.bestHourScore : data.bestDaypartScore;
  const chartData = viewMode === "hour" ? hourly : daypart;

  // Per-metric best in current view mode
  // IMPORTANT: skip empty buckets (videoCount === 0) -- they have median Z of 0
  // which would falsely "win" over buckets with negative z-scores.
  const bestForViews = useMemo(() => {
    if (!chartData.length) return null;
    return chartData.reduce<((typeof chartData)[0]) | null>(
      (best, d) => {
        if (d.videoCount <= 0) return best;
        if (!best || d.medianViewsZ > best.medianViewsZ) return d;
        return best;
      },
      null,
    );
  }, [chartData]);

  const bestForEngagement = useMemo(() => {
    if (!chartData.length) return null;
    return chartData.reduce<((typeof chartData)[0]) | null>(
      (best, d) => {
        if (d.videoCount <= 0) return best;
        if (!best || d.medianEngagementZ > best.medianEngagementZ) return d;
        return best;
      },
      null,
    );
  }, [chartData]);

  const bestForComments = useMemo(() => {
    if (!chartData.length) return null;
    return chartData.reduce<((typeof chartData)[0]) | null>(
      (best, d) => {
        if (d.videoCount <= 0) return best;
        if (!best || d.medianCommentsZ > best.medianCommentsZ) return d;
        return best;
      },
      null,
    );
  }, [chartData]);

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">Best Time to Post</h3>
          <p className="insights-section__desc">
            {viewMode === "hour"
              ? "Publish-hour performance"
              : "Daypart performance"}
            {" -- "}{data.totalVideosAnalyzed} videos
            {timezone && timezone !== "UTC"
              ? ` in ${timezoneShortLabel(timezone)}`
              : ""}
          </p>
        </div>
        <div className="insights-section__controls">
          <div className="insight-control-group">
            <span className="insight-control-label">View</span>
            <span className="insight-view-label">Hourly</span>
            <label className="insight-toggle">
              <input
                type="checkbox"
                checked={viewMode === "daypart"}
                onChange={() => setViewMode(viewMode === "hour" ? "daypart" : "hour")}
                aria-label="Toggle between hourly and daypart view"
              />
              <span className="insight-toggle__track" />
            </label>
            <span className="insight-view-label">Daypart</span>
          </div>
        </div>
      </div>

      {/* Summary stats */}
      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">
            Best {viewMode === "hour" ? "hour" : "time"}
          </span>
          <span className="insight-stat__value insight-stat__value--highlight">
            {bestLabel}
            <span className="insight-stat__unit">
              {" "}
              {timezone ? ` ${getTimezoneAbbr(timezone)} · ` : ""}
              ({bestScore?.toFixed(2) ?? "--"})
            </span>
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for views</span>
          <span className="insight-stat__value">
            {bestForViews?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for engagement</span>
          <span className="insight-stat__value">
            {bestForEngagement?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for comments</span>
          <span className="insight-stat__value">
            {bestForComments?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Videos analyzed</span>
          <span className="insight-stat__value">
            {data.totalVideosAnalyzed}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Long / Shorts</span>
          <span className="insight-stat__value">
            {data.longCount}
            <span className="insight-stat__unit"> / </span>
            {data.shortsCount}
          </span>
        </div>
        {data.kruskalWallis && (
          <div className="insight-stat">
            <span className="insight-stat__label">Significance (p)</span>
            <span className="insight-stat__value">
              {data.kruskalWallis.p?.toFixed(4) ?? "--"}
            </span>
          </div>
        )}
      </div>

      {/* Bar chart -- 24-hour or 6-part daypart */}
      <div className="insight-chart-wrap insight-chart-wrap--bar">
        <EChartsBarChart
          data={asChartRows(chartData)}
          config={chartConfig}
          xDataKey="label"
          height={280}
          tooltipFormatter={(rows, axisValue) => {
            const r =
              rows.find((x) => x.seriesKey === "shrunkScore") ?? rows[0];
            const v =
              typeof r?.value === "number" ? r.value : Number(r?.value ?? 0);
            const p = (r?.row ?? {}) as unknown as (
              | HourStatV2
              | DaypartStat
            ) & { confidenceTier: string };
            const sub =
              p.videoCount > 0
                ? `${p.videoCount} videos · ${p.confidenceTier} confidence` +
                  (p.ciLower != null && p.ciUpper != null
                    ? ` · CI [${p.ciLower.toFixed(2)}, ${p.ciUpper.toFixed(2)}]`
                    : "")
                : undefined;
            return tooltipHtml(String(axisValue ?? ""), [
              {
                color: palette.primary,
                name: "Composite score",
                value: v.toFixed(2),
                sub,
              },
            ]);
          }}
        >
          <EChartsBarChart.Grid />
          <EChartsBarChart.XAxis
            dataKey="label"
            tickFormatter={(v, i) =>
              viewMode === "hour" ? (i % 3 === 0 ? v : "") : v
            }
          />
          <EChartsBarChart.YAxis domain={[0, "dataMax"] as [number, string]} />
          <EChartsBarChart.Tooltip />
          <EChartsBarChart.Bar
            dataKey="shrunkScore"
            itemColors={(_value, _index, row) =>
              tierColor(
                (row as unknown as { confidenceTier: ConfidenceTier })
                  .confidenceTier,
              )
            }
          />
        </EChartsBarChart>
      </div>

      {/* Confidence tier legend */}
      <div className="insight-tier-legend">
        <span className="insight-tier-legend__label">Confidence:</span>
        <TierBadge tier="High" />
        <TierBadge tier="Medium" />
        <TierBadge tier="Exploratory" />
      </div>

      {/* Kruskal-Wallis footnote */}
      {data.kruskalWallis && (
        <p className="insight-kw-footnote">
          Kruskal-Wallis H={data.kruskalWallis.H?.toFixed(2) ?? "--"}, df=
          {data.kruskalWallis.df ?? "--"}, p=
          {data.kruskalWallis.p?.toFixed(4) ?? "--"}
          {data.isSignificant
            ? " -- statistically significant"
            : " -- not statistically significant"}
        </p>
      )}
    </section>
  );
}

// ── V2: Weekly Performance (day-of-week bar chart from DB data) ────────

function WeeklyAnalysisV2({
  data,
  timezone,
}: {
  data: BestTimeToPostV2Data;
  timezone?: string;
}) {
  const palette = useInsightPalette();
  const dayOfWeek = useMemo(() => data.dayOfWeek ?? [], [data.dayOfWeek]);

  // Per-metric best days from z-scores
  const bestDayForViews = useMemo(() => {
    if (!dayOfWeek.length) return null;
    return dayOfWeek.reduce(
      (best, d) => (d.medianViewsZ > best.medianViewsZ ? d : best),
      dayOfWeek[0],
    );
  }, [dayOfWeek]);

  const bestDayForEngagement = useMemo(() => {
    if (!dayOfWeek.length) return null;
    return dayOfWeek.reduce(
      (best, d) => (d.medianEngagementZ > best.medianEngagementZ ? d : best),
      dayOfWeek[0],
    );
  }, [dayOfWeek]);

  const bestDayForComments = useMemo(() => {
    if (!dayOfWeek.length) return null;
    return dayOfWeek.reduce(
      (best, d) => (d.medianCommentsZ > best.medianCommentsZ ? d : best),
      dayOfWeek[0],
    );
  }, [dayOfWeek]);

  const tierColor = (tier: ConfidenceTier) =>
    tier === "High"
      ? palette.tierHigh
      : tier === "Medium"
        ? palette.tierMedium
        : palette.tierLow;

  const weeklyConfig: ChartConfig = useMemo(
    () => ({
      shrunkScore: { label: "Composite score", color: palette.primary },
    }),
    [palette],
  );

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">Weekly Performance</h3>
          <p className="insights-section__desc">
            Performance by day of week
            {timezone && timezone !== "UTC"
              ? ` -- ${timezoneShortLabel(timezone)}`
              : ""}
          </p>
        </div>
      </div>

      {/* Stat pills */}
      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">Best day</span>
          <span className="insight-stat__value insight-stat__value--highlight">
            {data.bestDayOfWeekLabel}
            <span className="insight-stat__unit">
              {" "}
              {timezone ? ` ${getTimezoneAbbr(timezone)} · ` : ""}
              ({data.bestDayOfWeekScore?.toFixed(2) ?? "--"})
            </span>
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Videos</span>
          <span className="insight-stat__value">
            {data.totalVideosAnalyzed}
          </span>
        </div>
        {data.kruskalWallis && (
          <div className="insight-stat">
            <span className="insight-stat__label">Significance (p)</span>
            <span className="insight-stat__value">
              {data.kruskalWallis.p?.toFixed(4) ?? "--"}
            </span>
          </div>
        )}
        {/* Per-metric best day pills */}
        <div className="insight-stat">
          <span className="insight-stat__label">Best for views</span>
          <span className="insight-stat__value">
            {bestDayForViews?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for engagement</span>
          <span className="insight-stat__value">
            {bestDayForEngagement?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for comments</span>
          <span className="insight-stat__value">
            {bestDayForComments?.label ?? "--"}
          </span>
        </div>
        {/* Best for subs -- from YT Analytics subscriber enrichment */}
        <div className="insight-stat">
          <span className="insight-stat__label">Best for subs</span>
          <span className="insight-stat__value">
            {data.bestDayForSubscribersLabel ?? "--"}
          </span>
        </div>
      </div>

      {/* Day-of-week bar chart */}
      <div className="insight-chart-wrap insight-chart-wrap--bar">
        <EChartsBarChart
          data={asChartRows(dayOfWeek)}
          config={weeklyConfig}
          xDataKey="label"
          height={280}
          tooltipFormatter={(rows, axisValue) => {
            const r =
              rows.find((x) => x.seriesKey === "shrunkScore") ?? rows[0];
            const v =
              typeof r?.value === "number" ? r.value : Number(r?.value ?? 0);
            const p = (r?.row ?? {}) as unknown as
              | DayOfWeekStatV2
              | undefined;
            const sub =
              p && p.videoCount > 0
                ? `${p.videoCount} videos · ${p.confidenceTier} confidence` +
                  (p.ciLower != null && p.ciUpper != null
                    ? ` · CI [${p.ciLower.toFixed(2)}, ${p.ciUpper.toFixed(2)}]`
                    : "")
                : undefined;
            return tooltipHtml(String(axisValue ?? ""), [
              {
                color: palette.primary,
                name: "Composite score",
                value: v.toFixed(2),
                sub,
              },
            ]);
          }}
        >
          <EChartsBarChart.Grid />
          <EChartsBarChart.XAxis dataKey="label" />
          <EChartsBarChart.YAxis tickFormatter={(v) => v.toFixed(1)} />
          <EChartsBarChart.Tooltip />
          <EChartsBarChart.Bar
            dataKey="shrunkScore"
            itemColors={(_value, _index, row) =>
              tierColor(
                (row as unknown as { confidenceTier: ConfidenceTier })
                  .confidenceTier,
              )
            }
          />
        </EChartsBarChart>
      </div>

      {/* Confidence tier legend */}
      <div className="insight-tier-legend">
        <span className="insight-tier-legend__label">Confidence:</span>
        <TierBadge tier="High" />
        <TierBadge tier="Medium" />
        <TierBadge tier="Exploratory" />
      </div>
    </section>
  );
}

// ── Audience Active Time (day-of-week) ───────────────────────────────

function AudienceActiveTimeSection({
  data,
}: {
  data: AudienceActiveTimeData;
}) {
  const palette = useInsightPalette();
  const dayOfWeek = useMemo(() => data.dayOfWeek ?? [], [data.dayOfWeek]);

  // Peak day metric pills
  const bestDayForSubs = useMemo(() => {
    if (!dayOfWeek.length) return null;
    return dayOfWeek.reduce((best, d) =>
      d.subscribersGained > best.subscribersGained ? d : best,
    );
  }, [dayOfWeek]);

  const bestDayForLikes = useMemo(() => {
    if (!dayOfWeek.length) return null;
    return dayOfWeek.reduce((best, d) =>
      d.likes > best.likes ? d : best,
    );
  }, [dayOfWeek]);

  const bestDayForComments = useMemo(() => {
    if (!dayOfWeek.length) return null;
    return dayOfWeek.reduce((best, d) =>
      d.comments > best.comments ? d : best,
    );
  }, [dayOfWeek]);

  const fmtViews = (v: number) =>
    v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
        ? `${(v / 1_000).toFixed(1)}K`
        : String(v);

  const dayOfWeekWithEngagement = useMemo(
    () =>
      dayOfWeek.map((d) => ({
        ...d,
        totalEngagement: d.subscribersGained + d.likes + d.comments + d.shares,
      })),
    [dayOfWeek],
  );

  const avgViews = useMemo(() => {
    if (dayOfWeekWithEngagement.length === 0) return 0;
    return (
      dayOfWeekWithEngagement.reduce((s, d) => s + (d.views ?? 0), 0) /
      dayOfWeekWithEngagement.length
    );
  }, [dayOfWeekWithEngagement]);

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">
            Weekly Audience Activity
          </h3>
          <p className="insights-section__desc">
            View count and engagement by day of week
          </p>
        </div>
      </div>

      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">Best day</span>
          <span className="insight-stat__value insight-stat__value--highlight">
            {data.peakDayLabel}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for subs</span>
          <span className="insight-stat__value">
            {bestDayForSubs?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for likes</span>
          <span className="insight-stat__value">
            {bestDayForLikes?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Best for comments</span>
          <span className="insight-stat__value">
            {bestDayForComments?.label ?? "--"}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Total views</span>
          <span className="insight-stat__value">
            {fmtViews(data.totalViews)}
          </span>
        </div>
      </div>

      <div className="insight-chart-wrap insight-chart-wrap--bar">
        <EChartsBarChart
          data={asChartRows(dayOfWeekWithEngagement)}
          syncGroup="weekly-audience-activity"
          config={{
            views: { label: "Views", color: palette.accent },
            totalEngagement: {
              label: "Engagement (likes+comments+shares)",
              color: palette.secondary,
            },
            subscribersGained: {
              label: "Subscribers gained",
              color: palette.info,
            },
          }}
          xDataKey="label"
          height={280}
          tooltipFormatter={(rows, axisValue) => {
            const title = String(axisValue ?? "");
            const p = (rows[0]?.row ?? {}) as unknown as
              | (AudienceDayOfWeekStat & {
                  totalEngagement: number;
                })
              | undefined;
            const lines = rows.map((r) => {
              const v =
                typeof r.value === "number" ? r.value : Number(r.value ?? 0);
              if (r.seriesKey === "views") {
                return {
                  color: palette.accent,
                  name: "Views",
                  value: fmtViews(v),
                };
              }
              if (r.seriesKey === "subscribersGained") {
                return {
                  color: palette.info,
                  name: "Subscribers gained",
                  value: fmtViews(v),
                };
              }
              const subs: string[] = [];
              if (p && p.likes + p.comments + p.shares > 0) {
                subs.push(
                  `${fmtViews(p.likes)} likes · ${fmtViews(p.comments)} comments · ${fmtViews(p.shares)} shares`,
                );
              }
              return {
                color: palette.secondary,
                name: "Engagement",
                value: fmtViews(v),
                sub: subs.length ? subs.join(" · ") : undefined,
              };
            });
            return tooltipHtml(title, lines);
          }}
        >
          <EChartsBarChart.Grid />
          <EChartsBarChart.XAxis dataKey="label" />
          <EChartsBarChart.YAxis
            tickFormatter={(v) => fmtViews(v)}
            domain={[0, "dataMax"] as [number, string]}
          />
          <EChartsBarChart.YAxis
            tickFormatter={(v) => fmtViews(v)}
            domain={["dataMin", "dataMax"] as [string, string]}
          />
          <EChartsBarChart.Tooltip />
          <EChartsBarChart.Legend isClickable />
          <EChartsBarChart.Bar
            dataKey="views"
            name="Views"
            markLine={avgViews > 0 ? [{ y: avgViews, label: "Avg" }] : undefined}
            itemColors={(_value: number, _index: number, row: Record<string, unknown>) =>
              String(row.label) === data.peakDayLabel ? palette.secondary : palette.accent
            }
          />
          <EChartsBarChart.Bar
            dataKey="subscribersGained"
            name="Subscribers gained"
            yAxisIndex={1}
            itemColors={(value: number) => (value < 0 ? palette.tierLow : palette.info)}
          />
          <EChartsBarChart.Line dataKey="totalEngagement" yAxisIndex={1} />
        </EChartsBarChart>
      </div>
    </section>
  );
}

// ── Estimated Audience Active Time (View-Velocity Model) ──────────────

/**
 * Shows the estimated 24-hour audience activity distribution computed from
 * the view-velocity model (Postgres data). This is an ESTIMATE, not
 * ground-truth hourly analytics from YouTube.
 */
function EstimatedAudienceActiveTimeSection({
  data,
}: {
  data: EstimatedAudienceActiveTimeData;
}) {
  const palette = useInsightPalette();
  const hourly = useMemo(() => data.hourly ?? [], [data.hourly]);
  const { peakHourLabel, confidence, totalVideosAnalyzed } = data;

  const hoursWithData = useMemo(
    () => hourly.filter((h) => h.videoCount >= 1).length,
    [hourly],
  );

  const isReliable = confidence === 'high' || confidence === 'medium';
  const timeLabels = ["12AM", "3AM", "6AM", "9AM", "12PM", "3PM", "6PM", "9PM"];

  // Color function: traffic-light verdict per bar — best/high = green,
  // medium = yellow, lower = neutral blue, zero = gray
  const getBarColor = (entry: EstimatedHourlyActivity) => {
    if (entry.hour === data.peakHour) return palette.secondary; // green for peak hour (best)
    if (entry.viewPercentage <= 0) return palette.disabled;   // gray for zero
    const pct = entry.viewPercentage / Math.max(...hourly.map(h => h.viewPercentage), 1);
    if (pct > 0.7) return palette.secondary;  // green -- high
    if (pct > 0.4) return palette.tierMedium;  // yellow -- medium
    return palette.accent;                   // blue -- lower (neutral)
  };

  const estConfig: ChartConfig = useMemo(
    () => ({
      viewPercentage: { label: 'Est. activity', color: palette.secondary },
    }),
    [palette],
  );

  const fmtViews = (v: number) =>
    v >= 1_000_000
      ? `${(v / 1_000_000).toFixed(1)}M`
      : v >= 1_000
        ? `${(v / 1_000).toFixed(1)}K`
        : String(v);

  return (
    <section className="insights-section">
      <div className="insights-section__header">
        <div className="insights-section__header-left">
          <h3 className="insights-section__title">
            Estimated Hourly Activity
          </h3>
          <p className="insights-section__desc">
            View-velocity estimate based on {totalVideosAnalyzed} video
            {totalVideosAnalyzed !== 1 ? 's' : ''} -- highest at {peakHourLabel}
          </p>
        </div>
      </div>

      {/* Confidence & info stat row */}
      <div className="insight-stat-row">
        <div className="insight-stat">
          <span className="insight-stat__label">Peak hour</span>
          <span className="insight-stat__value insight-stat__value--highlight">
            {peakHourLabel}
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Confidence</span>
          <span className="insight-stat__value">
            <span
              className="insight-tier-badge"
              style={{
                backgroundColor:
                  confidence === 'high'
                    ? `color-mix(in srgb, ${palette.tierHigh} 12%, transparent)`
                    : confidence === 'medium'
                      ? `color-mix(in srgb, ${palette.tierMedium} 12%, transparent)`
                      : `color-mix(in srgb, ${palette.tierLow} 12%, transparent)`,
                color:
                  confidence === 'high'
                    ? palette.tierHigh
                    : confidence === 'medium'
                      ? palette.tierMedium
                      : palette.tierLow,
                fontSize: '0.75rem',
                padding: '2px 8px',
                borderRadius: '9999px',
                fontWeight: 600,
              }}
            >
              {confidence.charAt(0).toUpperCase() + confidence.slice(1)}
            </span>
          </span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Hours with data</span>
          <span className="insight-stat__value">{hoursWithData} / 24</span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Videos analyzed</span>
          <span className="insight-stat__value">{totalVideosAnalyzed}</span>
        </div>
        <div className="insight-stat">
          <span className="insight-stat__label">Peak views (est.)</span>
          <span className="insight-stat__value">
            {fmtViews(
              hourly.find((h) => h.hour === data.peakHour)?.estimatedViews ?? 0,
            )}
          </span>
        </div>
      </div>

      {/* Low-confidence notice */}
      {!isReliable && totalVideosAnalyzed > 0 && (
        <div
          className="insight-tier-legend"
          style={{
            padding: '8px 12px',
            marginBottom: 12,
            backgroundColor: `color-mix(in srgb, ${palette.primary} 8%, transparent)`,
            borderRadius: 6,
            fontSize: '0.8rem',
            color: palette.primary,
          }}
        >
          Low confidence estimate -- publish more videos for a more reliable hourly
          activity signal.
        </div>
      )}

      {/* No data / insufficient notice */}
      {totalVideosAnalyzed === 0 && (
        <div
          style={{
            padding: 24,
            textAlign: 'center',
            color: 'var(--rt-color-text-secondary)',
            fontSize: '0.85rem',
          }}
        >
          Not enough video data to estimate hourly audience activity. Publish more
          videos with consistent daily view data to enable this analysis.
        </div>
      )}

      {/* Bar chart */}
      {totalVideosAnalyzed > 0 && (
        <div className="insight-chart-wrap insight-chart-wrap--bar">
          <EChartsBarChart
            data={asChartRows(hourly)}
            config={estConfig}
            xDataKey="label"
            height={280}
            tooltipFormatter={(rows, axisValue) => {
              const r =
                rows.find((x) => x.seriesKey === "viewPercentage") ?? rows[0];
              const v =
                typeof r?.value === "number" ? r.value : Number(r?.value ?? 0);
              const p = (r?.row ?? {}) as unknown as EstimatedHourlyActivity;
              const sub = p
                ? `${fmtViews(p.estimatedViews)} views · ${p.videoCount} videos` +
                  (p.hour === data.peakHour ? " ✦ Peak" : "")
                : undefined;
              return tooltipHtml(String(axisValue ?? ""), [
                {
                  color: palette.primary,
                  name: "Est. activity",
                  value: `${v.toFixed(2)}%`,
                  sub,
                },
              ]);
            }}
          >
            <EChartsBarChart.Grid />
            <EChartsBarChart.XAxis
              dataKey="label"
              tickFormatter={(v) => (timeLabels.includes(v) ? v : "")}
            />
            <EChartsBarChart.YAxis
              tickFormatter={(v) => `${v.toFixed(1)}%`}
              domain={[0, "dataMax"] as [number, string]}
            />
            <EChartsBarChart.Tooltip />
            <EChartsBarChart.Bar
              dataKey="viewPercentage"
              itemColors={(_value, _index, row) =>
                getBarColor(row as unknown as EstimatedHourlyActivity)
              }
            />
          </EChartsBarChart>
        </div>
      )}

      {/* Estimate notice */}
      {totalVideosAnalyzed > 0 && (
        <p
          style={{
            marginTop: 8,
            fontSize: '0.75rem',
            color: 'var(--rt-color-text-tertiary)',
            textAlign: 'center',
          }}
        >
          Estimated from daily view patterns and publish times -- YouTube does not
          provide hourly audience data. Model parameters: decay τ={data.modelParameters.tau.toFixed(1)}h,
          bias β={data.modelParameters.beta.toFixed(1)}, spread σ={data.modelParameters.sigma.toFixed(1)}h
        </p>
      )}
    </section>
  );
}

// ── Skeleton ──────────────────────────────────────────────────────────

function InsightsSkeleton() {
  const pillCounts = [6, 4, 3, 4];
  return (
    <div className="insights-skeleton">
      {[
        "Hourly Analysis",
        "Weekly Performance",
        "Audience Activity",
        "Publish Hour Analysis",
      ].map((section, sIdx) => (
        <div key={section} className="insights-skeleton-card">
          <div className="insights-skeleton-card__header">
            <Skeleton
              type="title"
              width={section === "Audience Activity" ? "45%" : "50%"}
              height="1.1rem"
            />
            <Skeleton type="text" width="30%" height="0.75rem" />
          </div>
          <div className="insight-stat-row insights-skeleton-card__pills">
            {Array.from({ length: pillCounts[sIdx] }).map((_, i) => (
              <Skeleton
                key={i}
                type="text"
                width={i === 0 ? "120px" : "90px"}
                height="1.5rem"
              />
            ))}
          </div>
          <div className="insights-skeleton-card__chart">
            {sIdx === 2 ? (
              /* Retention trend -- curved line skeleton */
              <svg
                viewBox="0 0 300 120"
                className="insights-skeleton-line"
                aria-hidden
              >
                <path
                  d="M0,100 Q30,95 60,80 T120,60 T180,40 T240,55 T300,50"
                  fill="none"
                  stroke="var(--rt-color-border)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d="M0,100 Q30,95 60,80 T120,60 T180,40 T240,55 T300,50"
                  fill="url(#lineGradient)"
                  stroke="none"
                />
                <defs>
                  <linearGradient id="lineGradient" x1="0" y1="0" x2="0" y2="1">
                    <stop
                      offset="0%"
                      stopColor="var(--rt-color-border)"
                      stopOpacity="0.25"
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--rt-color-border)"
                      stopOpacity="0"
                    />
                  </linearGradient>
                </defs>
              </svg>
            ) : (
              /* Bar chart skeleton with fake bars */
              <div className="insights-skeleton-bars">
                {Array.from({ length: sIdx === 1 ? 7 : 12 }).map((_, i) => (
                  <div
                    key={i}
                    className="insights-skeleton-bar"
                    style={{
                      height: `${30 + Math.sin(i * 1.2) * 35 + Math.random() * 20}%`,
                      animationDelay: `${i * 0.06}s`,
                    }}
                  />
                ))}
              </div>
            )}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Empty state ───────────────────────────────────────────────────────

function InsightsEmptyState() {
  return (
    <EmptyState
      title="No insights data yet"
      description="Insights need at least 30 days of analytics data from YouTube. If your channel has been active for a while, check back once YouTube finishes processing analytics for the selected period."
    />
  );
}

// ── Searchable timezone dropdown ──────────────────────────────────────

function SearchableTimezoneDropdown({
  value,
  onChange,
  onClose,
}: {
  value: string;
  onChange: (tz: string) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const allTimezones = useMemo(() => getAllTimezones(), []);

  const filtered = useMemo(() => {
    if (!search) return allTimezones;
    const q = search.toLowerCase();
    return allTimezones.filter(
      (tz) =>
        tz.toLowerCase().includes(q) ||
        tz.split("/").pop()?.toLowerCase().includes(q) ||
        tz.replace(/_/g, " ").toLowerCase().includes(q),
    );
  }, [search, allTimezones]);

  // Group by region (segment before first '/')
  const grouped = useMemo(() => {
    const groups: Record<string, string[]> = {};
    filtered.forEach((tz) => {
      if (tz === "UTC") {
        if (!groups["Other"]) groups["Other"] = [];
        groups["Other"].push(tz);
        return;
      }
      const slashIdx = tz.indexOf("/");
      const region = slashIdx > 0 ? tz.slice(0, slashIdx) : "Other";
      if (!groups[region]) groups[region] = [];
      groups[region].push(tz);
    });
    return groups;
  }, [filtered]);

  // Close on Escape
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [onClose]);

  return (
    <div
      className="insights-tz-dropdown insights-tz-dropdown--searchable"
      onClick={(e) => e.stopPropagation()}
    >
      <div className="insights-tz-search-wrap">
        <input
          type="text"
          className="insights-tz-search"
          placeholder="Search timezone or city..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          autoFocus
        />
      </div>
      <div className="insights-tz-options">
        {Object.entries(grouped).map(([region, zones]) => (
          <div key={region}>
            <div className="insights-tz-group-label">{region}</div>
            {zones.map((tz) => (
              <Button bare
                key={tz}
                type="button"
                className={`insights-tz-option ${tz === value ? "insights-tz-option--selected" : ""}`}
                onClick={() => {
                  onChange(tz);
                  onClose();
                }}
              >
                <span className="insights-tz-option-label">
                  {timezoneShortLabel(tz)}
                </span>
                {tz !== "UTC" && (
                  <span className="insights-tz-option-path">{tz}</span>
                )}
              </Button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="insights-tz-no-results">No timezones found</div>
        )}
      </div>
    </div>
  );
}

// ── Main panel ────────────────────────────────────────────────────────

interface InsightsPanelProps {
  insightsData: InsightsData | null;
  loading: boolean;
  formattedLatestDate: string | null;
  channelTitle: string;
  channelId?: string | null;
  period?: number | null;
  latestDataDate?: string | null;
  getEffectiveToken?: (channelId: string) => Promise<string | null>;
}

export const InsightsPanel: React.FC<InsightsPanelProps> = ({
  insightsData,
  loading,
  formattedLatestDate,
  channelTitle,
  channelId,
  period,
  latestDataDate,
  getEffectiveToken,
}) => {
  const [insightsTimezone, setInsightsTimezoneState] =
    useState<string>(getStoredTimezone);
  const [insightsSegment, setInsightsSegmentState] = useState<
    "all" | "shorts" | "long"
  >(getStoredSegment);
  const [showTimezoneSelector, setShowTimezoneSelector] = useState(false);

  const setTimezone = useCallback((tz: string) => {
    storeTimezone(tz);
    setInsightsTimezoneState(tz);
  }, []);

  const setSegment = useCallback((seg: "all" | "shorts" | "long") => {
    storeSegment(seg);
    setInsightsSegmentState(seg);
  }, []);

  // Fire the insights query with the current timezone + segment settings
  useInsightsTabQuery({
    channelId: channelId ?? null,
    period: period ?? null,
    latestDataDate: latestDataDate ?? null,
    getEffectiveToken: getEffectiveToken ?? (async () => null),
    timezone: insightsTimezone,
    segment: insightsSegment,
    enabled: !!channelId,
  });

  const hasData = Boolean(
    insightsData?.bestTimeToPost ||
    insightsData?.bestTimeToPostV2 ||
    insightsData?.retention ||
    insightsData?.retentionByPublishHour ||
    insightsData?.audienceActiveTime ||
    insightsData?.estimatedAudienceActiveTime,
  );

  if (loading) {
    return (
      <div className="content-section">
        <InsightsSkeleton />
      </div>
    );
  }

  if (!hasData || !insightsData) {
    return (
      <div className="content-section">
        <InsightsEmptyState />
      </div>
    );
  }

  return (
    <div className="content-section">
      <div className="dp-panel">
        <div className="dp-panel-header rt-insights-header">
          <div className="dp-panel-header-left">
            <span className="dp-panel-title">Insights</span>
            <span className="dp-panel-sub">
              {channelTitle || "Overview"}
              {formattedLatestDate ? ` · As of ${formattedLatestDate}` : ""}
            </span>
            <PinToDashboardButton widgetId="insights" />
          </div>
          <div className="dp-panel-header__row rt-insights-controls-row">
            {/* Timezone + Segment controls */}
            <div className="insights-controls-bar">
              {(["all", "shorts", "long"] as const).map((seg) => (
                <Button bare
                  key={seg}
                  type="button"
                  className={`insights-segment-btn ${insightsSegment === seg ? "insights-segment-btn--active" : ""}`}
                  onClick={() => setSegment(seg)}
                  aria-pressed={insightsSegment === seg}
                >
                  {seg === "all" ? "All" : seg === "shorts" ? "Shorts" : "Long"}
                </Button>
              ))}
            </div>
            {/* Timezone selector */}
            <div className="insights-tz-selector">
              <Button variant="ghost" bare
                type="button"
                className="insights-tz-btn"
                onClick={() => setShowTimezoneSelector(!showTimezoneSelector)}
                title="Change timezone"
                aria-haspopup="listbox"
                aria-expanded={showTimezoneSelector}
              >
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  aria-hidden
                >
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10A15.3 15.3 0 0 1 12 2z" />
                  <path d="M2 12h20" />
                </svg>
                {timezoneShortLabel(insightsTimezone)}
              </Button>
              {showTimezoneSelector && (
                <SearchableTimezoneDropdown
                  value={insightsTimezone}
                  onChange={setTimezone}
                  onClose={() => setShowTimezoneSelector(false)}
                />
              )}
            </div>
          </div>
          {insightsTimezone !== getBrowserTimezone() && (
            <div className="insights-tz-note">
              Showing times in{" "}
              <strong>{timezoneShortLabel(insightsTimezone)}</strong>
              <span className="insights-tz-note__sep">·</span>
              Your timezone:{" "}
              {timezoneShortLabel(getBrowserTimezone())}
            </div>
          )}
        </div>
        <div className="dp-body">
          <div className="insights-panel">
            {insightsData.bestTimeToPostV2 ? (
              /* V2 DB-powered -- hourly + weekly sections */
              <>
                <HourlyAnalysisV2 data={insightsData.bestTimeToPostV2} timezone={insightsTimezone} />
                <WeeklyAnalysisV2 data={insightsData.bestTimeToPostV2} timezone={insightsTimezone} />
              </>
            ) : insightsSegment !== "all" ? (
              /* Segment active but not enough data -- show meaningful message instead of silently falling back */
              <section className="insights-section">
                <div className="insights-section__header">
                  <div className="insights-section__header-left">
                    <h3 className="insights-section__title">
                      Best Time to Post
                    </h3>
                    <p className="insights-section__desc">
                      Not enough{" "}
                      {insightsSegment === "shorts" ? "Shorts" : "Long-form"}{" "}
                      videos for analysis in this period
                    </p>
                  </div>
                </div>
                <EmptyState
                  title="Not enough data"
                  description="Try switching to All videos to see the full Best Time to Post analysis."
                />
              </section>
            ) : (
              /* YT API fallback: 24-hour curve + weekly */
              <>
                {insightsData.retentionByPublishHour && (
                  <BestTimeSection data={insightsData.retentionByPublishHour} />
                )}
                {insightsData.bestTimeToPost && (
                  <WeeklyMetricsSection data={insightsData.bestTimeToPost} />
                )}
              </>
            )}
            {insightsData.audienceActiveTime && (
              <AudienceActiveTimeSection
                data={insightsData.audienceActiveTime}
              />
            )}
            {insightsData.estimatedAudienceActiveTime && (
              <EstimatedAudienceActiveTimeSection
                data={insightsData.estimatedAudienceActiveTime}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
