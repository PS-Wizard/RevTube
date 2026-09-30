import { describe, it, expect, vi } from "vitest";
import { createOptimizerProcessor } from "./optimizerQueue.js";

describe("createOptimizerProcessor", () => {
  it("runs thumbnail analyze and persists to thumbnail_audits", async () => {
    const thumbnailOptimizerService = {
      analyze: vi.fn().mockResolvedValue({
        results: [{ url: "a", total: 7 }],
        errors: [{ url: "b", error: "nope" }],
      }),
    };
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 42 }] });
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService,
      playlistOptimizerService: { analyze: vi.fn() },
      query,
    });
    const job = {
      id: "j1",
      data: { kind: "thumbnail", payload: { urls: ["https://youtu.be/a"], channelTitle: "Chan" }, uid: "u1" },
      updateProgress: vi.fn(),
    };
    const out = await processor(job);
    expect(thumbnailOptimizerService.analyze).toHaveBeenCalledWith(["https://youtu.be/a"], "", "", "");
    expect(query).toHaveBeenCalledTimes(1);
    expect(query.mock.calls[0][0]).toContain("thumbnail_audits");
    expect(out.savedId).toBe(42);
    expect(out.kind).toBe("thumbnail");
    expect(job.updateProgress).toHaveBeenCalledWith(100);
  });

  it("runs playlist analyze and persists to playlist_audits", async () => {
    const playlistOptimizerService = {
      analyze: vi.fn().mockResolvedValue({ results: { playlists: [{ title: "P", videos: [{ id: "v1" }, { id: "v2" }] }], channelName: "Chan" } }),
    };
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 7 }] });
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService: { analyze: vi.fn() },
      playlistOptimizerService,
      query,
    });
    const job = {
      id: "j2",
      data: { kind: "playlist", payload: { videos: [{ id: "v1", title: "V" }], channelIdentifier: "Chan" }, uid: "u1" },
      updateProgress: vi.fn(),
    };
    const out = await processor(job);
    expect(playlistOptimizerService.analyze).toHaveBeenCalledWith([{ id: "v1", title: "V" }], "Chan", undefined, null);
    expect(query.mock.calls[0][0]).toContain("playlist_audits");
    expect(out.savedId).toBe(7);
    // Real analyze() returns { results: <normalized> }; ensure the persisted JSON
    // holds `playlists` at the TOP level and total_videos reflects membership.
    const params = query.mock.calls[0][1];
    const stored = JSON.parse(params[5]);
    expect(stored.playlists).toBeInstanceOf(Array);
    expect(stored.playlists[0].videos).toHaveLength(2);
    expect(params[4]).toBe(2); // total_videos computed from real membership
  });

  it("persists playlists even when analyze returns {results:{playlists:[]}}", async () => {
    const playlistOptimizerService = {
      analyze: vi.fn().mockResolvedValue({ results: { playlists: [], channelName: "Chan" } }),
    };
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 9 }] });
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService: { analyze: vi.fn() },
      playlistOptimizerService,
      query,
    });
    const out = await processor({
      id: "j2a",
      data: { kind: "playlist", payload: { videos: [] }, uid: "u1" },
      updateProgress: vi.fn(),
    });
    expect(out.savedId).toBe(9);
    const params = query.mock.calls[0][1];
    expect(JSON.parse(params[5]).playlists).toEqual([]);
    expect(params[4]).toBe(0);
  });

  it("fills blank thumbnail context from the saved channel focus", async () => {
    const thumbnailOptimizerService = { analyze: vi.fn().mockResolvedValue({ results: [] }) };
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    const channelFocusService = {
      getFocusForAI: vi.fn(async () => ({ niche: "Vegan cooking", audience: "Home cooks", tone: "Warm" })),
    };
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService,
      playlistOptimizerService: { analyze: vi.fn() },
      query,
      channelFocusService,
    });
    await processor({
      id: "j4",
      data: { kind: "thumbnail", payload: { urls: ["https://youtu.be/a"], channelId: "ch1" }, uid: "u1", orgId: "org1" },
      updateProgress: vi.fn(),
    });
    expect(channelFocusService.getFocusForAI).toHaveBeenCalledWith("ch1", "org1");
    expect(thumbnailOptimizerService.analyze).toHaveBeenCalledWith(
      ["https://youtu.be/a"], "Vegan cooking", "Home cooks", "Warm",
    );
  });

  it("explicit thumbnail context wins over the saved focus", async () => {
    const thumbnailOptimizerService = { analyze: vi.fn().mockResolvedValue({ results: [] }) };
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 1 }] });
    const channelFocusService = { getFocusForAI: vi.fn(async () => ({ niche: "Focus niche" })) };
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService,
      playlistOptimizerService: { analyze: vi.fn() },
      query,
      channelFocusService,
    });
    await processor({
      id: "j5",
      data: { kind: "thumbnail", payload: { urls: ["https://youtu.be/a"], channelId: "ch1", niche: "Typed niche" }, uid: "u1" },
      updateProgress: vi.fn(),
    });
    expect(channelFocusService.getFocusForAI).not.toHaveBeenCalled();
    expect(thumbnailOptimizerService.analyze).toHaveBeenCalledWith(
      ["https://youtu.be/a"], "Typed niche", "", "",
    );
  });

  it("passes the saved focus to playlist analyze", async () => {
    const playlistOptimizerService = { analyze: vi.fn().mockResolvedValue({ results: { playlists: [] } }) };
    const query = vi.fn().mockResolvedValue({ rows: [{ id: 2 }] });
    const focus = { niche: "Tech", audience: "Devs" };
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService: { analyze: vi.fn() },
      playlistOptimizerService,
      query,
      channelFocusService: { getFocusForAI: vi.fn(async () => focus) },
    });
    await processor({
      id: "j6",
      data: { kind: "playlist", payload: { videos: [], channelId: "ch9" }, uid: "u1", orgId: null },
      updateProgress: vi.fn(),
    });
    expect(playlistOptimizerService.analyze).toHaveBeenCalledWith([], undefined, undefined, focus);
  });

  it("throws on invalid kind", async () => {
    const processor = createOptimizerProcessor({
      thumbnailOptimizerService: { analyze: vi.fn() },
      playlistOptimizerService: { analyze: vi.fn() },
      query: vi.fn(),
    });
    await expect(processor({ id: "j3", data: { kind: "bogus" } })).rejects.toThrow("Invalid optimizer job kind");
  });
});
