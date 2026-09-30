# 2026-09-26 — Playlist toolbar Limit control uses the shared shadcn Select

**Sources:** `frontend/src/pages/playlist/PlaylistPage.tsx`, `frontend/src/pages/playlist/PlaylistPage.css`, `frontend/src/components/ui/{select,Input,Form,index}.tsx`

## What changed

The playlist fetch toolbar's **Limit** control was a raw native `<select>` (`.form-input.limit-select`)
plus a raw number `<input>` (`.form-input-custom-limit`) with a hand-written `<label className="form-label">`.

It now composes the shared UI kit:

- `ShadcnSelect` / `SelectTrigger` / `SelectValue` / `SelectContent` / `SelectItem` (radix-backed,
  exported from `components/ui/index.ts`) for the 50/100/200/300/All/Custom preset dropdown.
- `Input` (`compact`) for the conditional custom-limit number field.
- `FormField`'s own `label` / `htmlFor` props instead of a hand-rolled label element.

Sizing is Tailwind arbitrary (`w-[100px]` trigger, `w-[90px]` custom input) so no page CSS is needed.

## Boy-scout cleanup

Deleted from `PlaylistPage.css` (no remaining references):
`.limit-select`, `.limit-select:focus`, `.form-input-custom-limit`,
`.form-input-custom-limit:focus`, and `.form-field-limit .form-label`
(`.form-field-limit` layout itself stays — it is what the `FormField variant="limit"` toolbar slot needs).

## Note

The channel-catalog **Sort** dropdown further down the same page is still a native `<select>`.
It was left alone here to keep the change scoped; the same shadcn Select swap applies to it.

## Verify

| Gate | Result |
|---|---|
| `pnpm build` (tsc -b + vite) | pass |
| `npx eslint src/pages/playlist/PlaylistPage.tsx` | clean (repo-wide `pnpm lint` has 326 pre-existing errors, untouched by this change) |
| `pnpm design:lint` | pass |
| `pnpm test` | 32 files / 211 tests pass |
