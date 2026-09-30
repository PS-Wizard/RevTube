/**
 * ConversationMemory -- short-term (Redis) + long-term (PostgreSQL) storage.
 *
 * Short-term: Redis key `chat:conv:{conversationId}` stores JSON array of messages.
 *             TTL configurable, used as hot cache.
 * Long-term: PostgreSQL tables chat_conversations and chat_messages.
 *
 * Flow:
 *   getConversation(id) → Redis hit → return
 *                        → Redis miss → load from PG → write to Redis → return
 *   saveMessage(conversationId, message) → Redis + PG
 */
function createConversationMemory(deps) {
  const { serverCache, query, isPostgresConfigured, PERF_LOG_ENABLED, perfLog, perfNow } = deps;

  /** Default TTL for conversation cache (30 minutes). */
  const CONV_TTL_MS = (parseInt(process.env.CHAT_CONV_TTL_MINUTES || '30', 10)) * 60 * 1000;

  // ── Helper: generate UUID v4 ─────────────────────────────────────────────────
  const crypto = require('crypto');
  function uuid() {
    return crypto.randomUUID();
  }

  // ── Postgres helpers (graceful fallback) ────────────────────────────────────

  async function ensureTables() {
    if (!isPostgresConfigured()) return;
    try {
      await query(`
        CREATE TABLE IF NOT EXISTS chat_conversations (
          id UUID PRIMARY KEY,
          user_id TEXT NOT NULL,
          title TEXT NOT NULL DEFAULT '',
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      await query(`
        CREATE TABLE IF NOT EXISTS chat_messages (
          id UUID PRIMARY KEY,
          conversation_id UUID NOT NULL REFERENCES chat_conversations(id) ON DELETE CASCADE,
          role TEXT NOT NULL,
          content TEXT NOT NULL DEFAULT '',
          tool_calls JSONB,
          tool_results JSONB,
          created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
      `);
      // Index for fast conversation lookup
      await query(`
        CREATE INDEX IF NOT EXISTS idx_chat_messages_conversation
        ON chat_messages(conversation_id, created_at)
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_chat_conversations_user
        ON chat_conversations(user_id, updated_at DESC)
      `);
      // Org-scoped index (idempotent)
      await query(`
        ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS org_id TEXT
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_chat_conversations_org
        ON chat_conversations(org_id, updated_at DESC)
      `);
      // Conversation type column: 'user' | 'admin' (idempotent)
      await query(`
        ALTER TABLE chat_conversations ADD COLUMN IF NOT EXISTS type TEXT DEFAULT 'user'
      `);
      await query(`
        CREATE INDEX IF NOT EXISTS idx_chat_conversations_type
        ON chat_conversations(type, updated_at DESC)
      `);
      // User tracking columns for messages (idempotent)
      await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_id TEXT`);
      await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS user_name TEXT`);
      // Chart spec column for assistant messages that created a visualization
      await query(`ALTER TABLE chat_messages ADD COLUMN IF NOT EXISTS chart JSONB`);
    } catch (err) {
      console.warn('[ConversationMemory] Table creation skipped:', err.message);
    }
  }

  // ── Conversation CRUD ────────────────────────────────────────────────────────

  /**
   * Create a new conversation for a user or org.
   * @param {string} userId - The user who created the conversation
   * @param {string|null} [orgId] - Optional org ID for org-scoped conversations
   * @param {string} [type='user'] - Conversation type: 'user' | 'admin'
   * @returns {object} { id, userId, orgId, type, title, createdAt }
   */
  async function createConversation(userId, orgId = null, type = 'user') {
    const start = perfNow();
    const id = uuid();
    const now = new Date().toISOString();

    const conversation = { id, userId, orgId, type, title: '', createdAt: now, updatedAt: now };

    // Persist to PostgreSQL
    if (isPostgresConfigured()) {
      try {
        await ensureTables();
        await query(
          'INSERT INTO chat_conversations (id, user_id, org_id, type, title, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, $7)',
          [id, userId, orgId, type, '', now, now],
        );
      } catch (err) {
        console.warn('[ConversationMemory] PG create failed:', err.message);
      }
    }

    // Cache in Redis
    const cacheKey = `chat:conv:${id}`;
    await serverCache.set(cacheKey, { id, userId, orgId, type, messages: [] }, CONV_TTL_MS);

    PERF_LOG_ENABLED && perfLog('conv.create', start, { userId, type });
    return conversation;
  }

  /**
   * List all conversations for a user or org.
   * @param {string|null} userId - User ID (used when orgId is specified and not admin, or when neither orgId nor admin)
   * @param {string|null} [orgId] - Org ID for org-scoped listings
   * @param {number} limit - Maximum number of results to return
   * @param {number} offset - Offset for pagination
   * @param {boolean} [isAdmin] - If true, list all conversations bypassing user/org restrictions
   * @param {string} [type] - Optional type filter: 'user' | 'admin'. When provided, only that type is returned.
   * @returns {object} { conversations: Array<{ id, title, createdAt, updatedAt, messageCount, orgId, userId, type }>, totalCount: number }
   */
  async function listConversations(userId, orgId = null, limit = 50, offset = 0, isAdmin = false, type = null) {
    const start = perfNow();

    if (!isPostgresConfigured()) return { conversations: [], totalCount: 0 };

    try {
      let countResult, result;

      if (isAdmin && !orgId) {
        // Admin mode: list all conversations filtered by type if provided
        const typeFilter = type ? 'WHERE type = $1' : '';
        const params = type ? [type, limit, offset] : [limit, offset];
        const typeWhere = type ? 'WHERE c.type = $1' : '';

        countResult = await query(
          `SELECT COUNT(*)::int AS cnt FROM chat_conversations ${typeFilter}`,
          type ? [type] : []
        );
        result = await query(
          `SELECT c.id, c.user_id, c.org_id, c.type, c.title, c.created_at, c.updated_at,
                  COUNT(m.id)::int AS message_count
           FROM chat_conversations c
           LEFT JOIN chat_messages m ON m.conversation_id = c.id
           ${typeWhere}
           GROUP BY c.id
           ORDER BY c.updated_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );
      } else if (orgId) {
        // Org-scoped: list conversations belonging to the org
        const typeFilter = type ? 'AND type = $2' : '';
        const params = type ? [orgId, type, limit, offset] : [orgId, limit, offset];

        countResult = await query(
          `SELECT COUNT(*)::int AS cnt FROM chat_conversations WHERE org_id = $1 ${typeFilter}`,
          type ? [orgId, type] : [orgId]
        );
        result = await query(
          `SELECT c.id, c.user_id, c.org_id, c.type, c.title, c.created_at, c.updated_at,
                  COUNT(m.id)::int AS message_count
           FROM chat_conversations c
           LEFT JOIN chat_messages m ON m.conversation_id = c.id
           WHERE c.org_id = $1 ${typeFilter.replace('type', 'c.type')}
           GROUP BY c.id
           ORDER BY c.updated_at DESC
           LIMIT $${params.length - 1} OFFSET $${params.length}`,
          params
        );
      } else {
        // User-scoped: list personal conversations (exclude admin conversations)
        const typeFilter = type ? 'AND type = $3' : "AND (type IS NULL OR type = 'user')";
        const params = type ? [userId, limit, offset, type] : [userId, limit, offset];

        countResult = await query(
          `SELECT COUNT(*)::int AS cnt FROM chat_conversations WHERE user_id = $1 AND org_id IS NULL ${typeFilter}`,
          type ? [userId, type] : [userId]
        );
        result = await query(
          `SELECT c.id, c.user_id, c.org_id, c.type, c.title, c.created_at, c.updated_at,
                  COUNT(m.id)::int AS message_count
           FROM chat_conversations c
           LEFT JOIN chat_messages m ON m.conversation_id = c.id
           WHERE c.user_id = $1 AND org_id IS NULL ${typeFilter.replace('type', 'c.type')}
           GROUP BY c.id
           ORDER BY c.updated_at DESC
           LIMIT $2 OFFSET $3`,
          params.slice(0, 3)
        );
      }

      PERF_LOG_ENABLED && perfLog('conv.list', start, { userId, orgId, isAdmin, type, count: result?.rows?.length || 0 });
      const conversations = result?.rows?.map((r) => ({
        id: r.id,
        title: r.title || 'New conversation',
        createdAt: r.created_at,
        updatedAt: r.updated_at,
        messageCount: r.message_count || 0,
        userId: r.user_id,
        orgId: r.org_id,
        type: r.type || 'user',
      })) || [];
      return { conversations, totalCount: countResult?.rows?.[0]?.cnt || 0 };
    } catch (err) {
      console.warn('[ConversationMemory] PG list failed:', err.message);
      return { conversations: [], totalCount: 0 };
    }
  }

  /**
   * Get full conversation data with messages (paginated).
   * Tries Redis first, then PostgreSQL.
   * @returns {object|null} { id, userId, orgId, title, messages: [...], totalMessages }
   */
  async function getConversation(conversationId, limit = 100, offset = 0) {
    const start = perfNow();

    // Try Redis first
    const cacheKey = `chat:conv:${conversationId}`;
    const cached = await serverCache.get(cacheKey);
    if (cached && cached.messages) {
      PERF_LOG_ENABLED && perfLog('conv.get.redis_hit', start, { conversationId });
      const totalMessages = cached.messages.length;
      // Slice from the end (since messages are chronological)
      // e.g. if length is 25, offset = 0, limit = 10 -> slice(15, 25)
      const startIdx = Math.max(0, totalMessages - offset - limit);
      const endIdx = totalMessages - offset;
      const slicedMessages = startIdx < endIdx ? cached.messages.slice(startIdx, endIdx) : [];
      return {
        id: cached.id,
        userId: cached.userId,
        orgId: cached.orgId,
        type: cached.type || 'user',
        title: cached.title,
        messages: slicedMessages,
        totalMessages,
      };
    }

    // Fallback to PostgreSQL
    if (!isPostgresConfigured()) return null;

    try {
      // Ensure the chart column exists (idempotent) -- existing conversations
      // created before this column was added need it before the SELECT below.
      await ensureTables();

      const convResult = await query(
        'SELECT id, user_id, org_id, type, title, created_at FROM chat_conversations WHERE id = $1',
        [conversationId],
      );
      if (!convResult?.rows?.length) return null;

      const conv = convResult.rows[0];

      // Get total message count
      const countResult = await query(
        'SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE conversation_id = $1',
        [conversationId],
      );
      const totalMessages = countResult?.rows?.[0]?.cnt || 0;

      // Load latest 100 messages from Postgres to warm Redis cache
      const msgResult = await query(
        'SELECT role, content, tool_calls, tool_results, user_id, user_name, chart, created_at FROM chat_messages WHERE conversation_id = $1 ORDER BY created_at ASC LIMIT 100',
        [conversationId],
      );

      const allMessages = (msgResult?.rows || []).map((r) => ({
        role: r.role,
        content: r.content || '',
        tool_calls: r.tool_calls,
        tool_call_id: r.tool_results?.tool_call_id !== undefined ? r.tool_results.tool_call_id : null,
        userId: r.user_id || undefined,
        userName: r.user_name || undefined,
        chart: r.chart || undefined,
      }));

      const conversation = { id: conv.id, userId: conv.user_id, orgId: conv.org_id, type: conv.type || 'user', title: conv.title || '', messages: allMessages };

      // Write to Redis for next time
      await serverCache.set(cacheKey, conversation, CONV_TTL_MS);

      // Slice the requested page chunk
      const startIdx = Math.max(0, allMessages.length - offset - limit);
      const endIdx = allMessages.length - offset;
      const slicedMessages = startIdx < endIdx ? allMessages.slice(startIdx, endIdx) : [];

      PERF_LOG_ENABLED && perfLog('conv.get.pg_fallback', start, { conversationId, messageCount: slicedMessages.length });
      return {
        id: conv.id,
        userId: conv.user_id,
        orgId: conv.org_id,
        type: conv.type || 'user',
        title: conv.title || '',
        messages: slicedMessages,
        totalMessages,
      };
    } catch (err) {
      console.warn('[ConversationMemory] PG get failed:', err.message);
      return null;
    }
  }

  /**
   * Save a message to a conversation.
   */
  async function saveMessage(conversationId, message) {
    const start = perfNow();
    const msgId = uuid();
    const now = new Date().toISOString();

    const { role, content, tool_calls: toolCalls, toolResults, userId, userName, chart } = message;

    // PostgreSQL persist
    if (isPostgresConfigured()) {
      try {
        // Ensure the chart column exists (idempotent) before inserting.
        await ensureTables();

        await query(
          `INSERT INTO chat_messages (id, conversation_id, role, content, tool_calls, tool_results, user_id, user_name, chart, created_at)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            msgId,
            conversationId,
            role || 'assistant',
            content || '',
            toolCalls ? JSON.stringify(toolCalls) : null,
            toolResults ? JSON.stringify(toolResults) : null,
            userId || null,
            userName || null,
            chart ? JSON.stringify(chart) : null,
            now,
          ],
        );
        // Touch the conversation's updated_at
        await query(
          'UPDATE chat_conversations SET updated_at = $1 WHERE id = $2',
          [now, conversationId],
        );
        // Auto-generate title from first user message
        if (role === 'user') {
          const countResult = await query(
            'SELECT COUNT(*)::int AS cnt FROM chat_messages WHERE conversation_id = $1 AND role = $2',
            [conversationId, 'user'],
          );
          if (countResult?.rows?.[0]?.cnt === 1) {
            const title = (content || '').slice(0, 100).replace(/\s+/g, ' ').trim();
            await query('UPDATE chat_conversations SET title = $1 WHERE id = $2', [title, conversationId]);
          }
        }
      } catch (err) {
        console.warn('[ConversationMemory] PG save failed:', err.message);
      }
    }

    // Update Redis cache
    const cacheKey = `chat:conv:${conversationId}`;
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      cached.messages = cached.messages || [];
      cached.messages.push({
        role: role || 'assistant',
        content: content || '',
        tool_calls: toolCalls || undefined,
        tool_call_id: toolResults?.tool_call_id !== undefined ? toolResults.tool_call_id : undefined,
        userId: userId || undefined,
        userName: userName || undefined,
        chart: chart || undefined,
      });
      await serverCache.set(cacheKey, cached, CONV_TTL_MS);
    }

    PERF_LOG_ENABLED && perfLog('conv.save_msg', start, { conversationId, role });
  }

  /**
   * Update the title of a conversation.
   */
  async function updateTitle(conversationId, title) {
    if (isPostgresConfigured()) {
      try {
        await query('UPDATE chat_conversations SET title = $1 WHERE id = $2', [title, conversationId]);
      } catch (err) {
        console.warn('[ConversationMemory] PG title update failed:', err.message);
      }
    }
    // Update cache
    const cacheKey = `chat:conv:${conversationId}`;
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      cached.title = title;
      await serverCache.set(cacheKey, cached, CONV_TTL_MS);
    }
  }

  /**
   * Delete a conversation and all its messages.
   */
  async function deleteConversation(conversationId) {
    if (isPostgresConfigured()) {
      try {
        await query('DELETE FROM chat_conversations WHERE id = $1', [conversationId]);
      } catch (err) {
        console.warn('[ConversationMemory] PG delete failed:', err.message);
      }
    }
    // Remove from Redis
    const cacheKey = `chat:conv:${conversationId}`;
    await serverCache.delete(cacheKey);
  }

  return {
    createConversation,
    listConversations,
    getConversation,
    saveMessage,
    updateTitle,
    deleteConversation,
  };
}

module.exports = { createConversationMemory };
