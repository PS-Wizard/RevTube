// ── Anomalies Route ────────────────────────────────────────────────────────
// Read: GET /anomalies (latest first), GET /anomalies/series, GET /anomalies/:id
// Actions: POST /anomalies/scan, POST /anomalies/:id/explain (AI), PATCH /anomalies/:id
const express = require("express");
const { METRIC_REGISTRY, METRIC_BY_KEY } = require("../config/anomalyConfig");
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");

const KINDS = ["spike", "dip", "trend"];
const SEVERITIES = ["info", "low", "medium", "high", "critical"];
const STATUSES = ["open", "acknowledged", "dismissed"];
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function parseList(value, allowed) {
  const raw = Array.isArray(value) ? value.join(",") : String(value || "");
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => !allowed.length || allowed.includes(s));
}

function parseDate(value) {
  const s = String(value || "").slice(0, 10);
  return DATE_RE.test(s) ? s : null;
}

function createAnomaliesRouter(deps) {
  const {
    resolveUser,
    checkPremiumAccess,
    requireQuota,
    handleApiError,
    anomalyService,
    analyticsReadLimiter,
  } = deps;
  const ownership = deps.ownership || createChannelOwnershipValidator(deps);
  const router = express.Router();

  const guardService = (res) => {
    if (anomalyService) return true;
    res.status(503).json({ error: { message: "Anomaly detection is unavailable." } });
    return false;
  };

  // GET /anomalies/metrics -- metric catalog for the filter bar (no DB work).
  router.get("/metrics", resolveUser, (req, res) => {
    res.json({
      metrics: METRIC_REGISTRY.map((m) => ({
        key: m.key,
        label: m.label,
        unit: m.unit,
        integer: !!m.integer,
        direction: m.direction,
      })),
      kinds: KINDS,
      severities: SEVERITIES,
      statuses: STATUSES,
    });
  });

  // GET /anomalies -- paged list, newest first. Defaults to the caller's
  // connected channels when no channel filter is supplied.
  router.get("/", analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      if (!guardService(res)) return;
      let channelIds = parseList(req.query.channelId || req.query.channelIds, []);
      if (!channelIds.length && !ownership.isAdminRequest(req)) {
        channelIds = (await ownership.getConnectedChannelIds(req)) || [];
        if (!channelIds.length) {
          return res.json({ items: [], total: 0, counts: { total: 0, critical: 0, high: 0, open: 0 } });
        }
      }
      const result = await anomalyService.getAnomalies({
        channelIds: channelIds.length ? channelIds : undefined,
        metrics: parseList(req.query.metrics || req.query.metric, METRIC_REGISTRY.map((m) => m.key)),
        kinds: parseList(req.query.kinds || req.query.kind, KINDS),
        severities: parseList(req.query.severities || req.query.severity, SEVERITIES),
        statuses: parseList(req.query.statuses || req.query.status, STATUSES),
        from: parseDate(req.query.from),
        to: parseDate(req.query.to),
        minScore: req.query.minScore !== undefined ? Number(req.query.minScore) : undefined,
        limit: req.query.limit,
        offset: req.query.offset,
      });
      res.json(result);
    } catch (error) {
      handleApiError(error, res);
    }
  });

  // GET /anomalies/series -- daily series + expected baseline + markers.
  router.get("/series", analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      if (!guardService(res)) return;
      const channelId = String(req.query.channelId || "").trim();
      if (!channelId) {
        return res.status(400).json({ error: { message: '"channelId" is required.' } });
      }
      const metric = String(req.query.metric || "views");
      if (!METRIC_BY_KEY[metric]) {
        return res.status(400).json({ error: { message: `Unknown metric "${metric}".` } });
      }
      const series = await anomalyService.getSeries({
        channelId,
        metric,
        from: parseDate(req.query.from),
        to: parseDate(req.query.to),
        excludeDismissed: req.query.includeDismissed !== "true",
      });
      res.json(series);
    } catch (error) {
      handleApiError(error, res);
    }
  });

  // POST /anomalies/scan -- run detection now for one channel. The statistics
  // are DB-only; the optional AI auto-explain is capped inside the service.
  router.post(
    "/scan",
    analyticsReadLimiter,
    resolveUser,
    checkPremiumAccess("anomalies"),
    requireQuota("anomalies"),
    async (req, res) => {
      try {
        if (!guardService(res)) return;
        const channelId = String(req.body?.channelId || "").trim();
        if (!channelId) {
          return res.status(400).json({ error: { message: '"channelId" is required.' } });
        }
        const owned = new Set((await ownership.getConnectedChannelIds(req)) || []);
        if (!owned.has(channelId)) {
          return res.status(403).json({ error: { message: "Channel is not from your connected channels." } });
        }
        const result = await anomalyService.scanChannel(channelId, {
          days: req.body?.days,
          organizationId: req.orgId || null,
          notifyUserId: req.authUser?.email,
          autoExplain: req.body?.autoExplain !== false,
        });
        res.json(result);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // POST /anomalies/:id/explain -- AI explanation, cached on the row; falls back
  // to the deterministic rule-based text when AI is unavailable or fails.
  router.post(
    "/:id/explain",
    resolveUser,
    checkPremiumAccess("anomalies"),
    requireQuota("anomalies"),
    async (req, res) => {
      try {
        if (!guardService(res)) return;
        const id = Number(req.params.id);
        if (!Number.isInteger(id) || id <= 0) {
          return res.status(400).json({ error: { message: "Invalid anomaly id." } });
        }
        const refresh = req.query.refresh === "true" || req.body?.refresh === true;
        const result = await anomalyService.explainAnomaly(id, { refresh });
        if (!result) return res.status(404).json({ error: { message: "Anomaly not found." } });
        res.json(result);
      } catch (error) {
        handleApiError(error, res);
      }
    },
  );

  // GET /anomalies/:id -- single anomaly with evidence + cached AI explanation.
  router.get("/:id", analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      if (!guardService(res)) return;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: { message: "Invalid anomaly id." } });
      }
      const anomaly = await anomalyService.getAnomaly(id);
      if (!anomaly) return res.status(404).json({ error: { message: "Anomaly not found." } });
      res.json({ anomaly });
    } catch (error) {
      handleApiError(error, res);
    }
  });

  // PATCH /anomalies/:id -- acknowledge / dismiss / reopen.
  router.patch("/:id", resolveUser, async (req, res) => {
    try {
      if (!guardService(res)) return;
      const id = Number(req.params.id);
      const status = String(req.body?.status || "");
      if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: { message: "Invalid anomaly id." } });
      }
      if (!STATUSES.includes(status)) {
        return res.status(400).json({ error: { message: `"status" must be one of ${STATUSES.join(", ")}.` } });
      }
      const updated = await anomalyService.setStatus(id, status);
      if (!updated) return res.status(404).json({ error: { message: "Anomaly not found." } });
      res.json({ success: true, id, status });
    } catch (error) {
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createAnomaliesRouter, KINDS, SEVERITIES, STATUSES, parseList, parseDate };
