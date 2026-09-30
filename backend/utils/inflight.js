/**
 * Basic in-flight dedup -- no timeout (caller must set a sensible outer timeout).
 */
function withInFlight(map, key, factory) {
  const existing = map.get(key);
  if (existing) return existing;
  const promise = (async () => factory())();
  map.set(key, promise);
  return promise.finally(() => {
    if (map.get(key) === promise) {
      map.delete(key);
    }
  });
}

/**
 * In-flight dedup with a timeout -- a hung upstream call cannot permanently
 * block the cache key. The map entry is always cleaned up in .finally().
 */
function withInFlightTimeout(map, key, factory, timeoutMs = 120_000) {
  const existing = map.get(key);
  if (existing) return existing;

  const promise = Promise.race([
    (async () => factory())(),
    new Promise((_, reject) =>
      setTimeout(
        () =>
          reject(
            new Error(`Backend in-flight request timed out after ${timeoutMs}ms`),
          ),
        timeoutMs,
      ),
    ),
  ]);

  map.set(key, promise);
  promise.finally(() => {
    if (map.get(key) === promise) {
      map.delete(key);
    }
  });
  return promise;
}

module.exports = { withInFlight, withInFlightTimeout };
