import React, { useMemo, useState, forwardRef } from "react";
import { Toggle, Button } from "./ui";
import { EChartsMapChart } from "./evilcharts/charts/echarts-map-chart";
import { AudienceHeroRow, computeAudienceHero } from "./dashboard/AudienceHeroRow";
import { AudiencePieCard } from "./dashboard/AudiencePieCard";
import type { AnalyticsReport } from "../services/analyticsService";
import type {
  DimensionsBundleData,
  DimensionsMultiPeriodData,
} from "../utils/dashboardUtils";
import { MULTI_SERIES_FALLBACK_COLORS } from "../utils/chartTheme";
import { normalizeLayout, orderedCardIds } from "../utils/cardLayout";
import { useCardLayoutStore } from "../stores/cardLayoutStore";
import {
  AUDIENCE_CARD_SURFACE,
  AUDIENCE_HERO_CARD_BY_LABEL,
} from "../config/statCardRegistry";
import "./DimensionsPanel.css";

interface DimensionsPanelProps {
  multiPeriod: DimensionsMultiPeriodData | null;
  primaryPeriod: 7 | 30 | 90;
  loading: boolean;
  headerActions?: React.ReactNode;
  onDownload?: () => void;
}

const PALETTE = [...MULTI_SERIES_FALLBACK_COLORS, "#84cc16", "#6366f1"];

export const TRAFFIC_SOURCE_LABELS: Record<string, string> = {
  YT_SEARCH: "YouTube Search",
  EXT_URL: "External",
  NO_LINK_EMBEDDED: "Embedded",
  RELATED_VIDEO: "Suggested Videos",
  YT_CHANNEL: "Channel Page",
  SUBSCRIBER: "Subscriptions",
  PLAYLIST: "Playlist",
  YT_OTHER_PAGE: "Other YouTube",
  NOTIFICATION: "Notifications",
  END_SCREEN: "End Screen",
  CAMPAIGN_CARD: "Cards",
  VIDEO_REMIXES: "Remixes",
  SHORTS: "Shorts Feed",
  HASHTAGS: "Hashtags",
  SOUND_PAGE: "Sound Page",
  PRODUCT_PAGE: "Product Page",
};

const DEVICE_LABELS: Record<string, string> = {
  MOBILE: "Mobile",
  DESKTOP: "Desktop",
  TABLET: "Tablet",
  TV: "TV",
  GAME_CONSOLE: "Game Console",
};

export const COUNTRY_NAMES: Record<string, string> = {
  US: "United States",
  GB: "United Kingdom",
  IN: "India",
  CA: "Canada",
  AU: "Australia",
  DE: "Germany",
  FR: "France",
  BR: "Brazil",
  JP: "Japan",
  KR: "South Korea",
  MX: "Mexico",
  ID: "Indonesia",
  RU: "Russia",
  IT: "Italy",
  ES: "Spain",
  TR: "Turkey",
  SA: "Saudi Arabia",
  PK: "Pakistan",
  NG: "Nigeria",
  PH: "Philippines",
  EG: "Egypt",
  TH: "Thailand",
  VN: "Vietnam",
  UA: "Ukraine",
  PL: "Poland",
  NL: "Netherlands",
  AR: "Argentina",
  MY: "Malaysia",
  ZA: "South Africa",
  BD: "Bangladesh",
  CO: "Colombia",
  CL: "Chile",
  RO: "Romania",
  SE: "Sweden",
  BE: "Belgium",
  PT: "Portugal",
  GR: "Greece",
  CZ: "Czech Republic",
  HU: "Hungary",
  AT: "Austria",
  CH: "Switzerland",
  NO: "Norway",
  DK: "Denmark",
  FI: "Finland",
  NZ: "New Zealand",
  SG: "Singapore",
  HK: "Hong Kong",
  TW: "Taiwan",
  IL: "Israel",
  AE: "UAE",
  IQ: "Iraq",
  MA: "Morocco",
  DZ: "Algeria",
  KE: "Kenya",
  GH: "Ghana",
  ET: "Ethiopia",
  TZ: "Tanzania",
  UG: "Uganda",
  CM: "Cameroon",
  CI: "Côte d'Ivoire",
  PE: "Peru",
  VE: "Venezuela",
  EC: "Ecuador",
  BO: "Bolivia",
  PY: "Paraguay",
  UY: "Uruguay",
  CR: "Costa Rica",
  GT: "Guatemala",
  CU: "Cuba",
  DO: "Dominican Republic",
  SK: "Slovakia",
  HR: "Croatia",
  BG: "Bulgaria",
  RS: "Serbia",
  LT: "Lithuania",
  LV: "Latvia",
  EE: "Estonia",
  SI: "Slovenia",
  BY: "Belarus",
  KZ: "Kazakhstan",
  UZ: "Uzbekistan",
  AZ: "Azerbaijan",
  GE: "Georgia",
  AM: "Armenia",
  LK: "Sri Lanka",
  NP: "Nepal",
  MM: "Myanmar",
  KH: "Cambodia",
  LA: "Laos",
};

