const express = require("express");

function createCustomDashboardsRouter(deps) {
  const { customDashboardService, authenticateRequest } = deps;
  const router = express.Router();

  // GET /api/custom-dashboards?orgId=&name= -- one layout (null when unsaved).
  // `supported: false` tells the client Postgres is unavailable so it can
  // fall back to its local mirror instead of erroring the page.
  router.get("/", authenticateRequest, async (req, res) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return res.status(401).json({ error: { message: "Missing authenticated user" } });
    }
    try {
      const orgId = typeof req.query.orgId === "string" ? req.query.orgId : "";
      const name = typeof req.query.name === "string" ? req.query.name : "default";
      const { supported, layout } = await customDashboardService.getLayout(uid, orgId, name);
      return res.json({ layout, supported });
    } catch (error) {
      console.error("[Custom Dashboards GET] ERROR:", error.message);
      const status = error.status === 403 ? 403 : 500;
      return res.status(status).json({ error: { message: error.message } });
    }
  });

  // PUT /api/custom-dashboards -- upsert one layout (sanitized server-side).
  router.put("/", authenticateRequest, async (req, res) => {
    const uid = req.authUser?.uid;
    if (!uid) {
      return res.status(401).json({ error: { message: "Missing authenticated user" } });
    }
    try {
      const orgId = typeof req.body?.orgId === "string" ? req.body.orgId : "";
      const name = typeof req.body?.name === "string" ? req.body.name : "default";
      const layout = await customDashboardService.saveLayout(uid, orgId, name, req.body?.layout);
      return res.json({ layout, supported: true });
    } catch (error) {
      console.error("[Custom Dashboards PUT] ERROR:", error.message);
      if (error.status === 403) {
        return res.status(403).json({ error: { message: error.message } });
      }
      if (error.status === 503) {
        return res.status(503).json({ error: { message: "Could not save dashboard layout" } });
      }
      return res.status(500).json({ error: { message: error.message } });
    }
  });

  return router;
}

module.exports = { createCustomDashboardsRouter };
