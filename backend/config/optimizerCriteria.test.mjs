import { describe, it, expect } from "vitest";
import {
  DEFAULT_OPTIMIZER_CRITERIA,
  THUMBNAIL_TIERS,
  getOptimizerCriteria,
  mergeOptimizerCriteria,
  mergeCriteriaWithExisting,
  mergeEngineBlend,
  mergeVideoBlend,
  invalidateOptimizerCriteriaCache,
  isValidCriterion,
  playlistWeightTotal,
  validatePlaylistWeights,
} from "./optimizerCriteria.js";

describe("optimizerCriteria config", () => {
  it("defaults define the 12 thumbnail pillars across 3 tiers", () => {
    expect(DEFAULT_OPTIMIZER_CRITERIA.thumbnail).toHaveLength(12);
    for (const p of DEFAULT_OPTIMIZER_CRITERIA.thumbnail) {
      expect(typeof p.key).toBe("string");
      expect(typeof p.label).toBe("string");
      expect(THUMBNAIL_TIERS).toContain(p.tier);
      expect(p.weight).toBeGreaterThan(0);
      expect(typeof p.instruction).toBe("string");
    }
  });

  it("defaults define playlist scoring criteria", () => {
    expect(DEFAULT_OPTIMIZER_CRITERIA.playlist.length).toBeGreaterThanOrEqual(5);
    for (const c of DEFAULT_OPTIMIZER_CRITERIA.playlist) {
      expect(isValidCriterion(c)).toBe(true);
    }
  });

  it("playlist default weights match the specified distribution and sum to 100", () => {
    const expected = {
      title_ctr: 12,
      seo_description: 20,
      keywords: 12,
      tags: 8,
      ordering_flow: 12,
      theme_coherence: 8,
      metadata_health: 8,
      virality_potential: 8,
      video_coverage: 4,
      audience_targeting: 8,
    };
    expect(DEFAULT_OPTIMIZER_CRITERIA.playlist).toHaveLength(10);
    for (const c of DEFAULT_OPTIMIZER_CRITERIA.playlist) {
      expect(c.weight).toBe(expected[c.key]);
    }
    expect(playlistWeightTotal(DEFAULT_OPTIMIZER_CRITERIA.playlist)).toBe(100);
    expect(validatePlaylistWeights(DEFAULT_OPTIMIZER_CRITERIA.playlist)).toBeNull();
  });

  it("validatePlaylistWeights rejects totals other than 100", () => {
    expect(validatePlaylistWeights([{ key: "a", weight: 60 }])).toMatch(/must sum to 100/i);
    expect(validatePlaylistWeights([])).toMatch(/must sum to 100/i);
    expect(playlistWeightTotal([{ weight: 30 }, { weight: 70 }])).toBe(100);
    expect(validatePlaylistWeights([{ weight: 30 }, { weight: 70 }])).toBeNull();
  });

  it("merges db criteria, dropping invalid entries and keeping defaults", () => {
    const db = {
      thumbnail: [
        { key: "promise_lock", label: "Promise Lock!", tier: "Blue", weight: 20, instruction: "x" },
        { key: "bad", weight: 5 }, // invalid
      ],
      playlist: [
        { key: "title_ctr", label: "Titles", weight: 25, instruction: "y" },
      ],
    };
    const merged = mergeOptimizerCriteria(db);
    expect(merged.thumbnail).toHaveLength(12);
    const lock = merged.thumbnail.find((p) => p.key === "promise_lock");
    expect(lock.weight).toBe(20);
    expect(lock.tier).toBe("Grey"); // invalid tier normalized to default
    expect(merged.thumbnail.some((p) => p.key === "bad")).toBe(false);
    expect(merged.playlist.find((c) => c.key === "title_ctr").weight).toBe(25);
    expect(merged.playlist.length).toBeGreaterThanOrEqual(5);
  });

  it("getOptimizerCriteria reads Firestore and caches", async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false }),
        }),
      }),
    };
    const cfg = await getOptimizerCriteria(db);
    expect(cfg.thumbnail).toHaveLength(12);
    invalidateOptimizerCriteriaCache();
  });

  it("STREAM B: videoElements carry the 3 content-quality criteria and still sum to 100", () => {
    const els = DEFAULT_OPTIMIZER_CRITERIA.videoElements;
    for (const key of ["niche_alignment", "audience_hook", "value_density"]) {
      const c = els.find((e) => e.key === key);
      expect(c).toBeDefined();
      expect(isValidCriterion(c)).toBe(true);
      expect(typeof c.element).toBe("string");
      expect(Array.isArray(c.niches)).toBe(true);
    }
    expect(els.find((e) => e.key === "niche_alignment").element).toBe("title");
    expect(els.find((e) => e.key === "audience_hook").element).toBe("title");
    expect(els.find((e) => e.key === "value_density").element).toBe("description");
    // Renormalized: same total as before so engine outputs stay calibrated.
    expect(els.reduce((s, e) => s + e.weight, 0)).toBe(100);
  });

  it("STREAM B: channelIdentity carries the 3 content-quality params with thresholds + templates", () => {
    const params = DEFAULT_OPTIMIZER_CRITERIA.channelIdentity;
    for (const key of ["niche_consistency", "brand_curiosity", "likeability_trust"]) {
      const p = params.find((e) => e.key === key);
      expect(p).toBeDefined();
      // Same shape as the sibling channelIdentity entries (which carry
      // recommendationTemplate instead of instruction).
      expect(typeof p.label).toBe("string");
      expect(typeof p.category).toBe("string");
      expect(p.weight).toBeGreaterThan(0);
      expect(p.enabled).toBe(true);
      expect(typeof p.recommendationTemplate).toBe("string");
      expect(p.recommendationTemplate.length).toBeGreaterThan(0);
      expect(typeof p.thresholds).toBe("object");
    }
    expect(params.find((p) => p.key === "niche_consistency").thresholds.minMatchPct).toBe(70);
  });

  it("defaults define all four engine blends as 50/50", () => {
    for (const key of ["videoBlend", "channelBlend", "playlistBlend", "generalBlend"]) {
      expect(DEFAULT_OPTIMIZER_CRITERIA[key]).toEqual({ algorithmic: 50, ai: 50 });
    }
  });

  it("channelBrand + generalOutlook weights each sum to 100 with instructions", () => {
    const brand = DEFAULT_OPTIMIZER_CRITERIA.channelBrand;
    expect(brand).toHaveLength(4);
    expect(brand.reduce((s, c) => s + c.weight, 0)).toBe(100);
    const outlook = DEFAULT_OPTIMIZER_CRITERIA.generalOutlook;
    expect(outlook.reduce((s, c) => s + c.weight, 0)).toBe(100);
    expect(outlook.find((c) => c.key === "growth_trajectory").weight).toBe(40);
    for (const c of [...brand, ...outlook]) {
      expect(isValidCriterion(c)).toBe(true);
    }
  });

  it("mergeEngineBlend clamps, renormalizes to 100, and falls back 50/50 on zero/NaN", () => {
    expect(mergeEngineBlend(undefined, { algorithmic: 50, ai: 50 })).toEqual({ algorithmic: 50, ai: 50 });
    expect(mergeEngineBlend({ algorithmic: 0, ai: 100 })).toEqual({ algorithmic: 0, ai: 100 });
    expect(mergeEngineBlend({ algorithmic: 0, ai: 0 })).toEqual({ algorithmic: 50, ai: 50 });
    expect(mergeEngineBlend({ algorithmic: "x", ai: NaN })).toEqual({ algorithmic: 50, ai: 50 });
    expect(mergeEngineBlend({ algorithmic: 30, ai: 30 })).toEqual({ algorithmic: 50, ai: 50 });
    expect(mergeEngineBlend({ algorithmic: 150, ai: -5 })).toEqual({ algorithmic: 100, ai: 0 });
    // Backward-compatible alias keeps the video default.
    expect(mergeVideoBlend({ algorithmic: 70, ai: 30 })).toEqual({ algorithmic: 70, ai: 30 });
  });

  it("merge paths carry all four blends and the new AI sections", () => {
    const merged = mergeOptimizerCriteria({});
    for (const key of ["videoBlend", "channelBlend", "playlistBlend", "generalBlend"]) {
      expect(merged[key]).toEqual({ algorithmic: 50, ai: 50 });
    }
    expect(merged.channelBrand).toHaveLength(4);
    expect(merged.generalOutlook).toHaveLength(3);
    const withExisting = mergeCriteriaWithExisting(merged, { channelBlend: { algorithmic: 20, ai: 80 } });
    expect(withExisting.channelBlend).toEqual({ algorithmic: 20, ai: 80 });
    expect(withExisting.videoBlend).toEqual({ algorithmic: 50, ai: 50 });
    expect(withExisting.channelBrand).toHaveLength(4);
  });
});
