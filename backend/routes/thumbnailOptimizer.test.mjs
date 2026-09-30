import { describe, it, expect } from "vitest";
import { applyFocusDefaults } from "./thumbnailOptimizer.js";

describe("applyFocusDefaults", () => {
  it("fills blanks from the saved focus", () => {
    expect(
      applyFocusDefaults(
        { niche: "", targetAudience: "", brandVoice: "" },
        { niche: "Tech", audience: "Devs", tone: "Direct" },
      ),
    ).toEqual({ niche: "Tech", targetAudience: "Devs", brandVoice: "Direct" });
  });

  it("explicit user input always wins over focus", () => {
    expect(
      applyFocusDefaults(
        { niche: "Typed", targetAudience: "", brandVoice: "Typed voice" },
        { niche: "Focus", audience: "Focus audience", tone: "Focus tone" },
      ),
    ).toEqual({ niche: "Typed", targetAudience: "Focus audience", brandVoice: "Typed voice" });
  });

  it("returns blanks when neither input nor focus exists", () => {
    expect(applyFocusDefaults({}, null)).toEqual({ niche: "", targetAudience: "", brandVoice: "" });
    expect(applyFocusDefaults(undefined, undefined)).toEqual({ niche: "", targetAudience: "", brandVoice: "" });
  });
});
