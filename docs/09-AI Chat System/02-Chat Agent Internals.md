# AI Chat System

The AI Chat system is a **DeepSeek-powered agent** that answers natural-language questions about YouTube channel performance. It is a standalone subsystem (`backend/chat/`) with its own Express router, streaming SSE endpoint, tool registry, guardrails, and dual-storage conversation memory.

## Architecture

```
User → Org Check → Input Guard → ConversationMemory → Agent Loop → SSE → Frontend
                             ↑               ↓
                        (Redis + PG)     ToolRegistry (9 tools)
```

- **Two-tier design**: User mode (analytical/audit tools only) and Admin mode (all tools including bulk channel lookup and channel discovery). Mode is set per-request via `req.chatMode` and controls which tools the LLM can call.
- **Org Context**: `X-Org-Id` header verified via `getCachedOrgMembership()` -- sets `req.orgId` for org-scoped operations
- **Guardrails**: 3 layers -- input (50+ injection patterns + Unicode normalization, 4000 char limit), tool (name/args validation), output (PII redaction, 8000 char cap, leak detection). YouTube public resource IDs (channel/playlist IDs) are exempt from long-token redaction.
- **Agent Loop**: Max 10 iterations, streaming DeepSeek Chat, tool calls accumulated across SSE chunks. Only the user message and final assistant response are persisted to DB -- intermediate tool_call/tool messages stay in-memory for the LLM loop only (prevents duplicate entries in chat history). Output leak detection scans final responses for leaked system prompt content and replaces with a safe fallback if detected.
- **Conversation Memory**: Redis hot cache (30 min TTL) + PostgreSQL persistence (`chat_conversations` / `chat_messages`). Conversations can be personal (`user_id`-scoped), shared (`org_id`-scoped), or admin (`type = 'admin'`-scoped).
- **Tool Registry**: 9 tools total -- 8 for users, 1 admin-only
- **User Tracking**: Org conversations record `user_id` / `user_name` on each message so members see who said what

## Key Files

| File | Purpose |
|------|---------|
| `backend/chat/index.js` | Wiring hub -- Express routers for user (`/api/chat`) and admin (`/api/chat/admin`) chat, tool registration, SSE setup, channel resolution |
| `backend/chat/AgentExecutor.js` | Streaming agent loop, `buildMessages()` with positional `tool_call_id` matching, user message tracking, output leak detection, DB persistence (user + final assistant only) |
| `backend/chat/prompts/index.js` | Separate system prompt templates for user mode and admin mode with `{{PLACEHOLDER}}` substitution + shared `SECURITY_RULES` block (11 rules covering prompt protection, identity lock, extraction denial, Unicode parsing, multi-turn detection, etc.) |
| `backend/chat/ToolRegistry.js` | Central tool registry with JSON Schema parameter definitions |
| `backend/chat/Guardrails.js` | Input/output/tool security (50+ injection patterns, Unicode normalization, PII redaction, URL-aware token handling) |
| `backend/chat/ConversationMemory.js` | Redis + PostgreSQL dual-storage CRUD with org-scoped queries and admin conversation type |
| `backend/chat/tools/*.js` | Individual tool implementations with `verifyChannelAccess()`. |
| `frontend/src/hooks/useChat.ts` | React SSE client with full event parser, orgId param on CRUD methods, `baseEndpoint` option for admin chat |
| `frontend/src/pages/chat/ChatPage.tsx` | Chat UI -- org-aware conversation sidebar, sender name display, process indicator, mobile drawer |

## API Endpoints

### User Chat (`/api/chat`)

| Method | Path | Org? | Description |
|--------|------|------|-------------|
| `GET` | `/api/chat/conversations` | ✅ Lists org conversations when `X-Org-Id` present | List conversations (paginated) |
| `POST` | `/api/chat/conversations` | ✅ Creates org-scoped conversation | Create conversation |
| `GET` | `/api/chat/conversations/:id` | ✅ Checks org membership for org conversations | Get conversation with messages |
| `DELETE` | `/api/chat/conversations/:id` | ✅ Checks org membership for org conversations | Delete conversation |
| `POST` | `/api/chat/conversations/:id/messages` | ✅ Checks org membership, passes orgId to tools | Send message -- SSE stream (quota-gated) |
| `GET` | `/api/chat/channels` | ✅ Queries org channels when `X-Org-Id` present | List connected YouTube channels |

### Admin Chat (`/api/chat/admin`)

| Method | Path | Description |
|--------|------|-------------|
| `GET` | `/api/chat/admin/conversations` | List admin conversations (type='admin') |
| `POST` | `/api/chat/admin/conversations` | Create admin conversation |
| `GET` | `/api/chat/admin/conversations/:id` | Get admin conversation with messages |
| `DELETE` | `/api/chat/admin/conversations/:id` | Delete admin conversation |
| `POST` | `/api/chat/admin/conversations/:id/messages` | Send message -- SSE stream (all tools available) |
| `GET` | `/api/chat/admin/channels` | List admin's connected channels |
| `GET` | `/api/chat/admin/channels/all` | List ALL channels across all users/orgs with search |

