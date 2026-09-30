const { AsyncLocalStorage } = require("async_hooks");
const requestCacheStore = new AsyncLocalStorage();

const ENABLE_REQUEST_LOG =
  process.env.REQUEST_LOG === "1" ||
  (process.env.NODE_ENV !== "production" && process.env.REQUEST_LOG !== "0");

function requestLogger(req, res, next) {
  if (!ENABLE_REQUEST_LOG) return next();
  const start = Date.now();
  const method = req.method.padEnd(6, " ");
  const url = req.originalUrl || req.url;

  const store = { cacheEvents: [] };
  requestCacheStore.run(store, () => {
    res.on("finish", () => {
      const ms = Date.now() - start;
      const status = res.statusCode;
      const statusLabel =
        status < 200 || status === 304
          ? "\x1b[90m"
          : status < 300
            ? "\x1b[32m"
            : status < 400
              ? "\x1b[36m"
              : status < 500
                ? "\x1b[33m"
                : "\x1b[31m";
      const reset = "\x1b[0m";

      let cacheTag = "";
      if (store.cacheEvents.length > 0) {
        const parts = store.cacheEvents.map(
          ([evt, prefix]) =>
            `${evt === "HIT" ? "\x1b[32mH\x1b[0m" : evt === "MISS" ? "\x1b[33mM\x1b[0m" : "\x1b[34mS\x1b[0m"}:${prefix}`,
        );
        cacheTag = " \x1b[2m|\x1b[0m " + parts.join(" ");
      }

      console.log(
        `\x1b[2m[${new Date().toLocaleTimeString()}]\x1b[0m ` +
          `${method}${url.slice(0, 120)} ` +
          `${statusLabel}${status}${reset} ` +
          `\x1b[2m${ms}ms\x1b[0m${cacheTag}`,
      );
    });
    next();
  });
}

/**
 * @param {'HIT'|'MISS'|'SET'} event
 * @param {string} key
 */
function recordCacheEvent(event, key) {
  const store = requestCacheStore.getStore();
  if (!store) return;
  if (!Array.isArray(store.cacheEvents)) store.cacheEvents = [];
  const prefix = key.replace(/:.*$/, "");
  const already = store.cacheEvents.some((e) => e[0] === event && e[1] === prefix);
  if (already) return;
  if (store.cacheEvents.length >= 8) return;
  store.cacheEvents.push([event, prefix]);
}

/**
 * Middleware: attaches req._serverCache reference and usage info to JSON responses.
 */
function attachUsageInfo(req, res, next) {
  const originalJson = res.json.bind(res);
  res.json = function (body) {
    if (req.usageInfo && body && typeof body === "object" && !Array.isArray(body) && !body._usage) {
      body._usage = {
        used: req.usageInfo.used,
        limit: req.usageInfo.limit,
        pageKey: req.usageInfo.pageKey,
      };
    }
    return originalJson(body);
  };
  next();
}

module.exports = { requestLogger, recordCacheEvent, attachUsageInfo, requestCacheStore };
