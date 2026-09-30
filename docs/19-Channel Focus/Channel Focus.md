# Channel Focus

Channel Focus is the one place a user states, in their own words, what their channel
is actually about. Every AI surface in the product reads it so the AI stops guessing
the niche.

## Why it exists

Before Focus, each AI feature independently inferred the channel's niche from
whatever data it happened to have. That meant the chat agent, the Full Audit and the
optimizers could all disagree about what the channel is for. Focus makes the answer
explicit and shared, and the AI features consume it as context instead of re-deriving
it.

## Data model

One focus record per `(channel_id, scope)`, where scope is personal
(`organization_id IS NULL`) or a single organization. This mirrors the
`channel_goals` scoping model exactly, so the two features behave consistently.

```sql
channel_focus (
  id, channel_id, organization_id, created_by,
  niche, audience, content_pillars JSONB, tone, goals_notes,
  ai_snapshot JSONB, source, created_at, updated_at
)
```

The unique index is written on `COALESCE(organization_id, '')` because a plain
`UNIQUE (channel_id, organization_id)` would treat every `NULL` as distinct and
silently allow unlimited personal rows per channel.

`source` records whether the current record was AI-generated (`'ai'`) or hand-written
(`'manual'`), so the UI can tell the user which they are looking at and whether
regenerating would overwrite their edits.

## Source of truth

| Concern | File |
|---|---|
| Service | `backend/services/channelFocusService.js` |
| Route | `backend/routes/channelFocus.js` |
| UI dialog | `frontend/src/components/channel/ChannelFocusDialog.tsx` (surfaced on Profile and in audit flows) |
| Client service | `frontend/src/services/channelFocusService.ts` |
| Storage | `channel_focus` (migration `010_channel_focus.sql`) |

## Flow

1. `POST /api/channel-focus/generate` builds a focus draft for a channel.
2. The draft is saved and becomes the current focus.
3. The user can edit any field afterwards; edits flip `source` to `manual`.

Generation is quota-gated (`quotaGate` + `consumeQuota`) and prefers Postgres. When
Postgres has no catalog for the channel it falls back to the same live bundle
`auditInputService` gathers, injected via `setAuditInputSource`.

## Deterministic fallback

`buildHeuristicFocus` is a pure function that derives a first draft from the channel
snapshot (title, description, tags, stats) with **no LLM at all**. It runs when no AI
key is configured, when the AI call fails, or when there is not enough data to be
worth a call. Keywords come from `topWords`, which tokenizes titles and descriptions,
drops a stopword list and returns the five most frequent terms.

This is the reason Focus works with no API key configured at all: the product degrades
to keyword inference rather than erroring.

## Field limits

`sanitizeFocusInput` whitelists and trims every field, and caps content pillars at
`MAX_PILLARS` (6) non-empty strings. It accepts both `camelCase` and `snake_case`
pillar keys so older clients keep working.

| Field | Max length |
|---|---|
| `niche` | 500 |
| `audience` | 2000 |
| `tone` | 500 |
| `goalsNotes` | 4000 |
| `contentPillars` | 6 entries |

## Caching

Reads are cached under `chfocus:personal:{channelId}` or
`chfocus:org:{orgId}:{channelId}` for 6 hours (`FOCUS_CACHE_TTL_MS`). The scope is
baked into the key so an org's focus can never be served to a personal request or
vice versa. Both segments pass through `sanitizeCacheSegment` so a crafted id cannot
break out of its key namespace.

## Authorization

Reading requires membership of the target org (`canRead`), or sysadmin. Writing
requires `canManage` on that org. The personal scope needs no org check because it is
the caller's own record.

## Consumers

| Consumer | How it uses Focus |
|---|---|
| [Full Audit Orchestrator](../16-Full%20Audit%20Orchestrator/Full%20Audit%20Orchestrator.md) | `buildFocusContextBlock` injected into every sub-audit prompt |
| [AI Chat System](../09-AI%20Chat%20System/AI%20Chat%20System.md) | `getFocusForAI` grounds the agent's channel context |
| [Goals & Forecasting](../14-Goals%20%26%20Forecasting%20System/01-Goals%20%26%20Forecasting.md) | `goalsNotes` informs pacing context |

`getFocusForAI` deliberately returns only **top-level context** (15 videos,
`CONTEXT_TOP_VIDEOS`) and never a detailed per-video audit. That keeps the prompt
small enough that grounding the AI does not meaningfully increase token cost.

Every consumer treats an absent focus as normal and falls back to keyword inference,
so Focus being unset is never an error state.

## Prompt budget

| Constant | Value | Meaning |
|---|---|---|
| `FOCUS_CACHE_TTL_MS` | 6h | Focus read cache |
| `MAX_PILLARS` | 6 | Cap on content pillars |
| `CONTEXT_TOP_VIDEOS` | 15 | Videos summarised into the shared context block |
| `PROMPT_VIDEOS` | 10 | Videos actually placed in a prompt |
| `PROMPT_PLAYLISTS` | 12 | Playlists actually placed in a prompt |
