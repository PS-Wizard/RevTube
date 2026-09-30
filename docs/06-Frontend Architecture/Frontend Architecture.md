## Frontend Architecture

Relevant source files

-   [frontend/src/App.css](../../frontend/src/App.css)
-   [frontend/src/App.tsx](../../frontend/src/App.tsx)
-   [frontend/src/pages/PlaylistPage.css](../../frontend/src/pages/playlist/PlaylistPage.css)
-   Frontend tests live beside source (`*.test.ts`) under `frontend/src/` -- see [Testing (Vitest)](05-Testing (Vitest)).md)

The RevTube (TubeKeter Analytics) frontend is a React-based Single Page Application (SPA) designed for high-density data visualization and complex state management. It utilizes a modular architecture that separates the UI layer from business logic through a dedicated service layer and centralized state stores.

### High-Level Component Relationship

The diagram below illustrates how the core frontend subsystems interact to deliver the dashboard experience.

Frontend Subsystem Overview

Sources: [frontend/src/App.tsx#6-18](../../frontend/src/App.tsx) [frontend/src/App.tsx#158-175](../../frontend/src/App.tsx)

___

## 6.1 Application Shell & Routing

The application shell provides the persistent navigation framework and global feedback systems. Routing is handled by `react-router-dom`, with a significant portion of routes protected by authentication and permission wrappers.

-   Routing Logic: Defined in `App.tsx`, utilizing `ProtectedRoute`, `AdminRoute`, and `OrganizationRoute` to gate access based on user state [frontend/src/App.tsx#45-126](../../frontend/src/App.tsx)
-   Layout & Sidebar: The `Layout` component manages the collapsible sidebar rail and the primary `main-content` area [frontend/src/App.css#164-181](../../frontend/src/App.css)
-   Global Feedback: Includes an `auth-error-toast` for authentication failures [frontend/src/App.css#27-43](../../frontend/src/App.css) and a `PageLoader` for suspense-based transitions [frontend/src/App.tsx#129-136](../../frontend/src/App.tsx)

For details, see [Application Shell & Routing](01-Application Shell & Routing.md).

___

## 6.2 Design System & UI Component Library

RevTube uses a custom design system built on CSS variables (design tokens) and a shared library of atomic components. This system ensures visual consistency across the dashboard and content discovery pages.

-   Design Tokens: Prefixed with `rt-`, these tokens control colors, spacing, and typography (e.g., `var(--rt-color-accent)`, `var(--rt-space-4)`) [frontend/src/App.css#340-348](../../frontend/src/App.css)
-   UI Components: A canonical set of shadcn-based primitives (Button, Card, Input) styled with Tailwind and `--rt-*` tokens, giving one brand identity without ad-hoc styling [frontend/src/App.tsx#10-17](../../frontend/src/App.tsx)
-   Theming: Supports dark mode via a `data-theme` attribute on the document root, switching the `--rt-*` token values [frontend/src/App.tsx#9-17](../../frontend/src/App.tsx)

For details, see [Design System & UI Component Library](02-Design System & UI Component Library.md).

___

## 6.3 Service Layer & API Client

The service layer abstracts all communication with the Node.js backend. It handles authentication headers, usage context, and client-side data optimizations.

-   AnalyticsService: The primary interface for fetching data bundles (e.g., `getDashboardBundle`) and managing usage limit errors [frontend/src/App.tsx#28](../../frontend/src/App.tsx)
-   YouTubeService: Specialized for direct metadata fetching and channel/playlist resolution.
-   API Client Patterns: Implements in-flight request deduplication. Channel resolve routes skip quota entirely — the former `markResolveScope` middleware was removed 2026-06-27, replaced by `requireQuota`/`consumeQuota` two-phase billing in `backend/middleware/quota.js` and `backend/services/quotaService.js`.

For details, see [Service Layer & API Client](03-Service Layer & API Client.md).

___

## 6.4 Data Visualization & Chart System

Data visualization is the core of the RevTube experience. The system is built on Apache ECharts 6 through the in-repo EvilCharts provider, themed with the `--rt-chart-*` tokens.

-   RtChart Wrapper: A standardized container that provides consistent theming, tooltips, and responsive behavior for all dashboard charts.
-   Chart Rendering: Uses a utility-driven approach to map backend metrics (views, watch time, subscribers) to specific color series and sparkline formats.
-   Styling: Specialized CSS (`rt-charts.css`) manages the appearance of chart legends, axes, and grid lines to maintain a high-density, professional look.

For details, see [Data Visualization & Chart System](04-Data Visualization & Chart System.md).

___

## System Interaction: Code Entity Mapping

The following diagram maps high-level architectural concerns to the specific files and classes that implement them.

Code Entity Association

Architecture Data Flow

Sources: [frontend/src/App.tsx#45-102](../../frontend/src/App.tsx) [frontend/src/App.tsx#138-175](../../frontend/src/App.tsx) [frontend/src/pages/PlaylistPage.css#1-21](../../frontend/src/pages/playlist/PlaylistPage.css)