# Audit & Optimizer Suite Layout Guide

## 1. Applicable Screens
- **Video Audit** (`/video-audit` - `src/pages/VideoAuditPage.tsx`)
- **Thumbnail Optimizer** (`/thumbnail-optimizer` - `src/pages/ThumbnailOptimizerPage.tsx`)
- **Playlist Optimizer** (`/playlist-optimizer` - `src/pages/PlaylistOptimizerPage.tsx`)
- **Channel Audit Studio** (`/audit-orchestrator` - `src/pages/AuditOrchestratorPage.tsx`)
- **Channel Audit Detail** (`/audit-orchestrator/:id` - `src/pages/AuditOrchestratorDetailPage.tsx`)
- **Optimized Content Registry** (`/optimized` - `src/pages/OptimizedListPage.tsx`)

---

## 2. Layout Objective
All audit and optimization tools share identical structure and workflow rhythm:
1. **Header Chrome**: Clean title band with one-line description and header actions (help guide button, bulk export).
2. **View Navigation**: Canonical underline tab rail switching between **New Audit** and **Audit History** (or sub-categories).
3. **Alert Banner Slot**: Standardized location for warnings, rate limit banners, or errors directly above the body.
4. **Body Measure (`.audit-tool-body`)**: Bounded width `min(var(--rt-shell-content-max-width), 100%)` centered horizontally.
5. **Input Surface (`.audit-tool-card`)**: Elevated card surface for parameters and channel/video selection.
6. **Progress State (`.audit-tool-loading-card`)**: Uniform spinner and step-by-step loading messaging.
7. **Audit Report Header**: Metric overview with score ring or grade badge, summary stats, and export actions.
8. **Detailed Findings**: Filterable table or accordion breakdown with standard severity badges.

---

## 3. Structural Wireframe

```
+---------------------------------------------------------------------------------------+
| Header: Title + Description                           [Action: Guide] [Action: Export] |
+---------------------------------------------------------------------------------------+
| Tab Rail: [ New Audit (Active) ] [ Saved Audits (3) ]                                  |
+---------------------------------------------------------------------------------------+
| (Optional Alerts / Usage Limit Banners)                                               |
+---------------------------------------------------------------------------------------+
| .audit-tool-body                                                                      |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | .audit-tool-card (Input Parameters & Submit Button)                           |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | .audit-tool-loading-card (Active Job Progress & Status)                       |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Report Header (Overall Score Ring, Grade Band, Benchmark)                     |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Detailed Findings (Category Score Cards, Recommendations Table)               |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
+---------------------------------------------------------------------------------------+
```

---

## 4. Component Implementation: `AuditToolShell`

Use `AuditToolShell` from `src/components/audit/AuditToolShell.tsx`:

```tsx
import { AuditToolShell } from '@/components/audit/AuditToolShell';

export function MyAuditPage() {
  const [view, setView] = useState<'audit' | 'history'>('audit');

  return (
    <AuditToolShell
      title="Video Audit"
      description="In-depth video SEO & metadata audit: title CTR, description links, tags, and AI recommendations."
      actions={
        <>
          <ExportButton onExport={handleExport} />
          <GuideHelpButton onOpen={() => setGuideOpen(true)} />
        </>
      }
      tabs={{
        items: [
          { value: 'audit', label: 'New Audit' },
          { value: 'history', label: 'Saved Audits', count: savedCount },
        ],
        value: view,
        onChange: (v) => setView(v as 'audit' | 'history'),
      }}
      alerts={error ? <Alert severity="error">{error}</Alert> : null}
    >
      <div className="audit-tool-body">
        {view === 'audit' ? <AuditWorkflow /> : <AuditHistory />}
      </div>
    </AuditToolShell>
  );
}
```

---

## 5. Visual Standards for Audit Tools

### Surfaces & Cards
- Use `.audit-tool-card`:
  - `background: var(--rt-color-bg-elevated)`
  - `border: 1px solid var(--rt-color-border)`
  - `border-radius: var(--rt-radius-lg)`
  - `padding: var(--rt-space-5)`
  - `margin-bottom: var(--rt-space-5)`

### Score Bands & Colors
Scoring badges follow strict token mapping:
- **80-100% (High / Optimized)**:
  - Text: `var(--rt-color-success)`
  - Surface: `var(--rt-color-success-surface)`
- **50-79% (Moderate / Needs Attention)**:
  - Text: `var(--rt-color-warning)`
  - Surface: `var(--rt-color-warning-surface)`
- **0-49% (Critical / Poor)**:
  - Text: `var(--rt-color-danger)`
  - Surface: `var(--rt-color-danger-surface)`

### History Tables
All history panels must render within a responsive table structure (`.audit-tool-card` or `.table-report`) featuring:
- Search filter input (`AutocompleteInput` or native search)
- Date formatted with local timezone
- Score pill or status badge
- Action buttons: View Report, Re-run, Delete (with `ConfirmModal`).
