// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer Service -- Gemini API proxy with caching & retry
// ─────────────────────────────────────────────────────────────────────────────

const GEMINI_API_BASE =
  "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = "gemini-3.1-flash-lite";
const MAX_CONCURRENCY = 5;
const MAX_URLS = 20;
const {
  DEFAULT_OPTIMIZER_CRITERIA,
} = require("../config/optimizerCriteria");

/**
 * Retry a function with exponential backoff for transient failures (429, 5xx).
 */
async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const status = error?.response?.status || error?.status;
      const msg = error?.message || "";
      const code = error?.code || "";
      const isRateLimit =
        status === 429 ||
        msg.includes("429") ||
        msg.includes("RESOURCE_EXHAUSTED");
      // Axios timeouts surface as ECONNABORTED with no response status, so
      // they were previously never retried -- every slow Gemini vision call
      // (large base64 image + big JSON schema) failed the video outright.
      const isTimeout =
        code === "ECONNABORTED" ||
        code === "ETIMEDOUT" ||
        msg.toLowerCase().includes("timeout");
      const isTransient =
        isRateLimit || isTimeout || (status >= 500 && status < 600);

      if (isTransient && i < maxRetries - 1) {
        const delay = baseDelay * Math.pow(2, i);
        console.warn(
          `[ThumbnailOptimizer] Gemini call failed (attempt ${i + 1}/${maxRetries}), retrying in ${delay}ms...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

/**
 * Extract a YouTube video ID from various URL formats.
 */
function extractYoutubeId(url) {
  const regExp =
    /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|\&v=)([^#\&\?]*).*/;
  const match = String(url).match(regExp);
  return match && match[2].length === 11 ? match[2] : null;
}

function createThumbnailOptimizerService(deps) {
  const {
    axios,
    serverCache,
    shortHash,
    PERF_LOG_ENABLED,
    perfLog,
    perfNow,
    getOptimizerCriteria,
  } = deps;

  const API_KEY = process.env.GEMINI_API_KEY;

  if (!API_KEY) {
    console.warn(
      "[ThumbnailOptimizer] GEMINI_API_KEY not set -- thumbnail analysis will fail at runtime.",
    );
  }

  /**
   * Fetch a thumbnail image from YouTube CDN and convert to base64.
   */
  async function fetchThumbnailBase64(videoId) {
    const url = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
    const response = await axios.get(url, {
      responseType: "arraybuffer",
      timeout: 10000,
    });
    const base64 = Buffer.from(response.data).toString("base64");
    const mimeType = response.headers["content-type"] || "image/jpeg";
    return { base64, mimeType };
  }

  /**
   * Resolve the real video title via YouTube oEmbed (keyless, no quota).
   * The LLM is still asked for a title, but only as a fallback -- Gemini
   * invents titles from thumbnail pixels (e.g. a series/episode name that
   * is not the video's actual title), so metadata always wins when
   * available. Returns null when unresolvable; never throws.
   */
  async function fetchRealTitle(videoId) {
    try {
      const response = await axios.get("https://www.youtube.com/oembed", {
        params: {
          url: `https://www.youtube.com/watch?v=${videoId}`,
          format: "json",
        },
        timeout: 8000,
      });
      const title = response?.data?.title;
      return typeof title === "string" && title.trim() ? title.trim() : null;
    } catch {
      return null;
    }
  }

  /**
   * Load admin-configured thumbnail pillars (falls back to defaults inside
   * the config module when Firestore is unavailable).
   */
  async function loadPillars() {
    if (typeof getOptimizerCriteria !== "function") return null;
    try {
      const cfg = await getOptimizerCriteria();
      return Array.isArray(cfg?.thumbnail) && cfg.thumbnail.length > 0 ? cfg.thumbnail : null;
    } catch {
      return null;
    }
  }

  /**
   * Build the dynamic pillar framework section of the prompt from the
   * admin-configured criteria (grouped by tier).
   */
  function buildPillarSection(pillars) {
    const tiers = [
      { tier: "Red", heading: "🔴 Red Tier (Critical Priority - Fix First):" },
      { tier: "Yellow", heading: "🟡 Yellow Tier (Medium Priority - Refine Next):" },
      { tier: "Grey", heading: "🔘 Grey Tier (Low Priority - Final Polish):" },
    ];
    const sections = tiers
      .map(({ tier, heading }) => {
        const items = pillars.filter((p) => p.tier === tier);
        if (items.length === 0) return "";
        const lines = items.map((p) => `- ${p.label}: ${p.instruction}`).join("\n");
        return `${heading}\n${lines}`;
      })
      .filter(Boolean)
      .join("\n\n");
    return sections;
  }

  /**
   * Build the structured prompt sent to Gemini.
   */
  function buildPrompt(imageUrl, videoUrl, niche, targetAudience, brandVoice, pillars) {
    const pillarSection = buildPillarSection(pillars);
    return `
Act as a 'YouTube Thumbnail Optimizer' expert. Your task is to perform a high-level audit of the thumbnail at ${imageUrl} for the video ${videoUrl}.

CONTEXTUAL DATA:
- Channel Niche: ${niche || "General"}
- Target Audience: ${targetAudience || "YouTube Viewers"}
- Brand Voice: ${brandVoice || "Not specified"}

STRICT REQUIREMENT: Evaluate the thumbnail against these ${pillars.length} pillars with their assigned Tiers.

${pillarSection}

The 'detailedAreas' array in your JSON response MUST contain ${pillars.length} items -- one per pillar above, using the exact pillar names as the 'area' value. Assign the correct 'tier' (Red, Yellow, or Grey) to each.
Tailor all advice to the niche, audience, and brand voice provided.
`;
  }

  /**
   * Build the JSON schema for Gemini's structured output.
   */
  function getResponseSchema() {
    return {
      type: "object",
      properties: {
        videoTitle: {
          type: "string",
          description:
            "Fallback title guess for the video. The server prefers YouTube metadata and only uses this when metadata is unavailable.",
        },
        reviewSummary: {
          type: "string",
          description: "A concise 2-sentence expert verdict.",
        },
        strengths: {
          type: "string",
          description: "Bullet points of what is working well.",
        },
        opportunities: {
          type: "string",
          description: "Bullet points of top priority fixes.",
        },
        currentScore: {
          type: "number",
          description: "Overall rating out of 10.",
        },
        expectedScore: {
          type: "number",
          description: "Potential rating if all fixes are applied.",
        },
        detailedAreas: {
          type: "array",
          description:
            "Must contain one object per configured audit pillar (12 by default).",
          items: {
            type: "object",
            properties: {
              area: {
                type: "string",
                description: "Name of the optimization area.",
              },
              status: {
                type: "string",
                description: "Current performance / strengths in this area.",
              },
              opportunity: {
                type: "string",
                description: "Specific advice for improvement.",
              },
              score: {
                type: "number",
                description: "Score out of 10 for this specific area.",
              },
              tier: {
                type: "string",
                enum: ["Red", "Yellow", "Grey"],
                description: "The priority tier of this pillar.",
              },
            },
            required: ["area", "status", "opportunity", "score", "tier"],
          },
        },
      },
      required: [
        "videoTitle",
        "reviewSummary",
        "strengths",
        "opportunities",
        "currentScore",
        "expectedScore",
        "detailedAreas",
      ],
    };
  }

  /**
   * Analyze one thumbnail URL via the Gemini API.
   */
  async function analyzeSingle(
    videoUrl,
    niche,
    targetAudience,
    brandVoice,
  ) {
    // Admin-configurable pillar framework (12 by default, from
    // config/optimizerCriteria in Firestore).
    const pillars =
      (await loadPillars()) || DEFAULT_OPTIMIZER_CRITERIA.thumbnail;
    const videoId = extractYoutubeId(videoUrl);
    const thumbUrl = videoId
      ? `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`
      : null;

    // Fetch thumbnail image + real title in parallel. The title comes from
    // YouTube metadata (oEmbed), never from the LLM -- Gemini guesses titles
    // from thumbnail pixels and gets them wrong.
    let imagePart = null;
    let realTitle = null;
    if (videoId) {
      const [imageResult, titleResult] = await Promise.allSettled([
        fetchThumbnailBase64(videoId),
        fetchRealTitle(videoId),
      ]);
      if (imageResult.status === "fulfilled") {
        const { base64, mimeType } = imageResult.value;
        imagePart = {
          inlineData: { mimeType, data: base64 },
        };
      } else {
        console.warn(
          `[ThumbnailOptimizer] Failed to fetch thumbnail for ${videoId}: ${imageResult.reason?.message || "unknown error"}`,
        );
        // Continue without image -- Gemini will rely on URL context
      }
      if (titleResult.status === "fulfilled") realTitle = titleResult.value;
    }

    const prompt = buildPrompt(
      thumbUrl || videoUrl,
      videoUrl,
      niche,
      targetAudience,
      brandVoice,
      pillars,
    );

    const parts = imagePart
      ? [imagePart, { text: prompt }]
      : [{ text: prompt }];

    const response = await retryWithBackoff(async () => {
      const geminiResponse = await axios.post(
        `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${API_KEY}`,
        {
          contents: [{ parts }],
          generationConfig: {
            responseMimeType: "application/json",
            responseSchema: getResponseSchema(),
          },
        },
        { timeout: 120000 },
      );
      return geminiResponse.data;
    });

    const result = JSON.parse(
      response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}",
    );

    return {
      url: videoUrl,
      // Real YouTube metadata wins; the LLM guess is fallback-only.
      videoTitle: realTitle || result.videoTitle || "Unknown Title",
      reviewSummary: result.reviewSummary || "",
      strengths: result.strengths || "",
      opportunities: result.opportunities || "",
      currentScore: result.currentScore ?? 0,
      expectedScore: result.expectedScore ?? 0,
      detailedAreas: Array.isArray(result.detailedAreas)
        ? result.detailedAreas
        : [],
      niche: niche || "General",
      targetAudience: targetAudience || "YouTube Viewers",
      brandVoice: brandVoice || "Standard Creator Voice",
    };
  }

  /**
   * Analyze one or more thumbnail URLs through Gemini.
   *
   * @param {string[]} urls       - YouTube video URLs to analyze.
   * @param {string}   [niche]    - Channel niche context.
   * @param {string}   [targetAudience] - Target audience context.
   * @param {string}   [brandVoice]    - Brand voice context.
   * @returns {Promise<{results: Array, errors?: Array}>}
   */
  async function analyze(urls, niche, targetAudience, brandVoice) {
    const t0 = PERF_LOG_ENABLED ? perfNow() : 0;

    // Build a cache key that captures all inputs
    const contextHash = shortHash(
      JSON.stringify({ niche, targetAudience, brandVoice }),
    );
    const cacheKey = `thumbnail:audit:v1:${shortHash(urls.sort().join(","))}:${contextHash}`;

    // Try cache first
    const cached = await serverCache.get(cacheKey);
    if (cached) {
      if (PERF_LOG_ENABLED) {
        perfLog(
          `[ThumbnailOptimizer] Cache hit for ${urls.length} URL(s)`,
          t0,
        );
      }
      return cached;
    }

    const results = [];
    const errors = [];

    // Process in batches of MAX_CONCURRENCY
    for (let i = 0; i < urls.length; i += MAX_CONCURRENCY) {
      const batch = urls.slice(i, i + MAX_CONCURRENCY);
      const settled = await Promise.allSettled(
        batch.map((url) =>
          analyzeSingle(url, niche, targetAudience, brandVoice),
        ),
      );

      for (let j = 0; j < settled.length; j++) {
        const s = settled[j];
        if (s.status === "fulfilled") {
          results.push(s.value);
        } else {
          errors.push({
            url: batch[j],
            error: s.reason?.message || "Unknown error",
          });
          // Return a minimal placeholder so the user still gets partial results
          results.push({
            url: batch[j],
            videoTitle: "Analysis Failed",
            reviewSummary: "",
            strengths: "",
            opportunities: "",
            currentScore: 0,
            expectedScore: 0,
            detailedAreas: [],
            niche: niche || "General",
            targetAudience: targetAudience || "YouTube Viewers",
            brandVoice: brandVoice || "Standard Creator Voice",
          });
        }
      }
    }

    const payload = errors.length > 0 ? { results, errors } : { results };

    // Cache for 24 hours
    await serverCache.set(cacheKey, payload, 24 * 60 * 60 * 1000);

    if (PERF_LOG_ENABLED) {
      perfLog(
        `[ThumbnailOptimizer] Analyzed ${urls.length} URL(s) via Gemini`,
        t0,
      );
    }

    return payload;
  }

  return { analyze };
}

module.exports = { createThumbnailOptimizerService };
