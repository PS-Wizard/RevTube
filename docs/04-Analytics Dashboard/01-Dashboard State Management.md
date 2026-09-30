## Dashboard State Management

Relevant source files

-   [README.md](../README.md)
-   [PROJECT_GUIDE](../20-Reference/Legacy Project Guide)
-   [frontend/src/hooks/useDashboardFilters.ts](../../frontend/src/hooks/useDashboardFilters.ts)
-   [frontend/src/hooks/useDashboardState.ts](../../frontend/src/hooks/useDashboardState.ts)
-   [frontend/src/hooks/useDashboardUI.ts](../../frontend/src/hooks/useDashboardUI.ts)
-   [frontend/src/machines/dashboardMachine.ts](../../frontend/src/machines/dashboardMachine.ts)
-   [frontend/src/stores/dashboardSelectors.ts](../../frontend/src/stores/dashboardSelectors.ts)
-   [frontend/src/stores/dashboardStore.ts](../../frontend/src/stores/dashboardStore.ts)
-   [frontend/src/types/dashboard.ts](../../frontend/src/types/dashboard.ts)
-   [frontend/src/types/youtube.ts](../../frontend/src/types/youtube.ts)

The RevTube dashboard utilizes a hybrid state management architecture to handle complex analytical data, multi-tab navigation, and intricate filtering logic. The system has migrated from a monolithic `useState` approach in `useDashboardState` to a modular architecture powered by Zustand for global UI state and XState for robust tab transition logic [frontend/src/stores/dashboardStore.ts#1-9](../../frontend/src/stores/dashboardStore.ts)

## Modular State Architecture

The core of the dashboard state resides in the `useDashboardStore`, a Zustand store configured with `immer` for immutable updates to nested state trees and `devtools` for debugging [frontend/src/stores/dashboardStore.ts#186-189](../../frontend/src/stores/dashboardStore.ts)

### Dashboard State Slices

The state is partitioned into logical slices to maintain separation of concerns:

| Slice | Responsibility | Key Entities |
| --- | --- | --- |
| Channel | Manages channel lists and current selection. | `selectedChannel`, `orgTokenMap` |
| Videos | Stores video metadata and loading states. | `videos`, `loadingVideos` |
| Analytics | High-frequency analytical reports, metrics, and insights data. | `reportData`, `multiPeriodStats`, `videoAnomalyInsights`, `insightsData` |
| Filters | UI search and filtering criteria. | `searchQuery`, `videoTypeFilter` |
| Selection | Tracks user-selected items across tables. | `selectedVideoIds`, `tableCheckedOverride` |
| UI | General interface configuration and active tab. | `activeTab` (includes `'insights'`), `activeChart`, `showAnnotations` |
| DateRange | Temporal scoping for analytics. | `period`, `customStartDate`, `latestDataDate` |

Sources: [frontend/src/stores/dashboardStore.ts#67-180](../../frontend/src/stores/dashboardStore.ts) [frontend/src/types/dashboard.ts#240-260](../../frontend/src/types/dashboard.ts)

### Analytics State

The `AnalyticsState` type in [frontend/src/types/dashboard.ts#145-178](../../frontend/src/types/dashboard.ts) consolidates all analytical report data. Alongside existing fields for reports, multi-period stats, and video anomaly insights, the state now includes two fields specific to the Insights tab:

- **`insightsData: InsightsData | null`** -- Holds the aggregated insights payload (best time to post, daily retention, and retention by publish hour) returned by the `/api/dashboard/tab/insights` endpoint. Initialized as `null` in the store.
- **`loadingInsights: boolean`** -- Indicates whether the insights endpoint request is in-flight. Initialized as `false` in the store.

These fields live inside the `analytics` slice alongside the loading/fetching flags for other tabs:

```typescript
// AnalyticsState excerpt showing the new fields
export interface AnalyticsState {
  reportData: AnalyticsReport | null;
  prevReportData: AnalyticsReport | null;
  // ... other report and stats fields ...
  insightsData: InsightsData | null;
  loading: boolean;
  loadingMultiPeriod: boolean;
  loadingInsights: boolean;
  // ...
}
```

Sources: [frontend/src/types/dashboard.ts#145-178](../../frontend/src/types/dashboard.ts) [frontend/src/stores/dashboardStore.ts#92-116](../../frontend/src/stores/dashboardStore.ts)

### Insights Model Types

The Insights tab aggregates three distinct data views, each with its own model defined in [frontend/src/types/dashboard.ts](../../frontend/src/types/dashboard.ts):

**`DayStat`** -- Represents a single day-of-week aggregation used by the best-time-to-post analysis:
- `day: number` -- Numeric day index (0 = Sunday through 6 = Saturday).
- `label: string` -- Human-readable day label (e.g. `"Sunday"`).
- `views: number` -- Total views for that day.
- `averageViewPercentage`, `subscribersGained`, `likes`, `comments`, `shares` -- Optional metrics per day.

**`BestTimeToPostData`** -- Wraps the best-time-to-post recommendation:
- `bestDay`, `bestDayLabel` -- The single best day for posting.
- `bestRetentionDay`, `bestRetentionDayLabel` -- The day with highest retention (optional).
- `bestSubscriberDay`, `bestSubscriberDayLabel` -- The day with highest subscriber gain (optional).
- `dailyStats: DayStat[]` -- Full array of day-of-week stats.
- `recommendation: string` -- Human-readable recommendation string.

**`DailyRetentionPoint`** -- One data point in a retention-over-time series:
- `date: string` -- ISO date string.
- `retention: number | null` -- Average retention percentage for that date (may be null if data is missing).

**`DayRetentionStat`** -- Day-of-week retention aggregation:
- `day: number` -- Day index (0-6).
- `label: string` -- Day label.
- `avgRetention: number` -- Average retention percentage for that day.

**`HourRetentionStat`** -- Per-hour retention aggregation:
- `hour: number` -- Hour index (0-23).
- `label: string` -- Clock label (e.g. `"12AM"`, `"1AM"`, ..., `"11PM"`).
- `avgRetention: number` -- Average retention percentage for that hour.
- `videoCount: number` -- Number of videos contributing to the average.

**`RetentionByHourData`** -- Retention trend over a date range:
- `dailyRetention: DailyRetentionPoint[]` -- Daily retention time series.
- `averageRetention: number` -- Overall average retention across the period.

**`RetentionByPublishHourData`** -- Optimal publish hour analysis:
- `retentionByHour: HourRetentionStat[]` -- Retention broken down by hour of day.
- `bestHour: number`, `bestHourLabel: string` -- The single best hour for publishing.
- `bestHourRetention: number` -- The retention value at the best hour.
- `recommendation: string` -- Human-readable recommendation.

**`InsightsData`** -- Top-level aggregate that groups all views:
- `bestTimeToPost: BestTimeToPostData | null` — YT API-powered day-of-week analysis (legacy fallback)
- `bestTimeToPostV2: BestTimeToPostV2Data | null` — DB-powered hourly + day-of-week analysis (primary, from Postgres)
- `retention: RetentionByHourData | null`
- `retentionByPublishHour: RetentionByPublishHourData | null`

**`HourStatV2`** (DB-powered) — Per-hour bucket statistics:
- `hour: number` — Hour index (0-23).
- `label: string` — Clock label (`"12AM"`, `"1AM"`, ..., `"11PM"`).
- `medianComposite: number` — Median of composite scores (0.6×viewsZ + 0.4×likeRateZ).
- `shrunkScore: number` — Empirical-Bayes shrunken version (pulls low-N buckets toward global median).
- `confidenceTier: ConfidenceTier` — `'High' | 'Medium' | 'Exploratory'`.
- `ciLower`, `ciUpper: number | null` — Bootstrap 95% confidence interval bounds.
- `videoCount: number` — Videos in this hour bucket.
- `medianViewsZ: number` — Median winsorized z-score of normalized views (used for "Best for views").
- `medianEngagementZ: number` — Median winsorized z-score of like-rate (used for "Best for engagement").
- `medianCommentsZ: number` — Median winsorized z-score of comment-rate (used for "Best for comments" proxy).

**`DayOfWeekStatV2`** (DB-powered) — Same structure as HourStatV2, bucketed by day-of-week.

**`DaypartStat`** (DB-powered) — Same structure as HourStatV2, bucketed into 4 parts:
- Night (0-6), Morning (6-12), Afternoon (12-18), Evening (18-24) — UTC.

**`BestTimeToPostV2Data`** (DB-powered, added Jul 2026) — Replaces the YT API-based best-time analysis when sufficient video data exists in Postgres:
- `hourly: HourStatV2[]` — 24-hour bucket array (primary analysis).
- `dayOfWeek: DayOfWeekStatV2[]` — 7-day bucket with `medianComposite`, `shrunkScore`, `confidenceTier`, bootstrap CI.
- `daypart: DaypartStat[]` — 4-part buckets (Morning/Afternoon/Evening/Night) with same stats.
- `dayDaypartGrid: DayDaypartCell[]` — 7×4 heatmap cells (only when ≥150 videos).
- `globalMedianCompositeScore: number` — Channel-wide baseline for shrinkage.
- `kruskalWallis: { H, df, p }` — Statistical significance test across day-of-week groups.
- `bestHour`, `bestHourLabel`, `bestHourScore` — Best hour by composite score.
- `bestHourForViews`, `bestHourForViewsLabel` — Hour with highest median normalized-views z-score.
- `bestHourForEngagement`, `bestHourForEngagementLabel` — Hour with highest median like-rate z-score.
- `bestHourForComments`, `bestHourForCommentsLabel` — Hour with highest median comment-rate z-score.
- `bestDayOfWeek`, `bestDayOfWeekLabel`, `bestDayOfWeekScore`.
- `bestDaypart`, `bestDaypartLabel`, `bestDaypartScore`.
- `totalVideosAnalyzed`, `shortsCount`, `longCount`.
- `isSignificant: boolean` — Whether Kruskal-Wallis p < 0.05.

**Per-metric best hours**: Three individual z-score metrics are tracked per hour bucket:
- **viewsZ** — Normalized views (rolling median) → winsorized z-score. Identifies hours with strongest view performance.
- **engagementZ** — Like-rate (likes/views) → winsorized z-score. Identifies hours with strongest engagement.
- **commentsZ** — Comment-rate (comments/views) → winsorized z-score. Proxy metric since per-video subscriber and retention data is not stored in `analytics_videos`.

**Confidence tiers** (per slot):
- **High** (n≥8, CI excludes global median, p<0.05)
- **Medium** (n≥4)
- **Exploratory** (n<4)

### UI State -- Tab Type

The `DashboardTab` union type includes `'insights'` alongside the four original tabs:

```typescript
export type DashboardTab = 'videoAnalytics' | 'channelAnalytics' | 'audience' | 'playlistAnalytics' | 'insights';
```

The `getInitialActiveTab()` helper in the store initializes the active tab from `localStorage` and validates that the stored value is one of these five values; it falls back to `"channelAnalytics"` if no valid saved tab is found. [frontend/src/stores/dashboardStore.ts#29-45](../../frontend/src/stores/dashboardStore.ts)

### State Interaction Diagram

The following diagram illustrates how different code entities interact with the `dashboardStore`.

Sources: [frontend/src/stores/dashboardStore.ts#186-190](../../frontend/src/stores/dashboardStore.ts) [frontend/src/machines/dashboardMachine.ts#31-40](../../frontend/src/machines/dashboardMachine.ts) [frontend/src/hooks/useDashboardUI.ts#10-15](../../frontend/src/hooks/useDashboardUI.ts)

## XState Tab Machine

The `dashboardMachine` manages the lifecycle of tab transitions, ensuring that data loading triggers correctly and error states are handled predictably [frontend/src/machines/dashboardMachine.ts#31-33](../../frontend/src/machines/dashboardMachine.ts)

### Machine States and Transitions

-   `idle`: The starting state before any navigation [frontend/src/machines/dashboardMachine.ts#41](../../frontend/src/machines/dashboardMachine.ts)
-   `switchingTab`: Intermediate state that determines if the target tab requires a data fetch [frontend/src/machines/dashboardMachine.ts#55-60](../../frontend/src/machines/dashboardMachine.ts)
-   `loading`: Active state when `AnalyticsService` calls are in-flight [frontend/src/machines/dashboardMachine.ts#71](../../frontend/src/machines/dashboardMachine.ts)
-   `success`: Reached after `DATA_LOADED` event is received [frontend/src/machines/dashboardMachine.ts#92](../../frontend/src/machines/dashboardMachine.ts)
-   `error`: Handles `DATA_ERROR` with a built-in `retryCount` logic (max 3 retries) [frontend/src/machines/dashboardMachine.ts#107-111](../../frontend/src/machines/dashboardMachine.ts)

Sources: [frontend/src/machines/dashboardMachine.ts#31-131](../../frontend/src/machines/dashboardMachine.ts)

## Accessor Hooks (Selectors)

To minimize re-renders and provide a clean API to components, the system uses specialized hooks that select specific slices of the Zustand store.

### useDashboardUI

Consolidates interface-related state and actions.

-   Functions: `switchTab`, `switchChart`, `changePeriod` [frontend/src/hooks/useDashboardUI.ts#52-76](../../frontend/src/hooks/useDashboardUI.ts)
-   Persistence: Tab and Chart selections are persisted to `localStorage` during initialization [frontend/src/stores/dashboardStore.ts#27-65](../../frontend/src/stores/dashboardStore.ts)

### useDashboardFilters

Manages video and playlist filtering logic.

-   Logic: Handles `videoLimit` (mode: 10, 25, 'all', or 'custom') and persists these settings per channel ID [frontend/src/hooks/useDashboardFilters.ts#25-43](../../frontend/src/hooks/useDashboardFilters.ts)
-   Sync: Includes `loadVideoLimitForChannel` to hydrate limits from `localStorage` when switching channels [frontend/src/hooks/useDashboardFilters.ts#66-87](../../frontend/src/hooks/useDashboardFilters.ts)

### useDashboardStore Selectors

Memoized selectors in `dashboardSelectors.ts` perform client-side computation on raw state:

-   `useFilteredVideos`: Applies search queries and type filters to the video list [frontend/src/stores/dashboardSelectors.ts#85-100](../../frontend/src/stores/dashboardSelectors.ts)
-   `useListScopedVideos`: Intersects the global video list with IDs from active Saved Lists [frontend/src/stores/dashboardSelectors.ts#35-43](../../frontend/src/stores/dashboardSelectors.ts)
-   `useVideoTableRows`: Formats video data for display, toggling between `periodViewCount` and `viewCount` based on `showAllTimeViews` [frontend/src/stores/dashboardSelectors.ts#121-133](../../frontend/src/stores/dashboardSelectors.ts)

Sources: [frontend/src/hooks/useDashboardUI.ts#10-164](../../frontend/src/hooks/useDashboardUI.ts) [frontend/src/hooks/useDashboardFilters.ts#10-129](../../frontend/src/hooks/useDashboardFilters.ts) [frontend/src/stores/dashboardSelectors.ts#1-220](../../frontend/src/stores/dashboardSelectors.ts)

## Data Flow: Channel Switching

When a user selects a new channel, a multi-step hydration and fetch process is triggered.

Sources: [frontend/src/stores/dashboardStore.ts#201-214](../../frontend/src/stores/dashboardStore.ts) [frontend/src/hooks/useDashboardFilters.ts#66-80](../../frontend/src/hooks/useDashboardFilters.ts) [PROJECT_GUIDE#67-76](../20-Reference/Legacy Project Guide)

## Migration from useDashboardState

The system previously relied on a monolithic `useDashboardState` hook [frontend/src/hooks/useDashboardState.ts#6](../../frontend/src/hooks/useDashboardState.ts) This hook managed over 40 individual `useState` and `useRef` variables [frontend/src/hooks/useDashboardState.ts#7-150](../../frontend/src/hooks/useDashboardState.ts)

The migration to `dashboardStore` (Zustand) and `dashboardMachine` (XState) solved several architectural issues:

1.  Prop Drilling: State no longer needs to be passed through multiple component layers.
2.  Sync Issues: `selectedChannelRef` was previously used to bypass stale closures in callbacks [frontend/src/hooks/useDashboardState.ts#24](../../frontend/src/hooks/useDashboardState.ts); Zustand's `getState()` provides a native solution for this.
3.  Consistency: Logic for `videoLimit` persistence is now centralized in `useDashboardFilters` rather than duplicated across components [frontend/src/hooks/useDashboardFilters.ts#25-33](../../frontend/src/hooks/useDashboardFilters.ts)

Sources: [frontend/src/hooks/useDashboardState.ts#1-155](../../frontend/src/hooks/useDashboardState.ts) [frontend/src/stores/dashboardStore.ts#1-9](../../frontend/src/stores/dashboardStore.ts)
