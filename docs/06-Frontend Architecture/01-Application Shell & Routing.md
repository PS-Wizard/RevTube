## Application Shell & Routing

Relevant source files

-   [frontend/src/App.css](../../frontend/src/App.css)
-   [frontend/src/App.tsx](../../frontend/src/App.tsx)
-   [frontend/src/components/Layout.css](../../frontend/src/components/Layout.css)
-   [frontend/src/components/Layout.tsx](../../frontend/src/components/Layout.tsx)
-   [frontend/src/components/dashboard/DateRangeSelector.tsx](../../frontend/src/components/dashboard/DateRangeSelector.tsx)
-   [frontend/src/pages/PlaylistPage.css](../../frontend/src/pages/playlist/PlaylistPage.css)
-   [frontend/src/styles/page-chrome.css](../../frontend/src/styles/page-chrome.css)

The application shell provides the foundational UI structure, navigation, and routing logic for the RevTube platform. It manages the persistent sidebar, top header, and global feedback mechanisms while orchestrating page transitions through a centralized routing configuration.

## Routing Architecture

The application uses `react-router-dom` for client-side routing. The root configuration is defined in `App.tsx`, which wraps the entire application in a `BrowserRouter` and sets up the primary route hierarchy.

### Route Structure & Protection

Routes are categorized into public, protected, and role-restricted segments:

