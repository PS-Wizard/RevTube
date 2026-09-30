/**
 * Chat module -- wiring hub.
 *
 * Exports:
 *   createChatService(deps) -- creates the chat service object (registers ALL tools)
 *   createUserChatRouter(deps)  -- creates Express router for USER chat (/api/chat)
 *   createAdminChatRouter(deps) -- creates Express router for ADMIN chat (/api/chat/admin)
 *
 * Follows the same DI pattern as other backend modules (services/, routes/).
 *
 * TWO-TIER DESIGN:
 *   User chat  -- analytical/audit tools only; system prompt avoids recommendations
 *   Admin chat -- all tools including recommendation/strategy; full system prompt
 *   The key difference is which tools are exposed to the LLM and the system prompt.
 *   Admin-only tools like getBestTimeToPost (recommendation engine) are excluded
 *   for regular users.
 */
const { createToolRegistry } = require('./ToolRegistry');
const { createGuardrails } = require('./Guardrails');
const { createConversationMemory } = require('./ConversationMemory');
const { createAgentExecutor } = require('./AgentExecutor');

// Tool definitions
const searchVideos = require('./tools/searchVideos');
const getChannelInfo = require('./tools/getChannelInfo');
const getVideoDetails = require('./tools/getVideoDetails');
const getAnalyticsQuick = require('./tools/getAnalyticsQuick');
const compareChannels = require('./tools/compareChannels');
const getBestTimeToPost = require('./tools/getBestTimeToPost');
const searchKnowledge = require('./tools/searchKnowledge');
const listMyChannels = require('./tools/listMyChannels');
const getBulkChannelSummary = require('./tools/getBulkChannelSummary');
const createChart = require('./tools/createChart');
const listPlaylists = require('./tools/listPlaylists');
const getPlaylistDetails = require('./tools/getPlaylistDetails');
const getBulkPlaylistDetails = require('./tools/getBulkPlaylistDetails');
const getBulkVideoDetails = require('./tools/getBulkVideoDetails');
const getTopPlaylistsByViews = require('./tools/getTopPlaylistsByViews');
const queryAnalyticsDb = require('./tools/queryAnalyticsDb');

// ── Tool access tiers ──────────────────────────────────────────────────────────
// Tools available to regular users (analytical/audit/insights only)
const USER_TOOL_NAMES = [
  'listMyChannels',
  'searchVideos',
  'getChannelInfo',
  'getVideoDetails',
  'getAnalyticsQuick',
  'getBestTimeToPost',
  'searchKnowledge',
  'compareChannels',
  'createChart',
  'listPlaylists',
  'getPlaylistDetails',
  'getBulkPlaylistDetails',
  'getBulkVideoDetails',
  'getTopPlaylistsByViews',
];

// Tools reserved for admin users (recommendations, suggestions, advanced)
const ADMIN_ONLY_TOOL_NAMES = [
  'getBulkChannelSummary',
  'queryAnalyticsDb',
];

const ALL_TOOLS = [
  searchVideos,
  getChannelInfo,
  getVideoDetails,
  getAnalyticsQuick,
  compareChannels,
  getBestTimeToPost,
  searchKnowledge,
  listMyChannels,
  getBulkChannelSummary,
  createChart,
  listPlaylists,
  getPlaylistDetails,
  getBulkPlaylistDetails,
  getBulkVideoDetails,
  getTopPlaylistsByViews,
  queryAnalyticsDb,
];

/**
 * Create the chat service -- agent executor + tool registry + guardrails + memory.
 * Registers ALL tools. Tool filtering by mode (user/admin) happens at the router
 * level via req.chatMode -- the AgentExecutor uses this to decide which subset of
 * tools to expose to the LLM and which system prompt to use.
 */
function createChatService(deps) {
  const guardrails = createGuardrails(deps);
  const toolRegistry = createToolRegistry();
  const memory = createConversationMemory(deps);
  const executor = createAgentExecutor(deps);

  // Register all tools
  toolRegistry.registerAll(ALL_TOOLS);

  console.log(`[Chat] Agent initialized with ${toolRegistry.listTools().length} tools: ${toolRegistry.listTools().join(', ')}`);

  return {
    guardrails,
    toolRegistry,
    memory,
    executor,
  };
}

