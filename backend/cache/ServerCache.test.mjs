import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import ServerCache from "./ServerCache.js";

beforeEach(() => {
  delete process.env.REDIS_URL; // always exercise the in-memory path
  process.env.DISABLE_COMPRESSION = ""; // keep compression enabled for round-trip tests
});

afterEach(() => {
  vi.useRealTimers();
});

describe("ServerCache (in-memory)", () => {
  it("stores and retrieves a value", async () => {
    const cache = new ServerCache();
    await cache.set("k", "v");
    expect(await cache.get("k")).toBe("v");
  });

  it("returns null for a missing key and records a miss", async () => {
    const cache = new ServerCache();
    expect(await cache.get("missing")).toBeNull();
    expect(cache.metrics.misses).toBe(1);
  });

  it("expires entries after their TTL", async () => {
    vi.useFakeTimers();
    const cache = new ServerCache();
    await cache.set("k", "v", 1000);
    vi.advanceTimersByTime(1500);
    expect(await cache.get("k")).toBeNull();
  });

  it("keeps entries before TTL expiry", async () => {
    vi.useFakeTimers();
    const cache = new ServerCache();
    await cache.set("k", "v", 1000);
    vi.advanceTimersByTime(500);
    expect(await cache.get("k")).toBe("v");
  });

  it("evicts the oldest entry at maxSize (LRU)", async () => {
    const cache = new ServerCache(2, 60 * 1000);
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.set("c", 3);
    expect(await cache.get("a")).toBeNull();
    expect(await cache.get("b")).toBe(2);
    expect(await cache.get("c")).toBe(3);
  });

  it("supports has()", async () => {
    const cache = new ServerCache();
    await cache.set("k", "v");
    expect(await cache.has("k")).toBe(true);
    expect(await cache.has("missing")).toBe(false);
  });

  it("deletes a single key", async () => {
    const cache = new ServerCache();
    await cache.set("k", "v");
    await cache.delete("k");
    expect(await cache.get("k")).toBeNull();
  });

  it("clears all entries", async () => {
    const cache = new ServerCache();
    await cache.set("a", 1);
    await cache.set("b", 2);
    await cache.clear();
    expect(cache.size()).toBe(0);
  });

  it("deletes keys containing a substring", async () => {
    const cache = new ServerCache();
    await cache.set("dashSummary:x", 1);
    await cache.set("dashSummary:y", 2);
    await cache.set("other", 3);
    const deleted = await cache.deleteKeysContaining("dashSummary:");
    expect(deleted).toBe(2);
    expect(await cache.get("dashSummary:x")).toBeNull();
    expect(await cache.get("other")).toBe(3);
  });

  it("compresses large object values and round-trips them", async () => {
    const cache = new ServerCache();
    const big = { data: "x".repeat(5000), nested: { arr: [1, 2, 3] } };
    await cache.set("big", big);
    const out = await cache.get("big");
    expect(out).toEqual(big);
    expect(cache.metrics.compressions).toBe(1);
    expect(cache.metrics.decompressions).toBe(1);
  });

  it("does not compress small values", async () => {
    const cache = new ServerCache();
    await cache.set("small", { a: 1 });
    expect(cache.metrics.compressions).toBe(0);
  });

  it("reports metrics with hit rate and compression ratio", async () => {
    const cache = new ServerCache();
    await cache.set("big", { data: "y".repeat(3000) });
    await cache.get("big");
    const m = cache.getMetrics();
    expect(m.hits).toBe(1);
    expect(m.misses).toBe(0);
    expect(m.hitRate).toBe("100.0%");
    expect(m.compressionRatio).toMatch(/%$/);
  });

  describe("setIfAbsent (idempotency)", () => {
    it("sets the value on first call and returns true", async () => {
      const cache = new ServerCache();
      const won = await cache.setIfAbsent("lock:1", true, 60_000);
      expect(won).toBe(true);
      expect(await cache.get("lock:1")).toBe(true);
    });

    it("returns false and does not overwrite on a second call (in-memory)", async () => {
      const cache = new ServerCache();
      expect(await cache.setIfAbsent("lock:2", "first", 60_000)).toBe(true);
      expect(await cache.setIfAbsent("lock:2", "second", 60_000)).toBe(false);
      expect(await cache.get("lock:2")).toBe("first");
    });
  });
});
