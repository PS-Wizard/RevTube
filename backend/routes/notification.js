// ── Notifications Route -- GET list, PATCH mark read ──
const express = require("express");

function createNotificationRouter(deps) {
  const { resolveUser, handleApiError, notificationService } = deps;
  const router = express.Router();

  // GET /notifications -- list + unread count for the calling user
  router.get("/", resolveUser, async (req, res) => {
    try {
      const result = await notificationService.getNotifications(req.authUser.email);
      res.json(result);
    } catch (error) {
      handleApiError(error, res);
    }
  });

  // PATCH /notifications/:id/read -- mark a single notification read
  router.patch("/:id/read", resolveUser, async (req, res) => {
    try {
      await notificationService.markRead(req.authUser.email, req.params.id);
      res.json({ success: true });
    } catch (error) {
      handleApiError(error, res);
    }
  });

  // PATCH /notifications/read-all -- mark every notification read
  router.patch("/read-all", resolveUser, async (req, res) => {
    try {
      await notificationService.markAllRead(req.authUser.email);
      res.json({ success: true });
    } catch (error) {
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createNotificationRouter };
