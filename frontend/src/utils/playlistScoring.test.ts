import { describe, expect, it } from "vitest";
import {
  isDefaultSettings,
  scoreAllPlaylists,
  scorePlaylist,
} from "./playlistScoring";
import type {
  PlaylistRecommendation,
  VideoInsight,
} from "../types/playlistOptimizer";

const DAY = 24 * 60 * 60 * 1000;
const now = Date.now();

function insight(videoId: string, title: string, publishDate: string, views: number): VideoInsight {
  return { videoId, title, publishDate, views };
}

function playlist(id: string, videoIds: string[], title = "Cats are amazing! Fun cat moments and cat facts"): PlaylistRecommendation {
  return {
    id,
    title,
    description: "",
    keywords: ["cat facts", "cats", "funny cats"],
    tags: [],
    reasoning: "",
    why: "",
    videos: videoIds.map((videoId) => ({ id: videoId, videoId, title })),
    viralityScore: 65,
    predictedReach: "Medium",
    engagementPrediction: "",
  };
}

const THEME_INSIGHTS = [
  insight("c1", "Why cats are the best companions", new Date(now - 40 * DAY).toISOString(), 8000),
  insight("c2", "Cats have 32 muscles in each ear", new Date(now - 45 * DAY).toISOString(), 12000),
  insight("c3", "The ultimate cozy cat burrito", new Date(now - 30 * DAY).toISOString(), 6000),
  insight("c4", "Orange cat has zero interest in the ball", new Date(now - 60 * DAY).toISOString(), 20000),
  insight("c5", "Cat looking in the mirror", new Date(now - 50 * DAY).toISOString(), 4000),
];

describe("playlistScoring", () => {
  it("scores a solid playlist 80+ under default settings", () => {
    const pl = playlist("p1", ["c1", "c2", "c3", "c4", "c5"]);
    const { score, factors } = scorePlaylist(pl, THEME_INSIGHTS, {});
    expect(score).toBeGreaterThanOrEqual(80);
    expect(score).toBeLessThanOrEqual(100);
    // Solid playlist -> no size deduction, no obvious weakness factors.
    expect(factors.some((f) => f.key === "size")).toBe(false);
  });

  it("penalizes a tiny playlist and suggests adding videos", () => {
    const pl = playlist("p2", ["c1"]);
    const { score, factors } = scorePlaylist(pl, THEME_INSIGHTS, {});
    expect(score).toBeLessThan(80);
    const size = factors.find((f) => f.key === "size");
    expect(size).toBeDefined();
    expect(size!.tip).toContain("Add");
  });

  it("penalizes off-niche videos and suggests moving them", () => {
    const offNiche = insight("m1", "The truth about success nobody wants to hear", new Date(now - 30 * DAY).toISOString(), 9000);
    const insights = [...THEME_INSIGHTS, offNiche];
    const pl = playlist("p3", ["c1", "m1"]);
    const { score, factors } = scorePlaylist(pl, insights, {});
    const niche = factors.find((f) => f.key === "niche");
    expect(niche).toBeDefined();
    expect(niche!.label).toContain("off this theme");
    expect(niche!.tip).toContain("move");
    expect(score).toBeLessThan(80);
  });

  it("penalizes old videos more when time-decay weighting is on", () => {
    const old = insight("o1", "Why cats are the best companions", new Date(now - 4 * 365 * DAY).toISOString(), 8000);
    const pl = playlist("p4", ["o1", "c2"]);
    const light = scorePlaylist(pl, [...THEME_INSIGHTS, old], {}).factors.find((f) => f.key === "age");
    const heavy = scorePlaylist(pl, [...THEME_INSIGHTS, old], { useTimeDecay: true }).factors.find((f) => f.key === "age");
    expect(light).toBeDefined();
    expect(heavy).toBeDefined();
    expect(heavy!.deduction).toBeGreaterThan(light!.deduction);
  });

  it("lifts the strongest playlist to exactly 80 under default settings", () => {
    const weak = playlist("w1", ["c1"]); // 1 video -> 72-ish
    const weak2 = playlist("w2", ["c2"]); // 1 video -> 72-ish
    const map = scoreAllPlaylists([weak, weak2], THEME_INSIGHTS, {});
    const scores = [...map.values()];
    expect(Math.max(...scores.map((s) => s.score))).toBe(80);
    expect(scores.some((s) => s.isTopUplifted)).toBe(true);
  });

  it("does NOT apply the floor when advanced settings are active", () => {
    const weak = playlist("w1", ["c1"]);
    const weak2 = playlist("w2", ["c2"]);
    const map = scoreAllPlaylists([weak, weak2], THEME_INSIGHTS, { useTimeDecay: true });
    const scores = [...map.values()];
    expect(scores.some((s) => s.isTopUplifted)).toBe(false);
    expect(Math.max(...scores.map((s) => s.score))).toBeLessThan(80);
  });

  it("falls back to the AI score when no insights match", () => {
    const pl = playlist("p9", ["unmatched"]);
    const { score, factors } = scorePlaylist(pl, THEME_INSIGHTS, {});
    expect(score).toBe(65);
    expect(factors).toHaveLength(0);
  });

  it("isDefaultSettings detects default vs advanced runs", () => {
    expect(isDefaultSettings({})).toBe(true);
    expect(isDefaultSettings({ dataRange: "30d" })).toBe(false);
    expect(isDefaultSettings({ useTimeDecay: true })).toBe(false);
    expect(isDefaultSettings({ excludeKeywords: "montage" })).toBe(false);
    expect(isDefaultSettings({ maxPlaylistsPerVideo: 3 })).toBe(false);
  });
});
