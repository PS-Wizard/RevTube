import { describe, it, expect } from "vitest";
import auditScoringService from "./channelAuditScoringService.js";
const { createAuditScoringService } = auditScoringService;
const { DEFAULT_AUDIT_SCORING } = (await import("../config/channelAuditScoring.js")).default;

function makeService() {
  return { service: createAuditScoringService({}) };
}

// Three videos on a regular weekly cadence sharing a "youtube growth" topic.
const VIDEOS = [
  { title: "10 Ways to Grow Your YouTube Channel Fast in 2026", description: "A full guide covering all the strategies you need to grow a YouTube channel from scratch in under thirty minutes, packed with actionable tips.", tags: ["growth", "youtube", "tips", "strategy", "seo", "viral", "algorithm", "content", "creator", "audience"], publishedAt: "2026-01-01T00:00:00Z", viewCount: 100000, likeCount: 5000, commentCount: 300 },
  { title: "5 Advanced YouTube Growth Secrets Nobody Talks About", description: "Advanced tips for experienced creators looking to scale their channel with better retention, packaging, and strategy.", tags: ["youtube", "growth", "seo", "strategy", "tips"], publishedAt: "2026-01-08T00:00:00Z", viewCount: 80000, likeCount: 4000, commentCount: 200 },
  { title: "YouTube SEO Masterclass for Beginners", description: "A complete beginner masterclass covering keyword research, titles, tags, and description optimization on YouTube.", tags: ["seo", "youtube", "keywords", "beginners", "tutorial"], publishedAt: "2026-01-15T00:00:00Z", viewCount: 120000, likeCount: 6000, commentCount: 350 },
];

const CHANNEL = {
  name: "CodeMaster",
  username: "@codemaster",
  description: "Learn to code with clear tutorials every week.",
  keywords: ["coding", "python", "javascript", "react", "node"],
};

const PLAYLISTS = [
  { title: "Full Python Course from Scratch", description: "Every lesson in order, from basics to advanced projects with exercises and quizzes.", size: 40 },
  { title: "JavaScript Essentials", description: "Core JavaScript concepts with practical examples for beginners.", size: 25 },
];

describe("scoreVideo", () => {
  it("scores a strong set of videos near the max", async () => {
    const { service } = makeService();
    const r = await service.scoreVideo(VIDEOS);
    expect(r.total).toBeGreaterThanOrEqual(60);
    expect(r.breakdown.reduce((s, b) => s + b.earned, 0)).toBe(r.total);
  });
  it("caps each criterion at its max", async () => {
    const { service } = makeService();
    const r = await service.scoreVideo(VIDEOS);
    for (const b of r.breakdown) expect(b.earned).toBeLessThanOrEqual(b.max);
  });
  it("returns zero for no videos", async () => {
    const { service } = makeService();
    expect((await service.scoreVideo([])).total).toBe(0);
    expect((await service.scoreVideo({})).total).toBe(0);
  });
  it("respects a custom config max", async () => {
    const { service } = makeService();
    const cfg = { ...DEFAULT_AUDIT_SCORING, video: { title: { max: 100 }, description: { max: 0 }, tags: { max: 0 }, keywords: { max: 0 } } };
    const r = await service.scoreVideo(VIDEOS, cfg);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.breakdown.find((b) => b.key === "title").max).toBe(100);
  });
});

describe("scoreChannel", () => {
  it("scores identity, tags, niche, and description", async () => {
    const { service } = makeService();
    const r = await service.scoreChannel(CHANNEL, DEFAULT_AUDIT_SCORING, VIDEOS);
    expect(r.breakdown.reduce((s, b) => s + b.earned, 0)).toBe(r.total);
    expect(r.breakdown.find((b) => b.key === "name").earned).toBeGreaterThan(0);
    expect(r.breakdown.find((b) => b.key === "username").earned).toBeGreaterThan(0);
    expect(r.breakdown.find((b) => b.key === "niche").earned).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThanOrEqual(40);
  });
});

describe("scorePlaylist", () => {
  it("scores well-sized, described playlists", async () => {
    const { service } = makeService();
    const r = await service.scorePlaylist(PLAYLISTS);
    expect(r.breakdown.reduce((s, b) => s + b.earned, 0)).toBe(r.total);
    expect(r.breakdown.find((b) => b.key === "size").earned).toBeGreaterThan(0);
    expect(r.total).toBeGreaterThanOrEqual(50);
  });
  it("returns zero for no playlists", async () => {
    const { service } = makeService();
    expect((await service.scorePlaylist([])).total).toBe(0);
  });
  it("caps oversized playlists at max (never above 100)", async () => {
    const { service } = makeService();
    const big = [{ title: "Big Series With A Clear Keyword Title", description: "x".repeat(300), size: 423 }];
    const r = await service.scorePlaylist(big);
    const size = r.breakdown.find((b) => b.key === "size");
    expect(size.earned).toBeLessThanOrEqual(size.max);
    const h = service.rateHealth({ channel: CHANNEL, videos: [], playlists: [{ ...big[0], playlistId: "PLbig" }] });
    expect(h.playlists[0].health).toBeLessThanOrEqual(100);
    expect(h.playlists[0].dimensions.find((d) => d.key === "size")?.current).toBe(100);
    expect(h.playlists[0].recommendations.some((rec) => rec.dimension === "size")).toBe(false);
  });
});

