import { describe, it, expect } from "vitest";
import {
  DEFAULT_AUDIT_SCORING,
  deriveAuditScoring,
  getAuditScoring,
} from "./channelAuditScoring.js";
import { DEFAULT_PARAMS } from "./channelAuditParameterDefinitions.js";

const sumCat = (cfg, cat) =>
  Object.values(cfg[cat]).reduce((s, c) => s + c.max, 0);

describe("DEFAULT_AUDIT_SCORING", () => {
  it("has categories whose maxes sum to 100", () => {
    for (const cat of ["video", "channel", "playlist", "general"]) {
      expect(sumCat(DEFAULT_AUDIT_SCORING, cat)).toBe(100);
    }
  });
});

describe("deriveAuditScoring", () => {
  it("normalizes default param weights so every category sums to 100", () => {
    const cfg = deriveAuditScoring(DEFAULT_PARAMS);
    for (const cat of ["channel", "video", "playlist", "general"]) {
      expect(sumCat(cfg, cat)).toBe(100);
    }
  });

  it("re-distributes points when an admin raises a weight (dynamic)", () => {
    const boosted = DEFAULT_PARAMS.map((p) =>
      p.auditType === "CHANNEL_IDENTITY" && p.key === "name_clarity"
        ? { ...p, weight: 200 }
        : p,
    );
    const cfg = deriveAuditScoring(boosted);
    expect(sumCat(cfg, "channel")).toBe(100);
    // The boosted criterion should now dominate the category.
    const maxes = Object.values(cfg.channel).map((c) => c.max);
    expect(Math.max(...maxes)).toBe(cfg.channel.name.max);
    expect(cfg.channel.name.max).toBeGreaterThan(50);
  });

  it("excludes disabled params from the distribution", () => {
    const disabled = DEFAULT_PARAMS.map((p) =>
      p.auditType === "VIDEO" && p.key === "title_quality" ? { ...p, enabled: false } : p,
    );
    const cfg = deriveAuditScoring(disabled);
    expect(sumCat(cfg, "video")).toBe(100);
    expect(cfg.video.title.max).toBeLessThan(
      deriveAuditScoring(DEFAULT_PARAMS).video.title.max,
    );
  });

  it("falls back to defaults when nothing is enabled in a category", () => {
    const noneEnabled = DEFAULT_PARAMS.map((p) => ({ ...p, enabled: false }));
    const cfg = deriveAuditScoring(noneEnabled);
    expect(cfg.video).toEqual(DEFAULT_AUDIT_SCORING.video);
    expect(sumCat(cfg, "channel")).toBe(100);
  });
});

describe("getAuditScoring", () => {
  it("derives scoring live from param definitions (single source of truth)", async () => {
    const db = {}; // getParamDefinitions falls back to defaults without Firestore
    const cfg = await getAuditScoring(db);
    expect(cfg).toEqual(deriveAuditScoring(DEFAULT_PARAMS));
  });
});
