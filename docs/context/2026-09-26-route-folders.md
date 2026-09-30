# 2026-09-26 — Frontend pages restructured into route folders

Sources: `frontend/src/App.tsx` (route table + lazy imports), `frontend/src/pages/*` (19 route folders), `frontend/src/components/admin/PublicAuditPanel.tsx`, `frontend/src/components/audit/AuditedVideosTable.tsx`, `frontend/src/pages/audit-orchestrator/index.ts`, `docs/PROJECT_GUIDE.md` (tree sketch).

## What changed

`frontend/src/pages/` was a flat list of 24 page components. It is now one folder per route (Next.js-style grouping): each folder holds its page entry + page CSS + page-only components. Shared `components/`, `services/`, `hooks/`, `contexts/`, `stores/` did not move.

## Old → new mapping

| Route(s) | Before | After |
|---|---|---|
| `/dashboard` | `pages/DashboardPage.tsx` + `.css` | `pages/dashboard/` |
| `/goals`, `/goals/:goalId` | `pages/GoalsPage.tsx`, `pages/GoalDetailPage.tsx` + `.css` | `pages/goals/` |
| `/videos` | `pages/VideosPage.tsx` | `pages/videos/` |
| `/channel` | `pages/ChannelPage.tsx` | `pages/channel/` |
| `/playlist` | `pages/PlaylistPage.tsx` + `.css` | `pages/playlist/` |
| `/compare` | `pages/ComparePage.tsx` | `pages/compare/` |
| `/specific-videos` | `pages/SpecificVideosPage.tsx` | `pages/specific-videos/` |
| `/profile` | `pages/ProfilePage.tsx` | `pages/profile/` |
| `/organization`, `/organization/analytics` | `pages/OrganizationPage.tsx` + `.css`, `pages/OrgAnalyticsPage.tsx` + `.css` | `pages/organization/` |
| `/admin/*` | `pages/AdminPage.tsx` + `.css` | `pages/admin/` |
| `/chat` | `pages/ChatPage.tsx` | `pages/chat/` |
| `/thumbnail-optimizer` | `pages/ThumbnailOptimizerPage.tsx` + `.css`, `pages/thumbnailOptimizer/*` | `pages/thumbnail-optimizer/` |
| `/playlist-optimizer` | `pages/PlaylistOptimizerPage.tsx` + `.css`, `pages/playlistOptimizer/*` | `pages/playlist-optimizer/` |
| `/audit-orchestrator`, `/audit-orchestrator/:id` | `pages/AuditOrchestratorPage.tsx` (barrel, deleted), `pages/AuditOrchestratorDetailPage.tsx`, `pages/AuditOrchestratorPage.css`, `pages/auditOrchestrator/*` | `pages/audit-orchestrator/` |
| `/video-audit` | `pages/VideoAuditPage.tsx` + `.css`, `pages/videoAudit/*` | `pages/video-audit/` |
| `/readme` | `pages/ReadmePage.tsx` | `pages/readme/` |
| `/optimized` | `pages/OptimizedListPage.tsx` | `pages/optimized/` |
| auth (no layout) | `pages/VerifyEmailPage.tsx`, `pages/ResetPasswordPage.tsx`, `pages/AcceptInvitePage.tsx` | `pages/auth/` |

Folder names are kebab-case matching the URL route. The four pre-existing camelCase component folders (`videoAudit`, `auditOrchestrator`, `thumbnailOptimizer`, `playlistOptimizer`) were renamed to kebab-case as part of this.

## Import changes (mechanical, no logic touched)

- Every moved page: `../x` → `../../x` on static `import`/`export … from` lines and dynamic `import('…')`, plus side-effect CSS imports.
- Page→companion prefixes collapsed: `./videoAudit/` → `./` (etc.); cross-folder hops updated (`AdminPage` → `../thumbnail-optimizer/…`, `../playlist-optimizer/…`; `OptimizedListPage` and `PlaylistOptimizerPage` → `../thumbnail-optimizer/…`; `AuditChannelPickerCard` + `VideoAuditInputForm` → `../thumbnail-optimizer/…`; `AuditOrchestratorDetailPage` `./auditOrchestrator` → `.`; `AdminPlaylistOptimizer` `../PlaylistOptimizerPage` → `./PlaylistOptimizerPage`; `AdminPage` `./ChatPage` → `../chat/ChatPage`; `AuditOrchestratorPage` `../AuditOrchestratorPage.css` → `./AuditOrchestratorPage.css`).
- Outside `pages/`: `App.tsx` lazy imports rewritten to the new paths (plus a route-folder comment); `AuditedVideosTable` → `../../pages/audit-orchestrator`; `PublicAuditPanel` → `../../pages/video-audit/VideoAuditCriteriaList`.
- All moves via `git mv` (history preserved); the deleted root `AuditOrchestratorPage.tsx` was a pure re-export barrel, superseded by the folder `index.ts`.

## Notes for future moves

- `@/`-aliased imports are move-proof; relative `../` imports need a depth bump per added level, and bare `import '…'` (CSS side-effects, no `from`) is easy to miss — `tsc` won't catch those, only the Vite build will.
- Historical docs (`docs/context/*` dated logs, `CHANGELOG.md`, `fulldocs/`, old plans/specs) intentionally still cite the old paths — they are correct as-of their date. This file is the canonical old→new map.

## Verify

- `pnpm exec tsc -b` → clean.
- `pnpm build` → pass (tsc + Vite + PWA; only existing chunk-size warnings).
- `pnpm test -- --run` → 30 files / 199 tests pass (incl. `pages/audit-orchestrator/AuditExecutiveScorecard.test.tsx` at its new path).
- `pnpm exec eslint src/App.tsx` → clean; `git diff --check` → clean.
- `docs/PROJECT_GUIDE.md` tree sketch updated to route folders.
