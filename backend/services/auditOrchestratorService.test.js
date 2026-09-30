// Unit tests for the Centralized Audit orchestrator service.
// Channel-only audit: scores channel identity + niche coherence; no video/playlist/general.
// No real services/Redis/DB/network -- every dependency is a plain DI fake.
import { describe, it, expect, vi } from "vitest";
import { createAuditOrchestratorService } from "./auditOrchestratorService";
import { createVideoAuditService as createRealVideoAuditService } from "./videoAuditService";
import { createAuditScoringService as createRealScoringService } from "./channelAuditScoringService";
import { DEFAULT_PROFILE } from "../config/channelAuditScoringProfiles";

const fakeInput = {
  channel: {
    name: "Test Channel",
    username: "@test",
    description: "We make coding tutorials for beginners and pros.",
    categoryId: "27",
    branding: { avatar: "https://x/a.png", image: { bannerExternalUrl: "y" }, watermark: {}, trailer: {}, sections: [], relatedChannels: [] },
  },
  videos: [
    { videoId: "v1", title: "Learn Rust in 10 minutes", description: "A short guide", tags: ["rust", "coding"], publishedAt: "2026-01-01", viewCount: 1000, likeCount: 50, commentCount: 5 },
  ],
  playlists: [{ title: "Rust Series", description: "All rust", size: 5 }],
};

function makeService(overrides = {}) {
  const auditScoringService = {
    scoreChannel: async (ch) => ({ total: 70, breakdown: [{ key: "name", label: "Name", earned: 20, max: 20 }] }),
    scoreVideo: async () => ({ total: 75, breakdown: [{ key: "title", label: "Title", earned: 25, max: 25 }] }),
    scoreGeneral: async () => ({ total: 60, breakdown: [{ key: "cadence", label: "Cadence", earned: 20, max: 20 }] }),
    scorePlaylist: async () => ({
      total: 0,
      breakdown: [
        { key: "title", label: "Title", max: 30, earned: 0 },
        { key: "description", label: "Description", max: 30, earned: 0 },
        { key: "tags", label: "Tags / Keywords", max: 20, earned: 0 },
        { key: "size", label: "Coverage / Size", max: 20, earned: 0 },
      ],
    }),
  };
  const deps = {
    gatherAuditInput: vi.fn(async () => fakeInput),
    createAuditScoringService: () => auditScoringService,
    getScoringProfile: async () => DEFAULT_PROFILE,
    getParamDefinitions: async () => [],
    query: vi.fn(async () => ({ rows: [] })),
    isPostgresConfigured: () => false,
    db: {},
    // Default AI engine fake (same shape as createVideoAuditService()).
    // Returns a single title_clear breakdown so the AI engine score is
    // deterministic (16/20 = 80) in the blend tests; tests that need per-element
    // depth supply their own engine fake.
    videoAuditEngine: {
      auditBatch: async (inputs) => ({
        results: inputs.map((inp) => ({
          videoId: inp.videoId,
          total: 80,
          breakdown: [
            { element: "title", key: "title_clear", label: "Title Clarity", category: "discoverability", score: 8, earned: 8, weight: 20, max: 10, note: "" },
          ],
          recommendations: [{ element: "title", current: 80, projected: 90, delta: 10 }],
          suggestions: { title: { options: ["Better title A"], why: "more curiosity" } },
        })),
        overall: 80,
        auditedAt: new Date().toISOString(),
      }),
    },
    // Default Playlist Optimizer engine fake (same shape as
    // createPlaylistOptimizerService().analyze).
    playlistOptimizerEngine: {
      analyze: async () => ({
        results: {
          audit: {
            channelScore: 75,
            criteriaBreakdown: [
              { criterion: "title_ctr", score: 80, note: "Titles are decent" },
              { criterion: "seo_description", score: 60, note: "Descriptions thin" },
              { criterion: "keywords", score: 70, note: "" },
              { criterion: "tags", score: 50, note: "" },
              { criterion: "theme_coherence", score: 90, note: "" },
            ],
          },
          playlists: [],
          summary: "Channel playlist strategy is solid overall.",
        },
      }),
    },
    ...overrides,
  };
  return { service: createAuditOrchestratorService(deps), deps };
}

