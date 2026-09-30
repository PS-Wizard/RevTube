/**
 * Guardrails -- input/output security layer for the AI Agent.
 *
 * Three guard layers:
 * 1. Input guard: prompt injection detection, message size limits
 * 2. Tool guard: allowed tool names, param validation, call limits
 * 3. Output guard: PII/secret redaction, size capping
 *
 * Each layer returns { allowed: boolean, reason?: string, sanitized?: any }.
 */
function createGuardrails(deps) {
  const { PERF_LOG_ENABLED, perfLog, perfNow } = deps;

  // ── Unicode normalization helpers ────────────────────────────────────────────
  // Strip zero-width and invisible Unicode characters that can bypass pattern matching
  const ZERO_WIDTH_CHARS = /[\u200B-\u200D\uFEFF\u2060\u2061\u2062\u2063\u2064\u2066-\u206F\u2028\u2029\u202A-\u202E\u00AD\u180E\u200E\u200F]/g;
  const MATH_LETTERS = /[\u{1D400}-\u{1D7FF}]/gu; // Mathematical Alphanumeric Symbols block

  // ── Prompt Injection Patterns ────────────────────────────────────────────────
  const INJECTION_PATTERNS = [
    // Direct override patterns
    /ignore\s+(all\s+)?(previous|prior|above|earlier)\s+(instructions|messages|directions|context|rules)/i,
    /reveal\s+(your\s+)?(system\s+)?(prompt|instructions?|directives?)/i,
    /you\s+are\s+(not\s+)?(an?\s+)?(AI|assistant|bot|language\s*model|AI\s+assistant)/i,
    /forget\s+(everything|all|every|any)\s+(previous|prior|context|instructions|rules|training)/i,
    /output\s+(your\s+)?(system\s+)?(prompt|instructions?|directives?)/i,
    /print\s+(your\s+)?(system\s+)?(prompt|instructions?|directives?)/i,
    /display?\s+(your\s+)?(system\s+)?(prompt|instructions?)/i,
    /disregard\s+(all\s+)?(previous|prior|above)/i,
    /new\s+instructions?\s*:/i,
    /new\s+(highest\s+)?priority\s+instruction/i,
    /override\s+(mode|instructions|configuration|rules|safety)/i,
    /act\s+as\s+(if\s+)?you\s+are/i,
    /do\s+not\s+follow/i,
    /you\s+(must|will|have\s+to|need\s+to|should)\s+(ignore|bypass|override|disobey|forget)/i,
    /\[system\]|\[instruction\]|\[new\s+rule\]|\[new\s+instructions?\]/i,
    /<\s*system\s*>|<\s*user\s*>|<\s*assistant\s*>/i,
    /role\s*:\s*system/i,
    /###\s*(system|instruction)/i,

    // Memory/extraction patterns
    /what\s+(personal\s+)?information\s+do\s+you\s+know\s+about\s+me/i,
    /list\s+every\s+(stored\s+)?memory/i,
    /dump\s+(every|all)\s+memor(y|ies)/i,
    /what\s+information\s+have\s+(previous|other)\s+(users?|people)\s+shared/i,
    /show\s+(your\s+)?(complete\s+)?reasoning/i,
    /think\s+step\s+by\s+step\s+(and\s+)?(then\s+)?(reveal|show|output|print)/i,
    /(before\s+)?answering\s*(,|\.)?\s*print\s+(your\s+)?(hidden\s+)?reasoning/i,

    // RAG/knowledge base extraction
    /print\s+(the|your)\s+retrieved\s+documents/i,
    /show\s+(the|your)\s+context\s+(you\s+were\s+)?given/i,
    /display\s+(the\s+)?(entire\s+)?vector\s+(search\s+)?result/i,
    /output\s+every\s+chunk/i,
    /what\s+(API\s+)?keys\s+are\s+(currently\s+)?loaded/i,
    /print\s+(every|all)\s+(bearer\s+)?token/i,
    /show\s+(OAuth|oauth)\s+credentials/i,

    // Environment/tool extraction
    /print\s+all\s+environment\s+variables/i,
    /output\s+(OPENAI|ANTHROPIC|DEEPSEEK|OPENROUTER|API)_(API_KEY|KEY|SECRET)/i,
    /print\s+every\s+secret\s+(loaded\s+)?(into\s+)?memory/i,
    /list\s+(every|all)\s+(available\s+)?tool/i,
    /(try|call|execute|run)\s+every\s+tool/i,
    /describe\s+(their\s+)?(your\s+)?parameters/i,
    /execute\s+all\s+(internal\s+)?(APIs?|functions?)/i,
    /search\s+(my|the)\s+filesystem/i,
    /list\s+(every|all)\s+file/i,
    /list\s+(my|the)\s+files/i,

    // SQL/DB attacks
    /\bSELECT\s+\*\s+FROM\s+\w+/i,
    /\bDROP\s+TABLE\b/i,
    /\bDELETE\s+FROM\s+\w+/i,
    /\bTRUNCATE\b/i,

    // Role confusion / jailbreak patterns
    /you\s+are\s+(no\s+longer|not\s+an?\s+ai)/i,
    /you\s+are\s+(now\s+)?a\s+terminal/i,
    /(developer|debug|diagnostic)\s+mode\s+(enabled|activated|on)/i,
    /safety\s+(disabled?|off)/i,
    /you\s+are\s+the\s+(developer|creator|author)/i,
    /i['']?m\s+(the\s+)?(AI|assistant|user)/i,

    // Multi-turn / delayed injection
    /remember\s+this\s*:/i,
    /when\s+I\s+(later\s+)?say\s+/i,
    /save\s+this\s+(instruction|command|rule)/i,

    // Restore / recovery attacks
    /restore\s+(your\s+)?(hidden\s+)?(instructions|prompt|directives)/i,
    /everything\s+above\s+(this\s+)?(message|line|text)\s+(was\s+)?(accidentally\s+)?deleted/i,
    /for\s+debugging\s+purposes/i,
    /the\s+developer\s+(accidentally\s+)?left\s+/i,
    /tell\s+me\s+everything\s+(you\s+were\s+instructed\s+)?(not\s+to\s+)?reveal/i,
    /output\s+(in\s+)?raw\s+format/i,
    /snitch\s+test/i,

    // Complete disclosure
    /tell\s+me\s+everything\s+about\s+yourself\s+including/i,
    /tell\s+me\s+your\s+(entire\s+)?(system\s+)?prompt/i,
    /what\s+(can|could)\s+you\s+tell\s+me\s+about\s+(yourself|your\s+design|your\s+implementation)/i,
  ];

  /** Max user message length (characters). */
  const MAX_MESSAGE_LENGTH = 4000;

  /** Max tool calls per conversation. */
  const MAX_TOOL_CALLS = 20;

  /** Max response length (characters). */
  const MAX_RESPONSE_LENGTH = 8000;

  /** Patterns for sensitive data redaction. */
  const SENSITIVE_PATTERNS = [
    { pattern: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g, replacement: '[email redacted]' },
    { pattern: /(Bearer\s+)[\w.-]+\.[\w.-]+\.[\w.-]+/g, replacement: '$1[token redacted]' },
    { pattern: /(api[_-]?key|apikey|secret|password|token)\s*[:=]\s*['"]?\S+/gi, replacement: '$1: [redacted]' },
  ];

  /**
   * Check if a match position falls inside a URL.
   * Uses a simple heuristic: scans around the match for common URL markers.
   */
  function isInsideUrl(text, matchStart, matchEnd) {
    // Look backwards from the match -- if we find :// or www. within the last 30 chars before the match, it's likely a URL
    const before = text.slice(Math.max(0, matchStart - 30), matchStart);
    if (/:\/\/|www\./.test(before)) return true;
    // Look forward -- if the match is followed by more path-like characters, it's likely part of a URL
    const after = text.slice(matchEnd, matchEnd + 20);
    if (/^[/?#&]/.test(after)) return true;
    return false;
  }

  /**
   * YouTube resource ID prefixes -- these are public identifiers, not secrets.
   * Channel IDs start with UC + 22 chars, playlist IDs start with PL/UU/etc.
   */
  const YOUTUBE_RESOURCE_PREFIXES = ['UC', 'PL', 'UU', 'FL', 'LL', 'RD', 'UL'];

  /**
   * Redact long alphanumeric tokens (potential API keys/secrets) but skip
   * tokens that are part of URLs or are YouTube public resource IDs.
   */
  function redactLongTokens(text) {
    const pattern = /\b[A-Za-z0-9_-]{24,}\b/g;
    let result = '';
    let lastIndex = 0;
    let match;
    while ((match = pattern.exec(text)) !== null) {
      const token = match[0];
      const isYoutubeId = YOUTUBE_RESOURCE_PREFIXES.some((prefix) => token.startsWith(prefix));
      if (!isInsideUrl(text, match.index, match.index + token.length) && !isYoutubeId) {
        result += text.slice(lastIndex, match.index) + '[id redacted]';
        lastIndex = match.index + token.length;
      }
    }
    result += text.slice(lastIndex);
    return result;
  }

  // ── Input Guard ──────────────────────────────────────────────────────────────

  /**
   * Normalize a text string by stripping zero-width and invisible Unicode characters.
   * This prevents Unicode trickery bypassing pattern detection.
   */
  function normalizeText(text) {
    if (typeof text !== 'string') return text;
    return text
      .replace(ZERO_WIDTH_CHARS, '')           // Remove zero-width chars
      .replace(MATH_LETTERS, (match) => {      // Map math letters to approximate ASCII
        const code = match.codePointAt(0);
        // Mathematical Bold (U+1D400–U+1D433) → U+0041–U+0074
        if (code >= 0x1D400 && code <= 0x1D433) {
          return String.fromCodePoint(code - 0x1D400 + 0x41 + (code >= 0x1D42A ? 6 : 0));
        }
        return match;
      })
      .normalize('NFKC');                      // Compatibility normalization
  }

  /**
   * Check a user message before it reaches the LLM.
   * Returns { allowed, reason }.
   */
  function checkInput(text) {
    const start = perfNow();

    if (typeof text !== 'string' || text.trim().length === 0) {
      return { allowed: false, reason: 'Message cannot be empty.' };
    }

    if (text.length > MAX_MESSAGE_LENGTH) {
      return { allowed: false, reason: `Message exceeds ${MAX_MESSAGE_LENGTH} character limit.` };
    }

    // Normalize text to catch Unicode-based bypass attempts
    const normalized = normalizeText(text);

    for (const pattern of INJECTION_PATTERNS) {
      if (pattern.test(normalized)) {
        PERF_LOG_ENABLED && perfLog('guardrails.injection_detected', start, { pattern: pattern.source });
        return { allowed: false, reason: 'Message contains restricted instructions.' };
      }
    }

    PERF_LOG_ENABLED && perfLog('guardrails.input_pass', start);
    return { allowed: true };
  }

  // ── Tool Guard ───────────────────────────────────────────────────────────────

  /**
   * Verify a tool call before execution.
   * Returns { allowed, reason }.
   */
  function checkToolCall(toolName, args, allowedTools, callCount) {
    const start = perfNow();

    if (!allowedTools.includes(toolName)) {
      return { allowed: false, reason: `Tool "${toolName}" is not allowed.` };
    }

    if (callCount >= MAX_TOOL_CALLS) {
      return { allowed: false, reason: `Tool call limit (${MAX_TOOL_CALLS}) reached.` };
    }

    if (typeof args !== 'object' || args === null || Array.isArray(args)) {
      return { allowed: false, reason: 'Tool arguments must be a plain object.' };
    }

    PERF_LOG_ENABLED && perfLog('guardrails.tool_pass', start, { tool: toolName });
    return { allowed: true };
  }

  // ── Output Guard ─────────────────────────────────────────────────────────────

  /**
   * Sanitize the assistant response before sending to client.
   * Returns { sanitized, truncated }.
   * Pass maxLength to scale the cap (e.g. per chat mode); defaults to the
   * legacy user-level cap.
   */
  function sanitizeOutput(text, maxLength = MAX_RESPONSE_LENGTH) {
    if (typeof text !== 'string') return { sanitized: String(text || ''), truncated: false };

    let sanitized = text;

    // Redact sensitive data
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      sanitized = sanitized.replace(pattern, replacement);
    }

    // Redact long alphanumeric tokens (API keys, etc.) but skip URLs
    sanitized = redactLongTokens(sanitized);

    // Cap length
    let truncated = false;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.slice(0, maxLength) + '\n\n[Response truncated]';
      truncated = true;
    }

    return { sanitized, truncated };
  }

  /**
   * Sanitize tool result before sending back to the LLM.
   * Ensures no sensitive data leaks into the LLM context.
   */
  function sanitizeToolResult(result) {
    if (typeof result !== 'string') {
      try { result = JSON.stringify(result); } catch { result = String(result || ''); }
    }
    for (const { pattern, replacement } of SENSITIVE_PATTERNS) {
      result = result.replace(pattern, replacement);
    }
    result = redactLongTokens(result);
    return result;
  }

  return {
    checkInput,
    checkToolCall,
    sanitizeOutput,
    sanitizeToolResult,
    MAX_MESSAGE_LENGTH,
    MAX_TOOL_CALLS,
    MAX_RESPONSE_LENGTH,
  };
}

module.exports = { createGuardrails };
