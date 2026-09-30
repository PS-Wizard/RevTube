# 2026-09-28 — Install prompt mobile layout (Tailwind + shadcn)

Sources: `frontend/src/components/InstallPrompt.tsx` (deleted `frontend/src/components/InstallPrompt.css`) · verification: `tsc -b`, `eslint`, `pnpm design:lint` clean

## What changed

The PWA install banner (`InstallPrompt`, fixed bottom pill rendered on
`beforeinstallprompt`) kept a desktop row layout on phones: at ~360px the
text squeezed the two side-by-side buttons and the ~30px targets missed
thumbs. It also carried its own page-scoped CSS file.

- Migrated to shared `ui` primitives + Tailwind only, per the frontend
  convention — `InstallPrompt.css` deleted in the same change (no remaining
  imports). Card surface follows the established audit-tool pattern
  (`rounded-[var(--rt-radius-lg)] border border-[var(--rt-color-border)]
  bg-[var(--rt-color-bg-elevated)] shadow-xs`), `--rt-*` tokens only.
- Mobile-first layout: bottom-sheet card (`inset-x-3`, `bottom` clears the
  iPhone home indicator via `env(safe-area-inset-bottom)`), text on top,
  two-column equal-button grid with `min-h-[44px]` touch targets.
- `sm:` breakpoint restores the desktop centered pill (`left-1/2
  -translate-x-1/2`, row with side-by-side buttons at the `sm` Button size).
- No behavior change (dismiss key, standalone guard, `prompt()` flow kept).

## Verify

- `tsc -b` clean · `eslint src/components/InstallPrompt.tsx` clean ·
  `design:lint` exit 0.
- No JS test covers this component (renders only on `beforeinstallprompt`);
  verified by code inspection + lint/type gates.
