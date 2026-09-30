// ─── Video Audit LLM adapters -- Gemini (images) + DeepSeek (text) ───────────
// Each adapter scores one element (0-10) for the video audit engine.
// Factory functions follow the DI pattern so tests can inject fakes.

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";

function createVideoAuditLLM(deps = {}) {
  const { axios } = deps;

  // ── Gemini vision (thumbnail images) ─────────────────────────────────────
  // payload: { url: string, instruction: string } -> score 0-10
  async function geminiVision(payload = {}) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      console.warn("[VideoAudit] GEMINI_API_KEY not set -- vision scores 0");
      return 0;
    }
    const url = payload?.url || "";
    if (!url) return 0;

    let imagePart = null;
    try {
      const img = await axios.get(url, {
        responseType: "arraybuffer",
        timeout: 30000,
      });
      const base64 = Buffer.from(img.data).toString("base64");
      const mimeType =
        img.headers?.["content-type"] || "image/jpeg";
      imagePart = { inlineData: { mimeType, data: base64 } };
    } catch (e) {
      console.warn(`[VideoAudit] Failed to fetch thumbnail ${url}: ${e.message}`);
      return 0;
    }

    const prompt = [
      "You are a strict YouTube thumbnail analyst. Score the thumbnail from 0 to 10.",
      `Instruction: ${payload.instruction || "How eye-catching and on-topic is the thumbnail?"}`,
      "Scoring bands: 0-2 blurry/off-topic, 3-4 weak/stock, 5-6 generic, 7-8 good and on-topic, 9-10 bold, high-contrast, clearly tied to the video topic. Use the full range, do not anchor at 7.",
      "Reply with JSON only: {\"score\": <number 0-10>}",
    ].join("\n");

    const response = await axios.post(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${apiKey}`,
      {
        contents: [{ parts: [imagePart, { text: prompt }] }],
        generationConfig: {
          responseMimeType: "application/json",
          responseSchema: {
            type: "OBJECT",
            properties: { score: { type: "NUMBER" } },
            required: ["score"],
          },
        },
      },
      { timeout: 120000 },
    );

    const text =
      response?.data?.candidates?.[0]?.content?.parts?.[0]?.text || "{}";
    const parsed = JSON.parse(text);
    return Number(parsed.score) || 0;
  }

  // ── DeepSeek (all text elements) ─────────────────────────────────────────
  // payload: { text, instruction, niche?, keywords?: string[], element?, category? }
  // -> score 0-10. Grounded in the video's own extracted keywords and scored
  // against explicit bands so scores SPREAD instead of clustering ~7-8.
  async function deepSeekText(payload = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn("[VideoAudit] DEEPSEEK_API_KEY not set -- text scores 0");
      return 0;
    }
    const text = payload?.text || "";
    if (!text) return 0;

    const niche = payload?.niche ? `The channel niche is "${payload.niche}".` : "";
    const keywordList = Array.isArray(payload?.keywords) ? payload.keywords.filter(Boolean) : [];
    const keywordsLine = keywordList.length
      ? `This video's core topic keywords are: ${keywordList.slice(0, 12).join(", ")}.`
      : "";
    const element = payload?.element ? `Element being scored: ${payload.element}.` : "";
    const system =
      "You are a strict YouTube video metadata analyst. You score ONE element of a " +
      "video (title, description, tags, keywords, or captions) from 0 to 10. Judge it " +
      "against how well it is OPTIMIZED for THIS video's specific topic keywords, not " +
      "generically. An element that ignores the topic or is off-target must score LOW " +
      "(0-3). An element that clearly targets the topic and follows the instruction " +
      "scores HIGH (8-10). Use the full range, do not anchor at 7.";
    const bands =
      "Scoring bands: 0-2 poor/broken, 3-4 weak/off-topic, 5-6 okay/generic, " +
      "7-8 good and on-topic, 9-10 excellent, clearly optimized.";
    const prompt = [
      element,
      `Instruction: ${payload.instruction || "How effective is this element for this video's topic?"}`,
      niche,
      keywordsLine,
      "Video element content:",
      String(text).slice(0, 6000),
      bands,
      "Reply with JSON only: {\"score\": <number 0-10>}",
    ]
      .filter(Boolean)
      .join("\n");

    const response = await axios.post(
      `${DEEPSEEK_API_BASE}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 60000,
      },
    );

    const textOut = response?.data?.choices?.[0]?.message?.content || "{}";
    let clean = textOut.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(clean);
    return Number(parsed.score) || 0;
  }

  // ── DeepSeek (batched element scoring) ───────────────────────────────────
  // Scores ALL criteria for ONE video in a single API call. payload:
  // { elements: { title, description, tags, keywords, caption },
  //   criteria: [{ key, element, instruction, category }], niche?, keywords? }
  // -> { [key]: score 0-10 }. Collapses the old one-call-per-criterion loop
  // (5-6 calls/video) into one call/video.
  async function deepSeekBatchText(payload = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn("[VideoAudit] DEEPSEEK_API_KEY not set -- text scores 0");
      return {};
    }
    const criteria = Array.isArray(payload?.criteria) ? payload.criteria : [];
    if (!criteria.length) return {};

    const niche = payload?.niche ? `The channel niche is "${payload.niche}".` : "";
    const keywordList = Array.isArray(payload?.keywords) ? payload.keywords.filter(Boolean) : [];
    const keywordsLine = keywordList.length
      ? `This video's core topic keywords are: ${keywordList.slice(0, 8).join(", ")}.`
      : "";
    const system =
      "You are a strict YouTube metadata auditor. You will receive ONE video's raw " +
      "metadata elements and a list of evaluation criteria. Score each criterion 0-10 " +
      "against its instruction, judged for THIS video's specific topic (not generic " +
      "standards). " +
      'Use the full range, do not anchor at 7. Reply with JSON only: {"scores": {"<key>": <number 0-10>, ...}} ' +
      "with exactly one entry per criterion key.";
    const lines = criteria.map((c) =>
      `- key="${c.key}" (element: ${c.element}, category: ${c.category}): ${c.instruction || "How effective is this element for this video's topic?"}`,
    );
    const elNames = [...new Set(criteria.map((c) => c.element))];
    const contentSections = elNames
      .map((el) => `=== ${el.toUpperCase()} ===\n${String(payload?.elements?.[el] || "").slice(0, 6000)}`)
      .join("\n\n");

    const prompt = [
      "Evaluate these criteria:",
      ...lines,
      "",
      niche,
      keywordsLine,
      "Video element content:",
      contentSections,
      "Scoring bands: 0-2 poor/broken, 3-4 weak/off-topic, 5-6 okay/generic, 7-8 good and on-topic, 9-10 excellent, clearly optimized.",
      'Reply with JSON only: {"scores": {"<key>": <number 0-10>, ...}}',
    ]
      .filter(Boolean)
      .join("\n");

    const response = await axios.post(
      `${DEEPSEEK_API_BASE}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 2000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 90000,
      },
    );

    const textOut = response?.data?.choices?.[0]?.message?.content || "{}";
    let clean = textOut.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(clean);
    const scores = parsed?.scores || parsed || {};
    const out = {};
    for (const c of criteria) {
      const v = Number(scores[c.key]);
      if (Number.isFinite(v)) out[c.key] = Math.min(10, Math.max(0, Math.round(v)));
    }
    return out;
  }

  // ── DeepSeek (JSON object) ───────────────────────────────────────────────
  // Used for concrete "fix" suggestions: takes the full video context + a list of
  // weak elements and returns a JSON object of rewritten metadata. Returns null on
  // any failure so the audit degrades gracefully to scores only.
  async function deepSeekJson(payload = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn("[VideoAudit] DEEPSEEK_API_KEY not set -- no suggestions");
      return null;
    }
    const system =
      "You are a YouTube growth strategist. Given a video's metadata and a list of " +
      "weak elements, produce concrete, ready-to-use replacements for each. Reply with " +
      "JSON only, keys are the element names, values are the objects described in the prompt.";
    const prompt = String(payload.prompt || "");
    if (!prompt) return null;

    // max_tokens must cover the worst case (3 titles + 15-20 tags + 10-15 keywords
    // + a 2-4 paragraph description rewrite + reasons). 1500 truncated the JSON
    // mid-stream on weak videos -> parse failure -> ALL suggestions silently lost.
    const MAX_TOKENS = 8000;
    const body = {
      model: DEEPSEEK_MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: prompt },
      ],
      response_format: { type: "json_object" },
      temperature: 0.7,
      max_tokens: MAX_TOKENS,
    };
    const headers = {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    };

    // One retry: a single truncated/unparseable response should not kill the
    // suggestions for the whole video.
    for (let attempt = 1; attempt <= 2; attempt++) {
      let textOut = "";
      try {
        const response = await axios.post(`${DEEPSEEK_API_BASE}/chat/completions`, body, { headers, timeout: 90000 });
        textOut = response?.data?.choices?.[0]?.message?.content || "{}";
      } catch (err) {
        console.warn(`[VideoAudit] deepSeekJson attempt ${attempt} request failed:`, err?.message || err);
        if (attempt === 2) return null;
        continue;
      }
      let clean = textOut.trim();
      if (clean.startsWith("```")) {
        clean = clean.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
      }
      try {
        return JSON.parse(clean);
      } catch {
        const finishReason = "length"; // most likely cause when parse fails with json_object mode
        console.warn(
          `[VideoAudit] deepSeekJson attempt ${attempt}: unparseable response ` +
            `(len=${clean.length}, likely truncated: ${finishReason}) -- retrying`,
        );
        if (attempt === 2) return null;
      }
    }
    return null;
  }

  // ── DeepSeek (multi-video batched scoring) ────────────────────────────────
  // Scores ALL criteria for MULTIPLE videos in a SINGLE API call. payload:
  // { videos: [{ id, elements: {title,...}, keywords? }], criteria: [...], niche? }
  // -> { [videoId]: { [criterionKey]: score 0-10 } }. Collapses one-call-per-video
  // into one-call-per-chunk (a 34-video audit becomes ~9 calls, not 34).
  async function deepSeekBatchVideos(payload = {}) {
    const apiKey = process.env.DEEPSEEK_API_KEY;
    if (!apiKey) {
      console.warn("[VideoAudit] DEEPSEEK_API_KEY not set -- text scores 0");
      return {};
    }
    const videos = Array.isArray(payload?.videos) ? payload.videos.filter((v) => v?.id) : [];
    const criteria = Array.isArray(payload?.criteria) ? payload.criteria : [];
    if (!videos.length || !criteria.length) return {};

    const niche = payload?.niche ? `The channel niche is \"${payload.niche}\".` : "";
    const system =
      "You are a strict YouTube metadata auditor. You will receive MULTIPLE videos, each " +
      "with raw metadata elements, and one shared list of evaluation criteria. For EACH video, " +
      "score each criterion 0-10 against its instruction, judged for THAT video's specific topic " +
      "(not generic standards). Use the full range, do not anchor at 7. Reply with JSON only: " +
      '{"videos": {"<videoId>": {"<key>": <number 0-10>, ...}, ...}} with exactly one entry per ' +
      "video id and one score per criterion key per video.";
    const lines = criteria.map((c) =>
      `- key=\"${c.key}\" (element: ${c.element}, category: ${c.category}): ${c.instruction || "How effective is this element for this video's topic?"}`,
    );
    const elNames = [...new Set(criteria.map((c) => c.element))];
    const videoSections = videos
      .map((v) => {
        const kw = Array.isArray(v.keywords) && v.keywords.length
          ? `Core topic keywords: ${v.keywords.slice(0, 8).join(", ")}.\n`
          : "";
        const content = elNames
          .map((el) => `=== ${el.toUpperCase()} ===\n${String(v.elements?.[el] || "").slice(0, 2000)}`)
          .join("\n\n");
        return `### VIDEO ${v.id}\n${kw}${content}`;
      })
      .join("\n\n");

    const prompt = [
      "Evaluate these criteria for EVERY video below:",
      ...lines,
      "",
      niche,
      "Videos:",
      videoSections,
      "Scoring bands: 0-2 poor/broken, 3-4 weak/off-topic, 5-6 okay/generic, 7-8 good and on-topic, 9-10 excellent, clearly optimized.",
      'Reply with JSON only: {"videos": {"<videoId>": {"<key>": <number 0-10>, ...}, ...}}',
    ]
      .filter(Boolean)
      .join("\n");

    const response = await axios.post(
      `${DEEPSEEK_API_BASE}/chat/completions`,
      {
        model: DEEPSEEK_MODEL,
        messages: [
          { role: "system", content: system },
          { role: "user", content: prompt },
        ],
        response_format: { type: "json_object" },
        temperature: 0.4,
        max_tokens: 8000,
      },
      {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 120000,
      },
    );

    const textOut = response?.data?.choices?.[0]?.message?.content || "{}";
    let clean = textOut.trim();
    if (clean.startsWith("```")) {
      clean = clean.replace(/^```(json)?\n?/, "").replace(/\n?```$/, "");
    }
    const parsed = JSON.parse(clean);
    const byVideo = parsed?.videos || {};
    const out = {};
    for (const v of videos) {
      const scores = byVideo[v.id];
      if (!scores || typeof scores !== "object") continue;
      const perVideo = {};
      for (const c of criteria) {
        const val = Number(scores[c.key]);
        if (Number.isFinite(val)) perVideo[c.key] = Math.min(10, Math.max(0, Math.round(val)));
      }
      if (Object.keys(perVideo).length) out[v.id] = perVideo;
    }
    return out;
  }

  return { geminiVision, deepSeekText, deepSeekBatchText, deepSeekBatchVideos, deepSeekJson };
}

module.exports = { createVideoAuditLLM };