describe("scoreGeneral", () => {
  it("rewards a regular cadence and strong engagement", async () => {
    const { service } = makeService();
    const r = await service.scoreGeneral(VIDEOS);
    expect(r.breakdown.reduce((s, b) => s + b.earned, 0)).toBe(r.total);
    // Perfect weekly cadence -> full consistency points.
    expect(r.breakdown.find((b) => b.key === "uploadConsistency").earned).toBe(DEFAULT_AUDIT_SCORING.general.uploadConsistency.max);
    // Shared topic across all titles -> full content focus points.
    expect(r.breakdown.find((b) => b.key === "contentSwitch").earned).toBe(DEFAULT_AUDIT_SCORING.general.contentSwitch.max);
    expect(r.breakdown.find((b) => b.key === "engagement").earned).toBeGreaterThan(0);
  });
  it("returns zero for no videos", async () => {
    const { service } = makeService();
    expect((await service.scoreGeneral([])).total).toBe(0);
  });
});

describe("scoreAll", () => {
  it("returns all four categories", async () => {
    const { service } = makeService();
    const r = await service.scoreAll({ channel: CHANNEL, videos: VIDEOS, playlists: PLAYLISTS });
    expect(Object.keys(r)).toEqual(["video", "channel", "playlist", "general"]);
    expect(r.video.total).toBeGreaterThanOrEqual(0);
    expect(r.general.total).toBeGreaterThanOrEqual(0);
  });
});

describe("rateHealth", () => {
  it("returns per-field channel health and per-item video/playlist health in 0-100", async () => {
    const { service } = makeService();
    const h = service.rateHealth({ channel: CHANNEL, videos: VIDEOS, playlists: PLAYLISTS });
    // Channel fields carry their value plus a normalized health.
    expect(h.channel.name.value).toBe("CodeMaster");
    expect(h.channel.name.health).toBeGreaterThanOrEqual(0);
    expect(h.channel.name.health).toBeLessThanOrEqual(100);
    expect(h.channel.description.health).toBeGreaterThan(0);
    expect(h.channel.keywords.values).toEqual(CHANNEL.keywords);
    // Video/playlist items carry a single averaged health plus the raw data.
    expect(h.videos).toHaveLength(VIDEOS.length);
    expect(h.videos[0].title).toBe(VIDEOS[0].title);
    expect(h.videos[0].health).toBeGreaterThan(0);
    expect(h.playlists).toHaveLength(PLAYLISTS.length);
    expect(h.playlists[0].size).toBe(PLAYLISTS[0].size);
    expect(h.playlists[0].health).toBeGreaterThan(0);
  });
  it("emits an actionable hint per item", async () => {
    const { service } = makeService();
    const h = service.rateHealth({ channel: CHANNEL, videos: VIDEOS, playlists: PLAYLISTS });
    expect(typeof h.channel.name.hint).toBe("string");
    expect(h.channel.name.hint.length).toBeGreaterThan(0);
    for (const v of h.videos) expect(typeof v.hint).toBe("string");
    for (const p of h.playlists) expect(typeof p.hint).toBe("string");
  });
  it("includes general recommendations with hints", async () => {
    const { service } = makeService();
    const h = service.rateHealth({ channel: CHANNEL, videos: VIDEOS, playlists: PLAYLISTS });
    expect(Array.isArray(h.general)).toBe(true);
    const keys = h.general.map((g) => g.key);
    expect(keys).toEqual(["uploadConsistency", "engagement", "contentSwitch"]);
    for (const g of h.general) {
      expect(g.health).toBeGreaterThanOrEqual(0);
      expect(g.health).toBeLessThanOrEqual(100);
      expect(typeof g.hint).toBe("string");
    }
    // Regular weekly cadence with strong engagement scores the general aspects well.
    expect(h.general[0].health).toBeGreaterThanOrEqual(80);
    expect(h.general[1].health).toBeGreaterThan(0);
  });
  it("handles empty/missing input", async () => {
    const { service } = makeService();
    const h = service.rateHealth({});
    expect(h.channel.name.health).toBe(0);
    expect(h.videos).toEqual([]);
    expect(h.playlists).toEqual([]);
    expect(h.general).toHaveLength(3);
  });
  it("passes playlistId through so report rows can join the audit", async () => {
    const { service } = makeService();
    const withIds = PLAYLISTS.map((p, i) => ({ ...p, playlistId: `PL${i}` }));
    const h = service.rateHealth({ channel: CHANNEL, videos: VIDEOS, playlists: withIds });
    expect(h.playlists.map((p) => p.playlistId)).toEqual(["PL0", "PL1"]);
    // Missing ids degrade to null (never undefined) for a stable UI join.
    const bare = service.rateHealth({ channel: CHANNEL, videos: [], playlists: [{ title: "T" }] });
    expect(bare.playlists[0].playlistId).toBeNull();
  });
  it("emits per-dimension scores + fix recommendations per playlist", async () => {
    const { service } = makeService();
    const h = service.rateHealth({
      channel: CHANNEL,
      videos: [],
      playlists: [{ playlistId: "PL9", title: "T", description: "", size: 3 }],
    });
    const [pl] = h.playlists;
    expect(pl.dimensions).toEqual([
      { key: "title", label: "Title", current: expect.any(Number) },
      { key: "description", label: "Description", current: 0 },
      { key: "size", label: "Coverage / Size", current: 30 },
    ]);
    // Every dimension below 100 yields a fix, biggest uplift first.
    expect(pl.recommendations.map((r) => r.dimension)).toEqual(["description", "title", "size"]);
    for (const r of pl.recommendations) {
      expect(r.projected).toBe(100);
      expect(r.delta).toBe(100 - r.current);
    }
    // A perfect playlist has no fixes.
    const perfect = service.rateHealth({
      channel: CHANNEL,
      videos: [],
      playlists: [{
        playlistId: "PL10",
        title: "A Clear Keyword-Rich Playlist Title Here",
        description: "x".repeat(300),
        size: 25,
      }],
    });
    expect(perfect.playlists[0].health).toBe(100);
    expect(perfect.playlists[0].recommendations).toEqual([]);
  });
});
