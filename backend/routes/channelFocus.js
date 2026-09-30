const express = require('express');

function createChannelFocusRouter(deps) {
  const {
    channelFocusService, analyticsReadLimiter, resolveUser, handleApiError,
    requireQuota, consumeQuota,
  } = deps;
  const router = express.Router();
  const resolveOrgToken = deps.resolveOrgToken || (() => (req, res, next) => next());
  // channelId arrives in the body for PUT/POST — resolve the org token from there.
  const orgTokenFromBody = resolveOrgToken((req) => req.body?.channelId);
  const quotaGate = typeof requireQuota === 'function'
    ? requireQuota('channel')
    : ((req, res, next) => next());

  const orgOf = (req) => {
    const q = req.query.organizationId;
    const b = req.body?.organizationId;
    const h = req.headers['x-org-id'];
    return q || b || h || null;
  };

  // GET /api/channel-focus?channelId=&organizationId= — read focus (personal or org)
  router.get('/', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { channelId } = req.query;
      if (!channelId) {
        return res.status(400).json({ error: { message: 'Missing channelId query parameter' } });
      }
      const organizationId = orgOf(req);
      const allowed = await channelFocusService.canRead(req.authUser, organizationId);
      if (!allowed) {
        return res.status(403).json({ error: { message: 'Forbidden: not a member of this organization' } });
      }
      const focus = await channelFocusService.getFocus(String(channelId), organizationId);
      res.json({ focus });
    } catch (error) {
      console.error('[ChannelFocus GET] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // PUT /api/channel-focus — create/update focus (editors+ in org, anyone in personal)
  router.put('/', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { channelId } = req.body || {};
      if (!channelId) {
        return res.status(400).json({ error: { message: 'Missing channelId' } });
      }
      const organizationId = orgOf(req);
      const allowed = await channelFocusService.canManage(req.authUser, organizationId);
      if (!allowed) {
        return res.status(403).json({ error: { message: 'Forbidden: insufficient permissions to edit focus in this organization' } });
      }
      const focus = await channelFocusService.upsertFocus({
        ...req.body,
        channelId: String(channelId),
        organizationId,
        createdBy: req.authUser?.uid || 'anonymous',
      });
      res.json({ focus });
    } catch (error) {
      console.error('[ChannelFocus PUT] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // POST /api/channel-focus/generate — AI first draft (preview, never saves).
  // Enriches from Postgres analytics first (free); only falls back to a live
  // channel+videos+playlists audit bundle when the catalog is empty — and only
  // that live path consumes YouTube quota (billable).
  router.post('/generate', analyticsReadLimiter, resolveUser, orgTokenFromBody, quotaGate, async (req, res) => {
    try {
      const { channelId, channelSnapshot } = req.body || {};
      if (!channelId) {
        return res.status(400).json({ error: { message: 'Missing channelId' } });
      }
      const organizationId = orgOf(req);
      const allowed = await channelFocusService.canRead(req.authUser, organizationId);
      if (!allowed) {
        return res.status(403).json({ error: { message: 'Forbidden: not a member of this organization' } });
      }
      const generated = await channelFocusService.generateFocus({
        channelId: String(channelId),
        authHeader: req.headers.authorization,
        snapshot: channelSnapshot || {},
      });
      if (generated.fetchedLive && typeof consumeQuota === 'function') {
        await consumeQuota(req, { billable: true });
      }
      const { fetchedLive: _live, ...preview } = generated;
      res.json({ generated: preview });
    } catch (error) {
      console.error('[ChannelFocus Generate POST] Error:', error.message);
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createChannelFocusRouter };
