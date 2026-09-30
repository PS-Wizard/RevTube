# 2026-09-21 — Admin chat DB-toggle row spacing

Sources: `frontend/src/pages/ChatPage.tsx` (admin `Direct DB SQL` row),
`frontend/src/components/ui/chat.tsx` (`ChatInputPanel`, `ChatInputWrapper`),
`frontend/src/components/ui/Toggle.tsx`, `frontend/src/components/ui/Typography.tsx`.

## Change

The admin-only "Direct DB SQL" toggle row above the chat input had cramped,
lopsided spacing: a `rowGap: 0.5` (4px) override fought the row's own
`gap={1.5}` (12px) when the hint wrapped, and `px: 2` double-inset the row to
32px against the panel's 16px (`ChatInputPanel` is `p-4`) — misaligned with
the input box below. The hint was a bare `Box` span with hand-rolled
`fontSize`/`color`.

Now, all from shared components (no new utilities, `ui:boundary` clean):

- `Flex wrap` prop instead of `sx flexWrap`; `rowGap` override deleted so
  wrapped rows breathe at the same gap. Row gap raised to `gap={2}` (16px)
  for clear separation between the toggle and the hint text.
- `px` / `pt` overrides deleted — the row inherits the panel's 16px padding
  and aligns with the input box edges; kept `pb: 1.5` (12px) so the gap down
  to the input box matches the wrapper's internal `gap-3` rhythm.
- Hint text is shared `Typography variant="caption"` instead of a styled span.

## Follow-up: `rt-toggle` moved off the parent label

`Toggle` rendered `rt-toggle` on the outer `<label>`, so the switch styling
depended on the parent wrapper. Now the switch (input + track) lives in an
inner `.rt-toggle` div; the label keeps a new `.rt-toggle-field` wrapper
class (inline-flex, 8px gap between switch and label text, tight label
line-height) in `styles/design-tokens.css`. All existing track selectors
(`input:checked + track`, `focus-visible`) still match inside the inner div,
and the label-less Admin/OptimizedList call sites are unaffected.

## Verify

- `pnpm exec eslint src/pages/ChatPage.tsx` — only pre-existing `any` /
  exhaustive-deps findings, none on touched lines.
- `pnpm exec tsc -b` — only the 6 pre-existing errors in untouched files.
- `node scripts/check-ui-boundary.mjs` — ChatPage clean (remaining failure is
  pre-existing `FeatureGuard.tsx` vs stale baseline).