const AGE_ORDER = [
  "age13-17",
  "age18-24",
  "age25-34",
  "age35-44",
  "age45-54",
  "age55-64",
  "age65-",
];
const AGE_LABELS: Record<string, string> = {
  "age13-17": "13–17",
  "age18-24": "18–24",
  "age25-34": "25–34",
  "age35-44": "35–44",
  "age45-54": "45–54",
  "age55-64": "55–64",
  "age65-": "65+",
};

function fmtNum(n: number) {
  return new Intl.NumberFormat("en", {
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

function deltaPct(
  c: number,
  p: number,
  isAbsoluteDelta = false,
): number | null {
  if (p <= 0 && c <= 0) return null;
  if (isAbsoluteDelta) return c - p;
  if (p <= 0) return null;
  return ((c - p) / p) * 100;
}

export type ChartRow = {
  name: string;
  key: string;
  views: number;
  pct: number;
  delta7: number | null;
  delta30: number | null;
  delta90: number | null;
};

/** Same visual language as `VideoAnalyticsChart` / `ChannelAnalyticsInsights`. */
const renderAudienceDelta = (pct: number | null, loading = false) => {
  if (loading) return <span className="seo-pill-delta-skeleton" />;
  if (pct === null || Number.isNaN(pct))
    return <span className="seo-pill-delta neutral">--</span>;
  const isPositive = pct > 0;
  const isNegative = pct < 0;
  const colorClass = isPositive
    ? "positive"
    : isNegative
      ? "negative"
      : "neutral";
  return (
    <span className={`seo-pill-delta ${colorClass}`}>
      {isPositive && <span className="delta-arrow">↑</span>}
      {isNegative && <span className="delta-arrow">↓</span>}
      {Math.abs(pct).toFixed(1)}%
    </span>
  );
};

export const AudienceMetricDeltas: React.FC<{
  row: ChartRow;
  primaryPeriod: 7 | 30 | 90;
  isCustom?: boolean;
}> = ({ row, primaryPeriod, isCustom = false }) => (
  <span className="seo-pill-deltas dp-audience-deltas">
    {([90, 30, 7] as const).map((d) => {
      const pct = d === 7 ? row.delta7 : d === 30 ? row.delta30 : row.delta90;
      return (
        <span
          key={d}
          className={`seo-pill-delta-group${!isCustom && primaryPeriod === d ? " active-period" : ""}`}
        >
          <span className="seo-period-inline-label">{`${d}d`}</span>
          {renderAudienceDelta(pct, false)}
        </span>
      );
    })}
  </span>
);

function toChartData(
  report: AnalyticsReport | null,
  labelMap?: Record<string, string>,
  sortOrder?: string[],
  limit = 8,
  rawPct = false,
): { name: string; key: string; views: number; pct: number }[] {
  if (!report?.rows?.length) return [];
  const total = report.rows.reduce((s, r) => s + Number(r[1]), 0);
  let rows = report.rows.map((r) => ({
    name: labelMap?.[r[0]] ?? r[0],
    key: r[0],
    views: Number(r[1]),
    pct: rawPct ? Number(r[1]) : total > 0 ? (Number(r[1]) / total) * 100 : 0,
  }));
  if (sortOrder) {
    rows = rows.sort((a, b) => {
      const ai = sortOrder.indexOf(a.key);
      const bi = sortOrder.indexOf(b.key);
      return (ai === -1 ? 999 : ai) - (bi === -1 ? 999 : bi);
    });
  } else {
    rows = rows.sort((a, b) => b.views - a.views);
  }
  return rows.slice(0, limit);
}

function addDeltas(
  base: { name: string; key: string; views: number; pct: number }[],
  multiPeriod: DimensionsMultiPeriodData | null,
  getReport: (b: DimensionsBundleData) => AnalyticsReport | null,
  rawPct = false,
): ChartRow[] {
  if (!multiPeriod) {
    return base.map((b) => ({
      ...b,
      delta7: null,
      delta30: null,
      delta90: null,
    }));
  }

  const getMetricShare = (rep: AnalyticsReport | null, key: string) => {
    if (!rep?.rows?.length) return 0;
    const row = rep.rows.find((r) => String(r[0]) === key);
    const val = row ? Number(row[1]) || 0 : 0;
    if (rawPct) return val;
    // Calculate the percentage share for raw-value based metrics
    const total = rep.rows.reduce((s, r) => s + Number(r[1]), 0);
    return total > 0 ? (val / total) * 100 : 0;
  };

  return base.map((row) => ({
    ...row,
    delta7: deltaPct(
      getMetricShare(getReport(multiPeriod.d7.current), row.key),
      getMetricShare(getReport(multiPeriod.d7.previous), row.key),
      true, // ALWAYS use absolute point difference for audience composition charts
    ),
    delta30: deltaPct(
      getMetricShare(getReport(multiPeriod.d30.current), row.key),
      getMetricShare(getReport(multiPeriod.d30.previous), row.key),
      true,
    ),
    delta90: deltaPct(
      getMetricShare(getReport(multiPeriod.d90.current), row.key),
      getMetricShare(getReport(multiPeriod.d90.previous), row.key),
      true,
    ),
  }));
}

/** World choropleth for country watch share. The ranked list below stays as
 *  the offline/error fallback, so a failed shape fetch never blanks the card. */
const CountryMap: React.FC<{ rows: { key: string; views: number }[]; loading: boolean }> = ({
  rows,
  loading,
}) => (
  <div className="dp-map-wrap">
    <EChartsMapChart
      rows={rows}
      nameOf={(code) => COUNTRY_NAMES[code] ?? code}
      loading={loading}
      height={300}
    />
  </div>
);

const CountryFlag: React.FC<{ code: string }> = ({ code }) => {  const lower = code.toLowerCase();
  return (
    <div className="dp-flag-wrapper">
      <img
        src={`https://cdn.jsdelivr.net/npm/circle-flags@1.0.0/flags/${lower}.svg`}
        alt={code}
        className="dp-flag"
        crossOrigin="anonymous"
        loading="lazy"
        onError={(e) => {
          const img = e.target as HTMLImageElement;
          if (!img.src.includes("flagcdn")) {
            img.src = `https://flagcdn.com/${lower}.svg`;
          } else {
            img.style.display = "none";
          }
        }}
      />
    </div>
  );
};

const DonutChart: React.FC<{
  data: { name: string; pct: number }[];
  size?: number;
}> = ({ data, size = 90 }) => {
  const r = 30;
  const cx = size / 2;
  const cy = size / 2;
  const circumference = 2 * Math.PI * r;
  const segments = data.map((d, i) => {
    const dash = (d.pct / 100) * circumference;
    const gap = circumference - dash;
    const offset = data
      .slice(0, i)
      .reduce(
        (total, segment) => total + (segment.pct / 100) * circumference,
        0,
      );
    const seg = (
      <circle
        key={i}
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke={PALETTE[i % PALETTE.length]}
        strokeWidth="11"
        strokeDasharray={`${dash} ${gap}`}
        strokeDashoffset={-offset}
        style={{
          transform: `rotate(-90deg)`,
          transformOrigin: `${cx}px ${cy}px`,
        }}
      />
    );
    return seg;
  });

  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
      <circle
        cx={cx}
        cy={cy}
        r={r}
        fill="none"
        stroke="#f3f4f6"
        strokeWidth="11"
      />
      {segments}
    </svg>
  );
};

const SkeletonRows: React.FC = () => (
  <div className="dp-skeleton dp-skeleton-bars">
    {[80, 65, 50, 38, 25].map((w, i) => (
      <React.Fragment key={i}>
        <div
          className="dp-skeleton-meta"
          style={{ maxWidth: `${w * 0.55}%` }}
        />
        <div className="dp-skeleton-bar-wrap">
          <div className="dp-skeleton-bar" style={{ width: `${w}%` }} />
        </div>
        <div className="dp-skeleton-mini" />
        <div className="dp-skeleton-mini dp-skeleton-mini--pct" />
        <div className="dp-skeleton-deltas-slot" aria-hidden />
      </React.Fragment>
    ))}
  </div>
);

interface CardProps {
  title: string;
  icon: React.ReactNode;
  data: ChartRow[];
  loading: boolean;
  primaryPeriod: 7 | 30 | 90;
  showDeltas: boolean;
  className?: string;
  variant?: "bars" | "donut" | "countries";
  valueFormat?: "count" | "percent";
  isCustom?: boolean;
  /** Rendered between the card head and the body (e.g. the world map). */
  topVisual?: React.ReactNode;
  /** Countries only: map (70%) beside the ranked list (30%) instead of stacked. */
  split?: boolean;
  /** Card customization: grid `order` from the saved stat-card layout. */
  style?: React.CSSProperties;
}

const DimCard: React.FC<CardProps> = ({
  title,
  icon,
  data,
  loading,
  primaryPeriod,
  showDeltas,
  className = "",
  variant = "bars",
  valueFormat = "count",
  isCustom = false,
  topVisual,
  split = false,
  style,
}) => {
  const showDonut = variant === "donut" && data.length >= 2 && data.length <= 5;
  const scrollBars = variant !== "donut";

  /** Ranked country list, shared by the stacked and 70/30 split layouts. */
  const renderCountryList = () => (
    <div className="dp-bars">
      {data.map((item, i) => (
        <React.Fragment key={i}>
          <div className="dp-bar-meta-row">
            <CountryFlag code={item.key} />
            <span
              className="dp-bar-label"
              title={COUNTRY_NAMES[item.key] ?? item.name}
            >
              {COUNTRY_NAMES[item.key] ?? item.name}
            </span>
          </div>
          <div className="dp-bar-track">
            <div
              className="dp-bar-fill"
              style={{
                width: `${item.pct}%`,
                background: PALETTE[i % PALETTE.length],
              }}
            />
          </div>
          <span className="dp-bar-views">{fmtNum(item.views)}</span>
          <span className="dp-bar-pct">{item.pct.toFixed(1)}%</span>
          <div className="dp-bar-graph-deltas">
            {showDeltas ? (
              <AudienceMetricDeltas
                row={item}
                primaryPeriod={primaryPeriod}
                isCustom={isCustom}
              />
            ) : null}
          </div>
        </React.Fragment>
      ))}
    </div>
  );

  return (
    <div
      className={`dp-card${scrollBars ? " dp-card--bars" : ""} ${className}`.trim()}
      style={style}
    >
      <div className="dp-card-head">
        <span className="dp-card-icon">{icon}</span>
        <span className="dp-card-title">{title}</span>
      </div>
      {!split && topVisual}

      {loading ? (
        <SkeletonRows />
      ) : !data.length ? (
        <div className="dp-empty">
          <svg
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            width="28"
            height="28"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 8v4m0 4h.01" />
          </svg>
          <span>No data available</span>
        </div>
      ) : showDonut ? (
        <div className="dp-donut-layout">
          <DonutChart data={data} size={84} />
          <div className="dp-donut-legend">
            {data.map((item, i) => (
              <React.Fragment key={i}>
                <div className="dp-legend-item">
                  <span
                    className="dp-legend-dot"
                    style={{ background: PALETTE[i % PALETTE.length] }}
                  />
                  <span className="dp-legend-label">{item.name}</span>
                </div>
                <span className="dp-legend-pct">
                  {valueFormat === "percent"
                    ? `${item.views.toFixed(1)}%`
                    : `${item.pct.toFixed(1)}%`}
                </span>
                <div className="dp-legend-deltas-cell">
                  {showDeltas ? (
                    <AudienceMetricDeltas
                      row={item}
                      primaryPeriod={primaryPeriod}
                      isCustom={isCustom}
                    />
                  ) : null}
                </div>
              </React.Fragment>
            ))}
          </div>
        </div>
      ) : variant === "countries" ? (
        split ? (
          <div className="aud-split">
            <div className="aud-split-map">{topVisual}</div>
            <div className="aud-split-list">{renderCountryList()}</div>
          </div>
        ) : (
          renderCountryList()
        )
      ) : (
        <div className="dp-bars">
          {data.map((item, i) => (
            <React.Fragment key={i}>
              <div className="dp-bar-meta-row">
                <span
                  className="dp-bar-dot"
                  style={{ background: PALETTE[i % PALETTE.length] }}
                />
                <span className="dp-bar-label" title={item.name}>
                  {item.name}
                </span>
              </div>
              <div className="dp-bar-track">
                <div
                  className="dp-bar-fill"
                  style={{
                    width: `${item.pct}%`,
                    background: PALETTE[i % PALETTE.length],
                  }}
                />
              </div>
              {valueFormat !== "percent" ? (
                <span className="dp-bar-views">{fmtNum(item.views)}</span>
              ) : (
                <span
                  className="dp-bar-views dp-bar-views--empty"
                  aria-hidden
                />
              )}
              <span className="dp-bar-pct">
                {valueFormat === "percent"
                  ? `${item.views.toFixed(1)}%`
                  : `${item.pct.toFixed(1)}%`}
              </span>
              <div className="dp-bar-graph-deltas">
                {showDeltas ? (
                  <AudienceMetricDeltas
                    row={item}
                    primaryPeriod={primaryPeriod}
                    isCustom={isCustom}
                  />
                ) : null}
              </div>
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
};

function primaryBundle(
  multi: DimensionsMultiPeriodData | null,
  primaryPeriod: 7 | 30 | 90,
): DimensionsBundleData | null {
  if (!multi) return null;
  // When a custom date range is active, use the full user-chosen range as the primary window
  if (multi.dCustom) return multi.dCustom.current;
  if (primaryPeriod === 7) return multi.d7.current;
  if (primaryPeriod === 30) return multi.d30.current;
  return multi.d90.current;
}

export const DimensionsPanel = forwardRef<HTMLDivElement, DimensionsPanelProps>(
  ({ multiPeriod, primaryPeriod, loading, headerActions, onDownload }, ref) => {
    const [showChanges, setShowChanges] = useState(false);
    const primary = primaryBundle(multiPeriod, primaryPeriod);

    const trafficData = useMemo(() => {
      const base = toChartData(
        primary?.trafficSource ?? null,
        TRAFFIC_SOURCE_LABELS,
        undefined,
        6,
      );
      return addDeltas(base, multiPeriod, (b) => b.trafficSource);
    }, [multiPeriod, primary]);

    const genderData = useMemo(() => {
      const base = toChartData(
        primary?.gender ?? null,
        { male: "Male", female: "Female", user_specified: "Other" },
        undefined,
        8,
        true,
      );
      return addDeltas(base, multiPeriod, (b) => b.gender, true);
    }, [multiPeriod, primary]);

    const ageData = useMemo(() => {
      const base = toChartData(
        primary?.ageGroup ?? null,
        AGE_LABELS,
        AGE_ORDER,
        7,
        true,
      );
      return addDeltas(base, multiPeriod, (b) => b.ageGroup, true);
    }, [multiPeriod, primary]);

    const subData = useMemo(() => {
      const base = toChartData(primary?.subscribedStatus ?? null, {
        SUBSCRIBED: "Subscribers",
        UNSUBSCRIBED: "Non-Subscribers",
      });
      return addDeltas(base, multiPeriod, (b) => b.subscribedStatus);
    }, [multiPeriod, primary]);

    const countryData = useMemo(() => {
      const base = toChartData(
        primary?.country ?? null,
        undefined,
        undefined,
        6,
      );
      return addDeltas(base, multiPeriod, (b) => b.country);
    }, [multiPeriod, primary]);

    const deviceData = useMemo(() => {
      const base = toChartData(primary?.deviceType ?? null, DEVICE_LABELS);
      return addDeltas(base, multiPeriod, (b) => b.deviceType);
    }, [multiPeriod, primary]);

    type RawRows = [string, number][];
    const asRawRows = (rep: AnalyticsReport | null | undefined): RawRows =>
      (rep?.rows ?? []).map((r) => [String(r[0]), Number(r[1]) || 0]);

    /** Hero tiles from the full (unsliced) primary reports. */
    const heroTiles = useMemo(
      () =>
        computeAudienceHero({
          country: primary?.country
            ? { rows: asRawRows(primary.country), nameOf: (c) => COUNTRY_NAMES[c] ?? c }
            : null,
          traffic: primary?.trafficSource
            ? { rows: asRawRows(primary.trafficSource), nameOf: (k) => TRAFFIC_SOURCE_LABELS[k] ?? k }
            : null,
          device: primary?.deviceType ? { rows: asRawRows(primary.deviceType) } : null,
        }),
      [primary],
    );

    /**
     * Stat-card customization for the Audience tab: user order, visibility and
     * detail rows layered on top of the data. Hero tiles map to ids by label
     * (`AUDIENCE_HERO_CARD_BY_LABEL`) so `computeAudienceHero` stays pure.
     */
    const cardLayout = useCardLayoutStore((state) => state.layouts[AUDIENCE_CARD_SURFACE]);
    const audienceVisibleIds = useMemo(
      () => orderedCardIds(AUDIENCE_CARD_SURFACE, cardLayout),
      [cardLayout],
    );
    const audienceOrder = useMemo(() => {
      const map = new Map<string, number>();
      audienceVisibleIds.forEach((id, index) => map.set(id, index));
      return map;
    }, [audienceVisibleIds]);
    const audienceCompactIds = useMemo(
      () => new Set(normalizeLayout(AUDIENCE_CARD_SURFACE, cardLayout).compact),
      [cardLayout],
    );
    const isCardVisible = (id: string) => audienceVisibleIds.includes(id);
    const showCardDetails = (id: string) => !audienceCompactIds.has(id);

    const orderedHeroTiles = useMemo(() => {
      const visible = new Set(audienceVisibleIds);
      const rank = (label: string) =>
        audienceOrder.get(AUDIENCE_HERO_CARD_BY_LABEL[label] ?? "") ?? Number.MAX_SAFE_INTEGER;
      return heroTiles
        .filter((tile) => {
          const id = AUDIENCE_HERO_CARD_BY_LABEL[tile.label];
          return !id || visible.has(id);
        })
        .map((tile) => {
          const id = AUDIENCE_HERO_CARD_BY_LABEL[tile.label] ?? "";
          return { ...tile, showSub: !audienceCompactIds.has(id) };
        })
        .sort((a, b) => rank(a.label) - rank(b.label));
    }, [heroTiles, audienceVisibleIds, audienceOrder, audienceCompactIds]);

    const trafficTotal = useMemo(
      () => asRawRows(primary?.trafficSource).reduce((s, r) => s + r[1], 0),
      [primary],
    );
    const subsTotal = useMemo(
      () => asRawRows(primary?.subscribedStatus).reduce((s, r) => s + r[1], 0),
      [primary],
    );

    /** Untruncated country rows for the map (list card keeps its top-6). */
    const countryMapRows = useMemo(
      () => asRawRows(primary?.country).map(([key, views]) => ({ key, views })),
      [primary],
    );

    const isCustom = multiPeriod?.dCustom != null;
    const primaryLabel = isCustom
      ? "Custom"
      : primaryPeriod === 7
        ? "7d"
        : primaryPeriod === 30
          ? "30d"
          : "90d";

    const hasAnyData =
      !loading &&
      Boolean(
        primary &&
        [
          primary.trafficSource,
          primary.gender,
          primary.ageGroup,
          primary.subscribedStatus,
          primary.country,
          primary.deviceType,
        ].some((r) => r?.rows?.length),
      );

    return (
      <div
        className={`dp-panel${showChanges ? " dp-panel--show-changes" : ""}`}
        ref={ref}
      >
        <div className="dp-panel-header">
          <div className="dp-panel-header-left">
            <span className="dp-panel-title">Audience Breakdown</span>
            <span className="dp-panel-sub">Share by {primaryLabel}</span>
          </div>
          <div className="dp-panel-header-right">
            <div className="seo-control-group">
              <span className="control-label">Show changes</span>
              <Toggle
                checked={showChanges}
                onChange={setShowChanges}
                ariaLabel="Toggle period change pills"
              />
            </div>
            {onDownload && (
              <Button variant="secondary"
                bare
               
                onClick={(e) => {
                  e.stopPropagation();
                  onDownload();
                }}
                title="Download as PNG"
              >
                <svg
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="2"
                  width="14"
                  height="14"
                >
                  <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3" />
                </svg>
                <span className="dp-download-text">PNG</span>
              </Button>
            )}
            {headerActions && (
              <div
                className="dp-header-actions"
                onClick={(e) => e.stopPropagation()}
                onMouseDown={(e) => e.stopPropagation()}
              >
                {headerActions}
              </div>
            )}
          </div>
        </div>

        <div className="dp-body">
          {!loading && !hasAnyData ? (
            <div className="dp-no-data">
              <svg
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                width="36"
                height="36"
              >
                <circle cx="12" cy="12" r="10" />
                <path d="M12 8v4m0 4h.01" />
              </svg>
              <p>
                No audience data for the selected filters. Try a wider date
                range.
              </p>
            </div>
          ) : (
            <>
            <AudienceHeroRow tiles={orderedHeroTiles} loading={loading} />
              {isCardVisible('countries') && (
              <DimCard
                title="Top Countries"
                icon={<GlobeIcon />}
                data={countryData}
                loading={loading}
                primaryPeriod={primaryPeriod}
                showDeltas={showChanges && showCardDetails('countries')}
                variant="countries"
                isCustom={isCustom}
                className="dp-card--wide"
                split
                topVisual={<CountryMap rows={countryMapRows} loading={loading} />}
                style={{ order: audienceOrder.get('countries') ?? 0 }}
              />
              )}
            <div className="dp-grid">
              {isCardVisible('trafficSource') && (
              <div className="dp-card" style={{ order: audienceOrder.get('trafficSource') ?? 0 }}>
                <div className="dp-card-head">
                  <span className="dp-card-icon"><TrafficIcon /></span>
                  <span className="dp-card-title">Traffic Source</span>
                </div>
                <AudiencePieCard
                  data={trafficData}
                  totalForOther={trafficTotal}
                  legendValue={(row) => `${row.pct.toFixed(1)}%`}
                  loading={loading}
                  primaryPeriod={primaryPeriod}
                  showDeltas={showChanges && showCardDetails('trafficSource')}
                  isCustom={isCustom}
                  sliceLimit={6}
                />
              </div>
              )}
              {isCardVisible('deviceType') && (
              <div className="dp-card" style={{ order: audienceOrder.get('deviceType') ?? 0 }}>
                <div className="dp-card-head">
                  <span className="dp-card-icon"><DeviceIcon /></span>
                  <span className="dp-card-title">Device Type</span>
                </div>
                <AudiencePieCard
                  data={deviceData}
                  legendValue={(row) => `${row.views.toFixed(1)}%`}
                  loading={loading}
                  primaryPeriod={primaryPeriod}
                  showDeltas={showChanges && showCardDetails('deviceType')}
                  isCustom={isCustom}
                />
              </div>
              )}
              {isCardVisible('ageGroup') && (
              <div className="dp-card" style={{ order: audienceOrder.get('ageGroup') ?? 0 }}>
                <div className="dp-card-head">
                  <span className="dp-card-icon"><AgeIcon /></span>
                  <span className="dp-card-title">Age Group</span>
                </div>
                <AudiencePieCard
                  data={ageData}
                  legendValue={(row) => `${row.views.toFixed(1)}%`}
                  loading={loading}
                  primaryPeriod={primaryPeriod}
                  showDeltas={showChanges && showCardDetails('ageGroup')}
                  isCustom={isCustom}
                />
              </div>
              )}
              {isCardVisible('subscriberStatus') && (
              <div className="dp-card" style={{ order: audienceOrder.get('subscriberStatus') ?? 0 }}>
                <div className="dp-card-head">
                  <span className="dp-card-icon"><SubIcon /></span>
                  <span className="dp-card-title">Subscriber Status</span>
                </div>
                <AudiencePieCard
                  data={subData}
                  totalForOther={subsTotal}
                  legendValue={(row) => `${row.pct.toFixed(1)}%`}
                  loading={loading}
                  primaryPeriod={primaryPeriod}
                  showDeltas={showChanges && showCardDetails('subscriberStatus')}
                  isCustom={isCustom}
                />
              </div>
              )}
              {isCardVisible('gender') && (
              <div className="dp-card" style={{ order: audienceOrder.get('gender') ?? 0 }}>
                <div className="dp-card-head">
                  <span className="dp-card-icon"><GenderIcon /></span>
                  <span className="dp-card-title">Gender</span>
                </div>
                <AudiencePieCard
                  data={genderData}
                  legendValue={(row) => `${row.views.toFixed(1)}%`}
                  loading={loading}
                  primaryPeriod={primaryPeriod}
                  showDeltas={showChanges && showCardDetails('gender')}
                  isCustom={isCustom}
                />
              </div>
              )}
            </div>
            </>
          )}
        </div>
      </div>
    );
  },
);

DimensionsPanel.displayName = "DimensionsPanel";

const TrafficIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="16"
    height="16"
  >
    <circle cx="12" cy="12" r="10" />
    <path d="M12 8l4 4-4 4M8 12h8" />
  </svg>
);
const DeviceIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="16"
    height="16"
  >
    <rect x="5" y="2" width="14" height="20" rx="2" />
    <line x1="12" y1="18" x2="12.01" y2="18" />
  </svg>
);
const SubIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="16"
    height="16"
  >
    <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2" />
    <circle cx="9" cy="7" r="4" />
    <path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75" />
  </svg>
);
const GenderIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="16"
    height="16"
  >
    <circle cx="12" cy="11" r="4" />
    <path d="M12 15v6M9 18h6M16 6l2-2m0 0l2-2m-2 2l-2-2m2 2l2 2" />
  </svg>
);
const AgeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="16"
    height="16"
  >
    <path d="M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2" />
    <circle cx="12" cy="7" r="4" />
  </svg>
);
const GlobeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    width="16"
    height="16"
  >
    <circle cx="12" cy="12" r="10" />
    <line x1="2" y1="12" x2="22" y2="12" />
    <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
  </svg>
);
