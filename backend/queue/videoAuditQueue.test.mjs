import { describe, it, expect, vi } from "vitest";
import { createVideoAuditProcessor } from "./videoAuditQueue.js";

describe("videoAuditQueue processor", () => {
  it("fetches inputs, scores, and updates progress", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([
      { videoId: "a", title: "A", thumbnail: { url: "http://x/a.jpg" } },
    ]);
    const auditBatch = vi.fn().mockResolvedValue({ results: [{ videoId: "a", total: 80 }], overall: 80 });
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch });
    const updateProgress = vi.fn();
    const result = await processor({ id: "j1", data: { channelId: "c1", videoIds: ["a"], authHeader: "h" }, updateProgress });
    expect(fetchVideoInputs).toHaveBeenCalledWith({ channelId: "c1", videoIds: ["a"], authHeader: "h" });
    expect(auditBatch).toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(result.overall).toBe(80);
  });

  it("scores against the saved focus niche when present", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([{ videoId: "a", title: "A" }]);
    const auditBatch = vi.fn().mockResolvedValue({ results: [], overall: 0 });
    const channelFocusService = { getFocusForAI: vi.fn(async () => ({ niche: "Vegan cooking" })) };
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch, channelFocusService });
    await processor({
      id: "j9",
      data: { channelId: "c1", videoIds: ["a"], authHeader: "h", orgId: "org1" },
      updateProgress: vi.fn(),
    });
    expect(channelFocusService.getFocusForAI).toHaveBeenCalledWith("c1", "org1");
    expect(auditBatch.mock.calls[0][2]).toBe("Vegan cooking");
  });

  it("derives niche from the batch when no focus is saved", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([{ videoId: "a", title: "A" }]);
    const auditBatch = vi.fn().mockResolvedValue({ results: [], overall: 0 });
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch });
    await processor({
      id: "j10",
      data: { channelId: "c1", videoIds: ["a"] },
      updateProgress: vi.fn(),
    });
    expect(auditBatch.mock.calls[0][2]).toBeUndefined();
  });

  it("throws on missing job data", async () => {
    const processor = createVideoAuditProcessor({ fetchVideoInputs: vi.fn(), auditBatch: vi.fn() });
    await expect(processor({ id: "j1", data: {}, updateProgress: vi.fn() })).rejects.toThrow();
  });

  it("allows empty authHeader (falls back to API key)", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([{ videoId: "a", title: "A" }]);
    const auditBatch = vi.fn().mockResolvedValue({ results: [], overall: 0 });
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch });
    const updateProgress = vi.fn();
    const result = await processor({ id: "j1", data: { channelId: "c1", videoIds: ["a"], authHeader: "" }, updateProgress });
    expect(fetchVideoInputs).toHaveBeenCalledWith({ channelId: "c1", videoIds: ["a"], authHeader: "" });
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(result.overall).toBe(0);
  });

  it("persists child thumbnail audits from the embedded 12-pillar analyses", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([
      { videoId: "a", title: "A", thumbnail: { url: "http://x/a.jpg" } },
    ]);
    const auditBatch = vi.fn().mockResolvedValue({
      overall: 80,
      results: [
        {
          videoId: "a",
          videoTitle: "A",
          total: 80,
          elements: [
            { element: "thumbnail", score: 80, max: 100, thumbnailAnalysis: { currentScore: 8, expectedScore: 9, reviewSummary: "ok", strengths: "s", opportunities: "o", detailedAreas: [] } },
            { element: "title", score: 70, max: 100 },
          ],
        },
        { videoId: "b", videoTitle: "B", total: 55, elements: [{ element: "title", score: 55, max: 100 }] },
      ],
    });
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 42 }] });
    const processor = createVideoAuditProcessor({
      fetchVideoInputs,
      auditBatch,
      query,
      isPostgresConfigured: () => true,
    });
    const result = await processor({
      id: "j2",
      data: { channelId: "c1", videoIds: ["a"], authHeader: "", uid: "u1", includeThumbnail: true },
      updateProgress: vi.fn(),
    });
    expect(query).toHaveBeenCalledTimes(1);
    const [sql, params] = query.mock.calls[0];
    expect(sql).toContain("INSERT INTO thumbnail_audits");
    expect(params[0]).toBe("u1");
    expect(params[1]).toContain("Video Audit");
    expect(params[2]).toBe("c1"); // channel_id
    expect(params[3]).toBeNull(); // channel_title not part of video-audit job data
    expect(params[7]).toBe(1); // only videos that actually ran the child audit
    const audits = JSON.parse(params[8]);
    expect(audits).toEqual([
      {
        url: "https://www.youtube.com/watch?v=a",
        videoTitle: "A",
        currentScore: 8,
        expectedScore: 9,
        reviewSummary: "ok",
        strengths: "s",
        opportunities: "o",
        detailedAreas: [],
      },
    ]);
    // The inserted row id is surfaced on the job result for the frontend
    // deep-link ("Detailed Thumbnail Analysis" -> history entry).
    expect(result.thumbnailAuditSavedId).toBe(42);
  });

  it("skips child thumbnail persistence without uid or PG config", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([]);
    const auditBatch = vi.fn().mockResolvedValue({
      overall: 50,
      results: [{ videoId: "a", videoTitle: "A", total: 50, elements: [{ element: "thumbnail", score: 50, max: 100, thumbnailAnalysis: { currentScore: 5, expectedScore: 6 } }] }],
    });
    const query = vi.fn();
    // No uid in job data -> no write even though analyses exist.
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch, query, isPostgresConfigured: () => true });
    await processor({ id: "j3", data: { channelId: "c1", videoIds: ["a"] }, updateProgress: vi.fn() });
    expect(query).not.toHaveBeenCalled();
    // uid present but Postgres unconfigured -> no write either.
    const processor2 = createVideoAuditProcessor({ fetchVideoInputs, auditBatch, query, isPostgresConfigured: () => false });
    await processor2({ id: "j4", data: { channelId: "c1", videoIds: ["a"], uid: "u1" }, updateProgress: vi.fn() });
    expect(query).not.toHaveBeenCalled();
  });

  it("continues the audit when child thumbnail persistence fails", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([]);
    const auditBatch = vi.fn().mockResolvedValue({
      overall: 60,
      results: [{ videoId: "a", videoTitle: "A", total: 60, elements: [{ element: "thumbnail", score: 60, max: 100, thumbnailAnalysis: { currentScore: 6, expectedScore: 7 } }] }],
    });
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const query = vi.fn().mockRejectedValue(new Error("db down"));
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch, query, isPostgresConfigured: () => true });
    const updateProgress = vi.fn();
    const result = await processor({ id: "j5", data: { channelId: "c1", videoIds: ["a"], uid: "u1" }, updateProgress });
    expect(result.overall).toBe(60);
    // No successful persist -> no deep-link id on the result either.
    expect(result.thumbnailAuditSavedId).toBeUndefined();
    expect(updateProgress).toHaveBeenCalledWith(100);
    warn.mockRestore();
  });
});