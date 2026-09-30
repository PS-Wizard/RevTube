import { describe, it, expect, vi } from "vitest";
import { createVideoAuditService } from "./videoAuditService.js";

const CRITERIA = [
  { key: "title_clear", label: "Title Clarity", weight: 20, element: "title", category: "discoverability", instruction: "clear?", niches: [] },
  { key: "thumbnail_pop", label: "Thumbnail Pop", weight: 15, element: "thumbnail", category: "visualHook", instruction: "pop?", niches: [] },
  { key: "comedy_funny", label: "Funny", weight: 10, element: "title", category: "discoverability", instruction: "funny?", niches: ["comedy"] },
];

describe("videoAuditService", () => {
  // Thumbnail element now reuses the Thumbnail Optimizer's 12-pillar analyze()
  // (currentScore 0-10) instead of the separate geminiVision path. This helper
  // returns a fake optimizer result for a given current/expected score.
  const fakeThumb = (currentScore = 8, expectedScore = 9) => ({
    url: "https://www.youtube.com/watch?v=abc123",
    videoTitle: "My Video",
    reviewSummary: "ok",
    strengths: "s",
    opportunities: "o",
    currentScore,
    expectedScore,
    detailedAreas: [{ area: "Promise Lock", status: "x", opportunity: "y", score: 7, tier: "Red" }],
  });
  const makeSvc = (over = {}) =>
    createVideoAuditService({
      geminiVision: vi.fn().mockResolvedValue(8),
      deepSeekText: vi.fn().mockResolvedValue(7),
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb()] }) },
      ...over,
    });

  it("reuses the Thumbnail Optimizer analysis for the thumbnail element score", async () => {
    const analyze = vi.fn().mockResolvedValue({ results: [fakeThumb(6, 9)] }); // 6/10 -> 60
    const svc = makeSvc({ thumbnailOptimizerService: { analyze } });
    const input = { title: "My Video", thumbnail: { url: "http://x/1.jpg" }, videoId: "abc123" };
    const { total, elements } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(analyze).toHaveBeenCalledTimes(1); // thumbnail analysis runs once
    const thumbEl = elements.find((e) => e.element === "thumbnail");
    expect(thumbEl.score).toBe(60); // round(6 * 10)
    expect(thumbEl.thumbnailAnalysis?.currentScore).toBe(6);
    expect(thumbEl.thumbnailAnalysis?.detailedAreas?.length).toBeGreaterThan(0);
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThanOrEqual(100);
    // 3 criteria grouped into 2 elements (title, thumbnail)
    expect(elements.length).toBe(2);
    const titleEl = elements.find((e) => e.element === "title");
    expect(titleEl.breakdown.length).toBe(2);
  });

  it("weights sum to 100 via weighted mean of category scores", async () => {
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(10, 10)] }) },
      deepSeekText: vi.fn().mockResolvedValue(0), // title elements score 0 -> discoverability 0
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { total, categories } = await svc.scoreVideo(input, CRITERIA, "tech");
    // title_clear 20(0/10), comedy_funny 10(0/10) -> discoverability = 0
    // thumbnail_pop 15(10/10) -> visualHook = 100 (fakeThumb currentScore 10)
    // total = mean(0, 100) = 50 (category mean, not weighted mean)
    expect(total).toBe(50);
    expect(categories).toHaveLength(3);
    const disc = categories.find((c) => c.key === "discoverability");
    const vis = categories.find((c) => c.key === "visualHook");
    expect(disc.score).toBe(0);
    expect(vis.score).toBe(100);
    expect(disc.label).toBe("Discoverability");
  });

  it("applies niche boost x1.5 to matching-niche criteria (category score rises)", async () => {
    // Two discoverability criteria with different scores (title weak, tags strong)
    // so the 1.5x boost on the strong tags criterion shifts the category mean.
    const NICHE = [
      { key: "title", label: "Title", weight: 20, element: "title", category: "discoverability", instruction: "x", niches: [] },
      { key: "tags_n", label: "Tags", weight: 20, element: "tags", category: "discoverability", instruction: "x", niches: ["comedy"] },
      { key: "thumb", label: "Thumb", weight: 15, element: "thumbnail", category: "visualHook", instruction: "x", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(5, 9)] }) },
      deepSeekText: vi.fn().mockImplementation((payload) => (payload.element === "title" ? 4 : 8)), // tags strong
    });
    const input = { title: "x", tags: ["a", "b"], thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const boosted = await svc.scoreVideo(input, NICHE, "comedy");
    const plain = await svc.scoreVideo(input, NICHE, "tech");
    // comedy: tags weight 20*1.5=30. discoverability = (4*20 + 8*30)/50 = 6.4 -> 64
    // plain:   tags weight 20.      discoverability = (4*20 + 8*20)/40 = 6.0 -> 60
    expect(boosted.categories.find((c) => c.key === "discoverability").score).toBe(64);
    expect(plain.categories.find((c) => c.key === "discoverability").score).toBe(60);
  });

  it("scores 0 with a note when element data is missing", async () => {
    const deepSeekText = vi.fn().mockResolvedValue(7);
    const svc = makeSvc({ deepSeekText });
    const input = {}; // no title, no thumbnail
    const { total, elements } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(total).toBe(0);
    expect(elements[0].breakdown[0].earned).toBe(0);
    expect(deepSeekText).not.toHaveBeenCalled();
  });

  it("projects a higher total when weak elements are fixed (thumbnail uses expectedScore)", async () => {
    const PROJ = [
      { key: "t", label: "Title", weight: 40, element: "title", category: "discoverability", instruction: "x", niches: [] },
      { key: "th", label: "Thumb", weight: 20, element: "thumbnail", category: "visualHook", instruction: "x", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(10, 10)] }) }, // thumbnail strong
      deepSeekText: vi.fn().mockResolvedValue(3), // title weak
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { total, projectedTotal, recommendations } = await svc.scoreVideo(input, PROJ, "tech");
    // discoverability = 3 -> 30; visualHook = 10 -> 100
    // total = mean(30,100) = 65; projected = mean(90,100) = 95
    expect(total).toBe(65);
    expect(projectedTotal).toBe(95);
    expect(projectedTotal).toBeGreaterThanOrEqual(total);
    expect(recommendations.length).toBe(1);
    expect(recommendations[0].element).toBe("title");
    expect(recommendations[0].current).toBe(30); // round(3/10*100)=30
    expect(recommendations[0].projected).toBe(90); // round(9/10*100)=90
    expect(recommendations[0].delta).toBe(60);
    expect(recommendations[0].targetPerElement).toBe(90);
  });

  it("recommendations expose fix data without any fallback copy field", async () => {
    // The backend no longer emits a fallbackText string. The UI decides whether
    // to render a "Recommended Alternative" card purely from the AI suggestion
    // copy -- so the recommendation object only carries the math (element,
    // current, projected, delta, targetPerElement), nothing text-y.
    const PROJ = [
      { key: "title", label: "Title", weight: 40, element: "title", category: "discoverability", instruction: "x", niches: [] },
      { key: "desc", label: "Description", weight: 20, element: "description", category: "contentQuality", instruction: "x", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [] }) },
      deepSeekText: vi.fn().mockResolvedValue(2), // weak -> recommended
      deepSeekJson: vi.fn().mockResolvedValue({}), // no AI copy
    });
    const input = {
      title: "5 Python Tricks for Data Scientists",
      description: "short",
      videoId: "a",
    };
    const { recommendations } = await svc.scoreVideo(input, PROJ, "tech");
    expect(recommendations.length).toBeGreaterThan(0);
    for (const rec of recommendations) {
      expect(rec).toHaveProperty("element");
      expect(rec).toHaveProperty("current");
      expect(rec).toHaveProperty("projected");
      expect(rec).toHaveProperty("delta");
      expect(rec).toHaveProperty("targetPerElement");
      expect(rec).not.toHaveProperty("fallbackText");
    }
  });

  it("uses the optimizer expectedScore as the thumbnail fix target", async () => {
    const PROJ = [
      { key: "th", label: "Thumb", weight: 20, element: "thumbnail", category: "visualHook", instruction: "x", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(4, 9.5)] }) },
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { recommendations } = await svc.scoreVideo(input, PROJ, "tech");
    expect(recommendations).toHaveLength(1);
    expect(recommendations[0].element).toBe("thumbnail");
    // current = round(4*10)=40; targetPerElement = round(9.5*10)=95
    expect(recommendations[0].current).toBe(40);
    expect(recommendations[0].targetPerElement).toBe(95);
  });

  it("returns no recommendations when every element already meets the fix target", async () => {
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(10, 10)] }) },
      deepSeekText: vi.fn().mockResolvedValue(10),
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { total, projectedTotal, recommendations } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(total).toBe(100);
    expect(projectedTotal).toBe(100);
    expect(recommendations).toEqual([]);
  });

  it("excludes no-data elements (e.g. missing captions) from recommendations", async () => {
    const FULL = [
      ...CRITERIA,
      { key: "description_rich", label: "Description Richness", weight: 15, element: "description", category: "contentQuality", instruction: "rich?", niches: [] },
      { key: "caption_value", label: "Caption Value", weight: 15, element: "caption", category: "contentQuality", instruction: "cap?", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(3, 9)] }) }, // weak thumbnail
      deepSeekText: vi.fn().mockResolvedValue(3), // every text criterion weak
    });
    // No `description`/`captions` on the input -> those criteria are "no data"
    // (max 0) and must NOT be recommended as something to "fix" (nothing to raise).
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { total, recommendations } = await svc.scoreVideo(input, FULL, "tech");
    const elements = recommendations.map((r) => r.element);
    expect(elements).not.toContain("caption"); // absent -> never a "fix" reco
    expect(elements).not.toContain("description"); // absent -> never a "fix" reco
    // title/thumbnail DO have data, so they are recommended as weak.
    expect(elements).toContain("title");
    expect(elements).toContain("thumbnail");
    expect(total).toBeGreaterThan(0);
  });

  it("generates concrete suggestions for weak elements via deepSeekJson", async () => {
    const deepSeekJson = vi.fn().mockResolvedValue({
      title: { options: ["Alt One", "Alt Two"], why: "more curiosity" },
      thumbnail: { concepts: ["bold text overlay"], why: "higher contrast" },
    });
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(3, 9)] }) },
      deepSeekText: vi.fn().mockResolvedValue(3), // title weak
      deepSeekJson,
    });
    const input = { title: "My Video", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { suggestions, recommendations } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(deepSeekJson).toHaveBeenCalledTimes(1);
    // Suggestions keyed by weak element, with concrete content.
    expect(suggestions.title?.options?.length).toBeGreaterThan(0);
    expect(suggestions.thumbnail?.concepts?.length).toBeGreaterThan(0);
    // Every recommendation has a concrete suggestion attached.
    for (const r of recommendations) {
      expect(suggestions[r.element]).toBeTruthy();
    }
  });

  it("scores each alternative with the element scorer, parallel to options/suggested", async () => {
    // Title has 2 alt options; the scorer should be called once per option and
    // the returned 0-100 numbers stored in `title.scores` (parallel to options).
    const titleScores = new Map([
      ["Alt One", 7],
      ["Alt Two", 9],
    ]);
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(3, 9)] }) },
      deepSeekText: vi.fn().mockImplementation((p) => titleScores.get(p.text) ?? 3),
      deepSeekJson: vi.fn().mockResolvedValue({
        title: { options: ["Alt One", "Alt Two"], why: "more curiosity" },
      }),
    });
    const input = { title: "My Video", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { suggestions } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(suggestions.title?.scores).toEqual([70, 90]);
    expect(suggestions.title?.scores?.length).toBe(suggestions.title?.options?.length);
  });

  it("degrades to scores-only when deepSeekJson fails", async () => {
    const deepSeekJson = vi.fn().mockRejectedValue(new Error("boom"));
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(3, 9)] }) },
      deepSeekText: vi.fn().mockResolvedValue(3),
      deepSeekJson,
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { suggestions, recommendations } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(suggestions).toEqual({});
    expect(recommendations.length).toBeGreaterThan(0); // still scored
  });

  it("does not let an absent element (missing captions) drag a category or the total", async () => {
    const FULLR = [
      ...CRITERIA,
      { key: "description_rich", label: "Description Richness", weight: 15, element: "description", category: "contentQuality", instruction: "rich?", niches: [] },
      { key: "caption_value", label: "Caption Value", weight: 15, element: "caption", category: "contentQuality", instruction: "cap?", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(9, 10)] }) },
      deepSeekText: vi.fn().mockResolvedValue(9), // title-based text at target
    });
    // No description/captions on the input -> contentQuality has NO data criteria,
    // so its score must be 0 and the mean is over discoverability + visualHook only:
    // discoverability (title_clear + comedy_funny, all 9) = 90, visualHook 90.
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { total, categories, projectedTotal } = await svc.scoreVideo(input, FULLR, "tech");
    expect(categories.find((c) => c.key === "contentQuality").score).toBe(0);
    expect(total).toBe(90);
    expect(projectedTotal).toBe(90); // everything at target -> no reco, equals live total
  });

  it("projects per-video totals based on WHICH elements are weak (no blanket 77)", async () => {
    const CRIT3 = [
      { key: "title_clear", label: "Title", weight: 30, element: "title", category: "discoverability", instruction: "x", niches: [] },
      { key: "tags_quality", label: "Tags", weight: 30, element: "tags", category: "discoverability", instruction: "x", niches: [] },
      { key: "thumbnail_pop", label: "Thumbnail", weight: 20, element: "thumbnail", category: "visualHook", instruction: "x", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: {
        analyze: vi.fn().mockImplementation((urls) =>
          // The service builds the watch URL from videoId; base() sets videoId
          // to "weakthumb"/"strong" per case so we resolve a distinct analysis.
          urls[0].includes("weakthumb")
            ? Promise.resolve({ results: [fakeThumb(3, 9)] })
            : Promise.resolve({ results: [fakeThumb(10, 10)] }),
        ),
      },
      deepSeekText: vi.fn().mockImplementation((p) => (p.text.includes("weak") ? 3 : 9)),
    });
    const base = (title, tags, thumbUrl) => ({
      // videoId must differ per case so the mock resolves a distinct thumbnail
      // analysis (the service builds the watch URL from videoId, not thumbUrl).
      title, tags: tags.split(" "), thumbnail: { url: thumbUrl }, videoId: thumbUrl.includes("weakthumb") ? "weakthumb" : "strong",
    });
    // Weak TITLE (tags + thumbnail strong): disc = (3*30+9*30)/60 = 60,
    // visualHook = 100 -> total 80. Only title is below target, so the projected
    // lift is disc -> (9*30+9*30)/60 = 90 -> projected mean(90,100) = 95.
    const weakTitle = await svc.scoreVideo(base("weak title", "ok ok", "http://x/s.jpg"), CRIT3, "tech");
    expect(weakTitle.total).toBe(80);
    expect(weakTitle.projectedTotal).toBe(95);
    expect(weakTitle.recommendations.map((r) => r.element)).toEqual(["title"]);
    // Weak THUMBNAIL (title + tags strong): disc = 90, visualHook = 30 -> total 60.
    // Only thumbnail is below target -> projected mean(90, 90) = 90.
    const weakThumb = await svc.scoreVideo(base("ok title", "ok ok", "http://x/weakthumb.jpg"), CRIT3, "tech");
    expect(weakThumb.total).toBe(60);
    expect(weakThumb.projectedTotal).toBe(90);
    expect(weakThumb.recommendations.map((r) => r.element)).toEqual(["thumbnail"]);
    // Different weakness -> different projected ceiling (95 vs 90), never /77/.
    expect(weakTitle.projectedTotal).not.toBe(weakThumb.projectedTotal);
    // All elements at/above the fix target (title/tags 9, thumbnail 10) -> NO
    // recommendations and projected == live, so the projector can't fake a 77.
    const allStrong = await svc.scoreVideo(base("ok title", "ok ok", "http://x/s.jpg"), CRIT3, "tech");
    expect(allStrong.total).toBe(95); // disc mean(9,9)=90, vis 100 -> 95
    expect(allStrong.projectedTotal).toBe(95); // nothing below target to lift
    expect(allStrong.recommendations).toEqual([]);
  });

  it("echoes capped title/description/tags metadata for fix guidance", async () => {
    const svc = makeSvc({});
    const longDesc = "word ".repeat(1000);
    const res = await svc.scoreVideo(
      { videoId: "m1", title: "T", description: longDesc, tags: ["a", 42, "b"], thumbnail: { url: "http://x/1.jpg" } },
      CRITERIA,
      "tech",
    );
    expect(res.description).toBe(longDesc.slice(0, 2000));
    expect(res.tags).toEqual(["a", "b"]);
  });

  it("auditBatch returns per-video results and a batch overall", async () => {    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(10, 10)] }) },
      deepSeekText: vi.fn().mockResolvedValue(10),
    });
    const inputs = [
      { title: "a", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" },
      { title: "b", thumbnail: { url: "http://x/2.jpg" }, videoId: "b" },
    ];
    const batch = await svc.auditBatch(inputs, CRITERIA, "tech");
    expect(batch.results.length).toBe(2);
    expect(batch.overall).toBe(100);
  });

  it("grounds each element in the video's extracted keywords", async () => {
    const seen = [];
    const deepSeekText = vi.fn().mockImplementation((payload) => {
      seen.push(payload);
      return 6;
    });
    const { scoreVideo } = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(6, 9)] }) },
      deepSeekText,
    });
    const { categories } = await scoreVideo(
      { title: "5 Python Tricks for Data Scientists", description: "Python data science tips for analysis", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" },
      CRITERIA,
      "tech",
    );
    // DeepSeek was told the video's topic keywords so its judgment is grounded.
    const titleCall = seen.find((p) => p.element === "title");
    expect(Array.isArray(titleCall.keywords)).toBe(true);
    expect(titleCall.keywords).toContain("python");
    expect(titleCall.keywords).toContain("data");
    expect(categories).toHaveLength(3);
    const keys = categories.map((c) => c.key);
    expect(keys).toEqual(["discoverability", "contentQuality", "visualHook"]);
  });

  it("excludes the thumbnail element (no 0-score drag) when mode is 'lite'", async () => {    // User opted OUT of thumbnail analysis -> mode "lite". The thumbnail URL
    // still exists, but the vision pass never ran, so it must be treated as
    // no-data (max:0) and excluded from categories/total/recommendations rather
    // than scored 0/10 which would pull Visual Hook (and the total) to 0.
    const analyze = vi.fn().mockResolvedValue({ results: [fakeThumb(8, 9)] });
    const deepSeekText = vi.fn().mockResolvedValue(7); // title strong
    const svc = makeSvc({ thumbnailOptimizerService: { analyze }, deepSeekText });
    const input = { title: "Great clear title here", thumbnail: { url: "http://x/1.jpg" }, videoId: "abc123" };
    const { total, elements, categories, recommendations } = await svc.scoreVideo(input, CRITERIA, "tech", "lite");
    // Optimizer must NOT be invoked in lite mode (cost control).
    expect(analyze).not.toHaveBeenCalled();
    // Thumbnail element reported as no-data (max:0, note:"no data") so it is NOT
    // scored and can't drag a category/total -- not a 0/10 with weight intact.
    const thumbEl = elements.find((e) => e.element === "thumbnail");
    expect(thumbEl).toBeDefined();
    expect(thumbEl.breakdown[0].max).toBe(0);
    expect(thumbEl.breakdown[0].note).toBe("no data");
    // Visual Hook has no remaining data -> score 0 but NOT one of the counted
    // categories (proven below by total === discoverability, not the mean of the
    // two, and thus never dragging the score down).
    const vis = categories.find((c) => c.key === "visualHook");
    expect(vis).toBeDefined();
    expect(vis.score).toBe(0);
    // No thumbnail recommendation.
    expect(recommendations.find((r) => r.element === "thumbnail")).toBeUndefined();
    // Total reflects ONLY discoverability (title_clear + comedy_funny) -- the
    // phantom Visual Hook 0 is excluded, so total equals the discoverability
    // score instead of being dragged to ~half.
    const disc = categories.find((c) => c.key === "discoverability");
    expect(disc.score).toBeGreaterThan(0);
    expect(total).toBe(disc.score);
  });

  it("STREAM B: content-quality criteria score through the generic engine (no allowlist)", async () => {
    // niche_alignment/audience_hook (title) + value_density (description) use
    // only elements that always carry data, so the unchanged engine scores them
    // via the standard per-criterion path.
    const QUALITY = [
      { key: "title_clear", label: "Title Clarity", weight: 15, element: "title", category: "discoverability", instruction: "clear?", niches: [] },
      { key: "niche_alignment", label: "Niche Alignment", weight: 8, element: "title", category: "discoverability", instruction: "niche?", niches: [] },
      { key: "audience_hook", label: "Audience Hook", weight: 8, element: "title", category: "discoverability", instruction: "hook?", niches: [] },
      { key: "value_density", label: "Value Density", weight: 8, element: "description", category: "contentQuality", instruction: "dense?", niches: [] },
    ];
    const svc = makeSvc({
      thumbnailOptimizerService: { analyze: vi.fn().mockResolvedValue({ results: [fakeThumb(10, 10)] }) },
      deepSeekText: vi.fn().mockResolvedValue(8),
    });
    const input = { title: "5 Python Tricks for Data Scientists", description: "Concrete tips with examples", videoId: "a" };
    const { total, elements, categories } = await svc.scoreVideo(input, QUALITY, "tech");
    // All three new keys appear in the scored breakdown (grouped by element).
    const titleEl = elements.find((e) => e.element === "title");
    expect(titleEl.breakdown.length).toBe(3);
    const descEl = elements.find((e) => e.element === "description");
    expect(descEl.breakdown.length).toBe(1);
    expect(descEl.score).toBe(80);
    // discoverability = 80, contentQuality = 80 -> total 80.
    expect(total).toBe(80);
    expect(categories.find((c) => c.key === "discoverability").score).toBe(80);
    expect(categories.find((c) => c.key === "contentQuality").score).toBe(80);
  });

  it("reports no-data (not zeros) when no LLM scorer is wired", async () => {
    const svc = createVideoAuditService({}); // no deepSeek fakes at all
    const input = { title: "My Video", description: "Some words here", tags: ["a"], videoId: "v" };
    const res = await svc.scoreVideo(input, [
      { key: "title_clear", label: "Title Clarity", weight: 20, element: "title", category: "discoverability", instruction: "clear?", niches: [] },
    ], "tech");
    // The flat breakdown (consumed by the Full Audit blend) marks the
    // criterion as unscored instead of a false 0.
    expect(res.breakdown).toHaveLength(1);
    expect(res.breakdown[0].max).toBe(0);
    expect(res.breakdown[0].note).toBe("no data");
    expect(res.total).toBe(0);
  });
});
