import { describe, it, expect } from "vitest";
import featureConfig from "./featureConfig.js";
const { DEFAULT_FEATURE_CONFIG } = featureConfig;

describe("DEFAULT_FEATURE_CONFIG", () => {
  it("includes an audit page key", () => {
    expect(DEFAULT_FEATURE_CONFIG.pages.audit).toBeDefined();
    expect(DEFAULT_FEATURE_CONFIG.pages.audit.freeLimit).toBeGreaterThan(0);
  });
});