// ── Shared helpers used by both routers ─────────────────────────────────────────

/** Fetch user channels from Firestore (personal or org). */
async function fetchUserChannels(deps, uid, orgId) {
  try {
    const { db } = deps;
    let snapshot;
    if (orgId) {
      snapshot = await db
        .collection('organizations')
        .doc(orgId)
        .collection('channels')
        .get();
    } else {
      snapshot = await db
        .collection('users')
        .doc(uid)
        .collection('youtubeTokens')
        .get();
    }
    if (snapshot.empty) return [];
    return snapshot.docs
      .map((d) => d.data())
      .filter((d) => d.channelId || d.id)
      .map((d) => ({
        channelId: d.channelId || d.id,
        channelTitle: d.channelTitle || d.channelName || null,
        thumbnailUrl: d.thumbnailUrl || null,
      }));
  } catch (err) {
    console.warn('[Chat] Failed to fetch channels:', err.message);
    return [];
  }
}

/** Fetch EVERY connected channel across the whole system (all org channels +
 *  all users' personal tokens). Admin mode only. Dedupes by channelId
 *  (org entry wins). Shared by the /channels/all route and the messages
 *  handler so the admin-selected channel can be resolved to a full record. */
async function fetchAllSystemChannels(deps) {
  const { db } = deps;
  const channels = new Map();

  // 1. Org channels (organizations/{orgId}/channels/{channelId})
  const orgSnap = await db.collectionGroup('channels').get();
  orgSnap.docs.forEach((doc) => {
    const d = doc.data() || {};
    const channelId = d.channelId || doc.id;
    if (!channelId || channels.has(channelId)) return;
    channels.set(channelId, {
      channelId,
      channelTitle: d.channelTitle || d.channelName || 'Unknown',
      thumbnailUrl: d.thumbnailUrl || null,
      owner: { type: 'org', orgId: doc.ref.parent.parent?.id || null },
    });
  });

  // 2. Personal tokens (users/{uid}/youtubeTokens/{channelId})
  const tokenSnap = await db.collectionGroup('youtubeTokens').get();
  tokenSnap.docs.forEach((doc) => {
    const d = doc.data() || {};
    const channelId = d.channelId || doc.id;
    if (!channelId || channels.has(channelId)) return;
    channels.set(channelId, {
      channelId,
      channelTitle: d.channelTitle || d.channelName || 'Unknown',
      thumbnailUrl: d.thumbnailUrl || null,
      owner: { type: 'user', uid: d.uid || doc.ref.parent.parent?.id || null },
    });
  });

  return Array.from(channels.values());
}

/** Resolve org context from X-Org-Id header. */
async function resolveOrgContext(req, res, next, deps) {
  const orgId = req.headers['x-org-id'];
  if (!orgId) return next();
  const uid = req.authUser?.uid;
  if (!uid) return next();
  try {
    const isMember = await deps.getCachedOrgMembership(String(orgId), uid);
    if (isMember) req.orgId = orgId;
  } catch (err) {
    console.warn('[Chat] Org membership check failed:', err.message);
  }
  next();
}

/** Set admin context from req.adminUser. */
function adminContextMiddleware(req, res, next) {
  req.isAdmin = !!req.adminUser;
  next();
}

/**
 * Build the conversation access check -- returns true if the requesting user
 * can access the conversation.
 */
async function canAccessConversation(conversation, req, deps) {
  if (req.isAdmin) return true;
  if (conversation.orgId) {
    const isMember = await deps.getCachedOrgMembership(String(conversation.orgId), req.authUser?.uid);
    return !!isMember;
  }
  return conversation.userId === req.authUser?.uid;
}

/**
 * SSE helper: pipe executor events to the response stream.
 */
function setupSSE(req, res) {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders();

  const keepalive = setInterval(() => {
    try { res.write(':keepalive\n\n'); } catch { clearInterval(keepalive); }
  }, 15000);

  const abortController = new AbortController();
  req.on('close', () => {
    clearInterval(keepalive);
    abortController.abort();
  });

  return { keepalive, abortController };
}

