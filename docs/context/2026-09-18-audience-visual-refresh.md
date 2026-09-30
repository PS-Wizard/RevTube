# 2026-09-18 — Audience tab visual refresh (map + pie + hero)

Sources: `frontend/src/components/DimensionsPanel.{tsx,css}`, `dashboard/audienceGeo.ts`, `dashboard/AudienceHeroRow.tsx`, `dashboard/TrafficPieCard.tsx`, `evilcharts/charts/echarts-map-chart.tsx`.

## What changed

- **World choropleth for Top Countries.** New `EChartsMapChart` (ECharts MapChart + GeoComponent, RtECharts host with PNG toolbar, roam zoom, theme-aware tokens). Shapes load once from CDN (`johan/world.geo.json`, feature `id` = ISO_A3); `audienceGeo.ts` maps the panel's A2 codes to A3 and renames matched features so series data joins by code. Unmatched/offline countries stay visible in the ranked list below — the map never blanks the card (loading shimmer, then a quiet offline note).
- **Traffic Source is now a pie.** Top-6 slices + an "Other" rollup (shares stay honest), built-in legend replaced by a legend list with the same period-delta pills as the bar cards. Deltas still follow the "Show changes" toggle.
- **Hero KPI row.** Top country (+share), countries tracked, top traffic source, mobile share — computed from the full unsliced reports via pure `computeAudienceHero` (nulls mean no data, never zero-fill), skeleton tiles while loading, hidden when empty.
- Untouched: age bars, device/subs/gender donuts, retention section, PNG download, empty states. No backend changes (country already returns top 20).

## Files touched

- `dashboard/audienceGeo.ts` (+.test.ts), `evilcharts/charts/echarts-map-chart.tsx` (+.test.ts), `dashboard/AudienceHeroRow.tsx` (+.test.ts), `dashboard/TrafficPieCard.tsx` (+.test.ts) — all new
- `components/DimensionsPanel.{tsx,css}` — hero row, pie card, map `topVisual` slot on `DimCard`, exported label/type helpers

## Update — zoom controls return

- Pan-only roam had removed zooming. The map card now has explicit **+/- controls with a % readout and reset** (1x–6x, ×1.4 steps) driving the series `zoom` through the option builder — zoom state survives re-renders, and mouse-wheel keeps scrolling the page instead of hijacking the map.

- **Map ghost fixed.** The option rendered both a `geo` component and a `map` series, drawing every region twice (the "extra map in bg", obvious while roaming). Single renderer now (series only). Wheel zoom also hijacked page scroll, so roam is pan-only (`roam: 'move'`).
- **Slider removed.** `visualMap.show: false` — regions stay color-encoded, no slider chrome.
- **Layout is now explicit rows**: Top Countries full-width → 2 pies (Traffic Source, Device Type) → 3 pies (Age Group, Subscriber Status, Gender). Age and Subs converted to `AudiencePieCard` (shares sum to ~100, no rollup); the old SVG donuts/bars are gone from this tab. Rows collapse 3→2→1 under 1100/680px.

Earlier iteration (superseded details): 70/30 split card, `TrafficPieCard` → generalized `AudiencePieCard`, roomier grid (360px min, 1.25rem gaps), map 300px / pies 230px.

## Verify

- `pnpm vitest run` in `frontend/` -> 25 files, 143 passed.
- `tsc -b` clean for touched files; `pnpm design:lint` clean (tokens only, no raw hex).
- Manual: Dashboard -> Audience tab -> single map, no slider, rows (map / 2 pies / 3 pies); narrow viewport -> rows stack; offline -> ranked list with fallback note.
