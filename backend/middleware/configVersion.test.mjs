import { describe, it, expect, vi } from "vitest";
import configVersion from "./configVersion.js";

const { createConfigVersionMiddleware } = configVersion;

function makeMiddleware({ liveVersion = 2, cachedVersion = 0, keys = [] } = {}) {
  const cacheStore = new Map(keys.map((k) => [k, { value: 1 }]));
  const serverCache = {
    cache: cacheStore,
    delete: vi.fn(async (key) => {
      cacheStore.delete(key);
    }),
  };
  const getConfigVersion = vi.fn(async () => liveVersion);
  const invalidateFeatureConfigCache = vi.fn();
  const { checkConfigVersion } = createConfigVersionMiddleware({
    getConfigVersion,
    serverCache,
    PERF_LOG_ENABLED: false,
    invalidateFeatureConfigCache,
  });
  return { checkConfigVersion, getConfigVersion, serverCache, invalidateFeatureConfigCache, cacheStore };
}

function makeReq(version = 0) {
  return { configVersion: version };
}

describe("checkConfigVersion", () => {
  it("invalidates analytics cache keys when the version bumps", async () => {
    const { checkConfigVersion, serverCache, invalidateFeatureConfigCache } = makeMiddleware({
      liveVersion: 2,
      cachedVersion: 1,
      keys: ["dashSummary:a", "dashSnap:b", "snapshot:c", "yt:ytan:report:d", "bundle:e", "unrelated"],
    });

    const req = makeReq(1);
    const next = vi.fn();
    await checkConfigVersion(req, {}, next);

    for (const k of ["dashSummary:a", "dashSnap:b", "snapshot:c", "yt:ytan:report:d", "bundle:e"]) {
      expect(serverCache.delete).toHaveBeenCalledWith(k);
    }
    // non-analytics keys are not invalidated
    expect(serverCache.delete).not.toHaveBeenCalledWith("unrelated");
    expect(invalidateFeatureConfigCache).toHaveBeenCalled();
    expect(req.configVersion).toBe(2);
    expect(next).toHaveBeenCalled();
  });

  it("does nothing when the version is unchanged", async () => {
    const { checkConfigVersion, serverCache, invalidateFeatureConfigCache } = makeMiddleware({
      liveVersion: 2,
      cachedVersion: 2,
      keys: ["dashSummary:a"],
    });

    const req = makeReq(2);
    const next = vi.fn();
    await checkConfigVersion(req, {}, next);

    expect(serverCache.delete).not.toHaveBeenCalled();
    expect(invalidateFeatureConfigCache).not.toHaveBeenCalled();
    expect(req.configVersion).toBe(2);
    expect(next).toHaveBeenCalled();
  });

  it("swallows config version read errors and still calls next", async () => {
    const { checkConfigVersion } = createConfigVersionMiddleware({
      getConfigVersion: vi.fn(async () => {
        throw new Error("boom");
      }),
      serverCache: { cache: new Map(), delete: vi.fn() },
      PERF_LOG_ENABLED: false,
      invalidateFeatureConfigCache: vi.fn(),
    });

    const req = makeReq();
    const next = vi.fn();
    await checkConfigVersion(req, {}, next);
    expect(next).toHaveBeenCalled();
  });
});
