# 2026-09-21 — Channel audit video-count select with plan caps + Contact-us lead

Sources: `frontend/src/pages/auditOrchestrator/AuditSamplingSettings.tsx`,
`frontend/src/pages/auditOrchestrator/AuditOrchestratorPage.tsx`,
`frontend/src/pages/auditOrchestrator/auditOrchestratorTypes.ts`,
`frontend/src/constants/productUrls.ts`.

## Change

The channel audit "Sample Limit" was a free number input (1–100). It is now
a plan-capped select:

- Caps: Free 15 videos, Pro 30 (admins get Pro). Constants live in
  `auditOrchestratorTypes.ts` (`FREE_AUDIT_VIDEO_MAX`, `PRO_AUDIT_VIDEO_MAX`,
  `AUDIT_VIDEO_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30]`, filtered by cap at
  render; the cap option is suffixed "(plan max)").
- `AuditOrchestratorPage` derives `isPro` from `useAuth()` (`userPackage ===
  'pro'` or `role === 'admin'`), clamps stale over-plan selections on plan
  change, and clamps the outgoing `videoSelection.count` to the plan max (was
  a flat 100).
- Over-cap demand becomes a lead: under the select, Free sees "Free covers up
  to 15 videos. Need more? Upgrade to Pro or Contact us." and Pro sees "Pro
  covers up to 30 videos. Need more? Contact us." Upgrade links to
  `TUBEKETER_SITE_URL` (same as `PremiumFeature`); Contact us links to
  `REVKETER_EXPERT_HELP_URL` (same as the header "Get Expert Help" button,
  where lead capture happens). All links/buttons are shared `Link`/typography
  primitives — no new utilities (`ui:boundary` clean).

## Update: caps controlled from the admin panel

No new admin UI was needed — the Features tab renders every `pages` key
generically. Instead a dedicated `auditVideos` key ("Channel Audit Videos",
Free 15 / Pro 30) was added to the feature-config defaults in both
`backend/config/featureConfig.js` and `frontend/.../FeatureConfigContext.tsx`
(a separate key so the `audit` run-quota limits are untouched). It appears in
Admin → Feature controls with Free/Pro limit inputs like every other row,
validates through the existing zod record schema, and merges/saves through
the existing `/api/admin/config` path.

`AuditOrchestratorPage` now reads the cap via
`getSearchLimit('auditVideos', pkg)` (falls back to the code constants when
the config is missing or `-1`/unlimited, and to instant defaults while the
remote config loads). The select builds its options from presets plus the
configured cap itself, so raising the cap in admin (e.g. Pro → 50) offers 50
without a code change; the upsell copy reads "covers up to {planMax}".

## Update: user-facing copy (no admin internals in UI)

Rule going forward: UI copy is always written for the user — no mention of
admin criteria, administrators, or scoring internals. Fixed three leaks on
the Channel Audit page:

- Page subtitle dropped "scored against admin-configured criteria" → ends
  with "with clear scores and next steps."
- "How Full Audit Works" modal dropped "(max points are configured by
  platform administrators)" → "the points show how much weight each check
  carries."
- The scoring-formula line ("each criterion earns max × score/100…")
  became an actionable tip: "work through the highest-point checks first
  for the biggest score gains."

Untouched on purpose: admin-panel copy (`AuditCriteriaEditor`) and code
comments stay dev-facing — that's their audience.

## Update 2: server-side enforcement (done)

`POST /audit-orchestrator` now clamps `videoSelection.count` to the
admin-controlled `auditVideos` cap before enqueueing
(`backend/routes/auditOrchestrator.js` → `resolveAuditVideoCap`, using the
same `getFeatureConfig` + `req.currentUser` package/role resolution as the
rest of the backend; admins count as pro). Missing/`-1` config falls back to
the 15/30 code defaults, never throws. The service-level absolute cap stays
as a backstop. Covered by `backend/routes/auditOrchestrator.test.mjs` (6
tests: free/pro/admin clamps, under-cap passthrough, admin-raised cap,
missing-config fallback).

Full backend suite: 453/454 pass — the single failure
(`orgAnalyticsService` totals) is pre-existing and shares no code with this
change (zero references to feature config).

## Verify

- `pnpm exec eslint` on touched files — clean (remaining `any` errors in
  `AuditOrchestratorPage` are pre-existing casts).
- `pnpm exec tsc -b` — only the 6 pre-existing errors in untouched files.
- `node scripts/check-ui-boundary.mjs` — touched files clean (remaining
  failure is pre-existing `FeatureGuard.tsx` vs stale baseline).
