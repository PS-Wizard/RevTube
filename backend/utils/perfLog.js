const PERF_LOG_ENABLED = process.env.PERF_LOG === "1";

const perfNow = () => Date.now();

const perfLog = (label, startedAt, extra = undefined) => {
  if (!PERF_LOG_ENABLED) return;
  const durationMs = perfNow() - startedAt;
  if (extra !== undefined) {
    console.log(`[Perf] ${label}: ${durationMs}ms`, extra);
  } else {
    console.log(`[Perf] ${label}: ${durationMs}ms`);
  }
};

module.exports = { perfLog, perfNow, PERF_LOG_ENABLED };
