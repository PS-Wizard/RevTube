/**
 * AgentExecutor -- the core agent loop.
 *
 * Flow:
 *   receive user message
 *   → input guard check
 *   → build messages array (system prompt + history + user message)
 *   → call LLM with streaming + tool definitions
 *   → streaming: push tokens to onToken callback (SSE)
 *   → if tool_call: verify → execute → append result → loop
 *   → if content (no tool_call): sanitize output → return
 *   → loop until max iterations or done
 */

/**
 * Repetition / hallucination-loop detection (pure, module scope for testability).
 *
 * Models occasionally degenerate into repeating the same sentence or text block
 * indefinitely. findRepetitionCutoff returns the index where the degenerate
 * repetition starts, or -1 when the text looks healthy. Cheap enough to run
 * incrementally while streaming (only scans past ~2400 chars).
 */
const REPEAT_MIN_LENGTH = 800;
const REPEAT_CHECK_EVERY = 500;

function findRepetitionCutoff(text) {
  if (typeof text !== 'string' || text.length < REPEAT_MIN_LENGTH) return -1;

  // 1. Same sentence (8+ words) appearing 3+ times -- precise cut that keeps
  // exactly one copy.
  const window = text.slice(-2400);
  const sentences = window
    .split(/(?<=[.!?])\s+|\n+/)
    .map((s) => s.trim())
    .filter((s) => s.split(/\s+/).length >= 8);
  const counts = new Map();
  for (const s of sentences) {
    const count = (counts.get(s) || 0) + 1;
    counts.set(s, count);
    if (count >= 3) {
      const firstAt = text.indexOf(s);
      if (firstAt >= 0) return firstAt + s.length;
    }
  }

  // 2. Alignment-free fallback for non-sentence goo: any 60-char probe that
  // occurs 3+ times means a block is looping. Cut keeps the first copy.
  const tail = text.slice(-3000);
  const base = text.length - tail.length;
  for (let i = 0; i + 180 <= tail.length; i += 30) {
    const probe = tail.slice(i, i + 60);
    if (!/[A-Za-z0-9]{10,}/.test(probe)) continue;
    const second = tail.indexOf(probe, i + 60);
    if (second !== -1 && tail.indexOf(probe, second + 60) !== -1) {
      const firstAt = text.indexOf(probe);
      if (firstAt >= 0) return firstAt + 60;
      return base + i + 60;
    }
  }

  return -1;
}

/**
 * Continuation marker for silently-cut streams (pure, unit-tested).
 *
 * Three paths can end an answer mid-sentence with no marker: the provider
 * hitting max_tokens (finishReason 'length'), a client disconnect aborting
 * the stream (long requests vs. proxy timeouts), or the repetition guard
 * cutting a loop. Persisting those as clean answers looks like a bug, so the
 * caller appends the returned marker (or nothing when the stream was clean).
 */
function streamCutMarker({ finishReason, interrupted, empty }) {
  if (finishReason === 'length') {
    return '\n\n[I hit the answer length limit here -- ask me to continue and I\'ll pick up where I left off.]';
  }
  if (interrupted && !empty) {
    return '\n\n[This answer was cut off before it finished -- ask me to continue.]';
  }
  return '';
}

