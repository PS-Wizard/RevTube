import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_AUDIT_CRITERIA,
  CATEGORY_META,
  getAuditCriteria,
  mergeAuditCriteria,
  invalidateAuditCriteriaCache,
  normalizeVideoCriteria,
} from "./channelAuditCriteria.js";

describe("auditCriteria config", () => {
  it("defaults have a sensible video criteria set", () => {
    expect(Array.isArray(DEFAULT_AUDIT_CRITERIA.video)).toBe(true);
    expect(DEFAULT_AUDIT_CRITERIA.video.length).toBeGreaterThanOrEqual(4);
    for (const c of DEFAULT_AUDIT_CRITERIA.video) {
      expect(typeof c.key).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(typeof c.weight).toBe("number");
      expect(typeof c.element).toBe("string");
      expect(typeof c.instruction).toBe("string");
      expect(Array.isArray(c.niches)).toBe(true);
      expect(Object.prototype.hasOwnProperty.call(CATEGORY_META, c.category)).toBe(true);
    }
  });

  it("defines the 3 focus categories", () => {
    expect(Object.keys(CATEGORY_META)).toEqual(["discoverability", "contentQuality", "visualHook"]);
    expect(CATEGORY_META.discoverability.label).toBe("Discoverability");
    expect(CATEGORY_META.contentQuality.elements).toContain("description");
    expect(CATEGORY_META.visualHook.elements).toContain("thumbnail");
  });

  it("merges db criteria, falling back per-item on invalid entries", () => {
    const db = {
      video: [
        { key: "funny", label: "Funny", weight: 15, element: "title", instruction: "is it funny", niches: ["comedy"] },
        { key: "bad", weight: -5 }, // invalid: missing label/element/instruction
      ],
    };
    const merged = mergeAuditCriteria(db);
    const funny = merged.video.find((c) => c.key === "funny");
    expect(funny.weight).toBe(15);
    expect(funny.niches).toEqual(["comedy"]);
    // invalid entry dropped, default set retained
    expect(merged.video.some((c) => c.key === "bad")).toBe(false);
    expect(merged.video.length).toBeGreaterThanOrEqual(4);
  });

  it("getAuditCriteria reads Firestore and caches 10min", async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false }),
        }),
      }),
    };
    const cfg = await getAuditCriteria(db);
    expect(Array.isArray(cfg.video)).toBe(true);
    invalidateAuditCriteriaCache();
  });

  it("normalizeVideoCriteria drops zero/negative weights and returns the weighted set", () => {
    const norm = normalizeVideoCriteria(DEFAULT_AUDIT_CRITERIA.video);
    expect(norm.every((c) => c.weight > 0)).toBe(true);
  });

  it("STREAM B: content-quality criteria map to real elements/categories the engine scores", () => {
    const byKey = new Map(DEFAULT_AUDIT_CRITERIA.video.map((c) => [c.key, c]));
    expect(byKey.get("niche_alignment")).toMatchObject({ element: "title", category: "discoverability" });
    expect(byKey.get("audience_hook")).toMatchObject({ element: "title", category: "discoverability" });
    expect(byKey.get("value_density")).toMatchObject({ element: "description", category: "contentQuality" });
    // Unknown categories are remapped to discoverability -- these must survive as-is.
    const norm = normalizeVideoCriteria(DEFAULT_AUDIT_CRITERIA.video);
    expect(norm.find((c) => c.key === "niche_alignment").category).toBe("discoverability");
    expect(norm.find((c) => c.key === "value_density").category).toBe("contentQuality");
  });
});
