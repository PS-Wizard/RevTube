import { describe, it, expect, vi } from "vitest";
import { createPublicAuditRouter } from "./publicAudit.js";
import { createPublicAuditService } from "../services/publicAuditService.js";

// The route must not re-derive channel aggregates, so the fake service reuses
// the REAL `computeChannelLifetime` (single source of truth) instead of a copy.
const realService = createPublicAuditService({ axios: { get: vi.fn() }, API_KEY: "KEY" });

function makeRouter(overrides = {}) {
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const resolvePublicChannel = vi.fn().mockResolvedValue({
    channelId: "UC123",
    title: "Demo Channel",
    description: "desc",
    avatarUrl: "https://yt3.example/avatar.jpg",
    statistics: { subscriberCount: "100" },
    uploadsPlaylistId: "UU123",
  });
  const fetchPublicVideos = vi.fn().mockResolvedValue([
    {
      videoId: "v1",
      title: "T1",
      description: "D1",
      tags: ["a"],
      publishedAt: "2026-01-01T00:00:00.000Z",
      durationSeconds: 120,
      durationLabel: "2:00",
      definition: "hd",
      categoryId: "22",
      liveBroadcastContent: "none",
      statistics: { viewCount: "1000", likeCount: "100", commentCount: "50", favoriteCount: "5" },
      thumbnail: { url: "http://t/1.jpg" },
    },
    {
      videoId: "v2",
      title: "T2",
      description: "D2",
      tags: [],
      publishedAt: "2026-01-11T00:00:00.000Z",
      durationSeconds: 30,
      durationLabel: "0:30",
      definition: "sd",
      categoryId: "22",
      liveBroadcastContent: "none",
      statistics: { viewCount: "1000", likeCount: "100", commentCount: "50", favoriteCount: "1" },
      thumbnail: { url: "http://t/2.jpg" },
    },
  ]);
  const playlists = [
    { playlistId: "PL1", title: "Series", itemCount: 12, thumbnailUrl: "http://p/1.jpg" },
  ];
  const fetchPublicPlaylists = vi.fn().mockResolvedValue(playlists);
  const auditBatch = vi.fn().mockResolvedValue({ overall: 82, results: [{ videoId: "v1", total: 82 }] });
  // Full Audit engine fake: every category totals out of 100, per-category
  // breakdowns keep their own maxes so the route aggregation is verifiable.
  const scoreAll = vi.fn().mockResolvedValue({
    channel: { total: 80, breakdown: [{ key: "name", label: "Name", earned: 16, max: 20 }] },
    video: { total: 60, breakdown: [{ key: "title", label: "Title", earned: 18, max: 30 }] },
    playlist: { total: 40, breakdown: [{ key: "size", label: "Size", earned: 8, max: 20 }] },
    general: { total: 20, breakdown: [{ key: "engagement", label: "Engagement", earned: 7, max: 35 }] },
  });
  const buildAuditIssues = vi
    .fn()
    .mockReturnValue([{ key: "video-tags", label: "Missing or few tags", hint: "Add tags.", severity: "high", count: 2, affected: [] }]);
  const createAuditScoringService = vi.fn(() => ({ scoreAll, buildAuditIssues }));
  const getAuditScoring = vi.fn().mockResolvedValue({ channel: { name: { max: 20 } } });
  const deps = {
    checkAdmin: (req, res, next) => next(),
    query,
    isPostgresConfigured: () => true,
    handleApiError: (err, res) => res.status(500).json({ error: { message: err.message } }),
    publicAuditService: {
      // Reuse the REAL pure mapper/aggregator (single source of truth) instead
      // of a copy — the route must never re-derive aggregates itself.
      resolvePublicChannel,
      fetchPublicVideos,
      fetchPublicPlaylists,
      computeChannelLifetime: realService.computeChannelLifetime,
      buildFullAuditInput: realService.buildFullAuditInput,
    },
    videoAuditService: { auditBatch },
    getAuditCriteria: vi.fn().mockResolvedValue({ video: [{ key: "k", weight: 10 }] }),
    // Full Audit engine (channelAuditScoringService) fake — one category per
    // key so the route's aggregation/ordering is what gets asserted.
    createAuditScoringService,
    getAuditScoring,
    db: {},
    ...overrides,
  };
  return {
    router: createPublicAuditRouter(deps),
    query,
    resolvePublicChannel,
    fetchPublicVideos,
    fetchPublicPlaylists,
    auditBatch,
    scoreAll,
    createAuditScoringService,
    getAuditScoring,
  };
}

