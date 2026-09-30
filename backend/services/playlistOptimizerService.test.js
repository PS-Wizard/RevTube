// ─────────────────────────────────────────────────────────────────────────────
// Playlist Optimizer Service -- unit tests (DeepSeek call is mocked)
// ─────────────────────────────────────────────────────────────────────────────
import { describe, expect, it, vi } from "vitest";
import {
  createPlaylistOptimizerService,
  buildPlaylistTagPool,
  buildMeasuredFacts,
  countTimestamps,
  countNumberedEntries,
} from "./playlistOptimizerService";

const BASE_AUDIT = {
  audiencePersona: "",
  primaryNiche: "",
  contentStrengths: [],
  contentWeaknesses: [],
  missedOpportunities: [],
  metadataAnalysis: "",
};

const VIDEOS = [
  { id: "a", videoId: "aaaa", title: "One", description: "x".repeat(80) },
  { id: "b", videoId: "bbbb", title: "Two", description: "y".repeat(80) },
  { id: "c", videoId: "cccc", title: "Three", description: "" },
];

function makeService(deepSeekContent) {
  const axios = {
    post: vi.fn().mockResolvedValue({
      data: {
        choices: [{ message: { content: JSON.stringify(deepSeekContent) } }],
      },
    }),
  };
  const serverCache = {
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(true),
  };
  return createPlaylistOptimizerService({
    axios,
    serverCache,
    shortHash: (s) => `h${s.length}`,
    PERF_LOG_ENABLED: false,
    perfLog: () => {},
    perfNow: () => 0,
  });
}