**Access control**: GET/DELETE/POST on conversations verify:
- Personal conversation → `userId` must match authenticated user
- Org conversation → user must be an org member (`getCachedOrgMembership`)
- Admin conversation → `type` must be `'admin'`

## Tools

### User Tools (8 tools)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `listMyChannels` | List connected YouTube channels from Firestore. Returns `hasAnalytics` flag from PG cross-reference. | `query?` (name search) |
| `searchVideos` | Search/query video performance data | `query`, `channelId?`, `limit?`, `sortBy?`, `sortOrder?` |
| `getChannelInfo` | Get channel overview stats | `channelId` |
| `getVideoDetails` | Get performance details for a specific video | `channelId`, `videoId` |
| `getAnalyticsQuick` | Quick analytics summary for a channel (7/30/90 day periods) | `channelId`, `period?` |
| `getBestTimeToPost` | Optimal posting time recommendations with scoring, significance, and confidence tiers | `channelId` |
| `compareChannels` | Compare performance metrics across channels | `channelIds[]`, `metrics[]?`, `period?` |
| `searchKnowledge` | Search internal knowledge base for YouTube/growth advice | `query` |

### Admin-Only Tool (1 tool)

| Tool | Description | Key Parameters |
|------|-------------|----------------|
| `getBulkChannelSummary` | Compact summary for up to 10 channels at once -- title, total videos/views, recent subs/likes/shares | `channelIds[]`, `period?` |

All tools verify channel access via `verifyChannelAccess()` from `tools/shared.js` -- ensuring the user can only query their own connected channels. Admin users bypass channel ownership checks. In org mode, channels are fetched from `organizations/{orgId}/channels`.

## SSE Events

| Event | When |
|-------|------|
| `tools` | On connect -- available tools |
| `channels` | On connect -- your channels |
| `usage` | On connect -- quota usage |
| `token` | Streaming content chunk |
| `tool_start` / `tool_end` | Tool execution lifecycle |
| `thought` / `thought_end` | Agent reasoning |
| `done` | Stream complete |
| `error` | Error occurred |

## Configuration

| Env Var | Default | Description |
|---------|---------|-------------|
| `DEEPSEEK_API_KEY` | -- | Required for chat to function |
| `DEEPSEEK_MODEL` | `deepseek-chat` | Model to use |
| `CHAT_MAX_TOKENS` | `4096` | Max tokens per LLM response (user-level legacy key; prefer `CHAT_USER_MAX_TOKENS`) |
| `CHAT_USER_MAX_TOKENS` | `4096` | Max tokens per LLM response (user chat) |
| `CHAT_ADMIN_MAX_TOKENS` | `8192` | Max tokens per LLM response (admin chat; model API is the ceiling) |
| `CHAT_MAX_HISTORY` | `20` | Conversation history window, user chat (messages) |
| `CHAT_ADMIN_MAX_HISTORY` | `60` | Conversation history window, admin chat (messages) |
| `CHAT_MAX_TOOL_REPEATS` | `3` | Identical consecutive tool calls before the loop breaker trips |
| `CHAT_MAX_ITERATIONS` | `10` | Max agent loop iterations |
| `CHAT_CONV_TTL_MINUTES` | `30` | Redis cache TTL |

Feature config page key: `"chat"` -- `freeLimit: 50`, `proLimit: 200`, `premiumOnly: false`.

## Database

**chat_conversations** -- `id UUID PK`, `user_id TEXT`, `org_id TEXT` (nullable), `type TEXT` (nullable -- `'admin'` for admin conversations), `title TEXT`, `created_at`, `updated_at`. Indexed on both `(user_id, updated_at DESC)` and `(org_id, updated_at DESC)`.

**chat_messages** -- `id UUID PK`, `conversation_id UUID FK`, `role TEXT`, `content TEXT`, `tool_calls JSONB`, `tool_results JSONB`, `user_id TEXT` (nullable), `user_name TEXT` (nullable), `created_at`. Indexed on `(conversation_id, created_at)`.

Migrations: `0004_chat_conversations.sql` (initial), `0005_chat_org_id.sql` (org_id), `0006_chat_messages_user.sql` (user tracking).

## Admin Bypass

Admin users can access any channel's data regardless of channel ownership. The `verifyChannelAccess()` function in `tools/shared.js` checks both `userContext.role === 'admin'` and `userContext.isAdmin === true`. The chat service passes `role: 'admin'` when building user context for admin requests.

## See Also

- [docs/09-AI Chat System/AI Chat System.md](./AI Chat System) -- Full documentation
- [Project Overview](../20-Reference/Legacy Project Guide) -- Backend service overview