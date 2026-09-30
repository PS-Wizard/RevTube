// ── Video audit scoring engine -- LLM-scored, deterministic weighting ──
const { DEFAULT_AUDIT_CRITERIA, normalizeVideoCriteria, CATEGORY_META } = require("../config/channelAuditCriteria");

const clampScore = (n) => Math.min(10, Math.max(0, Math.round(Number(n) || 0)));

// Common English stopwords so keyword extraction ignores filler. Mirrors
// auditScoringService.extractKeywords (kept local to avoid cross-module coupling).
const STOP = new Set([
  "the", "a", "an", "to", "of", "in", "on", "for", "and", "or", "but", "how", "what", "why",
  "your", "you", "my", "me", "we", "our", "is", "are", "was", "were", "with", "from", "by",
  "at", "be", "it", "this", "that", "as", "get", "make", "new", "all", "video", "videos",
  "2026", "2025", "2024", "top", "best", "vs", "ways", "way",
]);

function extractKeywords(text) {
  const words = (text || "").toLowerCase().split(/\W+/).filter((w) => !STOP.has(w) && w.length > 2);
  const freq = {};
  for (const w of words) freq[w] = (freq[w] || 0) + 1;
  return Object.entries(freq)
    .sort((a, b) => b[1] - a[1])
    .slice(0, 12)
    .map(([w]) => w);
}

// Best-effort channel niche: the most frequent topic keyword across the batch's
// video titles. Feeds the per-criterion `niches` boost when it happens to match.
function deriveChannelNiche(inputs = []) {
  const freq = {};
  for (const input of inputs) {
    for (const w of extractKeywords(`${input?.title || ""} ${input?.description || ""}`)) {
      freq[w] = (freq[w] || 0) + 1;
    }
  }
  return Object.entries(freq).sort((a, b) => b[1] - a[1])[0]?.[0] || "";
}

// When a weak element is "fixed", we assume it reaches this per-criterion score
// (out of 10). The projected total is the weighted mean with weak criteria raised
// to this target, run through the exact same grouping math as the live score.
const FIX_TARGET = 9;
// An element is worth recommending only when fixing it lifts the video total by
// at least this many points (avoids noise on near-perfect elements).
const MIN_RECO_DELTA = 1;

