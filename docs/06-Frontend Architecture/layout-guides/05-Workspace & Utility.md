# Workspace & Specialty Layout Guide

## 1. Applicable Screens
- **Performance Goals & Milestones** (`/goals` - `src/pages/GoalsPage.tsx`)
- **Goal Detail & Pacing View** (`/goals/:goalId` - `src/pages/GoalDetailPage.tsx`)
- **AI Analytics Chat Workspace** (`/chat` - `src/pages/ChatPage.tsx`)
- **Documentation Viewer** (`/readme` - `src/pages/ReadmePage.tsx`)
- **Auth & Onboarding** (`/verify-email`, `/reset-password`, `/accept-invite`)

---

## 2. Layout Standards

### Goals & Milestones (`GoalsPage`)
- Must use canonical `.page-container` and `.page-header.page-header--split` matching the rest of the application.
- Header contains title ("Performance Goals & Pacing"), description, and primary CTA ("+ New Goal") with help tooltip.
- Tab rail for period filters (All, Weekly, Monthly, Quarterly, Annual).
- Cards represent goals with progress bars, pacing velocity chips, and target projections.

### Goal Detail Page (`GoalDetailPage`)
- Top breadcrumb navigation with back arrow linking to `/goals`.
- Hero header banner displaying metric icon, status pill (On Track, Behind, Achieved), and date duration.
- Visual breakdown: target vs current velocity chart, daily pacing table, and strategy notes.

### AI Chat Workspace (`ChatPage`)
- Full viewport height layout (`height: calc(100vh - var(--rt-panel-header-height))`).
- Collapsible conversation sidebar with search and new conversation button.
- Center chat stream with markdown rendering, table formatting, and SQL query blocks.
- Fixed bottom input bar with prompt shortcuts and model status indicators.