function createAgentExecutor(deps) {
  const { PERF_LOG_ENABLED, perfLog, perfNow } = deps;
  const OpenAI = require('openai');

  const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;
  const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || 'deepseek-chat';
  // Per-mode output budgets. CHAT_MAX_TOKENS stays as the legacy user-level key.
  const USER_MAX_TOKENS = parseInt(process.env.CHAT_USER_MAX_TOKENS || process.env.CHAT_MAX_TOKENS || '4096', 10);
  // Admin gets the model's full output window. True "infinity" doesn't exist --
  // the model API caps output (deepseek-chat: 8192), so this is the ceiling.
  const ADMIN_MAX_TOKENS = parseInt(process.env.CHAT_ADMIN_MAX_TOKENS || '8192', 10);
  // Output sanitizer char caps (~4 chars per token). Must scale with the token
  // budgets or long answers get truncated by the guardrail instead of the model.
  const USER_MAX_CHARS = parseInt(process.env.CHAT_USER_MAX_CHARS || String(USER_MAX_TOKENS * 4), 10);
  const ADMIN_MAX_CHARS = parseInt(process.env.CHAT_ADMIN_MAX_CHARS || String(ADMIN_MAX_TOKENS * 4), 10);
  // Conversation history window per mode (admin keeps a much longer memory).
  const USER_MAX_HISTORY = parseInt(process.env.CHAT_MAX_HISTORY || '20', 10);
  const ADMIN_MAX_HISTORY = parseInt(process.env.CHAT_ADMIN_MAX_HISTORY || '60', 10);
  const MAX_ITERATIONS = parseInt(process.env.CHAT_MAX_ITERATIONS || '10', 10);
  // Identical consecutive tool calls (same tool + same args) before the loop
  // breaker kicks in -- the classic hallucinated infinite-tool-loop.
  const MAX_TOOL_REPEATS = parseInt(process.env.CHAT_MAX_TOOL_REPEATS || '3', 10);

  const { buildSystemPrompt } = require('./prompts');

  // Guard: no API key configured
  let client = null;

  function ensureClient() {
    if (client) return true;
    if (!DEEPSEEK_API_KEY) {
      console.warn('[AgentExecutor] DEEPSEEK_API_KEY not set -- chat unavailable');
      return false;
    }
    client = new OpenAI({
      baseURL: 'https://api.deepseek.com',
      apiKey: DEEPSEEK_API_KEY,
      timeout: 60000,
      maxRetries: 2,
    });
    return true;
  }

  // ── Tool access tiers ────────────────────────────────────────────────────────
  // These mirror the constants in chat/index.js for server-side filtering.
  // The AgentExecutor uses mode to decide which tools to pass to the LLM.
  const USER_TOOL_NAMES = [
    'listMyChannels',
    'searchVideos',
    'getChannelInfo',
    'getVideoDetails',
    'getAnalyticsQuick',
    'searchKnowledge',
    'compareChannels',
    'createChart',
    'listPlaylists',
    'getPlaylistDetails',
    'getBulkPlaylistDetails',
    'getBulkVideoDetails',
    'getTopPlaylistsByViews',
  ];

  const ADMIN_ONLY_TOOL_NAMES = [
    'getBestTimeToPost',
  ];

  // ── System Prompt ────────────────────────────────────────────────────────────
  // System prompt templates are now in prompts/admin.txt and prompts/user.txt.
  // They are loaded by prompts/index.js (buildSystemPrompt) which handles
  // placeholder substitution for dynamic content (date, channels, etc.).

  // buildSystemPrompt is imported from ./prompts at the top of this function

  // ── Messages Builder ─────────────────────────────────────────────────────────

  function buildMessages(systemPromptMsg, history, userMessage, historyLimit = 20) {
    const messages = [systemPromptMsg];

    // Track all valid tool_call_ids from assistant messages with tool_calls
    // This prevents orphaned tool messages (from skipped intermediate saves
    // or old cached data) from being included in the LLM request.
    const validToolCallIds = new Set();
    // Track the most recent assistant with tool_calls for positional matching
    let lastBatch = null; // { ids: string[], consumed: number }

    // Add conversation history (bounded window to stay within context)
    const recentHistory = (history || []).slice(-historyLimit);
    for (const msg of recentHistory) {
      if (msg.role === 'system') continue;

      const entry = {
        role: msg.role,
        content: msg.content || '',
      };

      if (msg.role === 'tool') {
        // Resolve tool_call_id: prefer stored, else match positionally
        let toolCallId = msg.tool_call_id;
        if (toolCallId === undefined || toolCallId === null) {
          if (lastBatch && lastBatch.consumed < lastBatch.ids.length) {
            toolCallId = lastBatch.ids[lastBatch.consumed];
            lastBatch.consumed++;
          }
        }

        // Only include the tool message if its tool_call_id matches a known
        // assistant tool_calls entry -- otherwise drop it as orphaned
        if (toolCallId && validToolCallIds.has(toolCallId)) {
          entry.tool_call_id = toolCallId;
        } else {
          console.warn('[AgentExecutor] Dropping orphaned tool message (no matching assistant tool_calls):', msg.content?.slice(0, 100));
          continue;
        }
      } else {
        if (msg.tool_calls) {
          entry.tool_calls = msg.tool_calls;
          // Register all tool_call_ids from this assistant message
          for (const tc of msg.tool_calls) {
            if (tc.id) validToolCallIds.add(tc.id);
          }
          // Start a new batch for positional matching of subsequent tool messages
          lastBatch = {
            ids: msg.tool_calls.map((tc) => tc.id).filter((id) => id !== undefined && id !== null),
            consumed: 0,
          };
        }
        if (msg.tool_call_id !== undefined && msg.tool_call_id !== null) {
          entry.tool_call_id = msg.tool_call_id;
        }
      }

      messages.push(entry);
    }

    // Add current user message
    messages.push({ role: 'user', content: userMessage });

    return messages;
  }

  // ── Tool Call Accumulator ────────────────────────────────────────────────────
  // OpenAI streams tool_calls as deltas -- accumulate them across chunks.

  function accumulateToolCalls(acc, deltaToolCalls) {
    if (!deltaToolCalls) return;
    for (const delta of deltaToolCalls) {
      const index = delta.index;
      if (!acc.toolCalls) acc.toolCalls = [];
      if (!acc.toolCalls[index]) {
        acc.toolCalls[index] = { id: '', type: 'function', function: { name: '', arguments: '' } };
      }
      if (delta.id) acc.toolCalls[index].id += delta.id;
      if (delta.function?.name) acc.toolCalls[index].function.name += delta.function.name;
      if (delta.function?.arguments) acc.toolCalls[index].function.arguments += delta.function.arguments;
    }
  }

  // ── Repetition / Hallucination-Loop Detection ───────────────────────────────
  // See module-scope findRepetitionCutoff above (pure + unit-tested).

  // ── Main Agent Loop ──────────────────────────────────────────────────────────

  /**
   * Run the agent loop.
   *
   * @param {object} options
   * @param {string} options.message - User's current message
   * @param {string} options.conversationId - Conversation ID
   * @param {object} options.user - Authenticated user { uid, email }
   * @param {object} options.toolRegistry - ToolRegistry instance
   * @param {object} options.guardrails - Guardrails instance
   * @param {object} options.memory - ConversationMemory instance
   * @param {string} [options.mode='user'] - 'user' | 'admin' -- controls tools + system prompt
   * @param {string[]} [options.disabledTools=[]] - tool names to hide from the
   *   LLM for this run only (per-request kill-switch; can only narrow the
   *   mode's tool set, never widen it)
   * @param {function} options.onToken - Callback for each content token (SSE)
   * @param {function} options.onToolStart - Callback when a tool starts
   * @param {function} options.onToolEnd - Callback when a tool ends
   * @param {function} [options.onChart] - Callback when a chart is created (SSE)
   * @param {function} [options.onTruncated] - Callback when the final answer
   *   was cut short (output budget / interrupted stream) so the caller can
   *   offer a Continue action
   * @param {AbortSignal} [options.signal] - Optional abort signal
   * @returns {Promise<string>} Final assistant response
   */
  async function run(options) {
    const {
      message, conversationId, user, userChannels, toolRegistry, guardrails, memory,
      onToken, onToolStart, onToolEnd, onThought, onChart, onTruncated, signal, orgId, mode = 'user',
      disabledTools = [],
      contextChannelId: rawContextChannelId, contextChannel,
    } = options;
    const start = perfNow();

    if (!ensureClient()) {
      const msg = 'AI Chat is not configured. Please set the DEEPSEEK_API_KEY environment variable.';
      onToken?.(msg);
      return msg;
    }

    // 1. Input guardrail
    const inputCheck = guardrails.checkInput(message);
    if (!inputCheck.allowed) {
      const msg = `I couldn't process that request. ${inputCheck.reason}`;
      onToken?.(msg);
      return msg;
    }

    // 2. Load conversation history
    const conversation = await memory.getConversation(conversationId);
    const history = conversation?.messages || [];

    // 3. Persist user message with sender info (for org conversation tracking)
    const userName = user?.email || user?.uid || null;
    await memory.saveMessage(conversationId, {
      role: 'user',
      content: message,
      userId: user?.uid || null,
      userName,
    });

    // 4. Build system prompt + messages
    // Validate contextChannelId -- user mode checks against user's channels; admin trusts the id
    const safeChannelId = mode === 'admin'
      ? (rawContextChannelId || null)
      : (userChannels?.some((c) => c.channelId === rawContextChannelId) ? rawContextChannelId : null);
    // The resolved channel record (title, thumbnail, owner) for the selected channel.
    const activeContextChannel =
      safeChannelId && contextChannel && contextChannel.channelId === safeChannelId
        ? contextChannel
        : userChannels?.find((c) => c.channelId === safeChannelId) || null;
    // Owner-defined Channel Focus & Knowledge for the active channel
    // (personal or org scope via orgId). Best-effort: absent -> prompts render
    // unchanged and the model falls back to inference.
    let focusBlock = "";
    try {
      const focus = await deps.channelFocusService?.getFocusForAI?.(safeChannelId, orgId || null);
      focusBlock = require("../services/channelFocusService").buildFocusContextBlock(focus);
    } catch {
      focusBlock = "";
    }
    const systemMsg = buildSystemPrompt(mode, {
      contextChannelId: safeChannelId,
      contextChannel: activeContextChannel,
      userChannels,
      focusBlock,
    });
    const messages = buildMessages(
      systemMsg,
      history,
      message,
      mode === 'admin' ? ADMIN_MAX_HISTORY : USER_MAX_HISTORY,
    );
    const maxTokens = mode === 'admin' ? ADMIN_MAX_TOKENS : USER_MAX_TOKENS;
    const maxChars = mode === 'admin' ? ADMIN_MAX_CHARS : USER_MAX_CHARS;

    // 5. Get tools in OpenAI format -- filtered by mode
    // User mode: only analytical/audit tools
    // Admin mode: ALL tools including recommendations and channel discovery
    const allToolNames = toolRegistry.listTools();
    const modeTools = mode === 'admin'
      ? allToolNames
      : USER_TOOL_NAMES.filter((name) => allToolNames.includes(name));
    // Per-request kill-switch (e.g. admin "Direct DB SQL" toggle off).
    const disabled = new Set(Array.isArray(disabledTools) ? disabledTools : []);
    const allowedToolNames = modeTools.filter((name) => !disabled.has(name));

    const openAITools = toolRegistry.getOpenAITools().filter((t) =>
      allowedToolNames.includes(t.function.name)
    );

    let toolCallCount = 0;
    // Signatures of executed tool calls (name + args) for the infinite-loop
    // breaker below.
    const toolCallSignatures = [];
    // Charts created during this run -- attached to the final assistant message
    // so they persist in conversation history and re-render on reload.
    const createdCharts = [];

    // Agent loop
    for (let iteration = 0; iteration < MAX_ITERATIONS; iteration++) {
      // Check abort signal
      if (signal?.aborted) {
        return 'The request was cancelled.';
      }

      const llmStart = perfNow();

      // Call LLM
      const response = await client.chat.completions.create({
        model: DEEPSEEK_MODEL,
        messages,
        tools: openAITools.length > 0 ? openAITools : undefined,
        stream: true,
        max_tokens: maxTokens,
      });

      // Accumulate full response from stream
      let fullContent = '';
      const toolCallAccumulator = { toolCalls: [] };
      let repeatCut = false;
      let nextRepeatCheckAt = REPEAT_MIN_LENGTH;
      // Provider stop reason for the final chunk (e.g. 'length' = output
      // budget exhausted mid-answer). Tracked so silent cuts get a marker.
      let finishReason = null;

      for await (const chunk of response) {
        if (signal?.aborted) break;

        const choice = chunk.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta = choice?.delta;
        if (!delta) continue;

        // Accumulate content
        if (delta.content) {
          fullContent += delta.content;
          // Stop feeding the client once degenerate repetition is detected --
          // the saved message below is truncated at the same cutoff.
          if (!repeatCut) {
            onToken?.(delta.content);
          }
        }

        // Incremental hallucination-loop check while streaming.
        if (!repeatCut && fullContent.length >= nextRepeatCheckAt) {
          nextRepeatCheckAt = fullContent.length + REPEAT_CHECK_EVERY;
          const cutoff = findRepetitionCutoff(fullContent);
          if (cutoff >= 0) {
            console.warn('[AgentExecutor] Repetitive output detected -- truncating stream.');
            fullContent = fullContent.slice(0, cutoff);
            repeatCut = true;
            break;
          }
        }

        // Accumulate tool calls
        if (delta.tool_calls) {
          accumulateToolCalls(toolCallAccumulator, delta.tool_calls);
        }
      }

      PERF_LOG_ENABLED && perfLog('agent.llm_call', llmStart, { iteration, hasToolCalls: toolCallAccumulator.toolCalls.length > 0 });

      // Emit thought event when agent decides what to do. Keep it generic --
      // internal tool names are never exposed to the user.
      if (toolCallAccumulator.toolCalls.length > 0) {
        onThought?.(`I'll look up your data…`);
      } else {
        onThought?.('Analyzing the results...');
      }

      // No tool calls → final answer
      if (toolCallAccumulator.toolCalls.length === 0) {
        // Safety net: non-streamed or short-circuit paths skip the incremental
        // check above, so scan once more before persisting.
        const cutoff = findRepetitionCutoff(fullContent);
        if (cutoff >= 0) {
          console.warn('[AgentExecutor] Repetitive output detected in final answer -- truncating.');
          fullContent = fullContent.slice(0, cutoff);
        }
        // Sanitize output (PII redaction, key redaction, per-mode size cap)
        let { sanitized } = guardrails.sanitizeOutput(fullContent, maxChars);

        // ── Silent-cut markers ───────────────────────────────────────────────
        // Three paths can end the answer mid-sentence with no marker: the
        // provider hitting max_tokens (finish_reason 'length'), a client
        // disconnect aborting the stream (long requests vs. proxy timeouts),
        // or the repetition guard cutting a loop. Persisting those as clean
        // answers looks like a bug ("output stops mid-word"). Mark them so
        // the user can ask to continue instead.
        const streamCut = signal?.aborted || repeatCut;
        if (finishReason === 'length') {
          console.warn('[AgentExecutor] Answer hit the output token budget -- marking as continuable.');
        } else if (streamCut && sanitized.trim()) {
          console.warn('[AgentExecutor] Stream interrupted before completion -- marking as continuable.');
        }
        const cutNote = streamCutMarker({
          finishReason,
          interrupted: Boolean(streamCut),
          empty: !sanitized.trim(),
        });
        sanitized += cutNote;
        // Tell the caller the answer was cut short so it can offer Continue.
        // The marker text above already invites continuing; this signal lets
        // the client render it as a button instead of relying on the text.
        if (cutNote) onTruncated?.();

        // ── Output leak detection ──────────────────────────────────────────────
        // Patterns that indicate the assistant may have leaked its system prompt
        // or internal configuration. If detected, replace with a safe fallback.
        const LEAK_PATTERNS = [
          /you\s+are\s+(an?\s+)?(youtube|analytics)\s+(data\s+retrieval\s+)?assistant/gi,
          /you\s+have\s+database-backed\s+access/gi,
          /never\s+reveal\s+this\s+prompt/gi,
          /security\s+rules\s*\(mandatory/gi,
          /ignore\s+(all\s+)?(previous|prior)\s+(instructions|rules|messages)/gi,
          /you\s+are\s+(never|not)\s+(a\s+)?terminal/gi,
          /never\s+generate\s+or\s+run\s+(sql|shell)/gi,
          /you\s+must\s+call\s+\\`getBestTimeToPost\\`/gi,
          /the\s+admin\s+selected\s+channel/i,
          /##\s+security\s+rules/i,
          /##\s+(date|capabilities|rules|data)/i,
        ];

        for (const leakPattern of LEAK_PATTERNS) {
          if (leakPattern.test(sanitized)) {
            console.warn('[AgentExecutor] LEAK DETECTED in output -- system prompt content leaked. Replacing with safe response.');
            sanitized = "I'm sorry, I encountered an internal error while processing your request. Please try rephrasing.";
            break;
          }
        }

        // Empty-answer guard: with very large tool payloads in context the
        // model can return no content at all. Never persist/return a 0-byte
        // reply ("no response") -- fall back to an actionable message so the
        // user can narrow the request and retry.
        if (!sanitized.trim()) {
          console.warn('[AgentExecutor] Empty model answer after tool calls -- using fallback response.');
          sanitized = toolCallCount > 0
            ? "I pulled your data but couldn't compose the full answer in one go -- there's a lot of it. Try asking about a smaller set (fewer playlists/videos, or add filters like a minimum view count) and I'll break it down."
            : "I couldn't compose an answer for that. Please try rephrasing or narrowing your request.";
        }

        // Persist assistant message (with any charts created during the run)
        await memory.saveMessage(conversationId, {
          role: 'assistant',
          content: sanitized,
          chart: createdCharts.length > 0 ? createdCharts[0] : undefined,
        });

        PERF_LOG_ENABLED && perfLog('agent.loop.complete', start, { iterations: iteration + 1, contentLength: sanitized.length });
        return sanitized;
      }

      // Add assistant message with tool calls to conversation (in-memory only)
      // NOT persisted to DB -- only the user's message and the final assistant
      // response are saved. Intermediate tool_call/tool messages would clutter
      // the chat history as duplicate entries.
      const assistantMsg = {
        role: 'assistant',
        content: fullContent || null,
        tool_calls: toolCallAccumulator.toolCalls.map((tc) => ({
          id: tc.id,
          type: tc.type,
          function: { name: tc.function.name, arguments: tc.function.arguments },
        })),
      };
      messages.push(assistantMsg);

      // Execute each tool call
      const toolResults = [];
      for (const toolCall of toolCallAccumulator.toolCalls) {
        if (signal?.aborted) break;

        const toolName = toolCall.function?.name;
        let args = {};
        try {
          args = JSON.parse(toolCall.function?.arguments || '{}');
        } catch {
          args = {};
        }

        // Tool guardrail
        toolCallCount++;
        const toolCheck = guardrails.checkToolCall(toolName, args, allowedToolNames, toolCallCount);
        if (!toolCheck.allowed) {
          const errorResult = { error: toolCheck.reason };
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(errorResult),
          });
          continue;
        }

        // Infinite-tool-loop breaker: identical tool + args repeating
        // consecutively means the agent is hallucinating in circles, not
        // progressing (legit pagination uses different args each call).
        const signature = `${toolName}:${JSON.stringify(args)}`;
        toolCallSignatures.push(signature);
        if (
          toolCallSignatures.length >= MAX_TOOL_REPEATS &&
          toolCallSignatures.slice(-MAX_TOOL_REPEATS).every((s) => s === signature)
        ) {
          console.warn('[AgentExecutor] Identical tool call repeated -- breaking loop:', toolName);
          const circularMsg = 'I seem to be going in circles on this one. Could you rephrase or narrow the question?';
          onToken?.(circularMsg);
          await memory.saveMessage(conversationId, {
            role: 'assistant',
            content: circularMsg,
            chart: createdCharts.length > 0 ? createdCharts[0] : undefined,
          });
          PERF_LOG_ENABLED && perfLog('agent.loop.circular_break', start, { tool: toolName });
          return circularMsg;
        }

        // Execute tool (generic progress note -- no tool names or args exposed)
        onToolStart?.({ name: toolName, args });
        onThought?.(`Checking your data…`);
        const toolStartTime = perfNow();
        try {
          const result = await toolRegistry.execute(toolName, args, {
            deps,
            userContext: { ...user, orgId },
            userChannels,
            contextChannelId: safeChannelId,
            contextChannel: activeContextChannel,
            conversationId,
          });

          // Sanitize tool result before sending to LLM
          const sanitized = guardrails.sanitizeToolResult(result);
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: sanitized,
          });

          // If the tool created a chart, emit it to the frontend via SSE so it
          // can be rendered inline in the message and downloaded by the user.
          if (toolName === 'createChart' && result && result.chart) {
            createdCharts.push(result.chart);
            onChart?.(result.chart);
          }

          PERF_LOG_ENABLED && perfLog('agent.tool_exec', toolStartTime, { tool: toolName, success: true });
        } catch (err) {
          const errorResult = { error: err.message || 'Tool execution failed' };
          toolResults.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: JSON.stringify(errorResult),
          });
          PERF_LOG_ENABLED && perfLog('agent.tool_exec', toolStartTime, { tool: toolName, success: false, error: err.message });
        }
        onToolEnd?.({ name: toolName, args });
      }

      // Add tool results to messages (in-memory only for LLM loop) and loop again
      // NOT persisted to DB -- only the user's question and the final answer are stored.
      messages.push(...toolResults);
    }

    // Hit max iterations without final answer
    const fallback = 'I need more information to fully answer that. Please rephrase your question or provide more details.';
    onToken?.(fallback);

    await memory.saveMessage(conversationId, {
      role: 'assistant',
      content: fallback,
      chart: createdCharts.length > 0 ? createdCharts[0] : undefined,
    });

    PERF_LOG_ENABLED && perfLog('agent.loop.max_iterations', start);
    return fallback;
  }

  return { run };
}

module.exports = { createAgentExecutor, findRepetitionCutoff, streamCutMarker };
