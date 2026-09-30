## Dashboard UI Components

Relevant source files

-   [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx)
-   [frontend/src/components/DimensionsPanel.tsx](../../frontend/src/components/DimensionsPanel.tsx)
-   [frontend/src/components/SkeletonLoaders.tsx](../../frontend/src/components/SkeletonLoaders.tsx)
-   [frontend/src/components/VideoTable.tsx](../../frontend/src/components/VideoTable.tsx)
-   [frontend/src/components/dashboard/AudienceBreakdownPanel.tsx](../../frontend/src/components/dashboard/AudienceBreakdownPanel.tsx)
-   [frontend/src/components/dashboard/DashboardLoadToolbar.tsx](../../frontend/src/components/dashboard/DashboardLoadToolbar.tsx)
-   [frontend/src/components/dashboard/InsightsPanel.tsx](../../frontend/src/components/dashboard/InsightsPanel.tsx)
-   [frontend/src/components/dashboard/InsightsPanel.css](../../frontend/src/components/dashboard/InsightsPanel.css)
-   [frontend/src/components/dashboard/PlaylistTable.tsx](../../frontend/src/components/dashboard/PlaylistTable.tsx)
-   [frontend/src/components/dashboard/VideoAnalyticsChart.tsx](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)
-   [frontend/src/components/dashboard/VideoFiltersBar.tsx](../../frontend/src/components/dashboard/VideoFiltersBar.tsx)
-   [frontend/src/pages/DashboardPage.css](../../frontend/src/pages/dashboard/DashboardPage.css)
-   [frontend/src/pages/DashboardPage.tsx](../../frontend/src/pages/dashboard/DashboardPage.tsx)

The dashboard UI layer is responsible for orchestrating complex analytics data visualizations, interactive data tables, and filtering controls. It leverages a modular architecture where `DashboardPage.tsx` acts as the primary controller, delegating specific UI concerns to specialized components and managing state via custom hooks and the Zustand `dashboardStore`.

## Dashboard Orchestration

`DashboardPage` serves as the root container for the analytics experience. It integrates authentication, organization context, and the dashboard state machine to render a responsive layout.

### Data Flow & Component Hierarchy

The dashboard uses a "top-down" data flow where the `DashboardPage` fetches core data bundles (videos, playlists, analytics) and distributes them to sub-components.

Title: Dashboard UI Component Hierarchy