function createVideoAuditService(deps = {}) {
  const { geminiVision, deepSeekText, deepSeekBatchText, deepSeekBatchVideos, deepSeekJson, thumbnailOptimizerService } = deps;

  // Build a YouTube watch URL so the Thumbnail Optimizer can fetch the real
  // thumbnail (i.ytimg.com/vi/<id>/maxresdefault.jpg). Falls back to the raw
  // thumbnail URL when no videoId is present.
  function toWatchUrl(input) {
    const videoId = input?.videoId || "";
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return input?.thumbnail?.url || "";
  }

  // Run the existing Thumbnail Optimizer 12-pillar analysis once per video and
  // return the first result (0-10 scores + detailedAreas + expectedScore). This
  // is what the audit's thumbnail element reuses instead of the separate
  // geminiVision path. Returns null on any failure so the audit degrades to 0.
  async function runThumbnailAnalysis(input, niche) {
    const watchUrl = toWatchUrl(input);
    if (!watchUrl) return null;
    try {
      const res = await thumbnailOptimizerService.analyze([watchUrl], niche || "General", "", "");
      const first = Array.isArray(res?.results) ? res.results[0] : null;
      return first || null;
    } catch {
      return null;
    }
  }

  // Guard: only call the LLM when the element actually has data.
  function hasElementData(input, element) {
    if (element === "thumbnail") return !!(input?.thumbnail?.url || input?.url);
    if (element === "tags") return Array.isArray(input?.tags) && input.tags.length > 0;
    return !!(input?.[element] || "");
  }

  // True when at least one text scorer is wired. Without any scorer the engine
  // cannot judge text criteria; they are reported as no-data (max:0) rather
  // than false zeros.
  const canScoreText = !!(deepSeekBatchText || deepSeekText);

  async function scoreVideo(input, criteria = DEFAULT_AUDIT_CRITERIA.video, channelNiche = "", mode = "full", precomputed = null) {
    const crit = normalizeVideoCriteria(criteria);
    // Ground every text element in this video's own topic keywords so DeepSeek
    // scores how well the metadata targets the content (produces real spread).
    const keywords = extractKeywords(`${input?.title || ""} ${input?.description || ""}`);
    // In 'lite' mode (e.g. Channel Audit sub-step) skip the per-video thumbnail
    // AI vision call entirely for cost control; the thumbnail element scores 0
    // and no 12-pillar detail is attached. 'full' (default) runs the optimizer.
    const thumbnailAnalysis =
      mode !== "lite" && hasElementData(input, "thumbnail") ? await runThumbnailAnalysis(input, channelNiche) : null;
    const breakdown = [];
    // ── ONE batched LLM call for ALL text criteria of this video ──
    // (deepSeekBatchText scores every criterion in a single DeepSeek call,
    // collapsing the old one-call-per-criterion loop of 5-6 calls/video.)
    const withData = [];
    for (const c of crit) {
      let weight = c.weight;
      if (c.niches?.includes(channelNiche)) weight *= 1.5;
      // In 'lite' mode the thumbnail AI vision pass never ran (user opted out /
      // channel-audit cost control), so the thumbnail element has NO usable data
      // even though a thumbnail URL exists. Treat it as no-data (max:0) so it is
      // excluded from category/total/potential math instead of being scored 0 and
      // dragging Visual Hook (and the whole score) down.
      const thumbnailSkipped = c.element === "thumbnail" && mode === "lite";
      if (!hasElementData(input, c.element) || thumbnailSkipped) {
        breakdown.push({ element: c.element, key: c.key, label: c.label, category: c.category, score: 0, earned: 0, weight, max: 0, note: "no data" });
        continue;
      }
      withData.push({ c, weight });
    }
    const batchScores = {};
    // Precomputed scores (from a multi-video chunk call in auditBatch) skip the
    // per-video LLM call entirely.
    if (precomputed && typeof precomputed === "object") {
      Object.assign(batchScores, precomputed);
    } else {
    const textCriteria = withData.filter(({ c }) => c.element !== "thumbnail");
    if (textCriteria.length && deepSeekBatchText) {
      try {
        const scores = await deepSeekBatchText({
          elements: {
            title: input?.title || "",
            description: input?.description || "",
            tags: Array.isArray(input?.tags) ? input.tags.join(", ") : "",
            keywords: Array.isArray(input?.keywords) ? input.keywords.join(", ") : "",
            caption: String(input?.caption || ""),
          },
          criteria: textCriteria.map(({ c }) => ({ key: c.key, element: c.element, instruction: c.instruction, category: c.category })),
          niche: channelNiche,
          keywords,
        });
        Object.assign(batchScores, scores || {});
      } catch {
        // Batch call failed -> fall through to per-criterion scoring below.
      }
    }
    } // end non-precomputed LLM path
    for (const { c, weight } of withData) {
      let score = 0;
      if (c.element === "thumbnail") {
        // Reuse the Thumbnail Optimizer's 0-10 currentScore (0 when analysis
        // failed so the audit degrades gracefully rather than throwing).
        score = thumbnailAnalysis ? clampScore(thumbnailAnalysis.currentScore) : 0;
      } else if (c.key in batchScores) {
        score = batchScores[c.key];
      } else if (!canScoreText) {
        // No text scorer wired (no LLM configured): mark no-data so the
        // criterion is excluded from scoring instead of a false 0 dragging
        // every category down. Consumers (Full Audit blend) treat max:0 as
        // "waiting on data", never as failure.
        breakdown.push({ element: c.element, key: c.key, label: c.label, category: c.category, score: 0, earned: 0, weight, max: 0, note: "no data" });
        continue;
      } else {
        // Fallback: per-criterion call (batch failed or batch scorer absent).
        const payload = { text: String(input?.[c.element] || ""), instruction: c.instruction, niche: channelNiche, keywords, element: c.element, category: c.category };
        try {
          score = clampScore(await deepSeekText(payload));
        } catch {
          score = 0; // LLM failure -> 0, audit continues
        }
      }
      breakdown.push({ element: c.element, key: c.key, label: c.label, category: c.category, score, earned: score, weight, max: 10, note: "" });
    }

    const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
    const weightedSum = breakdown.reduce((s, b) => s + b.earned * b.weight, 0);

    // Group criteria into per-element scores (0-100 each, max 100). A criterion
    // with no data (e.g. captions that were never fetched) never counts toward
    // an element's weight or score, so an absent element can't drag anyone.
    const byElement = new Map();
    for (const b of breakdown) {
      if (!byElement.has(b.element)) {
        byElement.set(b.element, { element: b.element, breakdown: [], raw: [], weight: 0, earned: 0, hasData: false });
      }
      const g = byElement.get(b.element);
      g.breakdown.push({ criterion: b.label || b.key, earned: b.earned, max: b.max, note: b.note });
      g.raw.push(b);
      if (b.max > 0) {
        g.hasData = true;
        g.weight += b.weight;
        g.earned += b.earned * b.weight;
      }
    }
    const elements = [];
    const dataElements = new Set();
    for (const g of byElement.values()) {
      if (g.hasData) dataElements.add(g.element);
      const score = g.weight ? Math.round((g.earned / g.weight) * 10) : 0;
      // Attach the Thumbnail Optimizer's full 12-pillar analysis to the thumbnail
      // element so the UI can show "general knowledge" now and hand off to the
      // Thumbnail Optimizer page for the detailed child audit later.
      const thumbnailDetail =
        g.element === "thumbnail" && thumbnailAnalysis
          ? {
              currentScore: thumbnailAnalysis.currentScore,
              expectedScore: thumbnailAnalysis.expectedScore,
              reviewSummary: thumbnailAnalysis.reviewSummary,
              strengths: thumbnailAnalysis.strengths,
              opportunities: thumbnailAnalysis.opportunities,
              detailedAreas: thumbnailAnalysis.detailedAreas,
            }
          : undefined;
      elements.push({ element: g.element, score, max: 100, breakdown: g.breakdown, thumbnailAnalysis: thumbnailDetail });
    }

    // ── Focus categories (mirrors the channel audit's category split) ──
    // Each category score is the weighted mean of its criteria that have data on
    // this video. The overall `total` is the mean of the defined category scores
    // so a video is judged on the areas it can control, not dragged by absent
    // elements (a missing caption never halves Content Quality).
    const categories = [];
    for (const [key, meta] of Object.entries(CATEGORY_META)) {
      let catEarn = 0;
      let catWeight = 0;
      for (const b of breakdown) {
        if (b.category !== key || b.max === 0) continue;
        catWeight += b.weight;
        catEarn += b.earned * b.weight;
      }
      categories.push({
        key,
        label: meta.label,
        score: catWeight ? Math.round((catEarn / catWeight) * 10) : 0,
        max: 100,
        elements: meta.elements,
      });
    }
    const definedCatKeys = new Set(
      categories
        .filter((c) => c.score > 0 || c.elements.some((el) => dataElements.has(el)))
        .map((c) => c.key),
    );
    const total = definedCatKeys.size
      ? Math.round(categories.filter((c) => definedCatKeys.has(c.key)).reduce((s, c) => s + c.score, 0) / definedCatKeys.size)
      : totalWeight ? Math.round((weightedSum / totalWeight) * 10) : 0;

    // ── Per-element recommendations ──
    // Only elements that have real data (and a substantive gap to the fix target)
    // are recommended. Each carries its exact projected score if fixed, so the
    // recovered total below is the same "lift every recommendation to its target"
    // math the UI shows: what THIS video becomes when ITS fixes are applied.
    // For the thumbnail element the fix target is the Thumbnail Optimizer's own
    // expectedScore (0-100) so the projection reflects real 12-pillar uplift.
    const recommendations = [];
    for (const g of byElement.values()) {
      if (!g.hasData) continue;
      const current = Math.round((g.earned / g.weight) * 10);
      let projEarn = 0;
      for (const b of g.raw) {
        let earned = b.earned;
        if (b.max > 0 && earned < FIX_TARGET) earned = FIX_TARGET;
        projEarn += earned * b.weight;
      }
      const projected = Math.round((projEarn / g.weight) * 10);
      const delta = projected - current;
      if (delta >= MIN_RECO_DELTA) {
        const targetPerElement = g.element === "thumbnail" && thumbnailAnalysis
          ? Math.round((thumbnailAnalysis.expectedScore ?? FIX_TARGET) * 10)
          : FIX_TARGET * 10;
        recommendations.push({
          element: g.element,
          current,
          projected,
          delta,
          targetPerElement,
        });
      }
    }
    recommendations.sort((a, b) => b.delta - a.delta);

    // ── Projected total if the recommendations are applied ──
    // Recompute the category-mean total by lifting only the criteria that belong
    // to a recommended element (the same lifted scores shown per element). Absent
    // criteria (no data) never contribute, so the projected number reflects this
    // video's real fixes, not a blanket "every weak element -> 9" ceiling.
    // The thumbnail fix target uses the optimizer's expectedScore when available.
    const recoElements = new Set(recommendations.map((r) => r.element));
    const projCats = [];
    for (const [key] of Object.entries(CATEGORY_META)) {
      let catEarn = 0;
      let catWeight = 0;
      for (const b of breakdown) {
        if (b.category !== key || b.max === 0) continue;
        catWeight += b.weight;
        let target = FIX_TARGET;
        if (b.element === "thumbnail" && recoElements.has(b.element) && thumbnailAnalysis) {
          target = thumbnailAnalysis.expectedScore ?? FIX_TARGET;
        }
        if (recoElements.has(b.element) && b.earned < target) catEarn += target * b.weight;
        else catEarn += b.earned * b.weight;
      }
      projCats.push({ key, score: catWeight ? Math.round((catEarn / catWeight) * 10) : 0 });
    }
    const projDefined = projCats.filter((c) => definedCatKeys.has(c.key));
    const projectedTotal = projDefined.length
      ? Math.max(total, Math.round(projDefined.reduce((s, c) => s + c.score, 0) / projDefined.length))
      : total;

    // ── Concrete "fix" suggestions (real copy, not just a number) ──
    // One DeepSeek call for the whole video, asking for ready-to-use replacements
    // for each weak element that has data. Skipped when no API key or no weak
    // elements, and on any failure we fall back to scores-only (above).
    let suggestions = {};
    if (deepSeekJson && recommendations.length > 0) {
      try {
        suggestions = (await deepSeekJson({
          prompt: buildSuggestionPrompt(input, recommendations, channelNiche),
        })) || {};
      } catch {
        suggestions = {};
      }
    }

    // ── Per-alternative scores ──
    // The suggestions above are ready-to-use copy; now score each alternative
    // with the SAME deepSeekText element scorer the live audit used, so every
    // alternative carries a 0-100 number directly comparable to the element's
    // own score (e.g. 3 alt titles -> 3 independent title scores). Thumbnail
    // concepts are skipped: they aren't scorable without a generated image.
    async function scoreAlternativeForElement(elementName, replacementText) {
      // Score every weighted criterion for this element (criteria carry `weight`,
      // not `max` -- the breakdown hardcodes max:10 -- so filter on weight).
      const elCrit = crit.filter((c) => c.element === elementName && c.weight > 0);
      if (!elCrit.length) return 0;
      let earn = 0;
      let weight = 0;
      for (const c of elCrit) {
        let w = c.weight;
        if (c.niches?.includes(channelNiche)) w *= 1.5;
        const payload = {
          text: String(replacementText || ""),
          instruction: c.instruction,
          niche: channelNiche,
          keywords,
          element: c.element,
          category: c.category,
        };
        let s = 0;
        try {
          s = clampScore(await deepSeekText(payload));
        } catch {
          s = 0; // LLM failure -> 0, scoring continues
        }
        earn += s * w;
        weight += w;
      }
      return weight ? Math.round((earn / weight) * 10) : 0;
    }

    const scoreAlt = async (elementName, items) =>
      Array.isArray(items) && items.length
        ? Promise.all(items.map((it) => scoreAlternativeForElement(elementName, it)))
        : undefined;

    if (suggestions.title?.options) {
      suggestions.title.scores = await scoreAlt("title", suggestions.title.options);
    }
    if (suggestions.description?.rewrite) {
      suggestions.description.score = await scoreAlternativeForElement(
        "description",
        suggestions.description.rewrite,
      );
    }
    if (suggestions.tags?.suggested) {
      suggestions.tags.scores = await scoreAlt("tags", suggestions.tags.suggested);
    }
    if (suggestions.keywords?.suggested) {
      suggestions.keywords.scores = await scoreAlt("keywords", suggestions.keywords.suggested);
    }

    return {
      videoId: input?.videoId,
      videoTitle: input?.title,
      // Raw metadata echo (capped) so consumers can derive data-driven fix
      // guidance without refetching: tag counts, description content checks,
      // title/tag keyword overlap. Old rows without these fields degrade to
      // generic guidance downstream.
      description: typeof input?.description === "string" ? input.description.slice(0, 2000) : "",
      tags: Array.isArray(input?.tags) ? input.tags.filter((t) => typeof t === "string").slice(0, 50) : [],
      total,
      projectedTotal: Math.max(projectedTotal, total),
      recommendations,
      suggestions,
      elements,
      categories,
      // Flat per-criterion breakdown (keyed rows) for consumers that blend
      // individual criteria across engines (Full Audit video sub-run looks up
      // `breakdown` by criterion key). `elements` groups these same rows per
      // element for display.
      breakdown,
    };
  }

  // Build the DeepSeek prompt for concrete rewrite suggestions. Ask for ready-to-use
  // replacements (not scores) for each weak element, keyed by element name.
  function buildSuggestionPrompt(input, recos, niche) {
    const weak = recos.map((r) => r.element);
    const parts = [];
    parts.push(
      "A YouTube video scored low on these elements and needs concrete, ready-to-use " +
        "replacements (not scores): " + weak.join(", ") + ".",
    );
    parts.push(`Current title: ${String(input?.title || "(none)").slice(0, 200)}`);
    parts.push(`Current description: ${String(input?.description || "(none)").slice(0, 1200)}`);
    const tags = Array.isArray(input?.tags) && input.tags.length ? input.tags.join(", ") : "(none)";
    const keywords = Array.isArray(input?.keywords) && input.keywords.length ? input.keywords.join(", ") : "(none)";
    parts.push(`Current tags: ${tags}`);
    parts.push(`Current keywords: ${keywords}`);
    if (input?.thumbnail?.url) parts.push(`Thumbnail URL: ${input.thumbnail.url}`);
    if (niche) parts.push(`Channel niche: ${niche}`);

    parts.push("");
    parts.push(
      "Return JSON only with one key per weak element. For each, give a concrete improvement:",
    );
    parts.push(
      "QUALITY BAR (mandatory): every alternative you return must be genuinely strong and " +
        "would itself score at least 80/100 on that element -- do NOT produce weak or filler " +
        "copy. For titles, write 3 distinct, click-worthy titles that maximize curiosity, " +
        "emotion, clarity, or a challenge hook (emojis and numbers are encouraged). For tags, " +
        "return 15-20 real, high-volume + specific long-tail tags the video should rank for. " +
        "For keywords, return 10-15 phrases a viewer would actually search. For description, " +
        "write a fuller, engaging rewrite with a hook, context, and a CTA. For thumbnail, give " +
        "2-3 bold visual concepts with text-overlay ideas.",
    );
    const keySpec = [];
    if (weak.includes("title")) {
      keySpec.push(
        '  "title": { "options": ["alt title 1", "alt title 2", "alt title 3"], "why": "short reason" }',
      );
    }
    if (weak.includes("description")) {
      keySpec.push(
        '  "description": { "rewrite": "a fuller, more helpful description (2-4 short paragraphs)", "why": "short reason" }',
      );
    }
    if (weak.includes("tags")) {
      keySpec.push(
        '  "tags": { "suggested": ["tag1", "tag2", ...], "why": "short reason" }',
      );
    }
    if (weak.includes("keywords")) {
      keySpec.push(
        '  "keywords": { "suggested": ["keyword1", "keyword2", ...], "why": "short reason" }',
      );
    }
    if (weak.includes("thumbnail")) {
      keySpec.push(
        '  "thumbnail": { "concepts": ["concept 1", "concept 2"], "why": "short reason" }',
      );
    }
    parts.push(keySpec.join("\n"));
    parts.push('Example: {"title": {"options": ["..."], "why": "..."}, "thumbnail": {"concepts": ["..."], "why": "..."}}');
    return parts.join("\n");
  }

  async function auditBatch(inputs = [], criteria = DEFAULT_AUDIT_CRITERIA.video, channelNiche = "", mode = "full", onProgress = null) {
    // Derive the channel niche from the batch's own titles when not supplied, so
    // criteria with a `niches` boost still fire without extra wiring.
    const niche = channelNiche || deriveChannelNiche(inputs);
    const crit = normalizeVideoCriteria(criteria);
    // ── Multi-video chunked LLM scoring ──
    // ONE DeepSeek call scores a whole CHUNK of videos against all text criteria
    // (deepSeekBatchVideos). A 34-video audit becomes ~7 calls instead of 34,
    // further multiplied down by the worker pool below. CHUNK_SIZE bounds the
    // prompt size (each video contributes up to ~4KB of metadata).
    const chunkSize = Math.max(1, Math.min(20, Number(process.env.VIDEO_AUDIT_CHUNK) || 5));
    const concurrency = Math.max(1, Math.min(8, Number(process.env.VIDEO_AUDIT_CONCURRENCY) || 4));
    const textCriteria = crit.filter((c) => c.element !== "thumbnail" && c.weight > 0);
    const eligible = inputs.filter((v) =>
      textCriteria.some((c) => hasElementData(v, c.element)),
    );
    const scoresByVideo = {};
    if (deepSeekBatchVideos && eligible.length && textCriteria.length) {
      const chunks = [];
      for (let i = 0; i < eligible.length; i += chunkSize) chunks.push(eligible.slice(i, i + chunkSize));
      let nextChunk = 0;
      async function chunkWorker() {
        while (nextChunk < chunks.length) {
          const chunk = chunks[nextChunk++];
          const payload = {
            videos: chunk.map((v) => ({
              id: v.videoId,
              elements: {
                title: v.title || "",
                description: v.description || "",
                tags: Array.isArray(v.tags) ? v.tags.join(", ") : "",
                keywords: Array.isArray(v.keywords) ? v.keywords.join(", ") : "",
                caption: String(v.caption || ""),
              },
              keywords: extractKeywords(`${v.title || ""} ${v.description || ""}`),
            })),
            criteria: textCriteria.map((c) => ({ key: c.key, element: c.element, instruction: c.instruction, category: c.category })),
            niche,
          };
          try {
            const out = await deepSeekBatchVideos(payload);
            Object.assign(scoresByVideo, out || {});
          } catch (e) {
            console.warn("[VideoAudit] chunk scoring failed, videos fall back to per-video scoring:", e?.message || e);
          }
        }
      }
      await Promise.all(Array.from({ length: Math.min(concurrency, chunks.length) }, chunkWorker));
    }
    // Per-video assembly (thumbnail optimizer in full mode, suggestions, element
    // grouping) reuses scoreVideo; videos with chunk scores skip the per-video
    // LLM call entirely, the rest fall back inside scoreVideo.
    const results = new Array(inputs.length);
    let next = 0;
    let done = 0;
    async function worker() {
      while (next < inputs.length) {
        const i = next++;
        const pre = scoresByVideo[inputs[i]?.videoId] || null;
        results[i] = await scoreVideo(inputs[i], crit, niche, mode, pre);
        done++;
        if (onProgress && inputs.length) {
          try { onProgress(Math.round((done / inputs.length) * 100)); } catch { /* progress is best-effort */ }
        }
      }
    }
    await Promise.all(Array.from({ length: Math.min(concurrency, inputs.length) }, worker));
    const overall = results.length
      ? Math.round(results.reduce((s, r) => s + r.total, 0) / results.length)
      : 0;
    return { results, overall, auditedAt: new Date().toISOString() };
  }

  return { scoreVideo, auditBatch };
}

module.exports = { createVideoAuditService };
