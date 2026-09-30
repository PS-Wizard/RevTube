# docs/context — dated context docs

Date-prefixed, git-sortable snapshots: `YYYY-MM-DD-slug.md`.

## Convention (one file per system)

- One file per system/topic. If the change updates a system that already has a file, update that file in place: rename the date prefix to the latest date and refresh the content (append an `Update` section, refresh verify/results). Only create a new file for a new system/topic.
- New context/audit/decision notes go here, **never** by editing `docs/*.md` or `fulldocs/*` in place. Those are living references; `context/` is the latest-state log per system.
- Filename: `YYYY-MM-DD-short-slug.md` (latest-update date, lowercase kebab).
- Every file starts with `# YYYY-MM-DD — Title` + a `Sources` line (code paths + DeepWiki/web verification).

## Index

| Date | File | What |
|---|---|---|
| 2026-09-18 | `2026-09-18-skill-stack-index.md` | 11 new shared skills + how they relate to existing 7 revtube-* skills |
| 2026-09-18 | `2026-09-18-docs-audit.md` | Stale-doc audit (mtimes + DeepWiki verification, incl. Vite/ECharts corrections) |
| 2026-09-18 | `2026-09-18-youtube-api-baseline.md` | YouTube API baseline grounded in current code |
| 2026-09-18 | `2026-09-18-agent-instruction-context-rule.md` | Mandatory context-doc rule added to AGENTS.md + CLAUDE.md |
| 2026-09-18 | `2026-09-18-admin-chat-sql-tool.md` | Admin-only read-only SQL tool + toggle + retry-loop fix (schema action, qualified names) |
| 2026-09-18 | `2026-09-18-audience-visual-refresh.md` | Audience tab: world map, traffic pie, hero KPI row |
| 2026-09-21 | `2026-09-21-playlist-pagination.md` | Playlist catalog paged like videos (DB-backed service, page/perPage envelopes, infinite queries, select-all drain) |
| 2026-09-22 | `2026-09-22-auth-oauth-resume-ref-fix.md` | AuthContext render-time ref write fixed (react-hooks v6 compiler rule), applyOAuthResult memoized + mobile PWA connect race (channel-fetch retry, redirect fallback, resume spinner) |
| 2026-09-22 | `2026-09-22-app-version-display.md` | `v{APP_DISPLAY_VERSION}` caption on login page bottom + sidebar bottom |
| 2026-09-22 | `2026-09-22-channel-dropdown-mobile-actions.md` | Channel dropdown focus/move/delete buttons always visible on touch screens |
| 2026-09-21 | `2026-09-21-channel-focus-dialog.md` | Channel Focus dialog at 70% width (`Modal wide` prop) + checklist-design audit fixes |
| 2026-09-21 | `2026-09-21-profile-common-components.md` | Profile page rebuilt on shared components (SettingRow deleted, FormField/Divider/Grid) + ChannelFocusDialog boundary fix |
| 2026-09-21 | `2026-09-21-admin-chat-db-toggle-spacing.md` | Admin chat Direct-DB-SQL toggle row: uniform 12px gap, panel-aligned padding, caption hint |
| 2026-09-21 | `2026-09-21-audit-video-count-plan-caps.md` | Channel audit video-count select: 15 free / 30 pro caps + Contact-us lead links |
| 2026-09-21 | `2026-09-21-admin-feature-groups.md` | Admin feature controls grouped by category with limiters inside |
| 2026-09-23 | `2026-09-23-goal-target-preview.md` | Goal modal target preview bidirectional (Number mode shows +X%, % mode shows +N absolute) |
| 2026-09-23 | `2026-09-23-video-search-dialog-mobile.md` | Video chooser dialog PWA/mobile overflow fix (full-bleed paper, wrapping bars) |
| 2026-09-23 | `2026-09-23-audit-tab-rail-responsive.md` | Audit tab-rail navbar responsive (centered max-width, swipe-scroll, compact mobile tabs) |
| 2026-09-23 | `2026-09-23-slim-scrollbars.md` | App-wide slim creative scrollbars (8px floating pill, token-aware, accent hover) |
| 2026-09-23 | `2026-09-23-optimized-shared-components.md` | Optimized page rebuilt on shared components, custom CSS file deleted |
| 2026-09-23 | `2026-09-23-chat-responsive.md` | Chat page responsive pass (drawer close, min-width guards, mobile spacing) |
| 2026-09-23 | `2026-09-23-sidebar-chat-chooser.md` | Mobile sidebar auto-close on nav + chat circular avatar chooser |
| 2026-09-23 | `2026-09-23-goal-detail-rail.md` | Goal detail: Actual+Projected default, 4/12 progress rail + 8/12 chart |
| 2026-09-23 | `2026-09-23-channel-redesign.md` | Channel page rebuilt on design system, 2 CSS files deleted |
| 2026-09-23 | `2026-09-23-audience-badges-colors.md` | Audience insights: recommendation badges removed, amber/green app-palette recolor |
| 2026-09-24 | `2026-09-24-stat-card-customization.md` | Customizable stat cards (show/hide, position, details) for Channel + Audience tabs, persisted per user via `/api/user/ui-preferences` |
| 2026-09-26 | `2026-09-26-public-audit.md` | Admin-only Public Audit: up to 1,000 videos, all-playlist catalog option, shared engines/cache, branding, history, Excel export, and stacked report tabs |
| 2026-09-24 | `2026-09-24-channel-subs-chart-lines.md` | Channel Analytics chart: Net subs/day + Subs total (cumulative) lines with sign-preserving normalize and negative-aware Y domain |
| 2026-09-26 | `2026-09-26-playlist-limit-select.md` | Playlist toolbar Limit control migrated to shadcn Select + Input; orphaned limit CSS deleted |
| 2026-09-26 | `2026-09-26-route-folders.md` | Frontend pages restructured into one folder per route (kebab-case), with old→new mapping |
| 2026-09-28 | `2026-09-28-anomaly-detection-page.md` | `/anomalies`: full-width table/grid + 70% detail dialog with status control, compact AI panel (no model/cache internals), one-call batch AI explain at scan time, numbered pagination (10/25/50), wire-shape normalization fix, Clear-all filter reset |
| 2026-09-28 | `2026-09-28-custom-dashboard.md` | `/my-dashboard`: pin-to-dashboard affordance + 4 new widgets (video/playlist performance, top videos/playlists) + custom KPI card builder (local-only defs) |
| 2026-09-27 | `2026-09-27-audit-pipeline.md` | Audit pipeline rework: parallel fetch stages + pooled membership + channel-scope skip (extracted `auditInputService`), staged job progress (determinate UI bar), single-transaction final persist, perfLog spans |
| 2026-09-28 | `2026-09-28-public-audit-fixes.md` | Public audit: concise Recommendation lines; disabled Captions toggle + caption exclusion; per-playlist Score/Top-fix table (video-style resizable/sortable) + Recommended-Fixes dialog + Channel Health card (engine rateHealth persisted, size-score overflow clamped); runner pipelined |
| 2026-09-28 | `2026-09-28-security-headers-cache-cron-caps.md` | Enforced Content-Security-Policy (new `config/securityHeaders.js` + 6 tests, `script-src 'self'`); ServerCache fallback made env-tunable (1000 / 12h, was 24h); cron channel caps env-tunable (`CRON_*`) and `collectTokens()` ordered most-recently-active first |
| 2026-09-28 | `2026-09-28-no-hardcoded-production-host.md` | Production PWA origin removed from CORS defaults (`index.js`) and the OAuth redirect allowlist (`routes/oauth.js`); both read env only. Added malformed-redirect-URI warning + 7 tests. Also redacted a committed Google App Password from `example.env` |
| 2026-09-28 | `2026-09-28-install-prompt-mobile.md` | Install prompt PWA banner migrated to Tailwind + shadcn (CSS file deleted): bottom-sheet card + 44px targets on phones, centered pill on desktop |
| 2026-09-28 | `2026-09-28-channel-analytics-tailwind.md` | Channel tab migrated to Tailwind + shadcn (3 extracted parts, no custom classes); chart pane full-bleed on mobile, 40px series chips |
