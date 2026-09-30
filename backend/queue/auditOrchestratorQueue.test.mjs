import { describe, it, expect, vi } from "vitest";
import { createAuditOrchestratorProcessor, createProgressMapper } from "./auditOrchestratorQueue.js";
import { DEFAULT_PROFILE } from "../config/channelAuditScoringProfiles.js";

const fakeInput = {
  channel: {
    name: "Test Channel",
    username: "@test",
    description: "Coding tutorials.",
    categoryId: "27",
    branding: {},
  },
  videos: [
    { videoId: "v1", title: "Learn Rust", description: "guide", tags: ["rust"], publishedAt: "2026-01-01", viewCount: 100, likeCount: 5, commentCount: 1 },
  ],
  playlists: [],
};

// Minimal engine fakes (same shapes as services/auditOrchestratorService.test.js).
function processorDeps(overrides = {}) {
  return {
    gatherAuditInput: vi.fn(async () => fakeInput),
    createAuditScoringService: () => ({
      scoreChannel: async () => ({ total: 70, breakdown: [] }),
      scoreVideo: async () => ({ total: 75, breakdown: [] }),
      scoreGeneral: async () => ({ total: 60, breakdown: [] }),
      scorePlaylist: async () => ({ total: 0, breakdown: [] }),
    }),
    getScoringProfile: async () => DEFAULT_PROFILE,
    getParamDefinitions: async () => [],
    query: vi.fn(async () => ({ rows: [] })),
    isPostgresConfigured: () => false,
    db: {},
    videoAuditEngine: {
      auditBatch: async (inputs) => ({
        results: inputs.map((inp) => ({
          videoId: inp.videoId, total: 80, breakdown: [], recommendations: [],
        })),
        overall: 80,
        auditedAt: new Date().toISOString(),
      }),
    },
    playlistOptimizerEngine: {
      analyze: async () => ({
        results: { audit: { channelScore: 70, criteriaBreakdown: [] }, playlists: [], summary: "ok" },
      }),
    },
    ...overrides,
  };
}

describe("createProgressMapper", () => {
  it("maps input stages across the 10-35 band in order", () => {
    const seen = [];
    const report = createProgressMapper((pct) => seen.push(pct));
    report("input:channel", 1);
    report("input:videos", 1);
    report("input:playlists", 1);
    report("input:membership", 1);
    expect(seen).toEqual([14, 24, 28, 34]);
  });

  it("interpolates video batch progress across the 40-75 band", () => {
    const seen = [];
    const report = createProgressMapper((pct) => seen.push(pct));
    report("video", 0);
    report("video", 0.5);
    report("video", 1);
    expect(seen).toEqual([40, 58, 75]);
  });

  it("stays monotonic when parallel sub-audits finish out of order", () => {
    const seen = [];
    const report = createProgressMapper((pct) => seen.push(pct));
    report("video", 1);
    report("channelIdentity", 1);
    report("general", 1);
    expect(seen).toEqual([75, 75, 75]);
    report("persist", 1);
    report("done", 1);
    expect(seen.at(-2)).toBe(96);
    expect(seen.at(-1)).toBe(100);
  });

  it("ignores unknown phases", () => {
    const onPercent = vi.fn();
    const report = createProgressMapper(onPercent);
    report("mystery", 1);
    expect(onPercent).not.toHaveBeenCalled();
  });
});

describe("auditOrchestratorQueue processor", () => {
  it("runs the audit through the queue job with staged progress to 100", async () => {
    const deps = processorDeps();
    const processAuditOrchestrator = createAuditOrchestratorProcessor(deps);
    const updateProgress = vi.fn();
    const job = {
      id: "job1",
      data: { channelId: "UC123", uid: "u1", scope: "full" },
      updateProgress,
    };
    const result = await processAuditOrchestrator(job);

    // The pipelined gather receives scope + progress sink from the worker.
    expect(deps.gatherAuditInput).toHaveBeenCalledWith(
      expect.objectContaining({ channelId: "UC123", scope: "full" }),
    );
    const gatherCall = deps.gatherAuditInput.mock.calls[0][0];
    expect(typeof gatherCall.onProgress).toBe("function");

    // Progress advances monotonically through the stages to 100.
    const percents = updateProgress.mock.calls.map(([pct]) => pct);
    expect(percents[0]).toBe(10);
    expect(percents.at(-1)).toBe(100);
    for (let i = 1; i < percents.length; i += 1) {
      expect(percents[i]).toBeGreaterThanOrEqual(percents[i - 1]);
    }
    expect(percents.length).toBeGreaterThan(2);

    expect(result.overall).toBeGreaterThanOrEqual(0);
    expect(result.subRuns).toBeDefined();
  });

  it("passes channel scope through to the input fetch", async () => {
    const deps = processorDeps();
    const processAuditOrchestrator = createAuditOrchestratorProcessor(deps);
    await processAuditOrchestrator({
      id: "job2",
      data: { channelId: "UC123", scope: "channel" },
      updateProgress: vi.fn(),
    });
    expect(deps.gatherAuditInput).toHaveBeenCalledWith(
      expect.objectContaining({ scope: "channel" }),
    );
  });

  it("rejects jobs without a channelId", async () => {
    const processAuditOrchestrator = createAuditOrchestratorProcessor(processorDeps());
    await expect(
      processAuditOrchestrator({ id: "job3", data: {}, updateProgress: vi.fn() }),
    ).rejects.toThrow(/missing channelId/i);
  });
});