/**
 * Express helper: builds the messages endpoint handler shared by both routers.
 */
function createMessagesHandler(deps) {
  const { requireQuota } = deps;
  return [
    requireQuota('chat'),
    async (req, res) => {
      const userId = req.authUser?.uid;
      if (!userId) {
        return res.status(401).json({ error: { message: 'Not authenticated' } });
      }

      const { message, contextChannelId, disabledTools } = req.body;
      if (!message || typeof message !== 'string' || message.trim().length === 0) {
        return res.status(400).json({ error: { message: 'Message is required' } });
      }
      if (message.length > 500) {
        return res.status(400).json({ error: { message: 'Message exceeds 500 character limit' } });
      }

      // Verify conversation exists and user has access
      const conversation = await deps.chatService.memory.getConversation(req.params.id);
      if (!conversation) {
        return res.status(404).json({ error: { message: 'Conversation not found' } });
      }
      if (!(await canAccessConversation(conversation, req, deps))) {
        return res.status(403).json({ error: { message: 'Access denied' } });
      }

      const userChannels = await fetchUserChannels(deps, userId, req.orgId || null);

      // Resolve the selected channel to its full record so the LLM and tools
      // know its title. Admin mode looks it up system-wide; user mode checks
      // the user's own channels.
      let contextChannel = null;
      if (contextChannelId) {
        if (req.chatMode === 'admin') {
          const all = await fetchAllSystemChannels(deps);
          contextChannel = all.find((c) => c.channelId === contextChannelId) || null;
        } else {
          contextChannel = userChannels.find((c) => c.channelId === contextChannelId) || null;
        }
      }

      // ── SSE Setup ──
      const { keepalive, abortController } = setupSSE(req, res);

      try {
        // Tool definitions -- tell client which tools are available
        res.write(`data: ${JSON.stringify({ type: 'tools', tools: deps.chatService.toolRegistry.listTools() })}\n\n`);

        // The channels event refreshes the selector. User mode: emit the user's
        // channels. Admin mode: skip it so the system-wide list loaded via
        // /channels/all is not replaced by the admin's own channels mid-stream.
        if (req.chatMode !== 'admin') {
          res.write(`data: ${JSON.stringify({ type: 'channels', channels: userChannels })}\n\n`);
        }

        if (req.usageInfo) {
          res.write(`data: ${JSON.stringify({ type: 'usage', pageKey: req.usageInfo.pageKey, used: req.usageInfo.used, limit: req.usageInfo.limit })}\n\n`);
        }

        await deps.chatService.executor.run({
          message: message.trim(),
          conversationId: req.params.id,
          user: { ...req.authUser, isAdmin: !!req.adminUser, role: req.adminUser ? 'admin' : undefined },
          orgId: req.orgId || null,
          userChannels,
          contextChannelId: contextChannelId || null,
          contextChannel,
          toolRegistry: deps.chatService.toolRegistry,
          guardrails: deps.chatService.guardrails,
          memory: deps.chatService.memory,
          mode: req.chatMode || 'user',
          // Per-request tool kill-switch (e.g. the admin chat "Direct DB SQL"
          // toggle sends disabledTools: ['queryAnalyticsDb']). Can only narrow
          // the mode's tool set, never widen it.
          disabledTools: Array.isArray(disabledTools)
            ? disabledTools.filter((t) => typeof t === 'string')
            : [],
          onToken: (token) => {
            try { res.write(`data: ${JSON.stringify({ type: 'token', content: token })}\n\n`); } catch { /* disconnected */ }
          },
          onToolStart: (toolInfo) => {
            try { res.write(`data: ${JSON.stringify({ type: 'tool_start' })}\n\n`); } catch { /* disconnected */ }
          },
          onToolEnd: (toolInfo) => {
            try {
              res.write(`data: ${JSON.stringify({ type: 'tool_end' })}\n\n`);
              res.write(`data: ${JSON.stringify({ type: 'thought_end' })}\n\n`);
            } catch { /* disconnected */ }
          },
          onThought: (thought) => {
            try { res.write(`data: ${JSON.stringify({ type: 'thought', content: thought })}\n\n`); } catch { /* disconnected */ }
          },
          onChart: (chart) => {
            try { res.write(`data: ${JSON.stringify({ type: 'chart', chart })}\n\n`); } catch { /* disconnected */ }
          },
          onTruncated: () => {
            try { res.write(`data: ${JSON.stringify({ type: 'truncated' })}\n\n`); } catch { /* disconnected */ }
          },
          signal: abortController.signal,
        });

        res.write(`data: ${JSON.stringify({ type: 'done' })}\n\n`);
      } catch (err) {
        console.error('[Chat] Agent execution error:', err.message);
        try { res.write(`data: ${JSON.stringify({ type: 'error', message: 'An error occurred while processing your request.' })}\n\n`); } catch { /* disconnected */ }
      } finally {
        clearInterval(keepalive);
        res.end();
      }
    },
  ];
}