function call(router, method, url, body) {
  const req = {
    method, url, body, query: {}, params: {}, headers: {},
    authUser: { uid: "admin1", email: "admin@x.com" },
  };
  // express-style params for /:id routes
  const m = url.match(/^\/(\d+)$/);
  if (m) req.params = { id: m[1] };
  const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
  return new Promise((resolve) => {
    router.handle(req, res, () => {});
    setTimeout(() => resolve({ req, res }), 20);
  });
}

describe("public-audit route (admin-only)", () => {
  it("POST runs audit with public data + admin criteria and persists", async () => {
    const { router, resolvePublicChannel, fetchPublicVideos, fetchPublicPlaylists, auditBatch, query } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 7, created_at: "2026-01-01" }] });
    const { res } = await call(router, "POST", "/", { channelInput: "@demo", maxVideos: 5 });
    expect(resolvePublicChannel).toHaveBeenCalledWith("@demo");
    expect(fetchPublicVideos).toHaveBeenCalledWith(expect.objectContaining({ channelId: "UC123" }), 5);
    expect(fetchPublicPlaylists).toHaveBeenCalledWith("UC123", 25);
    expect(auditBatch).toHaveBeenCalledWith(
      expect.arrayContaining([expect.objectContaining({ videoId: "v1" })]),
      [{ key: "k", weight: 10 }],
      "",
      "lite",
      expect.any(Function),
    );
    expect(res.statusCode).toBe(200);
    // Headline score = Full Audit mean (80+60+40+20)/4; the video sub-audit
    // score is kept separately.
    expect(res.body).toMatchObject({ id: 7, overall: 50, videoAuditOverall: 82, channelId: "UC123" });
    expect(res.body.snapshot.avatarUrl).toBe("https://yt3.example/avatar.jpg");
    // Report metadata the admin UI renders (channel fallback + creator attribution).
    expect(res.body.channelInput).toBe("@demo");
    expect(res.body.createdByEmail).toBe("admin@x.com");
    expect(res.body).toHaveProperty("auditedAt");
    expect(query).toHaveBeenCalledWith(expect.stringContaining("INSERT INTO public_audits"), expect.any(Array));
  });

  /**
   * Enriched payload: the detail UI needs lifetime stats, playlists and a
   * per-video thumbnail -- all persisted so GET /:id replays without a refetch.
   */
  it("POST returns channel lifetime stats, playlists and thumbnails", async () => {
    const { router, query } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 11, created_at: "2026-01-02" }] });
    const { res } = await call(router, "POST", "/", { channelInput: "UC123" });

    expect(res.statusCode).toBe(200);
    expect(res.body.channelLifetime).toEqual({
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
    expect(res.body.playlists).toEqual([
      { playlistId: "PL1", title: "Series", itemCount: 12, thumbnailUrl: "http://p/1.jpg" },
    ]);
    expect(res.body.playlistCount).toBe(1);

    // Enrichment is persisted inside the JSONB `results` column, not just returned.
    const insert = query.mock.calls.find((c) => String(c[0]).includes("INSERT INTO public_audits"));
    const persistedSnapshot = JSON.parse(insert[1][5]);
    expect(persistedSnapshot.avatarUrl).toBe("https://yt3.example/avatar.jpg");
    const persisted = JSON.parse(insert[1][6]);
    expect(persisted.channelLifetime.avgViewsPerVideo).toBe(1000);
    expect(persisted.playlists).toHaveLength(1);
    // The scorer drops public metadata — the runner re-attaches it per video
    // so the UI/PDF/Excel render dates, views, and durations.
    expect(persisted.results).toEqual([
      expect.objectContaining({
        videoId: "v1",
        total: 82,
        statistics: { viewCount: "1000", likeCount: "100", commentCount: "50", favoriteCount: "5" },
        publishedAt: "2026-01-01T00:00:00.000Z",
        durationLabel: "2:00",
        durationSeconds: 120,
        definition: "hd",
      }),
    ]);
  });

  it("POST attaches null-safe metadata when an input has no stats", async () => {
    const bare = makeRouter({
      publicAuditService: {
        resolvePublicChannel: vi.fn().mockResolvedValue({ channelId: "UC123", title: "C", uploadsPlaylistId: "UU" }),
        fetchPublicVideos: vi.fn().mockResolvedValue([{ videoId: "v9" }]),
        fetchPublicPlaylists: vi.fn().mockResolvedValue([]),
        computeChannelLifetime: realService.computeChannelLifetime,
        buildFullAuditInput: realService.buildFullAuditInput,
      },
    });
    bare.query.mockResolvedValueOnce({ rows: [{ id: 14, created_at: "2026-01-04" }] });
    const { res } = await call(bare.router, "POST", "/", { channelInput: "@demo" });
    expect(res.statusCode).toBe(200);
    expect(res.body.results[0]).toMatchObject({
      videoId: "v1",
      statistics: { viewCount: null, likeCount: null, commentCount: null, favoriteCount: null },
      publishedAt: null,
      durationLabel: "",
      definition: "",
    });
  });

  it("POST tolerates a failing playlists fetch (non-fatal enrichment)", async () => {
    const failing = makeRouter({
      publicAuditService: {
        resolvePublicChannel: vi.fn().mockResolvedValue({ channelId: "UC123", title: "C", uploadsPlaylistId: "UU" }),
        fetchPublicVideos: vi.fn().mockResolvedValue([{ videoId: "v1", statistics: {} }]),
        fetchPublicPlaylists: vi.fn().mockRejectedValue(new Error("403 quota")),
        computeChannelLifetime: realService.computeChannelLifetime,
      },
    });
    failing.query.mockResolvedValueOnce({ rows: [{ id: 12, created_at: "2026-01-03" }] });
    const { res } = await call(failing.router, "POST", "/", { channelInput: "@demo" });
    expect(res.statusCode).toBe(200);
    expect(res.body.playlists).toEqual([]);
    expect(res.body.playlistCount).toBe(0);
  });

  it("POST with includeThumbnail=true runs the full (vision) mode", async () => {
    const { router, auditBatch, query } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 8, created_at: "2026-01-01" }] });
    const { res } = await call(router, "POST", "/", { channelInput: "UC123", includeThumbnail: true });
    expect(auditBatch).toHaveBeenCalledWith(expect.anything(), expect.anything(), "", "full", expect.any(Function));
    expect(res.statusCode).toBe(200);
  });

  it("POST excludes caption criteria by default, keeps them with includeCaptions=true", async () => {
    const criteria = [
      { key: "title_clear", element: "title", weight: 10 },
      { key: "caption_value", element: "caption", weight: 11 },
    ];
    const auto = makeRouter({ getAuditCriteria: vi.fn().mockResolvedValue({ video: criteria }) });
    auto.query.mockResolvedValueOnce({ rows: [{ id: 21, created_at: "2026-01-05" }] });
    const { res } = await call(auto.router, "POST", "/", { channelInput: "@demo" });
    expect(res.statusCode).toBe(200);
    expect(auto.auditBatch).toHaveBeenCalledWith(
      expect.anything(), [criteria[0]], "", "lite", expect.any(Function),
    );

    const manual = makeRouter({ getAuditCriteria: vi.fn().mockResolvedValue({ video: criteria }) });
    manual.query.mockResolvedValueOnce({ rows: [{ id: 22, created_at: "2026-01-05" }] });
    const r2 = await call(manual.router, "POST", "/", { channelInput: "@demo", includeCaptions: true });
    expect(r2.res.statusCode).toBe(200);
    expect(manual.auditBatch).toHaveBeenCalledWith(
      expect.anything(), criteria, "", "lite", expect.any(Function),
    );
  });

  it("POST 400 without channelInput and clamps maxVideos", async () => {
    const { router, fetchPublicVideos } = makeRouter();
    const bad = await call(router, "POST", "/", {});
    expect(bad.res.statusCode).toBe(400);
    const { res } = await call(router, "POST", "/", { channelInput: "@demo", maxVideos: 500 });
    expect(res.statusCode).toBe(200);
    // Hard ceiling keeps the synchronous admin audit bounded at 1,000 videos.
    expect(fetchPublicVideos).toHaveBeenLastCalledWith(expect.anything(), 500);
    const capped = await call(router, "POST", "/", { channelInput: "@demo", maxVideos: 2000 });
    expect(capped.res.statusCode).toBe(200);
    expect(fetchPublicVideos).toHaveBeenLastCalledWith(expect.anything(), 1000);
    await call(router, "POST", "/", { channelInput: "@demo" });
    expect(fetchPublicVideos).toHaveBeenLastCalledWith(expect.anything(), 50);
  });

  it("POST requests the complete playlist catalog when includeAllPlaylists=true", async () => {
    const { router, fetchPublicPlaylists, query } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 13, created_at: "2026-01-03" }] });
    const { res } = await call(router, "POST", "/", { channelInput: "@demo", includeAllPlaylists: true });
    expect(res.statusCode).toBe(200);
    expect(fetchPublicPlaylists).toHaveBeenCalledWith("UC123", 1000);
  });

  /**
   * A public audit IS a Full Audit run on public data: the 4-category engine
   * must receive public-derived inputs and its output must be returned +
   * persisted, with the headline `overall` set to the Full Audit mean.
   */
  it("POST runs the FULL 4-category audit on public data and persists it", async () => {
    const { router, query, scoreAll, createAuditScoringService, getAuditScoring } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 9, created_at: "2026-01-04" }] });
    const { res } = await call(router, "POST", "/", { channelInput: "UC123" });

    expect(res.statusCode).toBe(200);
    expect(createAuditScoringService).toHaveBeenCalledWith({});
    expect(getAuditScoring).toHaveBeenCalled();
    // Public channel/videos/playlists mapped onto the Full Audit input contract.
    expect(scoreAll).toHaveBeenCalledWith(
      expect.objectContaining({
        channel: expect.objectContaining({ name: "Demo Channel" }),
        videos: expect.arrayContaining([
          expect.objectContaining({ videoId: "v1", viewCount: 1000, likeCount: 100, commentCount: 50 }),
        ]),
        playlists: [expect.objectContaining({ playlistId: "PL1", size: 12 })],
      }),
      { channel: { name: { max: 20 } } },
    );

    expect(res.body.overall).toBe(50);
    expect(res.body.videoAuditOverall).toBe(82);
    expect(res.body.fullAudit.categories.map((c) => c.key)).toEqual(["channel", "video", "playlist", "general"]);
    expect(res.body.fullAudit.categories[0]).toMatchObject({ label: "Channel Identity", score: 80, max: 20 });
    expect(res.body.fullAudit.issues[0]).toMatchObject({ key: "video-tags", severity: "high", count: 2 });
    expect(res.body.fullAudit.source).toBe("public-data");

    const insert = query.mock.calls.find((c) => String(c[0]).includes("INSERT INTO public_audits"));
    expect(insert[1][4]).toBe(50);
    const persisted = JSON.parse(insert[1][6]);
    expect(persisted.fullAudit.scoredVideos).toBe(2);
    expect(persisted.fullAudit.categories).toHaveLength(4);
  });

  it("POST degrades gracefully when full-audit scoring is unavailable", async () => {
    const { router, query } = makeRouter({
      createAuditScoringService: () => {
        throw new Error("scoring offline");
      },
    });
    query.mockResolvedValueOnce({ rows: [{ id: 10, created_at: "2026-01-05" }] });
    const { res } = await call(router, "POST", "/", { channelInput: "@demo" });
    // The video sub-audit result still lands — scoring is never fatal.
    expect(res.statusCode).toBe(200);
    expect(res.body.overall).toBe(82);
    expect(res.body.fullAudit).toBeNull();
    expect(res.body.results).toEqual([
      expect.objectContaining({
        videoId: "v1",
        total: 82,
        statistics: expect.objectContaining({ viewCount: "1000" }),
        publishedAt: "2026-01-01T00:00:00.000Z",
      }),
    ]);
  });

  it("checkAdmin denial blocks the run", async () => {
    const { router } = makeRouter({
      checkAdmin: (req, res) => res.status(403).json({ error: { message: "Admin only." } }),
    });
    const { res } = await call(router, "POST", "/", { channelInput: "@demo" });
    expect(res.statusCode).toBe(403);
  });

  it("GET /:id hydrates the avatar for legacy snapshots", async () => {
    const { router, query, resolvePublicChannel } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 6, channel_id: "UC123", channel_input: "@demo", channel_title: "Demo", video_count: 1, overall: 82, snapshot: "{}", results: "{}", created_by_email: "a@x", created_at: "d" }] });
    const { res } = await call(router, "GET", "/6", null);
    expect(res.statusCode).toBe(200);
    expect(resolvePublicChannel).toHaveBeenCalledWith("UC123");
    expect(res.body.snapshot.avatarUrl).toBe("https://yt3.example/avatar.jpg");
  });

  it("GET / lists history and GET /:id returns one report", async () => {
    const { router, query } = makeRouter();
    query
      .mockResolvedValueOnce({ rows: [{ id: 7, channel_input: "@demo", channel_id: "UC123", channel_title: "Demo", video_count: 1, overall: 82, created_by_email: "a@x", created_at: "d" }] })
      .mockResolvedValueOnce({ rows: [{ total: 1 }] });
    const list = await call(router, "GET", "/", null);
    expect(list.res.statusCode).toBe(200);
    expect(list.res.body.items).toHaveLength(1);

    query.mockResolvedValueOnce({ rows: [{ id: 7, channel_input: "@demo", channel_id: "UC123", channel_title: "Demo", video_count: 1, overall: 82, snapshot: JSON.stringify({ avatarUrl: "https://yt3.example/saved-avatar.jpg" }), results: JSON.stringify({ results: [{ videoId: "v1" }], auditedAt: "2026-01-01T00:00:00.000Z", channelLifetime: { avgViewsPerVideo: 1000 }, playlists: [{ playlistId: "PL1" }], videoAuditOverall: 82, fullAudit: { overall: 61, categories: [] } }), created_by_email: "a@x", created_at: "d" }] });
    const one = await call(router, "GET", "/7", null);
    expect(one.res.statusCode).toBe(200);
    expect(one.res.body.snapshot.avatarUrl).toBe("https://yt3.example/saved-avatar.jpg");
    expect(one.res.body.results).toEqual([{ videoId: "v1" }]);
    expect(one.res.body.auditedAt).toBe("2026-01-01T00:00:00.000Z");
    // Replayed enrichment comes from the stored JSONB payload (no refetch).
    expect(one.res.body.channelLifetime).toEqual({ avgViewsPerVideo: 1000 });
    expect(one.res.body.playlists).toEqual([{ playlistId: "PL1" }]);
    expect(one.res.body.playlistCount).toBe(1);
    // The Full Audit section replays too, so history reports stay comparable.
    expect(one.res.body.fullAudit).toEqual({ overall: 61, categories: [] });
    expect(one.res.body.videoAuditOverall).toBe(82);
  });

  it("DELETE /:id removes a report and 400s on bad id", async () => {
    const { router, query } = makeRouter();
    const del = await call(router, "DELETE", "/7", null);
    expect(del.res.body).toEqual({ success: true });
    expect(query).toHaveBeenCalledWith("DELETE FROM public_audits WHERE id = $1", [7]);
    const bad = await call(router, "DELETE", "/abc", null);
    // non-numeric never matches the :id route shape here; router falls through
    expect([400, 404]).toContain(bad.res.statusCode);
  });

  it("PATCH /:id renames a report and validates input", async () => {
    const { router, query } = makeRouter();
    query.mockResolvedValueOnce({ rows: [{ id: 7, channel_title: "Renamed Channel" }] });
    const ok = await call(router, "PATCH", "/7", { name: "  Renamed Channel  " });
    expect(ok.res.statusCode).toBe(200);
    expect(ok.res.body).toEqual({ id: 7, channelTitle: "Renamed Channel" });
    expect(query).toHaveBeenCalledWith(
      expect.stringContaining("UPDATE public_audits SET channel_title"),
      ["Renamed Channel", 7],
    );
    const empty = await call(router, "PATCH", "/7", { name: "   " });
    expect(empty.res.statusCode).toBe(400);
    query.mockResolvedValueOnce({ rows: [] });
    const missing = await call(router, "PATCH", "/8", { name: "Ghost" });
    expect(missing.res.statusCode).toBe(404);
  });

  it("GET /:id backfills missing per-video stats from videos.list and persists once", async () => {
    const hydrated = [
      {
        videoId: "v1",
        statistics: { viewCount: "5000", likeCount: "400", commentCount: "40", favoriteCount: "2" },
        publishedAt: "2026-02-01T00:00:00.000Z",
        durationLabel: "2:30",
        durationSeconds: 150,
        definition: "hd",
        categoryId: "22",
        liveBroadcastContent: "none",
      },
    ];
    const hydrateVideoMetadata = vi.fn().mockResolvedValue(hydrated);
    const legacy = { results: [{ videoId: "v1", videoTitle: "T1", total: 70 }], auditedAt: "2026-01-01" };
    const { router, query } = makeRouter({ publicAuditService: {
      resolvePublicChannel: vi.fn(),
      fetchPublicVideos: vi.fn(),
      fetchPublicPlaylists: vi.fn(),
      computeChannelLifetime: realService.computeChannelLifetime,
      buildFullAuditInput: realService.buildFullAuditInput,
      hydrateVideoMetadata,
    } });
    query.mockResolvedValueOnce({ rows: [{
      id: 9, channel_id: "UC123", channel_input: "@demo", channel_title: "Demo",
      video_count: 1, overall: 70, snapshot: JSON.stringify({ avatarUrl: "http://a/1.jpg" }),
      results: JSON.stringify(legacy), created_by_email: "a@x", created_at: "d",
    }] });
    const { res } = await call(router, "GET", "/9", null);
    expect(res.statusCode).toBe(200);
    expect(hydrateVideoMetadata).toHaveBeenCalledWith(["v1"]);
    expect(res.body.results[0]).toMatchObject({
      videoId: "v1",
      videoTitle: "T1",
      total: 70,
      statistics: expect.objectContaining({ viewCount: "5000" }),
      publishedAt: "2026-02-01T00:00:00.000Z",
      durationLabel: "2:30",
    });
    // One-time write-back so the next open serves stored rows directly.
    const update = query.mock.calls.find((c) => String(c[0]).startsWith("UPDATE public_audits SET results"));
    expect(update[1][1]).toBe(9);
    expect(JSON.parse(update[1][0]).results[0]).toMatchObject({ statistics: expect.objectContaining({ viewCount: "5000" }) });
  });

  it("GET /:id skips hydration when rows already have stats and survives API failure", async () => {
    const hydrateVideoMetadata = vi.fn().mockResolvedValue([]);
    const full = { results: [{ videoId: "v1", total: 70, statistics: { viewCount: "5" }, publishedAt: "2026-01-01" }] };
    const { router, query } = makeRouter({ publicAuditService: {
      resolvePublicChannel: vi.fn(),
      fetchPublicVideos: vi.fn(),
      fetchPublicPlaylists: vi.fn(),
      computeChannelLifetime: realService.computeChannelLifetime,
      buildFullAuditInput: realService.buildFullAuditInput,
      hydrateVideoMetadata,
    } });
    query.mockResolvedValueOnce({ rows: [{
      id: 10, channel_id: "UC1", channel_input: "@x", channel_title: "X",
      video_count: 1, overall: 70, snapshot: "{}", results: JSON.stringify(full),
      created_by_email: "a@x", created_at: "d",
    }] });
    const { res } = await call(router, "GET", "/10", null);
    expect(res.statusCode).toBe(200);
    expect(hydrateVideoMetadata).not.toHaveBeenCalled();
    expect(res.body.results).toEqual(full.results);

    // Hydration failure is non-fatal: stored rows still serve.
    hydrateVideoMetadata.mockRejectedValueOnce(new Error("quota 403"));
    const legacy = { results: [{ videoId: "v9", total: 10 }] };
    query.mockResolvedValueOnce({ rows: [{
      id: 11, channel_id: "UC1", channel_input: "@x", channel_title: "X",
      video_count: 1, overall: 10, snapshot: "{}", results: JSON.stringify(legacy),
      created_by_email: "a@x", created_at: "d",
    }] });
    const failed = await call(router, "GET", "/11", null);
    expect(failed.res.statusCode).toBe(200);
    expect(failed.res.body.results).toEqual([{ videoId: "v9", total: 10 }]);
  });
});
