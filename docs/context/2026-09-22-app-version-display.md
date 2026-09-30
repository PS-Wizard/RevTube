# 2026-09-22 — App version display (login + sidebar)

Sources: `frontend/src/components/SignIn.tsx`, `frontend/src/constants/productUrls.ts`.

## Change

`APP_DISPLAY_VERSION` (`'1.0.5.1000'`) existed in `productUrls.ts` but was never
rendered anywhere. The login page (`SignIn`, rendered by `App.tsx`) now shows
`v{APP_DISPLAY_VERSION}` as a caption at the bottom of the form column — below
the centered form Stack (which holds `flex: 1`), so it pins to the bottom on
desktop and lands at the page bottom on mobile's single-column layout. Styled
with the `caption` Typography variant + `--rt-color-text-tertiary` token
(stylelint-safe, no raw hex).

## Verify

- `eslint src/components/SignIn.tsx` → clean.
- `tsc -b` → no errors in `SignIn.tsx` (only pre-existing errors elsewhere).

## Update — sidebar bottom version

Sources: `frontend/src/components/Layout.tsx`, `frontend/src/components/Layout.css`.

- `APP_DISPLAY_VERSION` now also renders as `v1.0.5.1000` at the sidebar bottom
  (expanded sidebar only; collapsed rail is icon-width), below Sign Out, with a
  `App version …` tooltip. New `.sidebar-version` class reuses the leftover
  `.footer-info` token styling (no raw hex).
- Verify: `eslint Layout.tsx` → only 1 pre-existing error (line 162 ref write,
  identical on HEAD); `tsc -b` clean; `stylelint Layout.css` clean.
