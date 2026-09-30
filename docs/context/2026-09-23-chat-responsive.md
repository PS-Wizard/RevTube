# 2026-09-23 — Chat page responsive pass

Sources: `frontend/src/pages/ChatPage.tsx`,
`frontend/src/components/ui/chat.tsx` (Tailwind lives only in `ui/**`)

## Fixes
ChatPage already composes shared primitives (no page CSS); gaps were in the
primitives and a few `sx` spots:
- `chat.tsx`: thinking/skeleton cards `max-w-80% → 90%` on phones;
  `ChatErrorBanner` `mx-6 → mx-4` on mobile; messages `p-6 → p-4 → p-3`
  (`max-sm`); empty state `p-8 → p-4` on mobile; bubbles get `min-w-0` +
  tighter mobile padding. (Tables already scroll inside `ChatTable`;
  ECharts auto-sizes; input wrapper already wraps.)
- `ChatPage.tsx` (`sx` only): drawer close button was `display: {xs:none,
  md:none}` = never visible → now `xs:block, md:none` (closable drawer on
  phones); `minWidth: 0` added to mobile-topbar title, composer channel
  label, and channel-dialog rows (all `flex:1` + nowrap, previously able to
  stretch the layout); suggestion buttons wrap (`maxWidth 100%`).

## Verify
- `tsc` clean for `ChatPage`/`ui/chat`. ESLint: 11 pre-existing
  problems (8 `any` + 3 hook-dep warnings), identical count on HEAD.