// ── Router factories ────────────────────────────────────────────────────────────

/**
 * Create the Express router for USER chat.
 * Only analytical/audit/insights tools are exposed to the LLM.
 * Mounted at /api/chat.
 */
function createUserChatRouter(deps) {
  const { Router } = require('express');
  const router = Router();

  // Auth
  router.use(deps.authenticateRequest);

  // Org context
  router.use((req, res, next) => resolveOrgContext(req, res, next, deps));

  // Admin context
  router.use(adminContextMiddleware);

  // Set mode to 'user'
  router.use((req, res, next) => {
    req.chatMode = 'user';
    next();
  });

  // ── Endpoints ──
  const messagesHandler = createMessagesHandler(deps);

  // GET /channels -- list user's connected channels
  router.get('/channels', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const channels = await fetchUserChannels(deps, userId, req.orgId || null);
      res.json({ channels, isAdmin: !!req.isAdmin });
    } catch (err) {
      console.error('[Chat] List channels error:', err.message);
      res.status(500).json({ error: { message: 'Failed to list channels' } });
    }
  });

  // GET /conversations
  router.get('/conversations', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      const { conversations, totalCount } = await deps.chatService.memory.listConversations(
        userId, req.orgId || null, limit, offset, !!req.isAdmin
      );
      res.json({ conversations, totalCount, limit, offset, isAdmin: !!req.isAdmin });
    } catch (err) {
      console.error('[Chat] List conversations error:', err.message);
      res.status(500).json({ error: { message: 'Failed to list conversations' } });
    }
  });

  // POST /conversations
  router.post('/conversations', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const conversation = await deps.chatService.memory.createConversation(userId, req.orgId || null);
      res.status(201).json({ conversation });
    } catch (err) {
      console.error('[Chat] Create conversation error:', err.message);
      res.status(500).json({ error: { message: 'Failed to create conversation' } });
    }
  });

  // GET /conversations/:id
  router.get('/conversations/:id', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const limit = parseInt(req.query.limit || '100', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      const conversation = await deps.chatService.memory.getConversation(req.params.id, limit, offset);
      if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found' } });
      if (!(await canAccessConversation(conversation, req, deps))) {
        return res.status(403).json({ error: { message: 'Access denied' } });
      }
      res.json({ conversation });
    } catch (err) {
      console.error('[Chat] Get conversation error:', err.message);
      res.status(500).json({ error: { message: 'Failed to get conversation' } });
    }
  });

  // DELETE /conversations/:id
  router.delete('/conversations/:id', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const conversation = await deps.chatService.memory.getConversation(req.params.id);
      if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found' } });
      if (!(await canAccessConversation(conversation, req, deps))) {
        return res.status(403).json({ error: { message: 'Access denied' } });
      }
      await deps.chatService.memory.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('[Chat] Delete conversation error:', err.message);
      res.status(500).json({ error: { message: 'Failed to delete conversation' } });
    }
  });

  // POST /conversations/:id/messages
  router.post('/conversations/:id/messages', messagesHandler);

  return router;
}

/**
 * Create the Express router for ADMIN chat.
 * All tools are exposed including recommendations/suggestions.
 * Mounted at /api/chat/admin behind checkAdmin.
 */
