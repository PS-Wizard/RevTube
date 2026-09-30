# 2026-09-21 — Channel Focus dialog: 70% width + checklist-design audit

Sources: `frontend/src/components/channel/ChannelFocusDialog.tsx`,
`frontend/src/components/ui/Modal.tsx` (`wide` prop), `frontend/src/components/ui/dialog.tsx`
shell, `frontend/src/components/ui/TextField.tsx` (`helperText`).

## Change

- `Modal` gains a `wide` prop: fluid 70vw panel with responsive steps at
  900px (85vw) and 640px (full-bleed). Shares the panel class previously
  exclusive to `guide` (`GUIDE_PANEL_CLASS` → `WIDE_PANEL_CLASS`; `guide`
  still works, prefer `wide` for non-guide content).
- `ChannelFocusDialog` switches `large` (≈540px fixed) → `wide` (70% of screen).
- Checklist-driven fixes in the same dialog:
  - Save disabled until `dirty` (Saving-changes: disable save until changes made).
  - `toast.success('Channel focus saved')` on save, `toast.error` on failure
    (Saving-changes notify + Submitting-form success message; inline error kept).
  - Two-column grid (`sm:grid-cols-2`) for Niche/Tone and Audience/Goals at
    wide widths, pillars full-width; single column on mobile (Modal responsiveness).
  - `helperText` hint on pillars ("One pillar per line…"; Input-field Hint item).
  - `role="alert"` on the inline error (accessibility).

## Audit (checklist-design skill, source-only — no screenshot)

Auditing this against the Modal checklist
(https://www.checklist.design/design-system/modal):

| | Item | Why |
|---|---|---|
| 🟢 | **Title** — Clear, simple text explaining the action of the modal | `Channel Focus — {channelTitle}` plus scope description line |
| 🟢 | **Actionable item** — A button or link to continue or close the event | Cancel + Save focus footer, Generate with AI secondary action |
| 🟡 | **Close action** — A way to exit the modal | X button + Cancel present, but shell blocks backdrop-click and Escape by default, so keyboard users must reach an explicit button |
| 🟢 | **Responsiveness** — Consider the size of the modal on different device sizes, and whether a modal is suitable on all | Now 70vw with 85vw ≤900px and full-bleed ≤640px steps; form collapses to one column on mobile |
| 🟢 | **Background change behind modal** — Darken, blur or lighten - change the background behind the modal to bring focus to it | Shell overlay `bg-black/60` + backdrop blur |
| 🟢 | **Description** — Incase they require more information to understand how to make their decision | Scope line (`Personal`/`Organization` context) + AI-draft provenance notes |

Plus Input-field, Saving-changes and Submitting-form checklists drove the
save-disabled-until-dirty, success toast, and pillars hint changes above.
Known gap left as-is: shell default blocks Escape/backdrop close for all
dialogs (form-input-loss protection) — changing that is a shell-wide decision,
not this dialog's.

## Verify

- `pnpm exec eslint src/components/ui/Modal.tsx src/components/channel/ChannelFocusDialog.tsx` — clean.
- `pnpm exec tsc -b` — only pre-existing errors in untouched files
  (`VideoDetailDialog.tsx`, `GoalDetailPage.tsx`); none in changed files.
- Visual check still open: audit was source-only, so a screenshot of the wide
  dialog at desktop + mobile widths would settle spacing/hierarchy properly.