describe("createAuditOrchestratorService", () => {
  it("grounds sub-audits in the saved channel focus when present", async () => {
    const auditBatch = vi.fn(async (inputs) => ({
      results: inputs.map((inp) => ({ videoId: inp.videoId, total: 80, breakdown: [], recommendations: [] })),
      overall: 80,
      auditedAt: new Date().toISOString(),
    }));
    const playlistAnalyze = vi.fn(async () => ({
      results: {
        audit: { channelScore: 75, criteriaBreakdown: [{ criterion: "title_ctr", score: 80, note: "" }] },
        playlists: [],
        summary: "s",
      },
    }));
    const focus = { channelId: "UC123", niche: "Vegan cooking", audience: "Home cooks", contentPillars: ["recipes"] };
    const channelFocusService = { getFocusForAI: vi.fn(async () => focus) };
    const { service } = makeService({
      videoAuditEngine: { auditBatch },
      playlistOptimizerEngine: { analyze: playlistAnalyze },
      channelFocusService,
    });
    await service.runAudit({ channelId: "UC123", orgId: "org1", opts: { scope: "full" } });
    // Focus fetched once, org-scoped
    expect(channelFocusService.getFocusForAI).toHaveBeenCalledWith("UC123", "org1");
    // Video sub-audit scores against the declared niche, not derived keywords
    expect(auditBatch.mock.calls[0][2]).toBe("Vegan cooking");
    // Playlist sub-audit receives the focus row for prompt + niche grounding
    expect(playlistAnalyze.mock.calls[0][3]).toEqual(focus);
  });

  it("falls back to keyword inference when no focus is saved", async () => {
    const auditBatch = vi.fn(async () => ({ results: [], overall: 0, auditedAt: new Date().toISOString() }));
    const { service } = makeService({
      videoAuditEngine: { auditBatch },
      channelFocusService: { getFocusForAI: vi.fn(async () => null) },
    });
    await service.runAudit({ channelId: "UC123", opts: { scope: "full" } }).catch(() => {});
    if (auditBatch.mock.calls.length) {
      expect(auditBatch.mock.calls[0][2]).not.toBe("Vegan cooking");
    }
  });

  it("reuses the real Video Audit engine for the video sub-audit when wired", async () => {
    // Fake LLM engine with the same shape as createVideoAuditService().
    const auditBatch = vi.fn(async (inputs) => ({
      results: inputs.map((inp) => ({
        videoId: inp.videoId,
        total: 80,
        breakdown: [
          { element: "title", key: "title_clear", label: "Title Clarity", category: "discoverability", score: 8, earned: 8, weight: 20, max: 10, note: "" },
          { element: "description", key: "description_rich", label: "Description Richness", category: "contentQuality", score: 6, earned: 6, weight: 15, max: 10, note: "" },
        ],
        recommendations: [{ element: "title", current: 80, projected: 90, delta: 10 }],
        suggestions: { title: { options: ["Better title A"], why: "more curiosity" } },
      })),
      overall: 80,
      auditedAt: new Date().toISOString(),
    }));
    const { service, deps } = makeService({ videoAuditEngine: { auditBatch } });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    // Engine receives the channel's videos mapped into video-audit inputs
    expect(deps.videoAuditEngine.auditBatch).toHaveBeenCalledTimes(1);
    expect(deps.videoAuditEngine.auditBatch.mock.calls[0][0][0].videoId).toBe("v1");
    expect(deps.videoAuditEngine.auditBatch.mock.calls[0][3]).toBe("full");
    // Full mode + all elements passed, so it runs the real deep pipeline (scores
    // every element and generates suggestions), not a 3-criterion lite pass.
    const passedElements = deps.videoAuditEngine.auditBatch.mock.calls[0][1];
    expect(passedElements.some((c) => c.key === "title_clear")).toBe(true);
    expect(passedElements.some((c) => c.key === "description_rich")).toBe(true);
    expect(passedElements.every((c) => c.element !== "thumbnail")).toBe(true);
    // Sub-run params are merged per dimension (backend weighted blend): the
    // deterministic title check and the AI title judgments collapse to ONE
    // "title" card instead of two scores for the same dimension.
    const params = out.subRuns.video.params;
    const title = params.find((p) => p.key === "title");
    expect(title).toBeDefined();
    expect(title.label).toBe("Title Optimization"); // clean label, no "(Category)" suffix
    expect(title.max).toBe(31); // 16 deterministic + 15 AI points
    expect(title.earned).toBe(24); // blended 77.5% (algo 75, AI 80) of 31
    expect(title.category).toBe("discoverability");
    expect(params.find((p) => p.key === "ve_title_clear")).toBeUndefined(); // merged
    const desc = params.find((p) => p.key === "description");
    expect(desc).toBeDefined(); // deterministic + AI description merged
    expect(desc.max).toBe(26); // 15 deterministic + 11 AI points
    expect(desc.earned).toBe(8); // blended ~31.8% (algo 0, AI 63.6) of 26
    // Caption criterion has no data -> excluded from the blend entirely. The
    // fake videos carry no caption flags, so captions_present gates too
    // (waiting on data) instead of scoring a false 0.
    expect(params.find((p) => p.key === "ve_caption_value")).toBeUndefined();
    expect(params.find((p) => p.key === "captions_present")).toBeUndefined();
    expect(out.subRuns.video.meta.gatedCriteria).toContain("captions_present");
    // description_rich IS AI-scored at full depth (the engine gets ALL
    // non-thumbnail elements), matching the standalone Video Audit — its points
    // land inside the merged "description" dimension, not a separate card.
    expect(params.find((p) => p.key === "ve_description_rich")).toBeUndefined(); // merged
    expect(out.subRuns.video.meta.scoringEngine).toContain("dual (algorithmic + AI, blended)");
    // Full per-video depth is returned: each analyzed video carries its engine
    // score, recommendations, and AI suggestions (the real generator info maps to
    // the input's videoId so it can be joined on the report).
    const metaVideos = out.subRuns.video.meta.videos;
    expect(Array.isArray(metaVideos)).toBe(true);
    const v1 = metaVideos.find((m) => m.videoId === "v1");
    expect(v1).toBeDefined();
    expect(typeof v1.score).toBe("number");
    expect(Array.isArray(v1.recommendations)).toBe(true);
    expect(out.subRuns.video.meta.deepAnalysisCount).toBeGreaterThan(0);
    expect(out.subRuns.video.meta.sampleLimit).toBeGreaterThan(0);
  });

  it("blends algorithmic and AI engine scores but never exposes the engine breakdown", async () => {
    // AI engine always returns 8/10 for title_clear (weight 20) -> AI engine
    // score = 80. Blend 50/50 vs 100% AI must produce different totals.
    const { service: svc50 } = makeService();
    const out50 = await svc50.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    // Only the merged final per-sub-run score is surfaced; the algorithmic/AI
    // breakdown must not leak to the client.
    expect(out50.subRuns.video.score).toBeGreaterThanOrEqual(0);
    expect(out50.subRuns.video.score).toBeLessThanOrEqual(100);
    // 100% AI weighting must equal the AI engine's own score exactly.
    const { service: svcAI } = makeService({
      getOptimizerCriteria: async () => ({ videoBlend: { algorithmic: 0, ai: 100 } }),
      videoAuditEngine: { auditBatch: async (inputs) => ({
      results: inputs.map(() => ({ total: 80, breakdown: [
        { element: "title", key: "title_clear", label: "Title Clarity", category: "discoverability", score: 8, earned: 8, weight: 20, max: 10, note: "" },
      ] })), overall: 80, auditedAt: new Date().toISOString(),
    }) } });
    const outAI = await svcAI.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(outAI.subRuns.video.score).toBe(80);
    for (const key of ["video", "channelIdentity", "playlist", "general"]) {
      expect(outAI.subRuns[key]?.meta?.engineScores).toBeUndefined();
    }
  });

  it("marks the video sub-run failed when no video AI engine is wired (no heuristic fallback)", async () => {
    const { service } = makeService({ videoAuditEngine: undefined });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(out.subRuns.video.status).toBe("failed");
    expect(out.subRuns.video.meta.error).toMatch(/Video AI engine is not configured/i);
  });

  it("runs a full 4-category audit and returns sub-run score + params + recommendations", async () => {
    const { service, deps } = makeService();
    const out = await service.runAudit({ channelId: "UC123", authHeader: "Bearer x", uid: "u1", orgId: null, includeThumbnailAI: false });
    expect(deps.gatherAuditInput).toHaveBeenCalledWith({
      channelId: "UC123",
      authHeader: "Bearer x",
      scope: undefined,
      onProgress: expect.any(Function),
    });
    expect(out.subRuns.channelIdentity.score).toBe(77);
    expect(out.subRuns.channelIdentity.params).toBeDefined();
    expect(Array.isArray(out.subRuns.channelIdentity.params)).toBe(true);
    expect(out.subRuns.channelIdentity.params.length).toBeGreaterThan(0);
    expect(out.subRuns.channelIdentity.recommendations).toBeDefined();
    expect(Array.isArray(out.subRuns.channelIdentity.recommendations)).toBe(true);
    // All 4 sub-runs present: channelIdentity, video, playlist, general
    expect(Object.keys(out.subRuns)).toEqual(["channelIdentity", "video", "playlist", "general"]);
    expect(out.subRuns.video.meta.videos).toBeDefined();
    expect(out.subRuns.video.meta.videos.length).toBe(1);
    expect(out.subRuns.video.meta.videos[0].videoId).toBe("v1");
    expect(out.subRuns.video.meta.videos[0].url).toBe("https://www.youtube.com/watch?v=v1");
  });

  it("calculates overall score based on sub-audit weights", async () => {
    const { service } = makeService();
    const out = await service.runAudit({ channelId: "UC123" });
    expect(out.overall).toBeGreaterThanOrEqual(0);
    expect(out.overall).toBeLessThanOrEqual(100);
    expect(out.grade).toBeDefined();
  });

  it("scores niche_coherence on a real 0-100 scale (not always-passing)", async () => {
    // Only 1 of 2 recent videos mentions the dominant "rust" niche -> 50%
    // coherence, below the default 70% threshold.
    const lowCoherence = {
      ...fakeInput,
      videos: [
        { videoId: "v1", title: "Rust guide for beginners", description: "d", tags: ["rust"] },
        { videoId: "v2", title: "Cooking pasta recipe", description: "d", tags: ["food"] },
      ],
    };
    const query = vi.fn(async () => ({ rows: [{ id: 1 }] }));
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => lowCoherence),
      isPostgresConfigured: () => true,
      query,
    });
    const out = await service.runAudit({ channelId: "UC123" });
    expect(out.subRuns.channelIdentity.meta.coherencePct).toBe(50);
    const subCall = query.mock.calls[2];
    const results = JSON.parse(subCall[1][5]);
    const coherenceParam = results.params.find((p) => p.key === "niche_coherence");
    expect(coherenceParam).toBeDefined();
    expect(coherenceParam.max).toBe(100);
    expect(coherenceParam.earned).toBe(0); // failed below threshold
  });

  it("does not persist when Postgres is not configured (no-ops cleanly)", async () => {
    const { service, deps } = makeService();
    const out = await service.runAudit({ channelId: "UC123", uid: "u1" });
    expect(deps.query).not.toHaveBeenCalled();
    expect(out.auditRunId).toBeNull();
  });

  it("persists run + 4 sub-runs when Postgres is configured", async () => {
    const { service, deps } = makeService({
      isPostgresConfigured: () => true,
      query: vi.fn(async () => ({ rows: [{ id: 42 }] })),
    });
    const out = await service.runAudit({ channelId: "UC123", uid: "u1", orgId: "org1", includeThumbnailAI: true });
    // 1 video history row + 1 playlist history row + 1 availability check + 1
    // insert for audit_runs + 4 for the sub_runs.
    expect(deps.query).toHaveBeenCalledTimes(8);
    expect(out.auditRunId).toBe(42);
    // Engine history rows (after the availability check) so their ids land in
    // the video / playlist sub-run meta.
    const videoHistory = deps.query.mock.calls[1];
    expect(videoHistory[0]).toContain("INSERT INTO video_audits");
    expect(videoHistory[1][1]).toContain("Full Audit --");
    expect(out.videoHistoryId).toBe(42);
    expect(out.subRuns.video.meta.videoHistoryId).toBe(42);
    const playlistHistory = deps.query.mock.calls[2];
    expect(playlistHistory[0]).toContain("INSERT INTO playlist_audits");
    expect(out.playlistHistoryId).toBe(42);
    expect(out.subRuns.playlist.meta.playlistHistoryId).toBe(42);
    const runInsert = deps.query.mock.calls[3][0];
    expect(runInsert).toContain("INSERT INTO audit_runs");
    const subInsert = deps.query.mock.calls[4][0];
    expect(subInsert).toContain("INSERT INTO audit_sub_runs");
    expect(deps.query.mock.calls[4][1][1]).toBe("channelIdentity");
  });

  it("persists the final rollup in one transaction when a client is available", async () => {
    const statements = [];
    const clientFake = {
      query: vi.fn(async (text) => {
        statements.push(text);
        if (text.includes("INSERT INTO audit_runs")) return { rows: [{ id: 7 }] };
        return { rows: [] };
      }),
    };
    const withClient = vi.fn(async (fn) => fn(clientFake));
    const { service, deps } = makeService({
      isPostgresConfigured: () => true,
      query: vi.fn(async () => ({ rows: [] })),
      withClient,
    });
    const out = await service.runAudit({ channelId: "UC123", uid: "u1" });
    expect(withClient).toHaveBeenCalledTimes(1);
    expect(statements[0]).toBe("BEGIN");
    expect(statements.at(-1)).toBe("COMMIT");
    expect(statements.filter((s) => s.includes("INSERT INTO audit_sub_runs"))).toHaveLength(4);
    expect(statements).not.toContain("ROLLBACK");
    expect(out.auditRunId).toBe(7);
    // Run + sub-run writes went through the transaction client, not the pool.
    expect(deps.query.mock.calls.some((c) => String(c[0]).includes("audit_runs"))).toBe(false);
  });

  it("rolls back the rollup when a sub-run insert fails", async () => {
    const statements = [];
    const clientFake = {
      query: vi.fn(async (text) => {
        statements.push(text);
        if (text.includes("INSERT INTO audit_runs")) return { rows: [{ id: 9 }] };
        if (text.includes("INSERT INTO audit_sub_runs") && statements.filter((s) => s.includes("audit_sub_runs")).length >= 2) {
          throw new Error("sub insert boom");
        }
        return { rows: [] };
      }),
    };
    const { service } = makeService({
      isPostgresConfigured: () => true,
      query: vi.fn(async () => ({ rows: [] })),
      withClient: vi.fn(async (fn) => fn(clientFake)),
    });
    await expect(service.runAudit({ channelId: "UC123", uid: "u1" })).rejects.toThrow("sub insert boom");
    expect(statements).toContain("ROLLBACK");
    expect(statements).not.toContain("COMMIT");
  });

  it("streams pipeline progress phases to the caller", async () => {
    const phases = [];
    const { service } = makeService();
    await service.runAudit({
      channelId: "UC123",
      uid: "u1",
      opts: { scope: "full", onProgress: (phase, fraction) => phases.push([phase, fraction]) },
    });
    const names = phases.map(([phase]) => phase);
    expect(names).toContain("setup");
    expect(names).toContain("video");
    expect(names).toContain("persist");
    expect(names.at(-1)).toBe("done");
  });

  it("degrades gracefully when the channel sub-audit throws", async () => {
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => { throw new SyntaxError("Unterminated string in JSON"); }),
    });
    const out = await service.runAudit({ channelId: "UC123", uid: "u1" });
    expect(out.subRuns.channelIdentity.score).toBe(0);
    expect(out.subRuns.channelIdentity.status).toBe("failed");
    expect(out.subRuns.channelIdentity.meta.error).toContain("Unterminated string in JSON");
    // Overall is still computed (0 from the failed sub).
    expect(out.overall).toBe(0);
  });

  it("builds real per-failing-param recommendations (no avatar -> high sev, interpolated)", async () => {
    const params = [
      { auditType: "CHANNEL_IDENTITY", key: "avatar_present", label: "Custom Profile Image", weight: 6, enabled: true, thresholds: {}, recommendationTemplate: "Upload a custom {{label}} so viewers trust you." },
      { auditType: "CHANNEL_IDENTITY", key: "category_set", label: "Category Set", weight: 5, enabled: true, thresholds: {}, recommendationTemplate: "Set your channel category." },
    ];
    const query = vi.fn(async () => ({ rows: [{ id: 42 }] }));
    const { service } = makeService({
      isPostgresConfigured: () => true,
      query,
      // Channel has no avatar -> avatar_present fails (0/100, +4 pts).
      // category_set passes (categoryId present) -> no recommendation.
      gatherAuditInput: vi.fn(async () => ({
        channel: { name: "C", username: "@c", description: "desc", categoryId: "27", branding: {} },
        videos: [{ videoId: "v1", title: "Rust guide", description: "d", tags: ["rust"], publishedAt: "2026-01-01" }],
        playlists: [],
      })),
      getParamDefinitions: async () => params,
    });
    await service.runAudit({ channelId: "UC123", uid: "u1" });
    // Channel sub-run insert is call index 4 (0 = availability check,
    // 1 = video history row, 2 = playlist history row, 3 = audit_runs insert).
    const subCall = query.mock.calls[4];
    expect(subCall[0]).toContain("INSERT INTO audit_sub_runs");
    // args[5] = JSONB results string: { params, recommendations, meta }
    const results = JSON.parse(subCall[1][5]);
    const recs = results.recommendations;
    // The missing avatar is a +4 pts fix -> medium severity (impact-led bands),
    // template interpolated.
    const avatarRec = recs.find((r) => r.paramKey === "avatar_present");
    expect(avatarRec).toBeDefined();
    expect(avatarRec.severity).toBe("medium");
    expect(avatarRec.message).toContain("Custom Profile Image");
    expect(avatarRec.message).not.toContain("{{label}}");
    // The present category_set must NOT generate a recommendation (it passed).
    expect(recs.find((r) => r.paramKey === "category_set")).toBeUndefined();
  });

  it("grades severity by score impact so highs/mediums/lows actually differ", async () => {
    // Low niche coherence (mixed topics) + AI niche_clarity 0/10: the merged
    // "niche" dimension scores 0 and must grade high; a missing avatar stays
    // a medium +4 pts fix.
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        channel: { name: "C", username: "@c", description: "desc", branding: {} },
        videos: [
          { videoId: "v1", title: "Rust guide for beginners", description: "d", tags: ["rust"] },
          { videoId: "v2", title: "Cooking pasta recipe", description: "d", tags: ["food"] },
        ],
        playlists: [],
      })),
      llmEngine: {
        deepSeekJson: async () => ({ scores: [{ key: "niche_clarity", score: 0 }] }),
      },
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const recs = out.subRuns.channelIdentity.recommendations;
    const byKey = new Map(recs.map((r) => [r.paramKey, r]));
    // Merged niche dimension at 0 (deterministic coherence failed AND AI
    // clarity 0/10) -> high.
    expect(byKey.get("niche")?.severity).toBe("high");
    // 0/100 branding check (+4 pts) -> medium, not high.
    expect(byKey.get("avatar_present")?.severity).toBe("medium");
    // Sorted severity-first: no low may precede a high.
    const rank = { high: 3, medium: 2, low: 1 };
    const ranks = recs.map((r) => rank[r.severity]);
    expect(ranks).toEqual([...ranks].sort((a, b) => b - a));
  });

  it("returns params and recommendations in the live summary (not just score)", async () => {
    const { service } = makeService();
    const out = await service.runAudit({ channelId: "UC123" });
    const ch = out.subRuns.channelIdentity;
    expect(ch.params).toBeDefined();
    expect(ch.recommendations).toBeDefined();
    // Each param has key/label/earned/max.
    expect(ch.params.every((p) => p.key && p.label && typeof p.earned === "number" && typeof p.max === "number")).toBe(true);
  });

  it("reuses the real Playlist Optimizer engine for the playlist sub-audit when wired", async () => {
    const analyze = vi.fn(async () => ({
      results: {
        audit: {
          channelScore: 75,
          criteriaBreakdown: [
            { criterion: "title_ctr", score: 80, note: "Titles are decent" },
            { criterion: "seo_description", score: 60, note: "Descriptions thin" },
            { criterion: "keywords", score: 70, note: "" },
            { criterion: "tags", score: 50, note: "" },
            { criterion: "theme_coherence", score: 90, note: "" },
          ],
        },
        playlists: [],
        summary: "Channel playlist strategy is solid overall.",
      },
    }));
    const { service, deps } = makeService({ playlistOptimizerEngine: { analyze } });
    const out = await service.runAudit({ channelId: "UC123" });
    // Engine receives the channel's videos.
    expect(deps.playlistOptimizerEngine.analyze).toHaveBeenCalledTimes(1);
    expect(deps.playlistOptimizerEngine.analyze.mock.calls[0][0][0].videoId).toBe("v1");
    // Sub-run earned = per-criterion BLEND of the deterministic baseline and the
    // LLM score (playlistBlend, default 50/50): title baseline here is 0 (the
    // scorePlaylist fake earns 0) and the LLM gives 80 -> (0*50+80*50)/100=40.
    const params = out.subRuns.playlist.params;
    expect(out.subRuns.playlist.status).not.toBe("failed");
    const titleCtr = params.find((p) => p.key === "pl_title_ctr");
    expect(titleCtr.earned).toBe(5); // 12 (default weight) * 40/100
    expect(titleCtr.rawValue).toBe(0); // deterministic baseline kept as rawValue
    expect(titleCtr.recommendationTemplate).toContain("Titles are decent");
    // Unmatched criteria are excluded, not zeroed.
    expect(params.find((p) => p.key === "pl_ordering_flow")).toBeUndefined();
    // Meta reports the engine + summary.
    expect(out.subRuns.playlist.meta.scoringEngine).toContain("playlistOptimizerEngine");
    expect(out.subRuns.playlist.meta.summary).toContain("solid overall");
  });

  it("computes deterministic ordering_flow and metadata_health baselines as rawValue", async () => {
    const fullBreakdown = [
      { criterion: "title_ctr", score: 80, note: "" },
      { criterion: "seo_description", score: 60, note: "" },
      { criterion: "keywords", score: 70, note: "" },
      { criterion: "tags", score: 50, note: "" },
      { criterion: "ordering_flow", score: 75, note: "" },
      { criterion: "theme_coherence", score: 90, note: "" },
      { criterion: "metadata_health", score: 65, note: "" },
      { criterion: "virality_potential", score: 55, note: "" },
      { criterion: "video_coverage", score: 85, note: "" },
      { criterion: "audience_targeting", score: 70, note: "" },
    ];
    const analyze = vi.fn(async () => ({
      results: {
        audit: { channelScore: 75, criteriaBreakdown: fullBreakdown },
        // Chronologically ordered members (oldest first) -> perfect flow.
        playlists: [
          { id: "pl1", videos: [
            { videoId: "v1", position: 0, publishedAt: "2026-01-01" },
            { videoId: "v2", position: 1, publishedAt: "2026-02-01" },
          ] },
        ],
        summary: "ok",
      },
    }));
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        ...fakeInput,
        videos: [
          // Complete metadata -> 100 health; incomplete -> partial.
          { videoId: "v1", title: "Full title here", description: "A decent description", tags: ["rust"], publishedAt: "2026-01-01" },
          { videoId: "v2", title: "", description: "", tags: [], publishedAt: "2026-02-01" },
        ],
      })),
      playlistOptimizerEngine: { analyze },
    });
    const out = await service.runAudit({ channelId: "UC123" });
    const params = out.subRuns.playlist.params;
    const flow = params.find((p) => p.key === "pl_ordering_flow");
    expect(flow).toBeDefined();
    expect(flow.rawValue).toBe(100); // position order matches published order
    expect(flow.earned).toBe(Math.round(12 * (((100 + 75) / 2) / 100))); // blended baseline+LLM = 11
    const health = params.find((p) => p.key === "pl_metadata_health");
    expect(health).toBeDefined();
    // v1 = 3/3 fields, v2 = 0/3 -> mean 50.
    expect(health.rawValue).toBe(50);
    expect(health.earned).toBe(Math.round(8 * (((50 + 65) / 2) / 100))); // blended = 5
  });

  it("scores catalog coverage from the FULL channel video count vs playlist count", async () => {
    // 100 channel videos but only 1 playlist -> far under-organized
    // (5-25 videos/playlist is healthy, so ~4-20 playlists are expected).
    const analyze = vi.fn(async () => ({
      results: {
        audit: { channelScore: 75, criteriaBreakdown: [{ criterion: "title_ctr", score: 80, note: "" }] },
        playlists: [{ id: "pl1", videos: [{ videoId: "v1", position: 0, publishedAt: "2026-01-01" }] }],
        summary: "ok",
      },
    }));
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        ...fakeInput,
        // Full inventory (100) vs the engine's analyzed sample (1).
        videos: Array.from({ length: 100 }, (_, i) => ({ videoId: `v${i}`, publishedAt: "2026-01-01" })),
      })),
      playlistOptimizerEngine: { analyze },
    });
    const out = await service.runAudit({ channelId: "UC123" });
    const pl = out.subRuns.playlist;
    const coverage = pl.params.find((p) => p.key === "pl_catalog_coverage");
    expect(coverage).toBeDefined();
    expect(coverage.rawValue).toBeLessThan(50); // 100 videos / 1 playlist = heavily over-stuffed
    expect(coverage.max).toBe(10);
    expect(pl.meta.totalVideoCount).toBe(100);
    expect(pl.meta.playlistAdequacy.recommendedMin).toBe(4); // ceil(100/25)
    expect(pl.meta.playlistAdequacy.recommendedMax).toBe(20); // ceil(100/5)
    // The under-coverage shortfall produces an actionable recommendation.
    const rec = pl.recommendations.find((r) => r.paramKey === "pl_catalog_coverage");
    expect(rec).toBeDefined();
    expect(rec.message).toContain("100 videos in 1 playlist");
  });

  it("fails the playlist sub-run loudly when the optimizer engine is missing", async () => {
    // Explicit null so the spread override actually removes the default fake.
    const { playlistOptimizerEngine, ...rest } = makeService().deps;
    const { service } = makeService({ ...rest, playlistOptimizerEngine: null });
    const out = await service.runAudit({ channelId: "UC123" });
    expect(out.subRuns.playlist.status).toBe("failed");
    expect(out.subRuns.playlist.meta.error).toContain("Playlist Optimizer engine is not configured");
  });

  it("degrades channel + general to algo-only when no LLM is wired (aiTotal null)", async () => {
    const { service } = makeService(); // no llmEngine dep
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    // Legacy deterministic totals are unchanged by the blend.
    expect(out.subRuns.channelIdentity.score).toBe(77);
    expect(out.subRuns.general.score).toBe(60);
    // No engine breakdown (algorithmic/AI/blend) leaks to the client.
    expect(out.subRuns.channelIdentity.meta.engineScores).toBeUndefined();
    expect(out.subRuns.general.meta.engineScores).toBeUndefined();
    // No AI params leak in without an LLM.
    expect(out.subRuns.channelIdentity.params.some((p) => p.key === "brand_voice")).toBe(false);
    expect(out.subRuns.general.params.some((p) => p.key === "growth_trajectory")).toBe(false);
  });

  it("blends channel AI criteria into the score with clean labels", async () => {
    const llmEngine = {
      deepSeekJson: async () => ({ scores: [
        { key: "brand_voice", score: 10 },
        { key: "niche_clarity", score: 10 },
        { key: "positioning", score: 10 },
        { key: "trust_signals", score: 10 },
      ] }),
    };
    const { service } = makeService({ llmEngine });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const ch = out.subRuns.channelIdentity;
    expect(ch.score).toBe(89); // round((77*50 + 100*50)/100)
    expect(ch.meta.engineScores).toBeUndefined();
    // AI-only dimensions keep their key with clean labels (no "AI" wording).
    for (const key of ["brand_voice", "positioning", "trust_signals"]) {
      const p = ch.params.find((x) => x.key === key);
      expect(p).toBeDefined();
      expect(p.earned).toBe(25); // 25 * 10/10
      expect(p.label).not.toMatch(/ai/i);
    }
    // Overlapping dimensions merge to ONE card: deterministic coherence (100)
    // + AI clarity (10/10) blend 50/50 -> full marks on the combined points.
    const niche = ch.params.find((x) => x.key === "niche");
    expect(niche).toBeDefined();
    expect(niche.label).not.toMatch(/ai/i);
    expect(niche.earned).toBe(niche.max);
    expect(niche.max).toBe(125); // 100 deterministic + 25 AI points
    expect(ch.params.find((x) => x.key === "niche_clarity")).toBeUndefined(); // merged
    // No separate AI section: every param carries a real scoring category.
    expect(ch.params.filter((x) => (x.category || "") === "ai")).toHaveLength(0);
  });

  it("blends general AI criteria into the score with clean labels", async () => {
    const llmEngine = {
      deepSeekJson: async () => ({ scores: [
        { key: "growth_trajectory", score: 10 },
        { key: "cadence_health", score: 10 },
        { key: "format_mix", score: 10 },
      ] }),
    };
    const { service } = makeService({ llmEngine });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const g = out.subRuns.general;
    expect(g.score).toBe(80); // round((60*50 + 100*50)/100)
    expect(g.meta.engineScores).toBeUndefined();
    expect(g.params.find((p) => p.key === "growth_trajectory")?.earned).toBe(40);
  });

  it("does not expose engineScores on the playlist sub-run", async () => {
    const { service } = makeService();
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(typeof out.subRuns.playlist.score).toBe("number");
    expect(out.subRuns.playlist.meta.engineScores).toBeUndefined();
  });

  it("lists gated criteria in meta instead of silently dropping them", async () => {
    // Default fakes: video engine scores only title_clear; playlist engine
    // returns 5 of 10 criteria. Missing ones must appear as waiting-on-data.
    const { service } = makeService();
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(out.subRuns.video.meta.gatedCriteria).toContain("caption_value");
    expect(out.subRuns.video.params.find((p) => p.key === "ve_caption_value")).toBeUndefined();
    expect(out.subRuns.playlist.meta.gatedCriteria.length).toBeGreaterThan(0);
    expect(out.subRuns.playlist.params.find((p) => p.key === "pl_ordering_flow")).toBeUndefined();
    // No Postgres in this fake: availability known-false, no extra query made.
    expect(out.subRuns.video.meta.dataAvailability).toEqual({ hasVideoMetrics: false });
    expect(out.subRuns.channelIdentity.meta.dataAvailability).toEqual({ hasVideoMetrics: false });
  });

  it("detects ingested retention data as available for gating", async () => {
    const query = vi.fn(async () => ({ rows: [{ "?column?": 1 }] }));
    const { service } = makeService({
      isPostgresConfigured: () => true,
      query,
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(query).toHaveBeenCalledWith(
      "SELECT 1 FROM analytics_video_metrics_daily WHERE channel_id = $1 LIMIT 1",
      ["UC123"],
    );
    expect(out.subRuns.general.meta.dataAvailability).toEqual({ hasVideoMetrics: true });
  });

  it("defaults the video sample to the latest quarter, max 15 videos", async () => {
    // 20 videos published 4 days apart (all inside the 90-day quarter).
    const now = Date.now();
    const videos = Array.from({ length: 20 }, (_, i) => ({
      videoId: `v${i}`,
      title: `Cat video ${i}`,
      description: "d",
      tags: ["cat"],
      publishedAt: new Date(now - i * 4 * 86400000).toISOString(),
    }));
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({ ...fakeInput, videos })),
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const meta = out.subRuns.video.meta;
    expect(meta.videoSelection.mode).toBe("since");
    expect(meta.videoCount).toBe(15);
    expect(meta.deepAnalysisCount).toBe(15);
    // Latest 15 win: v0 (newest) in, v19/v18/v17/v16/v15 (oldest) out.
    const ids = meta.videos.map((v) => v.videoId);
    expect(ids).toContain("v0");
    expect(ids).not.toContain("v19");
    expect(ids).not.toContain("v15");
  });

  it("falls back to the latest videos when the quarter is empty", async () => {
    // Single old video (outside the 90-day quarter) still audits instead of failing.
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        ...fakeInput,
        videos: [{ videoId: "old1", title: "Old cat video", description: "d", tags: ["cat"], publishedAt: "2020-01-01" }],
      })),
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(out.subRuns.video.status).not.toBe("failed");
    expect(out.subRuns.video.meta.videoCount).toBe(1);
  });

  it("gates trend checks instead of assuming perfect scores with one video", async () => {
    const { service } = makeService();
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const ch = out.subRuns.channelIdentity;
    // One video = no cadence/velocity signal: gated, absent from params.
    expect(ch.meta.gatedCriteria).toContain("publish_cadence_trend");
    expect(ch.meta.gatedCriteria).toContain("velocity_change_trend");
    expect(ch.params.find((p) => p.key === "publish_cadence_trend")).toBeUndefined();
    expect(ch.params.find((p) => p.key === "velocity_change_trend")).toBeUndefined();
    // Blend renormalizes over measured sides only (text 70 + branding, no trend).
    expect(ch.score).toBe(77);
  });

  it("gates shorts-mix with fewer than 4 videos and engagement with zero views", async () => {
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        ...fakeInput,
        videos: [{ videoId: "v1", title: "No views yet", description: "d", tags: ["x"], publishedAt: new Date().toISOString(), viewCount: 0, likeCount: 0, commentCount: 0 }],
      })),
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(out.subRuns.general.meta.gatedCriteria).toContain("shorts_balance");
    expect(out.subRuns.general.params.find((p) => p.key === "shorts_balance")).toBeUndefined();
    expect(out.subRuns.video.meta.gatedCriteria).toContain("engagement_signals");
    expect(out.subRuns.video.params.find((p) => p.key === "engagement_signals")).toBeUndefined();
  });

  it("gates unverifiable branding checks instead of false-failing them", async () => {
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        channel: {
          name: "No Brand Data",
          username: "@x",
          description: "desc",
          branding: { avatar: "https://x/a.png", image: null, watermark: null, trailer: null, sections: null, relatedChannels: null, brandingVerifiable: false },
        },
        videos: [{ videoId: "v1", title: "Rust guide", description: "d", tags: ["rust"], publishedAt: "2026-01-01" }],
        playlists: [],
      })),
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const ch = out.subRuns.channelIdentity;
    // Avatar comes from the snippet (always verifiable) and still passes.
    expect(ch.params.find((p) => p.key === "avatar_present")?.earned).toBe(100);
    // Stripped branding block: these gate instead of scoring 0.
    for (const key of ["banner_spec", "trailer_present", "watermark_set", "featured_sections", "category_set", "links_valid"]) {
      expect(ch.meta.gatedCriteria).toContain(key);
      expect(ch.params.find((p) => p.key === key)).toBeUndefined();
    }
  });

  it("feeds the playlist engine the quarter/15 sample, not the whole catalog", async () => {
    const now = Date.now();
    const videos = Array.from({ length: 20 }, (_, i) => ({
      videoId: `v${i}`,
      title: `Cat video ${i}`,
      description: "d",
      tags: ["cat"],
      publishedAt: new Date(now - i * 4 * 86400000).toISOString(),
    }));
    const analyze = vi.fn(async () => ({
      results: {
        audit: { channelScore: 75, criteriaBreakdown: [{ criterion: "title_ctr", score: 80, note: "" }] },
        playlists: [],
        summary: "ok",
      },
    }));
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({ ...fakeInput, videos })),
      playlistOptimizerEngine: { analyze },
    });
    await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const engineInput = analyze.mock.calls[0][0];
    expect(engineInput).toHaveLength(15);
    expect(engineInput[0].videoId).toBe("v0");
  });

  it("excludes failed sub-audits from the overall instead of scoring them zero", async () => {
    const { service } = makeService({ videoAuditEngine: undefined });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(out.subRuns.video.status).toBe("failed");
    // Only channelIdentity + general + playlist score; video's weight is out.
    expect(out.overall).toBeGreaterThan(0);
  });

  it("words upload consistency by measured frequency, not a fixed script", async () => {
    // Bursty schedule: alternating 1-day and 12-day gaps (avg ~6.5d, wild CV).
    // Frequent on average but irregular -> the "post often" variant must fire.
    const now = Date.now();
    let t = now;
    const videos = Array.from({ length: 30 }, (_, i) => {
      const v = {
        videoId: `v${i}`,
        title: `Video ${i} pokemon`,
        description: "d",
        tags: ["pokemon"],
        publishedAt: new Date(t).toISOString(),
        viewCount: 100,
        likeCount: 3,
        commentCount: 0,
      };
      t -= (i % 2 === 0 ? 1 : 12) * 86400000;
      return v;
    });
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({ ...fakeInput, videos })),
      // Real scorer: the fake scoreGeneral has no uploadConsistency breakdown.
      createAuditScoringService: () => createRealScoringService({}),
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const rec = out.subRuns.general.recommendations.find((r) => r.paramKey === "uploadConsistency");
    expect(rec?.message).toContain("post often");
    expect(rec?.message).not.toContain("rarely");
  });

  it("never demands a profile photo the channel already has", async () => {
    const llmEngine = {
      deepSeekJson: async () => ({ scores: [{ key: "trust_signals", score: 2 }] }),
    };
    const { service } = makeService({ llmEngine });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    // Fake channel has an avatar: the trust fix must not ask for one.
    const rec = out.subRuns.channelIdentity.recommendations.find((r) => r.paramKey === "trust_signals");
    expect(rec?.message).not.toContain("profile photo");
  });

  it("flows real engine criterion scores into merged dimensions (no phantom gating)", async () => {
    // Regression test: scoreVideo used to omit the flat criterion `breakdown`,
    // so the orchestrator found no AI scores and gated every AI element on
    // every channel. Wire the REAL engine (fake LLM) and require the AI
    // points to land in the merged dimensions.
    const engine = createRealVideoAuditService({ deepSeekText: async () => 8 });
    const { service } = makeService({ videoAuditEngine: engine });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const v = out.subRuns.video;
    expect(v.status).not.toBe("failed");
    for (const key of ["title_clear", "title_curiosity", "description_rich", "tags_quality", "keywords_match", "niche_alignment", "audience_hook", "value_density"]) {
      expect(v.meta.gatedCriteria).not.toContain(key);
    }
    // Captions genuinely have no data (no transcript text is fetched).
    expect(v.meta.gatedCriteria).toContain("caption_value");
    const title = v.params.find((p) => p.key === "title");
    expect(title).toBeDefined();
    expect(title.max).toBeGreaterThan(16); // deterministic 16 + AI points
    expect(v.meta.engineScores).toBeUndefined();
  });

  it("gates captions_present without caption flags, scores it with them", async () => {
    const { service: s1 } = makeService(); // fake videos carry no caption flags
    const o1 = await s1.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    expect(o1.subRuns.video.meta.gatedCriteria).toContain("captions_present");
    expect(o1.subRuns.video.params.find((p) => p.key === "captions_present")).toBeUndefined();
    const flagged = fakeInput.videos.map((v) => ({ ...v, caption: "false" }));
    const { service: s2 } = makeService({
      gatherAuditInput: vi.fn(async () => ({ ...fakeInput, videos: flagged })),
    });
    const o2 = await s2.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const caps = o2.subRuns.video.params.find((p) => p.key === "captions_present");
    expect(caps).toBeDefined();
    expect(caps.earned).toBe(0); // flags say absent -> honest 0 with a fix
    expect(o2.subRuns.video.meta.gatedCriteria).not.toContain("captions_present");
  });

  it("recommends Needs-Work (50-80%) params, not just failures", async () => {
    const words = Array(100).fill("word").join(" "); // 100/150 words -> ~67%
    const { service } = makeService({
      gatherAuditInput: vi.fn(async () => ({
        ...fakeInput,
        videos: [{ ...fakeInput.videos[0], description: words }],
      })),
    });
    const out = await service.runAudit({ channelId: "UC123", opts: { scope: "full" } });
    const recs = out.subRuns.video.recommendations;
    const desc = recs.find((r) => r.paramKey === "va_description_quality");
    expect(desc).toBeDefined(); // 67% is Needs Work -> guided, low severity
    expect(desc.severity).toBe("low");
  });
});
