import { describe, expect, it } from "vitest";
import { computeDecay, computeVideoInsights } from "./playlistDecay";
import type { Video } from "../types/playlistOptimizer";

const DAY = 24 * 60 * 60 * 1000;

describe("playlistDecay", () => {
  it("weights newer videos higher than older ones", () => {
    const now = Date.now();
    const fresh = computeDecay(new Date(now - 10 * DAY).toISOString());
    const aged = computeDecay(new Date(now - 2 * 365 * DAY).toISOString());
    expect(fresh.decayWeight).toBeGreaterThan(aged.decayWeight);
    expect(fresh.decayTier).toBe("High");
    expect(aged.decayTier).toBe("Low");
    expect(fresh.ageDays).toBe(10);
  });

  it("scales up high-performing videos but never zeroes low views", () => {
    const now = Date.now();
    const high = computeDecay(new Date(now - 30 * DAY).toISOString(), 100000, 100000);
    const low = computeDecay(new Date(now - 30 * DAY).toISOString(), 50, 100000);
    expect(high.decayWeight).toBeGreaterThan(low.decayWeight);
    expect(low.decayWeight).toBeGreaterThan(0);
  });

  it("treats missing publishDate as age 0 and missing views as neutral", () => {
    const info = computeDecay(undefined, undefined, 0);
    expect(info.ageDays).toBe(0);
    expect(info.decayWeight).toBe(1);
  });

  it("sorts input videos by decay weight, newest/highest performers first", () => {
    const now = Date.now();
    const videos: Video[] = [
      { id: "old", videoId: "old", title: "Old", publishDate: new Date(now - 4 * 365 * DAY).toISOString(), views: 100 },
      { id: "new", videoId: "new", title: "New", publishDate: new Date(now - 10 * DAY).toISOString(), views: 100000 },
      { id: "mid", videoId: "mid", title: "Mid", publishDate: new Date(now - 30 * DAY).toISOString(), views: 50 },
    ];
    const insights = computeVideoInsights(videos, true);
    expect(insights.map((i) => i.videoId)).toEqual(["new", "mid", "old"]);
    expect(insights[0].decayTier).toBe("High");
    expect(insights[2].decayTier).toBe("Minimal");
  });

  it("keeps input order and omits decay fields when time-decay is off (default)", () => {
    const now = Date.now();
    const videos: Video[] = [
      { id: "old", videoId: "old", title: "Old", publishDate: new Date(now - 4 * 365 * DAY).toISOString(), views: 100 },
      { id: "new", videoId: "new", title: "New", publishDate: new Date(now - 10 * DAY).toISOString(), views: 100000 },
    ];
    const insights = computeVideoInsights(videos);
    expect(insights.map((i) => i.videoId)).toEqual(["old", "new"]);
    expect(insights[0].decayWeight).toBeUndefined();
    expect(insights[0].decayTier).toBeUndefined();
  });

  it("carries channel and playlist data onto each row", () => {
    const videos: Video[] = [
      {
        id: "a",
        videoId: "a",
        title: "A",
        channelTitle: "My Channel",
        originalPlaylistId: "PL1",
        customMetadata: { originalPlaylistTitle: "Basics" },
      },
    ];
    const insights = computeVideoInsights(videos);
    expect(insights[0].channelTitle).toBe("My Channel");
    expect(insights[0].playlistId).toBe("PL1");
    expect(insights[0].playlistTitle).toBe("Basics");
  });
});
