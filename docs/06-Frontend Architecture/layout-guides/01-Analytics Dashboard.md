# Analytics & Dashboard Layout Guide

## 1. Applicable Screens
- **Channel Analytics Dashboard** (`/dashboard` - `src/pages/DashboardPage.tsx`)
- **Organization Portfolio Analytics** (`/organization/analytics` - `src/pages/OrgAnalyticsPage.tsx`)

---

## 2. Layout Objective
Dashboards are command centers displaying multi-dimensional time-series data, charts, and key performance indicators. Their layout emphasizes:
1. **Two-Tier Sticky Context Header (`.dashboard-header-container`)**:
   - **Row 1 (`.dashboard-header-row--context`)**: Channel or Organization switcher on the left, Date Range / Timeframe selector pill on the right. Stays pinned while scrolling through dense data.
   - **Row 2 (`.dashboard-header-row--tabs`)**: Canonical underline tab rail (`.analytics-tabs`) switching between analytical dimensions (e.g. Channel Overview, Videos, Audience, Engagement, Retention).
2. **Standard Measure**: Content body spans max-width `var(--rt-shell-content-max-width)` centered with responsive padding.
3. **KPI Metric Grid**: Summary metric cards with delta percentages (`var(--rt-color-success)`, `var(--rt-color-danger)`), benchmark indicators, and sparklines.
4. **Data Visualization Panels**: Chart panels wrapped in `.rt-card` or `.table-report` with standardized panel headers, legend positioning, and download options.
5. **Dimensions & Breakdown Drawer**: Collapsible sidebar (`DimensionsPanel`) for slicing data by geography, device, traffic source, or viewer age.

---

## 3. Structural Wireframe

```
+=======================================================================================+
| Sticky Row 1: [ Channel / Org Selector ]                  [ Timeframe: Last 28 Days ] |
+---------------------------------------------------------------------------------------+
| Sticky Row 2: [ Channel (Active) ] [ Videos ] [ Audience ] [ Engagement ] [ Benchmarks] |
+=======================================================================================+
| Dashboard Body: min(1400px, 100%)                                                     |
|                                                                                       |
|   +-------------------+ +-------------------+ +-------------------+ +-----------------+
|   | Views KPI Card    | | Watch Time Card   | | Subscribers Card  | | Revenue Card    |
|   | 1.2M (+14.2%)     | | 42.1K hrs (+8.1%) | | +4,210 (-2.3%)    | | $8,420 (+19.4%) |
|   +-------------------+ +-------------------+ +-------------------+ +-----------------+
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Primary Chart Panel (Time-Series Area / Line with ECharts)                   |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +---------------------------------------------+ +-------------------------------+   |
|   | Top Videos Table                            | | Dimensions / Demographics     |   |
|   +---------------------------------------------+ +-------------------------------+   |
|                                                                                       |
+---------------------------------------------------------------------------------------+
```

---

## 4. Visual Standards for Dashboards

### Sticky Header Hierarchy
```html
<div className="dashboard-header-container">
  <div className="dashboard-header-row dashboard-header-row--context">
    <div className="dashboard-header-context">
      <ChannelSelector ... />
    </div>
    <div className="dashboard-header-period">
      <DateRangeSelector ... />
    </div>
  </div>

  <nav className="dashboard-header-row dashboard-header-row--tabs analytics-tabs">
    <div className="analytics-tabs__list" role="tablist">
      <Button bare role="tab" className="analytics-tab active">Overview</Button>
      <Button bare role="tab" className="analytics-tab">Audience</Button>
    </div>
  </nav>
</div>
```

### Metric Card Typography & Delta Rules
- Value: `var(--rt-text-2xl)` font weight 700.
- Label: `var(--rt-text-xs)` font weight 600 uppercase tracking wide.
- Positive Delta: `color: var(--rt-color-success)` with upward icon.
- Negative Delta: `color: var(--rt-color-danger)` with downward icon.
- Neutral Delta: `color: var(--rt-color-text-secondary)`.
