# RevTube Layout System & Architecture Guide

## 1. Overview & Vision
RevTube (TubeKeter Analytics) is a high-density, professional YouTube analytics, audit, and optimization workspace. To provide a predictable, premium user experience, all application screens follow standardized layout archetypes rather than each view implementing its own ad-hoc structure.

This document outlines the core layout principles, container constraints, header systems, tab rails, action clusters, and responsive behaviors across the five major application sections.

---

## 2. Layout Archetypes Overview

| Section | Target Screens | Shell Component / CSS Base | Key Visual Rhythm |
| :--- | :--- | :--- | :--- |
| **Audit & Optimizer Suite** | `VideoAuditPage`, `ThumbnailOptimizerPage`, `PlaylistOptimizerPage`, `AuditOrchestratorPage`, `AuditOrchestratorDetailPage`, `OptimizedListPage` | `<AuditToolShell />`, `audit-tools.css`, `page-chrome.css` | Title band + right action cluster, underline tab rail, max-width bounded body, standardized input cards, progress states, structured findings |
| **Data Explorer & Lookup** | `VideosPage`, `ChannelPage`, `PlaylistPage`, `SpecificVideosPage`, `ComparePage` | `<DataExplorerShell />`, `page-chrome.css` | Title band, alert & quota banner slot, fetch toolbar (`form-section`), responsive data tables (`VideoTable`, `PlaylistTable`) |
| **Analytics Dashboards** | `DashboardPage`, `OrgAnalyticsPage` | Sticky header container, `page-chrome.css`, `shared-ui.css` | Sticky Row 1 (Channel/Org scope + Timeframe pill), Sticky Row 2 (Underline tab rail), wide responsive metric grids, chart panels |
| **Management & Admin** | `AdminPage`, `OrganizationPage`, `ProfilePage` | `.page-container`, `page-chrome.css` | Header band with primary operational CTA (e.g. Invite, Refresh), subnav/tabs, card surfaces (`rt-card`), two-column layout |
| **Workspace & Specialty** | `GoalsPage`, `GoalDetailPage`, `ChatPage`, `ReadmePage` | `.page-container`, `page-chrome.css` | Breadcrumb/nav bar, header band, responsive card grids, or split drawer workspace (Chat) |

---

## 3. Core Geometric Tokens & Spacing
All layouts are built upon the tokens defined in `frontend/src/styles/design-tokens.css`:

```css
/* Content Width Constraints */
--rt-shell-content-max-width: 1400px;
--rt-panel-header-height: 56px;
--rt-shell-header-z-index: 20;

/* Padding & Spacing */
--rt-space-1: 0.25rem;  /* 4px */
--rt-space-2: 0.5rem;   /* 8px */
--rt-space-3: 0.75rem;  /* 12px */
--rt-space-4: 1rem;     /* 16px */
--rt-space-5: 1.25rem;  /* 20px */
--rt-space-6: 1.5rem;   /* 24px */
--rt-space-8: 2rem;     /* 32px */
```

### Content Boundaries
1. **Outer Shell (`.content-area`)**: Managed by `Layout.tsx`. Never override margins or paddings on `.content-area` within a page.
2. **Page Container (`.page-container`)**:
   - `padding: 0; max-width: none; margin: 0; box-sizing: border-box;`
   - Spans full width inside `.content-area`.
3. **Inner Bounded Measure**:
   - Inside views like audit tools and dashboards, content sections must be bounded by:
     `max-width: min(var(--rt-shell-content-max-width), 100%); margin-inline: auto;`

---

## 4. Header Hierarchy & Standard Anatomy

### Standard Header (`.page-header`)
```html
<header className="page-header page-header--split">
  <div>
    <h1>Page Title</h1>
    <p className="page-description">Sentence case summary of screen purpose.</p>
  </div>
  <div className="header-actions">
    <!-- Action buttons, help modals, export triggers -->
  </div>
</header>
```
- **Height**: Minimum 56px (`var(--rt-panel-header-height)`).
- **Background**: `var(--rt-color-bg-highlight)`.
- **Border**: `1px solid var(--rt-table-header-border)` bottom.
- **Typography**:
  - `h1`: `var(--rt-text-lg)`, weight 600, `var(--rt-color-text)`.
  - `.page-description`: `var(--rt-text-sm)`, line-height 1.45, `var(--rt-table-cell-text-muted)`.

---

## 5. Underline Tab Rail Standard
When switching views within a screen, always use the canonical underline tab pattern (`.analytics-tabs` / `.analytics-tab`):
```html
<nav className="analytics-tabs" aria-label="Views">
  <div className="analytics-tabs__list" role="tablist">
    <Button bare role="tab" aria-selected={true} className="analytics-tab active">
      Tab 1
    </Button>
    <Button bare role="tab" aria-selected={false} className="analytics-tab">
      Tab 2
    </Button>
  </div>
</nav>
```
- **Active state**: Underline `2px solid var(--rt-color-text)` with negative bottom margin to sit seamlessly on the border.
- **Hover state**: Text color transitions to `var(--rt-color-text)`.
- **Keyboard navigation**: Full ARIA support (`role="tab"`, `aria-selected`, arrow key focus).

---

## 6. Section Guide Index
For full implementation details per screen archetype, consult the dedicated guides:
- [Audit & Optimizer Suite Layout Guide](layout-guides/02-Audit & Optimizer)
- [Data Explorer & Lookup Layout Guide](layout-guides/03-Data Explorer)
- [Analytics & Dashboard Layout Guide](layout-guides/01-Analytics Dashboard)
- [Management & Admin Layout Guide](layout-guides/04-Management & Admin)
- [Workspace & Utility Layout Guide](layout-guides/05-Workspace & Utility)
