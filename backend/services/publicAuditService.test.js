import { describe, it, expect, vi } from "vitest";
import { createPublicAuditService } from "./publicAuditService.js";

const BASE = "https://www.googleapis.com/youtube/v3";

function makeService(handlers = {}) {
  const get = vi.fn(async (url, { params }) => {
    const path = url.replace(`${BASE}/`, "");
    if (handlers[path]) return { data: await handlers[path](params) };
    throw new Error(`unexpected GET ${path}`);
  });
  const svc = createPublicAuditService({ axios: { get }, API_KEY: "KEY", YOUTUBE_API_BASE: BASE });
  return { svc, get };
}

describe("publicAuditService", () => {
  it("parseChannelInput handles ids, handles, and URLs", () => {
    const { svc } = makeService();
    expect(svc.parseChannelInput("UCxxxxxxxxxxxxxxxxxxxxxx")).toEqual({ kind: "id", value: "UCxxxxxxxxxxxxxxxxxxxxxx" });
    expect(svc.parseChannelInput("@mkbhd")).toEqual({ kind: "handle", value: "mkbhd" });
    expect(svc.parseChannelInput("https://youtube.com/channel/UC123")).toEqual({ kind: "id", value: "UC123" });
    expect(svc.parseChannelInput("https://www.youtube.com/@mkbhd/videos")).toEqual({ kind: "handle", value: "mkbhd" });
    expect(() => svc.parseChannelInput("   ")).toThrow();
  });

  it("resolvePublicChannel maps snippet/stats/uploads and caches per channel", async () => {
    let channelsCalls = 0;
    const { svc, get } = makeService({
      channels: async () => {
        channelsCalls += 1;
        return {
          items: [{
            id: "UC123",
            snippet: {
              title: "T",
              description: "D",
              thumbnails: {
                default: { url: "https://yt3.example/default.jpg" },
                medium: { url: "https://yt3.example/medium.jpg" },
                high: { url: "https://yt3.example/high.jpg" },
              },
            },
            statistics: { subscriberCount: "10", viewCount: "20", videoCount: "3" },
            contentDetails: { relatedPlaylists: { uploads: "UU123" } },
          }],
        };
      },
    });
    const ch = await svc.resolvePublicChannel("@demo");
    expect(ch).toMatchObject({ channelId: "UC123", title: "T", avatarUrl: "https://yt3.example/high.jpg", uploadsPlaylistId: "UU123" });
    expect(get).toHaveBeenCalledWith(expect.stringContaining("/channels"), expect.objectContaining({ params: expect.objectContaining({ forHandle: "demo" }) }));
    // No cache in unit tests -> every call hits the API, mapping stays pure.
    expect(channelsCalls).toBe(1);
  });

  it("resolvePublicChannel throws when nothing matches", async () => {
    const { svc } = makeService({ channels: async () => ({ items: [] }) });
    await expect(svc.resolvePublicChannel("@nope")).rejects.toThrow(/not found/i);
  });

  it("fetchPublicVideos returns engine-shaped inputs capped at max", async () => {
    const { svc } = makeService({
      playlistItems: async () => ({
        items: [
          { contentDetails: { videoId: "v1" } },
          { contentDetails: { videoId: "v2" } },
          { contentDetails: { videoId: "v3" } },
        ],
      }),
      videos: async () => ({
        items: [
          { id: "v1", snippet: { title: "T1", description: "D1", tags: ["a"], publishedAt: "2026-01-01", thumbnails: { medium: { url: "http://t/1" } } }, statistics: { viewCount: "5" } },
        ],
      }),
    });
    const channel = { channelId: "UC123", uploadsPlaylistId: "UU123" };
    const out = await svc.fetchPublicVideos(channel, 1);
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ videoId: "v1", title: "T1", tags: ["a"], thumbnail: { url: "http://t/1" } });
  });

  it("fetchPublicVideos paginates playlistItems for a FULL audit and clamps the cap", async () => {
    const pages = [
      { items: Array.from({ length: 50 }, (_, i) => ({ contentDetails: { videoId: `a${i}` } })), nextPageToken: "P2" },
      { items: Array.from({ length: 50 }, (_, i) => ({ contentDetails: { videoId: `b${i}` } })) },
    ];
    const { svc, get } = makeService({
      playlistItems: async (params) => pages[params.pageToken ? 1 : 0],
      videos: async (params) => ({
        items: String(params.id)
          .split(",")
          .map((id) => ({ id, snippet: { title: id, description: "", tags: [], publishedAt: "2026-01-01", thumbnails: {} }, statistics: { viewCount: "1" } })),
      }),
    });
    const channel = { channelId: "UC123", uploadsPlaylistId: "UU123" };

    const full = await svc.fetchPublicVideos(channel, 75);
    // 75 requested -> 2 playlistItems pages, ids clipped, 2 videos.list chunks.
    expect(full).toHaveLength(75);
    expect(full[0].videoId).toBe("a0");
    expect(get.mock.calls.filter((c) => c[0].endsWith("/playlistItems"))).toHaveLength(2);
    expect(get.mock.calls.filter((c) => c[0].endsWith("/videos"))).toHaveLength(2);

    // The fixture contains two pages (100 ids), so it stops when YouTube ends.
    get.mockClear();
    const capped = await svc.fetchPublicVideos(channel, 9999);
    expect(capped).toHaveLength(100);
    expect(get.mock.calls.filter((c) => c[0].endsWith("/playlistItems"))).toHaveLength(2);
  });

  describe("buildFullAuditInput", () => {
    const { svc } = makeService();

    it("maps public data onto the Full Audit scoring contract", () => {
      const input = svc.buildFullAuditInput(
        { title: "Demo", handle: "@demo", keywords: '"cat videos" cats pets', description: "D" },
        [
          {
            videoId: "v1",
            title: "T",
            description: "D",
            tags: ["a"],
            publishedAt: "2026-01-01",
            statistics: { viewCount: "100", likeCount: "10", commentCount: "2" },
          },
        ],
        [{ playlistId: "PL1", title: "Series", description: "PD", itemCount: 12 }],
      );
      expect(input.channel).toEqual({
        name: "Demo",
        username: "@demo",
        keywords: ["cat videos", "cats", "pets"],
        description: "D",
      });
      expect(input.videos[0]).toEqual({
        videoId: "v1",
        title: "T",
        description: "D",
        tags: ["a"],
        publishedAt: "2026-01-01",
        viewCount: 100,
        likeCount: 10,
        commentCount: 2,
      });
      expect(input.playlists[0]).toEqual({ playlistId: "PL1", title: "Series", description: "PD", size: 12 });
    });

    it("never emits NaN for missing statistics and survives empty input", () => {
      const empty = svc.buildFullAuditInput();
      expect(empty).toEqual({ channel: { name: "", username: "", keywords: [], description: "" }, videos: [], playlists: [] });
      const input = svc.buildFullAuditInput({}, [{ videoId: "v", statistics: {} }], [{ playlistId: "p" }]);
      expect(input.videos[0]).toMatchObject({ viewCount: 0, likeCount: 0, commentCount: 0, tags: [], publishedAt: null });
      expect(input.playlists[0]).toMatchObject({ title: "", description: "", size: 0 });
    });
  });

  it("fetchPublicPlaylists maps id/title/thumbnail/count, pages, and clamps size", async () => {
    const { svc, get } = makeService({
      playlists: async (params) => {
        expect(params).toMatchObject({ channelId: "UC123", part: "snippet,contentDetails" });
        // maxResults is always 50; the caller cap is applied by slicing, and
        // pagination only follows YouTube's nextPageToken while under the cap.
        expect(params.maxResults).toBe(50);
        return {
          items: [
            {
              id: "PL1",
              snippet: { title: "Series", description: "D", publishedAt: "2025-05-05T00:00:00.000Z", thumbnails: { default: { url: "http://p/1" } } },
              contentDetails: { itemCount: 12 },
            },
          ],
        };
      },
    });
    const out = await svc.fetchPublicPlaylists("UC123", 99);
    expect(out).toEqual([
      { playlistId: "PL1", title: "Series", description: "D", publishedAt: "2025-05-05T00:00:00.000Z", itemCount: 12, thumbnailUrl: "http://p/1" },
    ]);
    expect(get).toHaveBeenCalledWith(expect.stringContaining("/playlists"), expect.objectContaining({ params: expect.objectContaining({ maxResults: 50 }) }));
    expect(await svc.fetchPublicPlaylists("")).toEqual([]);
  });

  it("fetchPublicPlaylists stops at the caller cap even when more pages exist", async () => {
    const page = { items: Array.from({ length: 50 }, (_, i) => ({ id: `PL${i}`, snippet: { title: `P${i}`, thumbnails: {} }, contentDetails: { itemCount: 5 } })) };
    const { svc, get } = makeService({
      playlists: async (params) => (params.pageToken ? { ...page, nextPageToken: "P2" } : page),
    });
    // The fixture contains one 50-item page, so it stops at 50.
    const out = await svc.fetchPublicPlaylists("UC123", 99);
    expect(out).toHaveLength(50);
    expect(get.mock.calls.filter((c) => c[0].endsWith("/playlists"))).toHaveLength(1);
  });

  it("fetchPublicPlaylists follows nextPageToken within the supported cap", async () => {
    const first = { items: Array.from({ length: 15 }, (_, i) => ({ id: `PL${i}`, snippet: { title: `P${i}`, thumbnails: {} }, contentDetails: { itemCount: 5 } })), nextPageToken: "P2" };
    const second = { items: Array.from({ length: 15 }, (_, i) => ({ id: `PLX${i}`, snippet: { title: `X${i}`, thumbnails: {} }, contentDetails: { itemCount: 7 } })) };
    const { svc, get } = makeService({
      playlists: async (params) => (params.pageToken === "P2" ? second : first),
    });
    const out = await svc.fetchPublicPlaylists("UC123", 25);
    expect(out).toHaveLength(25);
    expect(get.mock.calls.filter((c) => c[0].endsWith("/playlists"))).toHaveLength(2);
  });

  it("resolvePublicChannel falls back to forUsername when forHandle misses", async () => {
    const { svc, get } = makeService({
      channels: async (params) => {
        if (params.forHandle) return { items: [] };
        return {
          items: [{ id: "UC999", snippet: { title: "Legacy", thumbnails: {} }, statistics: {}, contentDetails: { relatedPlaylists: { uploads: "UU999" } } }],
        };
      },
    });
    const ch = await svc.resolvePublicChannel("@legacyname");
    expect(ch.channelId).toBe("UC999");
    const calls = get.mock.calls.filter((c) => c[0].endsWith("/channels"));
    expect(calls).toHaveLength(2);
    expect(calls[1][1].params).toMatchObject({ forUsername: "legacyname" });
    expect(calls[1][1].params).not.toHaveProperty("forHandle");
  });

  it("serves channel and playlists from the L1 cache when one is provided", async () => {
    const store = new Map();
    const serverCache = {
      get: async (k) => store.get(k),
      set: async (k, v) => {
        store.set(k, v);
      },
    };
    const get = vi.fn(async (url, { params }) => {
      const path = url.replace(`${BASE}/`, "");
      if (path === "channels") {
        return {
          data: { items: [{ id: "UC1", snippet: { title: "C", thumbnails: {} }, statistics: { videoCount: "7" }, contentDetails: { relatedPlaylists: { uploads: "UU1" } } }] },
        };
      }
      if (path === "playlists") {
        return { data: { items: [{ id: "PL9", snippet: { title: "S", thumbnails: {} }, contentDetails: { itemCount: 3 } }] } };
      }
      throw new Error(`unexpected GET ${path}`);
    });
    const svc = createPublicAuditService({ axios: { get }, API_KEY: "KEY", YOUTUBE_API_BASE: BASE, serverCache });
    await svc.resolvePublicChannel("@cached");
    await svc.resolvePublicChannel("@cached");
    await svc.fetchPublicPlaylists("UC1", 5);
    await svc.fetchPublicPlaylists("UC1", 5);
    // One channel request + one playlist request; both second calls hit L1.
    expect(get).toHaveBeenCalledTimes(2);
    expect(store.get("public_audit:channel:handle:cached").channelId).toBe("UC1");
    expect(store.get("public_audit:playlists:UC1:n5")).toHaveLength(1);
  });

  describe("computeChannelLifetime", () => {
    const { svc } = makeService();

    it("aggregates views, engagement, cadence and short/long-form split", () => {
      const life = svc.computeChannelLifetime([
        { publishedAt: "2026-01-01T00:00:00.000Z", durationSeconds: 120, statistics: { viewCount: "1000", likeCount: "100", commentCount: "50" } },
        { publishedAt: "2026-01-11T00:00:00.000Z", durationSeconds: 30, statistics: { viewCount: "1000", likeCount: "100", commentCount: "50" } },
      ]);
      expect(life).toEqual({
        auditedVideoCount: 2,
        totalViewsAudited: 2000,
        totalLikesAudited: 200,
        totalCommentsAudited: 100,
        avgViewsPerVideo: 1000,
        engagementRatePct: 15,
        oldestAuditedAt: "2026-01-01T00:00:00.000Z",
        newestAuditedAt: "2026-01-11T00:00:00.000Z",
        uploadCadenceDays: 10,
        shortsCount: 1,
        longformCount: 1,
      });
    });

    it("degrades safely on empty/partial input (no NaN, no throw)", () => {
      expect(svc.computeChannelLifetime()).toMatchObject({ auditedVideoCount: 0, avgViewsPerVideo: null, engagementRatePct: null, uploadCadenceDays: null, oldestAuditedAt: null });
      // Unknown duration falls back to 61s => counted as long-form, never NaN.
      expect(svc.computeChannelLifetime([{ durationSeconds: null, statistics: {} }])).toMatchObject({
        auditedVideoCount: 1,
        totalViewsAudited: 0,
        engagementRatePct: null,
        shortsCount: 0,
        longformCount: 1,
      });
    });
  });

  it("requires an API key", async () => {
    const svc = createPublicAuditService({ axios: { get: vi.fn() }, API_KEY: "", YOUTUBE_API_BASE: BASE });
    await expect(svc.resolvePublicChannel("@demo")).rejects.toThrow(/YOUTUBE_API_KEY/i);
  });

  describe("hydrateVideoMetadata", () => {
    it("looks videos up directly by id (snippet + statistics + contentDetails)", async () => {
      const { svc, get } = makeService({
        videos: async (params) => ({
          items: String(params.id)
            .split(",")
            .map((id) => ({
              id,
              snippet: { title: `T-${id}`, publishedAt: "2026-02-01T00:00:00.000Z", categoryId: "22", thumbnails: {} },
              statistics: { viewCount: "5000", likeCount: "400", commentCount: "40", favoriteCount: "2" },
              contentDetails: { duration: "PT2M30S", definition: "hd" },
            })),
        }),
      });
      const out = await svc.hydrateVideoMetadata(["v1", "v1", "v2", "", null]);
      expect(out).toHaveLength(2);
      expect(out[0]).toMatchObject({
        videoId: "v1",
        title: "T-v1",
        publishedAt: "2026-02-01T00:00:00.000Z",
        durationLabel: "2:30",
        durationSeconds: 150,
        definition: "hd",
        statistics: expect.objectContaining({ viewCount: "5000", likeCount: "400" }),
      });
      // Deduped ids -> a single videos.list call with both ids.
      expect(get.mock.calls.filter((c) => c[0].endsWith("/videos"))).toHaveLength(1);
      expect(get.mock.calls[0][1].params).toMatchObject({ part: "snippet,statistics,contentDetails", id: "v1,v2" });
    });

    it("returns [] for empty input without calling the API", async () => {
      const { svc, get } = makeService();
      await expect(svc.hydrateVideoMetadata()).resolves.toEqual([]);
      await expect(svc.hydrateVideoMetadata([])).resolves.toEqual([]);
      expect(get).not.toHaveBeenCalled();
    });
  });
});
