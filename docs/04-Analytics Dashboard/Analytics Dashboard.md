## Analytics Dashboard

Relevant source files

-   [README.md](../README.md)
-   [PROJECT_GUIDE](../20-Reference/Legacy Project Guide)
-   [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx)
-   [frontend/src/machines/dashboardMachine.ts](../../frontend/src/machines/dashboardMachine.ts)
-   [frontend/src/pages/DashboardPage.tsx](../../frontend/src/pages/dashboard/DashboardPage.tsx)

The Analytics Dashboard is the primary interface for channel performance analysis in RevTube. It orchestrates complex data flows between the YouTube Analytics API, PostgreSQL read models, and a modular frontend state architecture. The dashboard provides high-level channel insights, granular video metrics, and comparative audience data through a tabbed interface managed by a formal state machine.

### Core Architecture

The dashboard is built on a "PostgreSQL-first" strategy, where the backend prioritizes materialized views and daily ingestion tables over live API calls to ensure high performance and historical depth [PROJECT_GUIDE#76-77](../20-Reference/Legacy Project Guide) The frontend utilizes a multi-layered state approach, combining Zustand for persistent UI state and XState for complex view transitions.

#### Dashboard Logic Flow

The following diagram illustrates the relationship between UI components, state managers, and the data fetching layer.

Dashboard Component-State-Data Bridge

Sources: [frontend/src/pages/DashboardPage.tsx#15-32](../../frontend/src/pages/dashboard/DashboardPage.tsx) [frontend/src/machines/dashboardMachine.ts#31-40](../../frontend/src/machines/dashboardMachine.ts) [PROJECT_GUIDE#11-19](../20-Reference/Legacy Project Guide)

___

### [Dashboard State Management](01-Dashboard State Management.md)

State is partitioned into modular slices within the `dashboardStore`. This includes channel metadata, video filters, UI toggles (e.g., `trueDeltaEnabled`), and modal visibility [frontend/src/pages/DashboardPage.tsx#158-182](../../frontend/src/pages/dashboard/DashboardPage.tsx)

Navigation between tabs (Channel, Videos, Audience, Playlists) is governed by the `dashboardMachine`, an XState implementation that prevents invalid loading states and handles automatic data re-fetching upon tab switches [frontend/src/machines/dashboardMachine.ts#55-69](../../frontend/src/machines/dashboardMachine.ts)

For details, see [Dashboard State Management](01-Dashboard State Management.md).

___

### [Channel Selection & Workspace Scoping](02-Channel Selection & Workspace Scoping.md)

The dashboard operates within a "Workspace" context, which can be personal or organizational [frontend/src/pages/DashboardPage.tsx#100-107](../../frontend/src/pages/dashboard/DashboardPage.tsx)

Channels are aggregated from all available tokens, and the `getEffectiveToken` utility ensures the correct OAuth credentials (either the user's own or the organization's) are used for API requests [frontend/src/pages/DashboardPage.tsx#121-145](../../frontend/src/pages/dashboard/DashboardPage.tsx) Selection state is hydrated from `localStorage` and scoped by a unique workspace key to maintain context across sessions [frontend/src/pages/DashboardPage.tsx#57-58](../../frontend/src/pages/dashboard/DashboardPage.tsx)

For details, see [Channel Selection & Workspace Scoping](02-Channel Selection & Workspace Scoping.md).

___

### [Analytics Data Fetching & Query Hooks](03-Analytics Data Fetching & Query Hooks.md)

Data fetching is managed by specialized TanStack Query hooks. The primary hook, `useAnalyticsQuery`, fetches a "Dashboard Bundle"—a consolidated JSON object containing time-series data for multiple metrics (Views, Subs, Watch Time) across various periods (d7, d30, d90) [frontend/src/pages/DashboardPage.tsx#27-28](../../frontend/src/pages/dashboard/DashboardPage.tsx)

The backend `AnalyticsService` processes these requests by either querying the `analytics_video_metrics_daily` table or proxying to the YouTube Analytics API [PROJECT_GUIDE#144-145](../20-Reference/Legacy Project Guide)

For details, see [Analytics Data Fetching & Query Hooks](03-Analytics Data Fetching & Query Hooks.md).

___

### [Video & Playlist Data Management](04-Video & Playlist Data Management.md)

The dashboard provides deep-dive capabilities for individual videos and playlists. `useDashboardVideos` handles metadata enrichment, while `useDashboardSelection` manages complex multi-select states across tables [frontend/src/pages/DashboardPage.tsx#148-156](../../frontend/src/pages/dashboard/DashboardPage.tsx)

A specialized "Saved Lists" system allows users to create arbitrary groupings of videos or playlists, which then scope the analytics charts and tables to just those entities [frontend/src/pages/DashboardPage.tsx#73-77](../../frontend/src/pages/dashboard/DashboardPage.tsx)

For details, see [Video & Playlist Data Management](04-Video & Playlist Data Management.md).

___

### [Dashboard UI Components](05-Dashboard UI Components.md)

The UI is a composition of specialized widgets:

-   VideoAnalyticsChart: An ECharts-based multi-series visualizer supporting annotations and "True Delta" (percentage change) modes [frontend/src/pages/DashboardPage.tsx#71-72](../../frontend/src/pages/dashboard/DashboardPage.tsx). Its header pin adds the chart to [My Dashboard](../18-Custom%20Dashboards/Custom%20Dashboards.md) (`video-performance` on Videos, `playlist-performance` on Playlists).
-   VideoTable: A high-performance grid for exploring video-level metrics with CSV/PDF export capabilities [frontend/src/pages/DashboardPage.tsx#76-78](../../frontend/src/pages/dashboard/DashboardPage.tsx)
-   AudienceBreakdownPanel: Displays demographic and geographic dimensions [frontend/src/pages/DashboardPage.tsx#75](../../frontend/src/pages/dashboard/DashboardPage.tsx)
-   DashboardLoadToolbar: Centralizes date range selection and data refresh triggers [frontend/src/pages/DashboardPage.tsx#74](../../frontend/src/pages/dashboard/DashboardPage.tsx)

For details, see [Dashboard UI Components](05-Dashboard UI Components.md).

___

### Data Flow Mapping

The following table maps natural language features to their primary code implementations.

Sources: [frontend/src/pages/DashboardPage.tsx#47-182](../../frontend/src/pages/dashboard/DashboardPage.tsx) [frontend/src/machines/dashboardMachine.ts#31-131](../../frontend/src/machines/dashboardMachine.ts) [PROJECT_GUIDE#101-106](../20-Reference/Legacy Project Guide)