function createAdminChatRouter(deps) {
  const { Router } = require('express');
  const router = Router();

  // Admin authentication
  router.use(deps.checkAdmin);
  router.use(deps.authenticateRequest);

  // Org context
  router.use((req, res, next) => resolveOrgContext(req, res, next, deps));

  // Admin context
  router.use(adminContextMiddleware);

  // Set mode to 'admin'
  router.use((req, res, next) => {
    req.chatMode = 'admin';
    next();
  });

  // ── Endpoints (mirror user chat but with admin mode) ──
  const messagesHandler = createMessagesHandler(deps);

  // GET /channels
  router.get('/channels', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const channels = await fetchUserChannels(deps, userId, req.orgId || null);
      res.json({ channels, isAdmin: !!req.isAdmin });
    } catch (err) {
      console.error('[Chat Admin] List channels error:', err.message);
      res.status(500).json({ error: { message: 'Failed to list channels' } });
    }
  });

  // GET /channels/all -- list ALL channels across all users and orgs (admin only)
  router.get('/channels/all', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const q = (req.query.q || '').toLowerCase();
      const limit = Math.min(parseInt(req.query.limit || '20', 10), 100);
      const offset = parseInt(req.query.offset || '0', 10);

      const all = await fetchAllSystemChannels(deps);

      // Filter by search term, then paginate
      const filtered = q
        ? all.filter((ch) => ch.channelTitle.toLowerCase().includes(q))
        : all;
      const total = filtered.length;
      const paginated = filtered.slice(offset, offset + limit);

      res.json({ channels: paginated, total, limit, offset });
    } catch (err) {
      console.error('[Chat Admin] Search all channels error:', err.message);
      res.status(500).json({ error: { message: 'Failed to search channels' } });
    }
  });

  // GET /conversations
  router.get('/conversations', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const limit = parseInt(req.query.limit || '50', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      // Admin conversations are stored with type='admin' and are separate from user chats
      const { conversations, totalCount } = await deps.chatService.memory.listConversations(
        userId, null, limit, offset, true, 'admin'
      );
      res.json({ conversations, totalCount, limit, offset, isAdmin: true });
    } catch (err) {
      console.error('[Chat Admin] List conversations error:', err.message);
      res.status(500).json({ error: { message: 'Failed to list conversations' } });
    }
  });

  // POST /conversations
  router.post('/conversations', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const conversation = await deps.chatService.memory.createConversation(userId, null, 'admin');
      res.status(201).json({ conversation });
    } catch (err) {
      console.error('[Chat Admin] Create conversation error:', err.message);
      res.status(500).json({ error: { message: 'Failed to create conversation' } });
    }
  });

  // GET /conversations/:id
  router.get('/conversations/:id', async (req, res) => {
    try {
      const userId = req.authUser?.uid;
      if (!userId) return res.status(401).json({ error: { message: 'Not authenticated' } });
      const limit = parseInt(req.query.limit || '100', 10);
      const offset = parseInt(req.query.offset || '0', 10);
      const conversation = await deps.chatService.memory.getConversation(req.params.id, limit, offset);
      if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found' } });
      // Admin conversations: check type === 'admin'
      if (conversation.type !== 'admin') {
        return res.status(403).json({ error: { message: 'Access denied' } });
      }
      res.json({ conversation });
    } catch (err) {
      console.error('[Chat Admin] Get conversation error:', err.message);
      res.status(500).json({ error: { message: 'Failed to get conversation' } });
    }
  });

  // DELETE /conversations/:id
  router.delete('/conversations/:id', async (req, res) => {
    try {
      const conversation = await deps.chatService.memory.getConversation(req.params.id);
      if (!conversation) return res.status(404).json({ error: { message: 'Conversation not found' } });
      if (conversation.type !== 'admin') {
        return res.status(403).json({ error: { message: 'Access denied' } });
      }
      await deps.chatService.memory.deleteConversation(req.params.id);
      res.json({ success: true });
    } catch (err) {
      console.error('[Chat Admin] Delete conversation error:', err.message);
      res.status(500).json({ error: { message: 'Failed to delete conversation' } });
    }
  });

  // POST /conversations/:id/messages
  router.post('/conversations/:id/messages', messagesHandler);

  return router;
}

module.exports = { createChatService, createUserChatRouter, createAdminChatRouter };