-   Public Routes: Include `/signin`, `/oauth-callback`, and `/reset-password` [frontend/src/App.tsx#164-171](../../frontend/src/App.tsx)
-   Protected Routes: Wrapped in a `ProtectedRoute` component [frontend/src/App.tsx#45-102](../../frontend/src/App.tsx) This component checks `isAuthenticated` and `isEmailVerified` from `useAuth`. If authentication is missing, it renders the `SignIn` component [frontend/src/App.tsx#70-89](../../frontend/src/App.tsx)
-   Admin Routes: Wrapped in `AdminRoute`, restricting access to users with the `admin` role [frontend/src/App.tsx#105-110](../../frontend/src/App.tsx)
-   Organization Routes: Wrapped in `OrganizationRoute`, allowing access only to Pro users or Organization admins/owners [frontend/src/App.tsx#113-126](../../frontend/src/App.tsx)
-   **Feature-Gated Routes**: Wrapped in `FeatureGuard` with a `pageKey` prop. When the feature config's `premiumOnly` is true for that page key, free users see an upgrade prompt instead. Applies to `/chat` (pageKey: `"chat"`) [frontend/src/App.tsx](../../frontend/src/App.tsx) [frontend/src/components/FeatureGuard.tsx](../../frontend/src/components/FeatureGuard.tsx)

### Lazy Loading & Code Splitting

To optimize initial bundle size, all major pages and the layout shell are loaded lazily using `React.lazy` [frontend/src/App.tsx#24-42](../../frontend/src/App.tsx) Lazy-loaded pages include: DashboardPage, VideosPage, PlaylistPage, SpecificVideosPage, ComparePage, ChannelPage, OrganizationPage, AdminPage, ProfilePage, **ChatPage**, and ReadmePage. A `Suspense` boundary with a `PageLoader` fallback handles the loading states during chunk fetching [frontend/src/App.tsx#129-136](../../frontend/src/App.tsx)

### Data Flow: Routing to UI

The following diagram illustrates how the `App.tsx` router maps URLs to the `Layout` shell and nested page components.

Title: Routing and Shell Hierarchy

Sources: [frontend/src/App.tsx#163-220](../../frontend/src/App.tsx) [frontend/src/components/Layout.tsx#48-250](../../frontend/src/components/Layout.tsx)

___

## The Layout Component

The `Layout` component serves as the primary UI shell. It manages the sidebar state, navigation items, and provides the `Outlet` for nested routes [frontend/src/components/Layout.tsx#48](../../frontend/src/components/Layout.tsx)

### Sidebar Rail & Toggle

The sidebar supports two states: `open` (expanded, default 260px) and `closed` (collapsed rail, 57px) [frontend/src/components/Layout.tsx#34-35](../../frontend/src/components/Layout.tsx). When open, users can **drag the right edge** to resize the sidebar between 180px and 600px. The width is persisted to `localStorage`.

-   State Management: Controlled by `sidebarOpen` state [frontend/src/components/Layout.tsx#51](../../frontend/src/components/Layout.tsx)
-   **Resize Handle**: A 5px vertical strip on the right edge of the sidebar. Click and drag horizontally to resize. Cursor changes to `col-resize` during drag [frontend/src/components/Layout.tsx#55-80](../../frontend/src/components/Layout.tsx) [frontend/src/components/Layout.css](../../frontend/src/components/Layout.css)
-   Toggle Mechanism: Users can toggle the sidebar via a button in the header or using the `Ctrl+B` (or `Cmd+B`) keyboard shortcut [frontend/src/components/Layout.tsx#72-85](../../frontend/src/components/Layout.tsx)
-   Responsive Behavior: On mobile devices (width < 768px), the sidebar behaves as a drawer and is closed by default. The resize handle is hidden on mobile [frontend/src/components/Layout.tsx#38-41](../../frontend/src/components/Layout.tsx)

### Navigation Items & Context

The sidebar renders navigation links using `NavLink`. It dynamically displays "Pro" or "Admin" badges based on the user's `userPackage` and `role` via `getNavBadge(pageKey)` [frontend/src/components/Layout.tsx#154-173](../../frontend/src/components/Layout.tsx). The AI Chat nav item uses `getNavBadge("chat")` for its Pro badge and applies the `premium-item` CSS class. Active nav items use background shift only (no blue icon/text color) — applied via `.nav-item.active` and `.nav-item.premium-item.active` rules. Per-page sidebar badges are hidden in org mode (`getNavBadge()` returns `null` when `!isPersonalContext`).

Sources: [frontend/src/components/Layout.tsx#48-250](../../frontend/src/components/Layout.tsx) [frontend/src/components/Layout.css#279-293](../../frontend/src/components/Layout.css)

___

## App Shell CSS & Styling

The shell's layout is governed by a combination of Flexbox and CSS variables to ensure smooth transitions when the sidebar toggles.

### Main Content Area

The `.main-content` container uses a `transition` on `padding-inline-start` that is synced with the sidebar's width transition [frontend/src/App.css#325-331](../../frontend/src/App.css) The specific offset is calculated in `Layout.tsx` and applied as a CSS variable or inline style:

-   `sidebarRailOffsetPx`: 0 (mobile), 57 (collapsed), or the resizable sidebar width (default 260, range 180–600) [frontend/src/components/Layout.tsx#128-129](../../frontend/src/components/Layout.tsx)

### Page Chrome

Pages utilize standardized classes from `page-chrome.css` for headers and toolbars:

-   `.page-header`: The title band at the top of pages like Profile or Videos [frontend/src/styles/page-chrome.css#7-19](../../frontend/src/styles/page-chrome.css)
-   `.dashboard-header-container`: A sticky header specific to the dashboard that contains channel selection and date range controls [frontend/src/styles/page-chrome.css#57-70](../../frontend/src/styles/page-chrome.css)

Sources: [frontend/src/App.css#164-180](../../frontend/src/App.css) [frontend/src/components/Layout.css#1-30](../../frontend/src/components/Layout.css) [frontend/src/styles/page-chrome.css#1-70](../../frontend/src/styles/page-chrome.css)

___

## Global Feedback Patterns

The application shell integrates several global feedback mechanisms to handle authentication errors and loading states.

### Auth Error Toast

When authentication fails (e.g., during sign-in), a fixed-position toast notification is displayed. It is styled with `.auth-error-toast` and includes a slide-in animation [frontend/src/App.css#27-43](../../frontend/src/App.css)

### Loading States

-   Auth Loading: A full-screen spinner used while the application verifies the user's session (`isCheckingAuth`) [frontend/src/App.css#10-24](../../frontend/src/App.css)
-   Page Loader: A smaller, centered spinner used during lazy-loading of route components [frontend/src/App.tsx#129-136](../../frontend/src/App.tsx)

### Feedback Implementation Map

The following diagram bridges the logical feedback states to their specific CSS classes and components.

Title: Global Feedback Code Map

Sources: [frontend/src/App.css#10-69](../../frontend/src/App.css) [frontend/src/App.tsx#61-67](../../frontend/src/App.tsx) [frontend/src/App.tsx#129-136](../../frontend/src/App.tsx)