Sources: [frontend/src/pages/DashboardPage.tsx#87-185](../../frontend/src/pages/dashboard/DashboardPage.tsx) [frontend/src/pages/DashboardPage.tsx#273-310](../../frontend/src/pages/dashboard/DashboardPage.tsx)

### Dashboard Navigation Tabs

The dashboard header includes a tab navigation (`analytics-tabs` nav) with five tabs: **Channel**, **Playlists**, **Videos**, **Audience**, and **Insights**. Each tab is rendered as a `<button role="tab">` with `aria-selected` and an `active` class applied when the `activeTab` state matches. The Insights tab (5th tab) triggers `switchTabMeasured("insights")` on click and is enabled when `activeTab === "insights"`.

Sources: [frontend/src/pages/DashboardPage.tsx#1887-1937](../../frontend/src/pages/dashboard/DashboardPage.tsx)

## Primary Analytics Components

### VideoAnalyticsChart (The "SEO Widget")

This component implements the high-level performance overview. It features a "pill" based metric selector that allows users to toggle between Views, Watch Time, Retention, and CTR [frontend/src/components/dashboard/VideoAnalyticsChart.tsx#145-218](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)

-   Metric Switching: Uses `setActiveChart` to update the visual series [frontend/src/components/dashboard/VideoAnalyticsChart.tsx#35-36](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)
-   Pin to My Dashboard: The header carries a `PinToDashboardButton` that pins `video-performance` on the Videos tab and `playlist-performance` on the Playlists tab (same component serves both tabs via `activeTab`) [frontend/src/components/dashboard/VideoAnalyticsChart.tsx](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)
-   True Delta Mode: A specialized view that calculates non-overlapping changes (e.g., comparing 0-7 days vs 8-37 days) to show actual growth trends [frontend/src/components/dashboard/VideoAnalyticsChart.tsx#179-197](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)
-   Annotations: Renders vertical markers for significant events or video-specific anomalies [frontend/src/components/dashboard/VideoAnalyticsChart.tsx#159-168](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)

### Dimensions & Audience Panels

The `DimensionsPanel` and `AudienceBreakdownPanel` visualize demographic and traffic source data. They transform raw `AnalyticsReport` rows into categorized charts for traffic sources, device types, and geographic distribution [frontend/src/components/DimensionsPanel.tsx#18-64](../../frontend/src/components/DimensionsPanel.tsx)

-   Multi-Period Deltas: Displays percentage changes across 7, 30, and 90-day windows simultaneously [frontend/src/components/DimensionsPanel.tsx#114-129](../../frontend/src/components/DimensionsPanel.tsx)
-   Absolute Delta Calculation: For audience composition (like age or country), the system uses absolute point differences rather than relative percentages to prevent skewed insights on small baseline numbers [frontend/src/components/DimensionsPanel.tsx#180-190](../../frontend/src/components/DimensionsPanel.tsx)

Sources: [frontend/src/components/dashboard/VideoAnalyticsChart.tsx#7-77](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx) [frontend/src/components/DimensionsPanel.tsx#8-130](../../frontend/src/components/dashboard/AudienceBreakdownPanel.tsx#13-31](../frontend/src/components/dashboard/AudienceBreakdownPanel.tsx)

### InsightsPanel

The `InsightsPanel` is the 5th dashboard tab component that provides 3 analytics views: best time to post (DB-powered 24-hour composite score chart or YT API fallback), audience retention trend, and weekly day-of-week (YT API fallback only). It is rendered when `activeTab === "insights"`.

The component was redesigned to use the `dp-panel` ledger pattern for visual consistency with DashboardPage, Compare, and Channel tabs. Each section card now follows the `dp-panel` structure: a header with `border-bottom` + body area, replacing the previous standalone card layout. All CSS units have been migrated to `--rt-*` design tokens.

Sources: [frontend/src/components/dashboard/InsightsPanel.tsx](../../frontend/src/components/dashboard/InsightsPanel.tsx) [frontend/src/components/dashboard/InsightsPanel.css](../../frontend/src/components/dashboard/InsightsPanel.css) [frontend/src/pages/DashboardPage.tsx](../../frontend/src/pages/dashboard/DashboardPage.tsx)

#### Props

| Prop | Type | Description |
|---|---|---|
| `insightsData` | `{ bestTimeToPost: BestTimeToPostData \| null; bestTimeToPostV2: BestTimeToPostV2Data \| null; retention: RetentionByHourData \| null; retentionByPublishHour: RetentionByPublishHourData \| null } \| null` | The insight data sub-objects, or null when no data is available |
| `loading` | `boolean` | Whether the insights query is still loading |
| `formattedLatestDate` | `string \| null` | Human-readable latest data date label, e.g. "Jul 5, 2026" |
| `channelTitle` | `string` | Current channel display name |
| `insightsTimezone` | `string` | IANA timezone string (e.g. `"America/New_York"`) — passed to sub-components for timezone-aware display |
| `insightsSegment` | `"all" \| "shorts" \| "long"` | Active content segment filter — controls which videos are included in the analysis |

Sources: [frontend/src/components/dashboard/InsightsPanel.tsx#1660-1720](../../frontend/src/components/dashboard/InsightsPanel.tsx)

#### Section 1 — V2 Hourly Best Time to Post (DB-powered, primary)

- **Data source**: `insightsData.bestTimeToPostV2` (type `BestTimeToPostV2Data`)
- **Algorithm**: Rolling median normalization (W=10), winsorized z-score composite (`0.6×views_z + 0.4×like_rate_z`), empirical-Bayes shrinkage (k=4), bootstrap 95% CI (2000 resamples), Kruskal-Wallis significance. All computed from Postgres `analytics_videos` table — zero YT API quota.
- **Chart type**: BarChart showing `shrunkScore` by publish hour (0-23) or by daypart (6 segments), bar-colored by confidence tier
- **Daypart toggle**: A toggle switch in the section header lets users switch between **hourly** (24 bars, 1-hour slots) and **daypart** (6 bars: early morning, morning, afternoon, evening, prime, late night) views. Per-metric best labels and the recommendation pill ("Best hour:" / "Best time:") update reactively based on the active view mode.
- **X-axis**: Hourly mode — 24 hour labels (`"12AM", "1AM", ..., "11PM"`) at interval 2. Daypart mode — 6 part-of-day labels at interval 0.
- **Bar coloring**: High confidence = green (`#059669`), Medium = indigo (`#6366f1`), Exploratory = gold (`#ca8a04`)
- **Tooltip**: Shows composite score, video count, confidence tier, and bootstrap CI range `[lower, upper]`
- **Stats row**: Best hour/time (with composite score and timezone abbreviation), Best for views (label), Best for engagement (label), Best for comments (label), Videos analyzed, Long/Shorts breakdown, Significance p-value
- **Per-metric breakdown**: Three additional stat pills showing which slot performs best for each individual metric. **Empty buckets (`videoCount === 0`) are now skipped** — previously a zero-video slot with a median Z-score of 0 could falsely win over negative-score slots, producing misleading labels like `"00:00 (0.00)"`.
- **Timezone awareness**: The recommendation pill, stats row labels, and section description all show the IANA timezone abbreviation (e.g. `EST`, `WAT`) alongside best-slot names. When the selected timezone differs from the browser's local timezone, a `.insights-tz-note` note appears below the panel controls: `"Showing times in New York · Your timezone: Kathmandu"`.
- **Tier legend**: `.insight-tier-legend` with `TierBadge` components for High/Medium/Exploratory
- **Kruskal-Wallis footnote**: Rendered below chart as `.insight-kw-footnote` with `H`, `df`, `p`, and significance statement
- **Recommendation pill**: Shown when `isSignificant` is true
- **Confidence tiers**: High (n≥8, CI excludes global median, p<0.05), Medium (n≥4), Exploratory (<4)
- **Analytics period**: The analysis uses ALL ingested videos regardless of date range — the cache key intentionally omits `period` to prevent cache thrashing when switching between 7/30/90-day tabs.

#### Section 2 — YT API Fallback (when V2 unavailable)

When `bestTimeToPostV2` is null (e.g. channel has <10 videos in Postgres), two YT API-powered sections render instead:

**2a. Best Time to Post (24-hour retention curve)**
- **Data source**: `insightsData.retentionByPublishHour` (type `RetentionByPublishHourData`)
- **Chart type**: AreaChart with a smooth (monotone) curve of average watch time across 24 publish hours
- **X-axis**: 24-hour labels at 3-hour intervals: `"12AM", "3AM", "6AM", "9AM", "12PM", "3PM", "6PM", "9PM"`
- **Reference line**: Green dashed `ReferenceLine` at `bestHourLabel` with a label `"✦ Best: <hour>"`
- **Tooltip**: Custom `ChartTooltipContent` showing "Avg watch time" (minutes) and the video count for that hour as a sub-line
- **Recommendation pill**: A green pill in the section header showing `data.recommendation` text
- **Stats row**: Best hour (with peak watch time in parentheses), Peak watch time (minutes), Hours with data (count), Videos analyzed (total video count across all hours)

**2b. Weekly Performance (day-of-week)**
- **Data source**: `insightsData.bestTimeToPost` (type `BestTimeToPostData`); DB-powered V2 uses `insightsData.bestTimeToPostV2.dayOfWeek`
- **Chart type**: BarChart showing views by day of week (Sunday through Saturday)
- **Bar coloring**: The bar matching `bestDay` is colored green (`COLOR_POSITIVE`); all other bars are indigo (`COLOR_PRIMARY`)
- **Tooltip**: Shows "Views" (formatted with `toLocaleString`), and when available, a sub-line with `averageViewPercentage` and `subscribersGained`
- **Stats row**: Best day for views (highlighted, with timezone abbreviation), Best day for retention, Best day for subscribers, Period views
- **Timezone awareness**: V2 section description and best-day label include the IANA timezone abbreviation (e.g. `WAT`, `EST`), and the section receives the `timezone` prop for accurate display

#### Section 3 — Weekly Audience Activity (Day-of-Week with Engagement)

- **Data source**: `insightsData.dayOfWeek` (computed from `generateAudienceActiveTime` response in YT API mode)
- **Chart type**: Dual-axis BarChart + Line chart
- **Views (bars, left Y-axis)**: Shows total views per day of week (Sunday–Saturday), colored indigo (`COLOR_PRIMARY`).
- **Engagement (line, right Y-axis)**: Shows `totalEngagement = subscribersGained + likes + comments + shares` per day as a monotone line in cyan (`COLOR_SECONDARY`), with small dots at each data point. The right axis auto-scales independently so both metrics are visible regardless of magnitude differences.
- **Tooltip**: Shows full engagement breakdown (views, likes, comments, shares, subscribers gained) when hovering over either the bars or the engagement line.
- **Stats row**: Peak day label, total views, peak engagement value.

Previously this chart showed only views bars; engagement data was only visible via tooltip. The dual-axis approach makes both metrics independently readable at a glance.

#### Section 4 — Audience Retention

- **Data source**: `insightsData.retention` (type `RetentionByHourData`)
- **Chart type**: AreaChart showing daily view retention trend over time
- **Data shape**: Each point has `date` and `retention` (percentage). Missing retention values are tracked with a `_isNull` flag
- **Confidence band**: A ±12% band around the retention curve rendered via two stacked Area layers (`bandTop` and `bandBottom`) — the top band fills with a cyan gradient, the bottom band masks with the card background color to create the shaded corridor effect
- **Reference line**: Gold dashed `ReferenceLine` at the average retention value, labeled `"Avg X.X%"`
- **Normalize toggle**: A toggle switch (`insight-toggle`) in the section controls that scales all values to a 0-100 range based on the maximum retention. When normalized, the Y-axis domain becomes `[0, 105]` and values display as percentages.
- **Tooltip**: Shows "Retention" with a percentage value, formatted as `MM/DD` dates
- **Stats row**: Average Retention (%), Days with data (count), Peak retention (%)
- **Color identity**: Uses `COLOR_SECONDARY` (cyan/#0891b2) for the retention line, bands, and active dot

#### Rendering Priority

```
bestTimeToPostV2  →  HourlyAnalysisV2 (24-hour composite score OR 6-part daypart, per-metric breakdowns)
                            + WeeklyAnalysisV2 (DB-powered day-of-week, z-score colored)
        ↓ null
retentionByPublishHour + bestTimeToPost  →  BestTimeSection (24-hour retention curve) + WeeklyMetricsSection (day-of-week)
```

When V2 DB data is available, it **replaces** the YT API best-time sections entirely (both the 24-hour retention curve and the weekly day-of-week view). V2's `WeeklyAnalysisV2` renders day-of-week bar charts computed from the same DB model (per-metric z-scores with empty-bucket skip), while the YT API `WeeklyMetricsSection` only has raw view counts. The Audience Retention section always renders independently via `insightsData.retention`.

#### States

- **Loading**: Renders `InsightsSkeleton` — a 3-section skeleton grid with circular placeholders and card skeletons matching the 3-panel layout
- **Empty**: Renders `InsightsEmptyState` — an info icon with title "No insights data yet" and a message explaining that insights need at least 30 days of analytics data
- **Error fallback**: Not rendered directly; the parent `DashboardPage` handles errors via the `analytics.error` banner at the page level, and the Insights tab simply shows the empty state when data is null

#### Color Identity

| Token | Variable | Hex | Usage |
|---|---|---|---|
| `COLOR_PRIMARY` | `CHANNEL_CHART_COLORS.watchTime` | `#4f46e5` (indigo) | V2 hourly chart bars, watch time curve, bar chart |
| `COLOR_TIER_HIGH` | — | `#059669` (green) | High-confidence bar fill |
| `COLOR_TIER_MEDIUM` | — | `#6366f1` (indigo) | Medium-confidence bar fill |
| `COLOR_TIER_EXPLORATORY` | — | `#ca8a04` (gold) | Exploratory bar fill |
| `COLOR_REFERENCE` | `CHANNEL_CHART_COLORS.videosUploaded` | `#ca8a04` (gold) | Average retention reference line |
| `COLOR_SECONDARY` | `CHANNEL_CHART_COLORS.comments` | `#0891b2` (cyan) | Retention trend line, confidence band fill |

#### CSS Architecture

The stylesheet (`InsightsPanel.css`) follows the app's design token system (`--rt-*` CSS custom properties) and the `dp-panel` ledger pattern. Key class groups:

- `.insights-panel` — Grid layout container for the sections (single column, `var(--rt-space-5)` gap)
- `.insights-section` — Card wrapper using `dp-panel` tokens: `--rt-card-bg` background, `--rt-card-border`, `--rt-card-radius`, `--rt-card-shadow`
- `.insights-section__header` — `dp-panel-header`-style flexbox row with `min-height: var(--rt-panel-header-height)`, `padding: 0 var(--rt-space-5)`, and `border-bottom`
- `.insights-section__header-left` — Title + description column
- `.insights-section__controls` — Controls group header area (houses view toggle + recommendation pill)
- `.insight-stat-row` — Flexbox row of stat items with uppercase labels and tabular-nums values
- `.insight-toggle` / `.insight-toggle--on` — Mini toggle switch (32x18px) with sliding knob, used for the Normalize control and Daypart/Hourly toggle
- `.insight-view-label` — Small label on either side of the daypart toggle switch ("Hourly" / "Daypart")
- `.insight-pill--recommendation` — Rounded pill badge with accent color for the posting time recommendation
- `.insight-chart-wrap--area` / `.insight-chart-wrap--bar` — Chart wrapper with `min-height` (320px area, 280px bar)
- `.insight-tier-badge` / `.insight-tier-badge__dot` / `.insight-tier-legend` — Confidence tier legend styles
- `.insight-kw-footnote` — Muted Kruskal-Wallis p-value display
- `.insights-empty-state` — Centered flex column for the empty data state
- `.insights-skeleton-grid` — 3-section grid of skeleton placeholders
- `.rt-insights-header` — Extended `dp-panel-header` with `overflow: visible` to allow timezone dropdown to escape the card's `border-radius: overflow:hidden` clip
- `.rt-insights-controls-row` — Flexbox row wrapping the segment toggle, timezone selector, and version info in the main Insights panel header
- `.insights-tz-note` — Timezone discrepancy note shown when selected tz ≠ browser tz; uses `flex: 0 0 100%` to wrap to its own line below controls
- Responsive breakpoint at 768px reduces chart heights, font sizes, and switches controls to 100% width + left-aligned

#### Data Flow

1. `DashboardPage` calls `useInsightsTabQuery` when `activeTab === "insights"`, which POSTs to `POST /api/dashboard/tab/insights`
2. The query response (type `InsightsTabResponse`) contains:
   - `bestTimeToPostV2` (DB-powered, from PostgreSQL)
   - `bestTimeToPost` (YT API fallback day-of-week)
   - `retention` (30-day rolling retention trend)
   - `retentionByPublishHour` (YT API fallback hourly curve)
   - `audienceActive` (day-of-week breakdown with engagement — YT API)
   - `audienceActiveDb` (hourly view-velocity estimation — DB-powered)
3. The `useEffect` in `useInsightsTabQuery` writes the response into the Zustand store under `analytics.insightsData` and sets `loadingInsights` to false
4. `DashboardPage` reads `analytics.insightsData` and passes it as the `insightsData` prop to `InsightsPanel`, along with `analytics.loadingInsights` as the `loading` prop
5. `InsightsPanel` renders `HourlyAnalysisV2` when `bestTimeToPostV2` is present; otherwise falls back to `BestTimeSection` + `WeeklyMetricsSection` for YT API data
6. The `HourlyAnalysisV2` and `WeeklyAnalysisV2` sub-components now receive a `timezone` prop for timezone-aware display of best-slot labels and abbreviations
7. **Weekly Audience Activity** renders a dual-axis chart showing views (bars, left axis) and engagement (line, right axis). Engagement data comes from `generateAudienceActiveTime` (YT API) — the DB version (`audienceActiveDb`) returns a different shape (hourly estimation) and is not directly swappable.
8. **Audience Retention** respects the selected date range — when a custom date range is active, `retentionWindow` uses `{ startDate, endDate }` instead of clamping to 30 days.
9. **Cache note**: The `bestTimeToPost` V2 cache key omits the `period` parameter since the analysis uses ALL ingested videos regardless of date range. This prevents cache thrashing when users switch between 7/30/90-day tabs without changing the actual query scope. (`backend/services/insightsService.js`)

#### Audience Tab Switch Behavior

When the user switches to the **Audience** tab from another tab (e.g. Videos):
1. `useDashboardUI.ts` clears `selectedVideo`, `selectedVideoIds`, and `tableCheckedOverride` — this prevents stale `video==` filters from propagating to YT Analytics API calls and causing empty dimension responses.
2. `useDashboardSelection.ts` skips all-videos auto-fill when no saved list is active on the audience tab (avoids flooding YT API with unbounded channel-wide video IDs).
3. Saved-list scoping is preserved: when a saved list is active, `selectedVideoIds` are populated from `listScopedVideos` as normal.
4. For custom date ranges, a `dCustom` window is computed and threaded through `DimensionsPanel` → `DimCard` → `AudienceMetricDeltas` for correct pill display.

Sources: [frontend/src/hooks/queries/useInsightsTabQuery.ts](../../frontend/src/hooks/queries/useInsightsTabQuery.ts) [frontend/src/types/dashboard.ts](../../frontend/src/types/dashboard.ts)

## Data Tables & Selection

The dashboard provides two primary tabular views powered by `@tanstack/react-table` for high-performance sorting and virtualization.

### VideoTable & PlaylistTable

Both tables support complex filtering and selection logic used to scope the analytics charts.

Sources: [frontend/src/components/VideoTable.tsx#75-112](../../frontend/src/components/VideoTable.tsx) [frontend/src/components/dashboard/PlaylistTable.tsx#29-63](../../frontend/src/components/dashboard/PlaylistTable.tsx)

## Toolbar & Controls

### DashboardLoadToolbar

Provides the interface for fetching data from the YouTube API. It manages:

-   Content Filtering: Toggling between Shorts and Long-form content [frontend/src/components/dashboard/DashboardLoadToolbar.tsx#61-75](../../frontend/src/components/dashboard/DashboardLoadToolbar.tsx)
-   Load Limits: Preset options (10, 25, 50, 100) or a "Custom" input field that triggers a refetch via React Query [frontend/src/components/dashboard/DashboardLoadToolbar.tsx#81-135](../../frontend/src/components/dashboard/DashboardLoadToolbar.tsx)
-   Status Indication: Shows an "Updating..." state during active background fetches [frontend/src/components/dashboard/DashboardLoadToolbar.tsx#136](../../frontend/src/components/dashboard/DashboardLoadToolbar.tsx)

### DateRangeSelector

A unified component for selecting the analytics window. It supports:

-   Relative Ranges: 7, 30, 90 days, or "Last Month".
-   Custom Picker: Uses `dayjs` for precise start/end date selection.
-   Integration: Informs the `useAnalyticsQuery` hook to invalidate and refetch data for the new period.

Sources: [frontend/src/components/dashboard/DashboardLoadToolbar.tsx#20-49](../../frontend/src/components/dashboard/DashboardLoadToolbar.tsx) [frontend/src/pages/DashboardPage.tsx#69](../../frontend/src/pages/dashboard/DashboardPage.tsx)

## Loading States

The dashboard utilizes a "Skeleton" pattern to maintain layout stability during data fetching.

-   SkeletonDashboardShell: The top-level wrapper used during initial hydration [frontend/src/pages/DashboardPage.tsx#65](../../frontend/src/pages/dashboard/DashboardPage.tsx)
-   SkeletonSeoMetricPills: Mimics the 4-pill metric selector in the `VideoAnalyticsChart` [frontend/src/components/SkeletonLoaders.tsx#38-101](../../frontend/src/components/SkeletonLoaders.tsx)
-   SkeletonDimensionsPanel: Renders placeholder cards for demographic data [frontend/src/components/SkeletonLoaders.tsx#182-195](../../frontend/src/components/SkeletonLoaders.tsx)
-   InsightsSkeleton: A 3-section skeleton grid with circular placeholders and card skeletons matching the 3-panel layout of the Insights tab. Each skeleton section uses the `Skeleton` base component with `type="title"`, `type="text"`, and `type="card"` shapes. [frontend/src/components/dashboard/InsightsPanel.tsx#658-710](../../frontend/src/components/dashboard/InsightsPanel.tsx)

Title: Skeleton State to Entity Mapping

Sources: [frontend/src/components/SkeletonLoaders.tsx#1-40](../../frontend/src/components/SkeletonLoaders.tsx) [frontend/src/components/dashboard/VideoAnalyticsChart.tsx#215-218](../../frontend/src/components/dashboard/VideoAnalyticsChart.tsx)
