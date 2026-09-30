# 2026-09-18 — Admin chat read-only SQL tool (queryAnalyticsDb)

Sources: `backend/chat/tools/queryAnalyticsDb.js`, `backend/chat/index.js`, `backend/chat/AgentExecutor.js`, `backend/chat/prompts/index.js`, `frontend/src/hooks/useChat.ts`, `frontend/src/pages/ChatPage.tsx`.

## What changed

- New admin-only chat tool `queryAnalyticsDb`: takes raw SQL from the agent, runs read-only queries against Postgres for complex ad-hoc analytics the dedicated tools can't answer.
- Server-side guards (all in the tool, fail-closed): admin check, postgres-configured check, single `SELECT`/`WITH` only, no stacked statements, no SQL comments, no write/DDL keywords (incl. data-modifying CTEs), `FROM`/`JOIN` allowlist of 10 analytics tables, PII columns (`email/password/secret/token/keys`) rejected after stripping string literals, CTE names exempted from the table check, hard row cap (default 50, max 100) enforced by wrapping the query. Results also pass through `Guardrails.sanitizeToolResult`.
- Unreachable by design: `user_access_flags` (emails/roles), `audits`/`video_audits`/`thumbnail_audits`/`playlist_audits` (uid-linked user content), system catalogs.
- Wiring: registered in `ALL_TOOLS` + `ADMIN_ONLY_TOOL_NAMES` (`chat/index.js`); user mode unaffected (mode allowlists exclude it in both `index.js` and `AgentExecutor.js`).
- Per-request kill-switch: `AgentExecutor.run({ disabledTools })` narrows the mode tool set (never widens); messages handler accepts `disabledTools` from the POST body.
- Admin prompt carve-out: capability bullet + rule 7 scoped to `queryAnalyticsDb`; shared security rule 10 now allows only a listed read-only DB tool. User prompt stays strict (refuses all SQL).
- Frontend (admin chat only, `AdminPage` -> `ChatPage mode="admin"`): `Toggle` "Direct DB SQL" (default OFF) above the composer; `useChat.sendMessage` accepts `{ disabledTools }` and sends it in the message POST body.

## Why

- Complex cross-table questions (custom aggregations, joins) had no tool path; admins previously got refusals. Default-off toggle keeps the new surface opt-in.

## Files touched

- `backend/chat/tools/queryAnalyticsDb.js` (new) + `queryAnalyticsDb.test.mjs` (new, 23 tests)
- `backend/chat/index.js`, `backend/chat/AgentExecutor.js`, `backend/chat/prompts/index.js`
- `frontend/src/hooks/useChat.ts`, `frontend/src/pages/ChatPage.tsx`

## Update — retry-loop fix (schema action + qualified names)

A 30-vs-30-day comparison (CTEs, window function, goal join) ended in the agent max-iterations fallback. Two causes, both reproduced locally:

1. **No schema introspection** — the model guessed column names; each wrong guess burned a loop iteration. Fixed with `action: "schema"`: static `TABLE_SCHEMAS` inventory (10 tables, columns + grain, mirrors `backend/db/migrations`), no DB hit, still admin-gated. Tool description + admin prompt now teach schema-first.
2. **`public.`-qualified tables rejected** (`Table "public" is not queryable`). Table extraction now accepts an optional `schema.` qualifier.

Also: `sql` required only for `action: "query"` (schema `required` relaxed, enforced in `execute`); unknown actions rejected.

## Update — ingested-only scope, channel scoping, no-narration, Continue button

- **Data scope narrowed to ingested tables.** `channel_goals` / `channel_focus` moved from allowlist to denylist (planning data, not measured data).Queryable set is now 8 `analytics_*` tables; schema action lists goals/focus as UNQUERYABLE stubs so the agent knows they exist but stays off them.
- **Active-channel scoping.** Admin prompt: when an Active Channel is set, every `queryAnalyticsDb` query carries `WHERE channel_id = '<id>'` unless the user explicitly asks across channels. (Server-side scoping was rejected — it would break legit cross-channel admin questions.)
- **No technical narration (rule 13).** The assistant no longer tells the user about schema probing, table/column names, SQL, or tool process — tools run silently, answers are analyst-style (numbers, comparisons, recommendations). Follow-ups build on conversation history + Active Channel without re-asking.
- **Continue button for cut-off answers.** `AgentExecutor.run({ onTruncated })` fires when the cut marker is added (output budget / interrupted stream); messages handler emits SSE `truncated`; `useChat` exposes `showContinue`; `ChatPage` renders a Continue button that resends "Continue from where you left off." in the same conversation (history reused, same tool gating). Covers output-limit cuts; max-iteration/circular fallbacks are complete messages, not continuable.
- **Toggle spacing.** Direct DB SQL row now wraps with balanced gaps (`gap 1.5`, `px 2 / pt 1.5 / pb 1`).
- Context budget unchanged: admin history/tokens stay env-tunable (`CHAT_ADMIN_MAX_HISTORY`, `CHAT_ADMIN_MAX_TOKENS`); Continue reuses the stored conversation instead of growing prompts.

## Update — workbook export: all message tables, one .xlsx

- Assistant messages with 2+ markdown tables now show **"Download all N tables (.xlsx)"** — one workbook, one sheet per table, sheet names from the nearest heading (sanitized/deduped, 31-char cap). Single tables keep their existing per-table Download dropdown in `ChatTable`.
- Pure client-side: new `components/chat/chatWorkbook.ts` parses the markdown source (escaped pipes, alignment variants, fenced-code exclusion, ragged-row padding) and lazy-loads `xlsx` so the bundle chunking is unchanged. `ChatWorkbookExport.tsx` renders the button (hidden while streaming to avoid partial exports).
- No backend changes; filename `chat-tables_<timestamp>.xlsx`.
- **Fix — xlsx import shape.** The first version used `const { default: XLSX } = await import('xlsx')`, which throws `Cannot read properties of undefined (reading 'utils')` in the built app: Vite resolves `xlsx` via its `module` field (`xlsx.mjs`), which ships named exports only and NO default. New `loadXlsx()` loader takes `mod.default ?? mod` (works for CJS and ESM packaging) and throws a readable error if the API is missing. The pre-existing per-table Excel export in `ChatTable.tsx` had the same latent bug and now uses the loader too.

## Verify

- Backend chat suite: `pnpm vitest run chat/` in `backend/` -> 9 files, 99 passed.
- Frontend suite: `pnpm vitest run` in `frontend/` -> 21 files, 129 passed (incl. 8 `chatWorkbook` tests: parser + loader + in-memory sheet build).
- `tsc -b` clean for touched files (6 pre-existing errors in `VideoDetailDialog.tsx`, `GoalDetailPage.tsx`, untouched).
- Manual: admin chat -> toggle ON + channel selected -> complex question scopes to that channel with no schema talk; ask something long enough to hit the output budget -> Continue button appears and resumes; multi-table answer -> workbook button downloads one .xlsx with a sheet per table.

## Known limits / follow-ups

- No statement timeout on the wrapped query (single SELECT + 100-row cap bounds cost); consider `SET LOCAL statement_timeout` if slow queries appear.
- Guardrails input filter still blocks user messages containing `SELECT * FROM ...` (unchanged, defense in depth): admins ask in natural language, the agent authors the SQL.