describe("playlistOptimizerService", () => {
  it("derives non-zero fallback audit scores when the model returns zeros", async () => {
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: {
        ...BASE_AUDIT,
        channelScore: 0,
        contentHealthScore: 0,
        totalVideosAnalyzed: 0,
      },
    });
    const { results } = await service.analyze(VIDEOS, "channel");
    expect(results.audit.channelScore).toBeGreaterThan(0);
    expect(results.audit.contentHealthScore).toBeGreaterThan(0);
    expect(results.audit.totalVideosAnalyzed).toBe(VIDEOS.length);
  });

  it("keeps valid numeric scores from the model", async () => {
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: {
        ...BASE_AUDIT,
        channelScore: 85,
        contentHealthScore: 62,
        totalVideosAnalyzed: 3,
      },
    });
    const { results } = await service.analyze(VIDEOS, "channel");
    expect(results.audit.channelScore).toBe(85);
    expect(results.audit.contentHealthScore).toBe(62);
  });

  it("coerces string scores to 0-100 integers", async () => {
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: {
        ...BASE_AUDIT,
        channelScore: "70",
        contentHealthScore: "40",
        totalVideosAnalyzed: 3,
      },
    });
    const { results } = await service.analyze(VIDEOS, "channel");
    expect(results.audit.channelScore).toBe(70);
    expect(results.audit.contentHealthScore).toBe(40);
  });

  it("normalizes per-playlist scores and video arrays", async () => {
    const service = makeService({
      playlists: [
        {
          id: "p1",
          title: "P1",
          viralityScore: "88",
          videos: null,
          keywords: [],
          tags: [],
        },
      ],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50 },
    });
    const { results } = await service.analyze([VIDEOS[0]], "channel");
    expect(results.playlists[0].viralityScore).toBe(88);
    expect(Array.isArray(results.playlists[0].videos)).toBe(true);
  });

  it("attaches effectiveTags aggregated from member videos (no native playlist tags)", async () => {
    const service = makeService({
      playlists: [
        {
          id: "p1",
          title: "P1",
          description: "d".repeat(800),
          viralityScore: 50,
          predictedReach: "Medium",
          engagementPrediction: "ok",
          reasoning: "r",
          why: "w",
          keywords: ["k"],
          tags: ["t"],
          videos: ["a", "b"],
        },
      ],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50 },
    });
    const vids = [
      { id: "a", videoId: "aaaa", title: "One", description: "x", tags: ["Cat", "cute"] },
      { id: "b", videoId: "bbbb", title: "Two", description: "y", tags: ["cat", "funny"] },
    ];
    const { results } = await service.analyze(vids, "channel");
    const effective = results.playlists[0].effectiveTags;
    expect(effective).toEqual(expect.arrayContaining(["Cat", "cute", "funny"]));
    // Case-deduped: "Cat"/"cat" appears once.
    expect(effective.filter((t) => String(t).toLowerCase() === "cat")).toHaveLength(1);
  });

  it("fills niche, persona, and a real summary when the model omits them", async () => {
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: {
        ...BASE_AUDIT,
        channelScore: 50,
        contentHealthScore: 50,
        totalVideosAnalyzed: 2,
      },
    });
    const { results } = await service.analyze(
      [
        { id: "a", videoId: "aaaa", title: "Deep Diving into Machine Learning", description: "" },
        { id: "b", videoId: "bbbb", title: "Machine Learning Tips for Beginners", description: "" },
      ],
      "channel",
    );
    expect(results.audit.primaryNiche).not.toBe("");
    expect(results.audit.audiencePersona).not.toBe("");
    expect(results.summary).not.toBe("No summary provided.");
    expect(results.summary.length).toBeGreaterThan(10);
  });

  it("prefers the saved channel focus over model output and inference", async () => {
    const axios = {
      post: vi.fn().mockResolvedValue({
        data: {
          choices: [{ message: { content: JSON.stringify({
            playlists: [],
            summary: "ok",
            audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50, primaryNiche: "Model niche", audiencePersona: "Model persona" },
          }) } }],
        },
      }),
    };
    const serverCache = { get: vi.fn().mockResolvedValue(null), set: vi.fn().mockResolvedValue(true) };
    const service = createPlaylistOptimizerService({
      axios, serverCache, shortHash: (s) => `h${s.length}`,
      PERF_LOG_ENABLED: false, perfLog: () => {}, perfNow: () => 0,
    });
    const focus = { niche: "Vegan cooking", audience: "Busy home cooks", contentPillars: ["recipes"], tone: "Warm" };
    const { results } = await service.analyze(VIDEOS, "channel", {}, focus);
    expect(results.audit.primaryNiche).toBe("Vegan cooking");
    expect(results.audit.audiencePersona).toBe("Busy home cooks");
    // The prompt carries the owner-defined block for grouping/copy grounding.
    const sentPrompt = JSON.stringify(axios.post.mock.calls[0]);
    expect(sentPrompt).toContain("CHANNEL FOCUS & KNOWLEDGE");
    expect(sentPrompt).toContain("Vegan cooking");
  });

  it("keeps the model-provided summary, niche and persona", async () => {
    const service = makeService({
      playlists: [],
      summary: "A strong channel focused on tutorials with steady growth.",
      audit: {
        ...BASE_AUDIT,
        channelScore: 80,
        contentHealthScore: 70,
        totalVideosAnalyzed: 3,
        primaryNiche: "DIY tutorials",
        audiencePersona: "Hobbyists building personal projects",
      },
    });
    const { results } = await service.analyze(VIDEOS, "channel");
    expect(results.audit.primaryNiche).toBe("DIY tutorials");
    expect(results.audit.audiencePersona).toBe("Hobbyists building personal projects");
    expect(results.summary).toBe(
      "A strong channel focused on tutorials with steady growth.",
    );
  });

  it("degrades to safe defaults on non-JSON model output (no cache written)", async () => {
    const axios = {
      post: vi.fn().mockResolvedValue({
        data: { choices: [{ message: { content: "not json" } }] },
      }),
    };
    const serverCache = {
      get: vi.fn().mockResolvedValue(null),
      set: vi.fn().mockResolvedValue(true),
    };
    const service = createPlaylistOptimizerService({
      axios,
      serverCache,
      shortHash: (s) => `h${s.length}`,
      PERF_LOG_ENABLED: false,
      perfLog: () => {},
      perfNow: () => 0,
    });
    const result = await service.analyze(VIDEOS, "channel");
    expect(result.results).toEqual(
      expect.objectContaining({ playlists: [], audit: expect.any(Object) }),
    );
  });

  it("echoes videoInsights with time-decay weights, newest/highest performers first", async () => {
    const now = Date.now();
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50 },
    });
    const { results } = await service.analyze(
      [
        // Old, low-view -> lowest weight
        { id: "old", videoId: "old11111111", title: "Old", publishDate: new Date(now - 4 * 365 * 86400000).toISOString(), views: 100 },
        // Recent, high-view -> highest weight
        { id: "new", videoId: "new22222222", title: "New", publishDate: new Date(now - 10 * 86400000).toISOString(), views: 100000 },
        // Recent, low-view -> middle
        { id: "mid", videoId: "mid33333333", title: "Mid", publishDate: new Date(now - 30 * 86400000).toISOString(), views: 50 },
      ],
      "channel",
      { useTimeDecay: true },
    );
    const insights = results.videoInsights;
    expect(Array.isArray(insights)).toBe(true);
    expect(insights).toHaveLength(3);
    // Sorted by decayWeight descending.
    expect(insights[0].videoId).toBe("new22222222");
    expect(insights[0].decayWeight).toBeGreaterThan(insights[1].decayWeight);
    expect(insights[1].decayWeight).toBeGreaterThan(insights[2].decayWeight);
    // Old low-view video gets the smallest weight.
    expect(insights[2].videoId).toBe("old11111111");
    expect(insights[2].decayTier).toBe("Minimal");
    expect(insights[0].decayTier).toBe("High");
    // Insight rows carry the fields the UI table needs.
    expect(insights[0].title).toBe("New");
    expect(insights[0].views).toBe(100000);
    expect(typeof insights[0].ageDays).toBe("number");
  });

  it("skips time-decay entirely when useTimeDecay is off (default)", async () => {
    const now = Date.now();
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50 },
    });
    const { results } = await service.analyze(
      [
        // Old low-view video first; without time-decay it must stay first.
        { id: "old", videoId: "old11111111", title: "Old", publishDate: new Date(now - 4 * 365 * 86400000).toISOString(), views: 100 },
        // Recent high-view video second.
        { id: "new", videoId: "new22222222", title: "New", publishDate: new Date(now - 10 * 86400000).toISOString(), views: 100000 },
      ],
      "channel",
      {},
    );
    const insights = results.videoInsights;
    expect(insights.map((i) => i.videoId)).toEqual(["old11111111", "new22222222"]);
    expect(insights[0].decayWeight).toBeUndefined();
    expect(insights[0].decayTier).toBeUndefined();
    expect(results.analysisMeta.filters.useTimeDecay).toBe(false);
  });

  it("builds analysisMeta describing the data used", async () => {
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50 },
    });
    const { results } = await service.analyze(
      [
        { id: "a", videoId: "aaaa", title: "One", originalPlaylistId: "PL1", customMetadata: { originalPlaylistTitle: "Basics" } },
        { id: "b", videoId: "bbbb", title: "Two", originalPlaylistId: "PL1", customMetadata: { originalPlaylistTitle: "Basics" } },
        { id: "c", videoId: "cccc", title: "Three", originalPlaylistId: "PL2", customMetadata: { originalPlaylistTitle: "Advanced" } },
      ],
      "@mychannel",
      { analysisMode: "EXISTING", dataRange: "30d", excludeKeywords: "montage", maxPlaylists: 5, useTimeDecay: true },
    );
    expect(results.analysisMeta).toMatchObject({
      channelIdentifier: "@mychannel",
      mode: "EXISTING",
      dataRange: "30d",
      videoCount: 3,
    });
    expect(results.analysisMeta.playlistsIncluded).toHaveLength(2);
    expect(results.analysisMeta.filters.excludeKeywords).toBe("montage");
    expect(results.analysisMeta.filters.maxPlaylists).toBe(5);
    expect(results.analysisMeta.filters.useTimeDecay).toBe(true);
  });

  it("fills a blank playlist title/description instead of leaving them empty (EXISTING mode)", async () => {
    const service = makeService({
      playlists: [
        {
          id: "pl1",
          title: "", // model returned blank
          description: "", // model returned blank
          currentTitle: "Basics",
          currentViralityScore: 40,
          viralityScore: 80,
          predictedReach: "Medium",
          engagementPrediction: "good",
          videos: [{ id: "a", videoId: "aaaa", title: "One" }],
          keywords: [],
          tags: [],
        },
        {
          id: "pl2",
          title: "", // New Opportunity playlist left blank by the model
          description: "",
          viralityScore: 70,
          predictedReach: "Medium",
          engagementPrediction: "ok",
          videos: [{ id: "b", videoId: "bbbb", title: "Two" }],
          keywords: [],
          tags: [],
        },
      ],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 50, contentHealthScore: 50 },
    });
    const { results } = await service.analyze(
      [
        { id: "a", videoId: "aaaa", title: "One", originalPlaylistId: "PL1", customMetadata: { originalPlaylistTitle: "Basics" } },
        { id: "b", videoId: "bbbb", title: "Two", originalPlaylistId: "PL2", customMetadata: { originalPlaylistTitle: "Advanced" } },
      ],
      "@ch",
      { analysisMode: "EXISTING" },
    );
    const pl1 = results.playlists[0];
    const pl2 = results.playlists[1];
    // Optimized-existing falls back to its before-state title when blank.
    expect(pl1.title).toBe("Basics");
    expect(String(pl1.description).length).toBeGreaterThan(0);
    // New Opportunity playlist still gets a usable title, not empty.
    expect(pl2.title).not.toBe("");
    expect(pl2.currentTitle).toBeUndefined();
    expect(String(pl2.description).length).toBeGreaterThan(0);
    expect(Array.isArray(pl1.keywords)).toBe(true);
    expect(Array.isArray(pl2.tags)).toBe(true);
  });

  it("replaces echoed video stubs with full input rows, dropping duplicates and unknown ids", async () => {
    const service = makeService({
      playlists: [
        {
          id: "p1",
          title: "T",
          description: "d".repeat(700),
          keywords: ["k"],
          tags: ["t"],
          reasoning: "r",
          why: "w",
          viralityScore: 80,
          predictedReach: "High",
          engagementPrediction: "e",
          videos: [
            "cccc",
            { id: "b", videoId: "bbbb", title: "Two" },
            { id: "b", videoId: "bbbb", title: "Two (dup)" },
            { id: "zz", videoId: "zzzz", title: "Not in input" },
            { id: "a", videoId: "aaaa", title: "One" },
          ],
        },
      ],
      summary: "ok",
      audit: BASE_AUDIT,
    });
    const { results } = await service.analyze(VIDEOS, "", {});
    const vids = results.playlists[0].videos;
    // Bare-string member ("cccc") + object stubs all resolve; dup + unknown drop.
    expect(vids).toHaveLength(3);
    expect(vids[0]).toMatchObject({ videoId: "cccc", title: "Three" });
    expect(vids[1]).toMatchObject({ videoId: "bbbb", title: "Two" });
    // Full input row enriched back in, not the model's 3-field stub.
    expect(typeof vids[1].description).toBe("string");
  });

  it("backfills an EXISTING-mode playlist whose videos[] the model dropped", async () => {
    const sourceVideos = [
      { id: "v1", videoId: "vid1", title: "A", originalPlaylistId: "PLX", customMetadata: { originalPlaylistTitle: "Old Pl" } },
      { id: "v2", videoId: "vid2", title: "B", originalPlaylistId: "PLX", customMetadata: { originalPlaylistTitle: "Old Pl" } },
    ];
    const service = makeService({
      playlists: [
        {
          id: "p1",
          title: "Better Old Pl",
          currentTitle: "Old Pl",
          description: "d".repeat(700),
          keywords: ["k"],
          tags: ["t"],
          reasoning: "r",
          why: "w",
          viralityScore: 70,
          predictedReach: "High",
          engagementPrediction: "e",
          videos: [],
        },
      ],
      summary: "ok",
      audit: BASE_AUDIT,
    });
    const { results } = await service.analyze(sourceVideos, "", {
      analysisMode: "EXISTING",
    });
    expect(results.playlists[0].videos).toHaveLength(2);
    expect(results.playlists[0].videos[1].videoId).toBe("vid2");
  });

  it("leaves a genuinely unmatched NEW-mode playlist empty rather than inventing members", async () => {
    const service = makeService({
      playlists: [
        {
          id: "p1",
          title: "Fresh Picks",
          description: "d".repeat(700),
          keywords: ["k"],
          tags: ["t"],
          reasoning: "r",
          why: "w",
          viralityScore: 60,
          predictedReach: "Medium",
          engagementPrediction: "e",
          videos: [],
        },
      ],
      summary: "ok",
      audit: BASE_AUDIT,
    });
    const { results } = await service.analyze(VIDEOS, "", { analysisMode: "NEW" });
    expect(results.playlists[0].videos).toEqual([]);
  });

  it("buildPlaylistTagPool ranks by usage and dedupes case-insensitively", () => {
    const pool = buildPlaylistTagPool([
      { tags: ["Cat", "cute"] },
      { tags: ["cat", "funny"] },
      { customMetadata: { keywords: ["cute", "kittens"] } },
      { title: "no tags here" },
    ]);
    expect(pool[0]).toBe("Cat"); // most used (2 videos), first casing kept
    expect(pool.filter((t) => t.toLowerCase() === "cat")).toHaveLength(1);
    expect(pool).toEqual(expect.arrayContaining(["cute", "funny", "kittens"]));
    expect(buildPlaylistTagPool([])).toEqual([]);
  });

  it("buildMeasuredFacts reports real lengths, chapters, tags and playlist state", () => {
    const facts = buildMeasuredFacts(
      [
        { title: "Short", description: "thin", tags: [] },
        { title: "A much longer video title here", description: "00:00 Intro\n00:45 Part two\n01:30 End #cats", tags: ["a", "b"] },
      ],
      { analysisMode: "EXISTING" },
    );
    expect(facts).toContain("Videos analyzed: 2");
    expect(facts).toContain("1/2 thin (<40 chars)");
    expect(facts).toContain("Chapters (3+ timestamps): 1/2 videos");
    expect(facts).toContain("1/2 videos with zero tags");
  });

  it("buildMeasuredFacts measures existing playlists against the 700-char rule", () => {
    const desc = "Intro text.\n1. First video\n2. Second video";
    const facts = buildMeasuredFacts(
      [
        { id: "v1", videoId: "vid1", title: "A", originalPlaylistId: "PLX", customMetadata: { originalPlaylistTitle: "Old Pl", originalPlaylistDescription: desc, originalPlaylistTags: ["x"] } },
        { id: "v2", videoId: "vid2", title: "B", originalPlaylistId: "PLX", customMetadata: { originalPlaylistTitle: "Old Pl", originalPlaylistDescription: desc, originalPlaylistTags: ["x"] } },
      ],
      { analysisMode: "EXISTING" },
    );
    expect(facts).toContain("needs 700+: NO");
    expect(facts).toContain("numbered video list entries: 2 (matches members: YES)");
  });

  it("countTimestamps and countNumberedEntries count deterministically", () => {
    expect(countTimestamps("00:00 Intro 01:23 Middle")).toBe(2);
    expect(countTimestamps("no times here")).toBe(0);
    expect(countNumberedEntries("1. One\n2. Two\nplain")).toBe(2);
    expect(countNumberedEntries("no list")).toBe(0);
  });

  it("scores zero — not an invented 40 — when model and data are both empty", async () => {
    const service = makeService({
      playlists: [],
      summary: "ok",
      audit: { ...BASE_AUDIT, channelScore: 0, contentHealthScore: 0 },
    });
    const { results } = await service.analyze([], "channel");
    expect(results.audit.channelScore).toBe(0);
  });
});
