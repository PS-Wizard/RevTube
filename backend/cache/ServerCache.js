const zlib = require("zlib");
const { promisify } = require("util");
const gzip = promisify(zlib.gzip);
const gunzip = promisify(zlib.gunzip);

/**
 * Record a cache event on the async-local-storage store (if present).
 * Imported by index.js; used inside ServerCache methods.
 * @param {'HIT'|'MISS'|'SET'} event
 * @param {string} key  Shortened key snippet
 */
let _recordCacheEvent = () => {};

function recordCacheEvent(event, key) {
  _recordCacheEvent(event, key);
}

/** Wire up the event recorder (called once by index.js during boot). */
function setCacheEventRecorder(fn) {
  _recordCacheEvent = fn;
}

class ServerCache {
  constructor(maxSize = 1000, defaultTTL = 12 * 60 * 60 * 1000) {
    this.cache = new Map();
    this.maxSize = maxSize;
    this.defaultTTL = defaultTTL;
    this.redisClient = null;
    this.useRedis = false;
    this.compressionEnabled = process.env.DISABLE_COMPRESSION !== "1";

    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      compressions: 0,
      decompressions: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      compressionErrors: 0,
      decompressionErrors: 0,
    };

    if (process.env.REDIS_URL) {
      this.initRedis();
    }
  }

  getMetrics() {
    const compressionRatio =
      this.metrics.totalCompressedSize > 0
        ? (
            (1 -
              this.metrics.totalCompressedSize /
                this.metrics.totalOriginalSize) *
            100
          ).toFixed(1)
        : 0;
    const hitRate =
      this.metrics.hits + this.metrics.misses > 0
        ? (
            (this.metrics.hits / (this.metrics.hits + this.metrics.misses)) *
            100
          ).toFixed(1)
        : 0;

    return {
      ...this.metrics,
      compressionRatio: `${compressionRatio}%`,
      hitRate: `${hitRate}%`,
      cacheSize: this.cache.size,
      averageCompressedSize:
        this.metrics.compressions > 0
          ? Math.round(
              this.metrics.totalCompressedSize / this.metrics.compressions,
            )
          : 0,
    };
  }

  async initRedis() {
    try {
      const redis = require("redis");
      this.redisClient = redis.createClient({
        url: process.env.REDIS_URL,
        socket: {
          reconnectStrategy: (retries) => {
            if (retries > 10) {
              console.error(
                "[Cache] Redis reconnection failed, falling back to in-memory",
              );
              this.useRedis = false;
              return new Error("Redis reconnection limit exceeded");
            }
            return Math.min(retries * 100, 3000);
          },
        },
      });

      this.redisClient.on("error", (err) => {
        console.error("[Cache] Redis error:", err.message);
        this.useRedis = false;
      });

      this.redisClient.on("connect", () => {
        console.log("[Cache] Redis connected successfully");
        this.useRedis = true;
      });

      await this.redisClient.connect();
    } catch (err) {
      console.warn(
        "[Cache] Redis not available, using in-memory cache:",
        err.message,
      );
      this.useRedis = false;
    }
  }

  async set(key, value, ttl = this.defaultTTL) {
    this.metrics.sets++;
    recordCacheEvent("SET", key);
    let dataToStore = value;
    let originalSize = 0;
    let compressedSize = 0;

    if (this.compressionEnabled && value && typeof value === "object") {
      try {
        const jsonStr = JSON.stringify(value);
        originalSize = Buffer.byteLength(jsonStr, "utf8");

        if (originalSize > 1024) {
          const compressed = await gzip(jsonStr);
          compressedSize = compressed.length;
          dataToStore = {
            __compressed: true,
            __originalSize: originalSize,
            data: compressed.toString("base64"),
          };
          this.metrics.compressions++;
          this.metrics.totalOriginalSize += originalSize;
          this.metrics.totalCompressedSize += compressedSize;
        }
      } catch (err) {
        console.warn("[Cache] Compression failed for key", key, ":", err.message);
        this.metrics.compressionErrors++;
        dataToStore = value;
      }
    }

    if (this.useRedis && this.redisClient) {
      try {
        const ttlSeconds = Math.floor(ttl / 1000);
        await this.redisClient.setEx(
          key,
          ttlSeconds,
          JSON.stringify(dataToStore),
        );
        if (process.env.PERF_LOG === "1") {
          const ratio =
            originalSize > 0
              ? ((1 - compressedSize / originalSize) * 100).toFixed(1)
              : 0;
          console.log(
            `[Cache] Redis SET: ${key.slice(0, 50)}... (orig: ${originalSize}B, comp: ${compressedSize}B, ratio: ${ratio}%)`,
          );
        }
        return;
      } catch (err) {
        console.warn("[Cache] Redis set failed, falling back to in-memory:", err.message);
        this.useRedis = false;
      }
    }

    if (this.cache.size >= this.maxSize) {
      const firstKey = this.cache.keys().next().value;
      this.cache.delete(firstKey);
    }

    this.cache.set(key, {
      value: dataToStore,
      expiresAt: Date.now() + ttl,
    });
  }

  async get(key) {
    if (this.useRedis && this.redisClient) {
      try {
        const data = await this.redisClient.get(key);
        if (data) {
          const parsed = JSON.parse(data);

          if (parsed.__compressed) {
            try {
              this.metrics.decompressions++;
              const decompressed = await gunzip(Buffer.from(parsed.data, "base64"));
              const result = JSON.parse(decompressed.toString("utf8"));
              this.metrics.hits++;
              recordCacheEvent("HIT", key);
              return result;
            } catch (err) {
              console.warn("[Cache] Decompression failed for key", key, ":", err.message);
              this.metrics.decompressionErrors++;
              return null;
            }
          }

          this.metrics.hits++;
          recordCacheEvent("HIT", key);
          return parsed;
        }
        this.metrics.misses++;
        recordCacheEvent("MISS", key);
        return null;
      } catch (err) {
        console.warn("[Cache] Redis get failed, falling back to in-memory:", err.message);
        this.useRedis = false;
      }
    }

    const entry = this.cache.get(key);
    if (!entry) {
      this.metrics.misses++;
      return null;
    }

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      this.metrics.misses++;
      return null;
    }

    this.cache.delete(key);
    this.cache.set(key, entry);

    const value = entry.value;
    if (value && value.__compressed) {
      try {
        this.metrics.decompressions++;
        const decompressed = await gunzip(Buffer.from(value.data, "base64"));
        const result = JSON.parse(decompressed.toString("utf8"));
        this.metrics.hits++;
        recordCacheEvent("HIT", key);
        return result;
      } catch (err) {
        console.warn("[Cache] Decompression failed for key", key, ":", err.message);
        this.metrics.decompressionErrors++;
        return null;
      }
    }

    this.metrics.hits++;
    recordCacheEvent("HIT", key);
    return value;
  }

  async has(key) {
    const value = await this.get(key);
    return value !== null;
  }

  /**
   * Atomic set-if-absent (Redis `SET key value NX EX ttl`). Returns true if the
   * key was set (caller won), false if it already existed. Used to make
   * once-per-job side effects idempotent across multiple backend workers/pods.
   * In-memory fallback uses a check-then-set (single-process safe).
   */
  async setIfAbsent(key, value, ttlMs = this.defaultTTL) {
    if (this.useRedis && this.redisClient) {
      try {
        const ttlSeconds = Math.max(1, Math.floor(ttlMs / 1000));
        const res = await this.redisClient.set(key, JSON.stringify(value), { NX: true, EX: ttlSeconds });
        return res === "OK";
      } catch (err) {
        console.warn("[Cache] Redis setIfAbsent failed, falling back to in-memory:", err.message);
        this.useRedis = false;
      }
    }
    const existing = await this.get(key);
    if (existing !== null) return false;
    await this.set(key, value, ttlMs);
    return true;
  }

  async delete(key) {
    if (this.useRedis && this.redisClient) {
      try {
        await this.redisClient.del(key);
      } catch (err) {
        console.warn("[Cache] Redis delete failed:", err.message);
      }
    }
    this.cache.delete(key);
  }

  async clear() {
    if (this.useRedis && this.redisClient) {
      try {
        await this.redisClient.flushDb();
      } catch (err) {
        console.warn("[Cache] Redis clear failed:", err.message);
      }
    }
    this.cache.clear();
    console.log("[Cache] Cache cleared");
  }

  /**
   * Delete all cache entries whose keys contain the given substring.
   * For Redis: uses SCAN (not KEYS) to find matching keys and bulk-DEL.
   * For in-memory: iterates and deletes matching entries.
   */
  async deleteKeysContaining(substr) {
    if (!substr) return;
    let deletedCount = 0;

    if (this.useRedis && this.redisClient) {
      try {
        // SCAN with COUNT 100 to avoid blocking Redis
        let cursor = 0;
        const keysToDelete = [];
        do {
          const res = await this.redisClient.scan(cursor, { MATCH: `*${substr}*`, COUNT: 100 });
          cursor = res.cursor;
          keysToDelete.push(...res.keys);
        } while (cursor !== 0);

        if (keysToDelete.length > 0) {
          await this.redisClient.del(keysToDelete);
          deletedCount = keysToDelete.length;
        }
      } catch (err) {
        console.warn(`[Cache] Redis deleteKeysContaining failed for "${substr}":`, err.message);
      }
    }

    // Always clean in-memory cache
    for (const key of this.cache.keys()) {
      if (key.includes(substr)) {
        this.cache.delete(key);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[Cache] Deleted ${deletedCount} keys containing "${substr}"`);
    }
    return deletedCount;
  }

  size() {
    return this.cache.size;
  }

  resetMetrics() {
    this.metrics = {
      hits: 0,
      misses: 0,
      sets: 0,
      compressions: 0,
      decompressions: 0,
      totalOriginalSize: 0,
      totalCompressedSize: 0,
      compressionErrors: 0,
      decompressionErrors: 0,
    };
  }
}

module.exports = ServerCache;
module.exports.setCacheEventRecorder = setCacheEventRecorder;
