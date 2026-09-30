# 2026-09-21 — Admin feature controls grouped by category

Sources: `frontend/src/pages/AdminPage.tsx` (features tab),
`frontend/src/pages/AdminPage.css`.

## Change

Admin → Feature controls was one flat table of every feature row. Rows are
now grouped under category subheader rows, each with its limiters inside:

- Analytics & Discovery (dashboard, videos, channel, playlists, compare,
  specific videos) · Audits (audit, auditVideos, videoAudit) · Optimizers
  (thumbnail + playlist) · AI & Chat (chat, captions) · Workspace (goals,
  optimized). Any key the map doesn't know falls into an "Other" group, so
  future backend keys never disappear.
- Group definition is a static `FEATURE_GROUPS` map; the row markup was
  extracted once into `renderFeatureRow`, so grouping adds no duplication.
  Save flow, draft state, and validation are untouched.
- Subheader style (`.feature-group-row`) lives in the existing
  `AdminPage.css` and uses only design tokens.

## Verify

- `pnpm exec eslint src/pages/AdminPage.tsx` — one pre-existing
  set-state-in-effect finding on an untouched `useEffect`; nothing new.
- `pnpm exec stylelint` on `AdminPage.css` — clean. `tsc -b` — only the
  known pre-existing errors. `ui:boundary` — touched files clean.
