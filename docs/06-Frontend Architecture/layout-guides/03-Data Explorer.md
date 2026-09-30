# Data Explorer & Lookup Layout Guide

## 1. Applicable Screens
- **Videos** (`/videos` - `src/pages/VideosPage.tsx`)
- **Channel Profile** (`/channel` - `src/pages/ChannelPage.tsx`)
- **Playlist Browser** (`/playlist` - `src/pages/PlaylistPage.tsx`)
- **Specific Videos** (`/specific-videos` - `src/pages/SpecificVideosPage.tsx`)
- **Compare Channels** (`/compare` - `src/pages/ComparePage.tsx`)

---

## 2. Layout Objective
Data explorer pages provide lookup, filtering, and analysis of raw YouTube data. They must exhibit identical top-to-bottom rhythm:
1. **Header Chrome**: Standard `.page-header` with title, brief description, and primary action buttons (e.g. Export CSV, Compare).
2. **Alert & Quota Banner Area**: Dedicated slot for errors, alerts, and `UsageLimitBanner` directly below the header.
3. **Fetch & Filter Toolbar (`.form-section`)**:
   - Uses `<Form layout="toolbar">` with `.horizontal-form`.
   - Main query input (`.form-field-main`) with autocomplete suggestions for recent channels or saved playlists.
   - Secondary filters (`.form-field-small` or `.form-field-checkbox`).
   - Inline action triggers (e.g. "Fetch Videos", "Look Up", "Clear").
4. **Content Area**:
   - Data presentation through standardized tables (`VideoTable`, `PlaylistTable`) or metric cards.
   - Integrated pagination and row selection.
   - Video detail modal triggers (`VideoDetailDialog`).

---

## 3. Structural Wireframe

```
+---------------------------------------------------------------------------------------+
| Header: Title + Description                                    [Action: Export / CTA] |
+---------------------------------------------------------------------------------------+
| (Alert Banners / Usage Limit Quota Warning)                                           |
+---------------------------------------------------------------------------------------+
| Toolbar: [ Main Input: @channel or URL ] [ Filter Dropdown ] [ Fetch Button ] [Clear] |
+---------------------------------------------------------------------------------------+
| Content / Results Area                                                                |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Channel / Query Summary Banner (Thumbnail, Name, Subscribers, Total Views)    |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Data Table (VideoTable / PlaylistTable) with Sorting, Selection, Actions      |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
+---------------------------------------------------------------------------------------+
```

---

## 4. Component Implementation: `DataExplorerShell`

Use `DataExplorerShell` from `src/components/shells/DataExplorerShell.tsx`:

```tsx
import { DataExplorerShell } from '@/components/layout/DataExplorerShell';
import { Form, FormField, FormActions, Button } from '@/components/ui';

export function VideosExplorerPage() {
  return (
    <DataExplorerShell
      title="Videos"
      description="Fetch and browse videos from a channel, then open the dashboard for deeper analytics."
      actions={
        <Button variant="secondary" size="sm" onClick={handleExportCSV}>
          Export CSV
        </Button>
      }
      alerts={error ? <Alert severity="error">{error}</Alert> : null}
      usageLimit={usageError ? <UsageLimitBanner {...usageError} /> : null}
      toolbar={
        <Form layout="toolbar">
          <FormField variant="main">
            <AutocompleteInput
              value={query}
              onChange={setQuery}
              onSelect={handleFetch}
              placeholder="@username or channel URL"
              suggestions={recentSuggestions}
            />
          </FormField>
          <FormActions>
            <Button variant="primary" onClick={handleFetch} disabled={loading}>
              Fetch Videos
            </Button>
          </FormActions>
        </Form>
      }
    >
      <VideoTable videos={videos} onSelectVideo={handleOpenDetail} />
    </DataExplorerShell>
  );
}
```

---

## 5. Visual Standards for Data Explorers

### Input Toolbar
- Must use `.form-section` styling from `styles/page-chrome.css`:
  - `background: transparent;`
  - `border-bottom: 1px solid var(--rt-table-header-border);`
  - `padding: 0 var(--rt-space-5) var(--rt-space-4);`
  - `margin: 0 0 var(--rt-space-4);`
- Auto-complete inputs must provide recent search history badges and clear labels.

### Data Tables
- Header row must use sticky behavior or standardized surface styling (`.table-header--surface`).
- Cell typography uses `var(--rt-font-sans)` with tabular numbers for metric values (`font-variant-numeric: tabular-nums`).
- Thumbnails render with rounded corners (`var(--rt-radius-sm)`) and 16:9 aspect ratio.
