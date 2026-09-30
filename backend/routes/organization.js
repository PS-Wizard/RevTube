const express = require("express");
const { createOrgAnalyticsService } = require("../services/orgAnalyticsService");

function createOrganizationRouter(deps) {
  const {
    db, getCachedUser, deleteCachedOrgMembership, queueService,
    serverCache, getCachedOrgMembership, query, isPostgresConfigured,
    withInFlightTimeout, resolveUser,
  } = deps;
  const router = express.Router();
  const orgAnalyticsService = createOrgAnalyticsService({
    db, serverCache, getCachedOrgMembership, query, isPostgresConfigured,
    withInFlightTimeout,
  });

  // ── Org-wide analytics (cross-channel comparison, postgres read models) ────
  // GET /organization/analytics?orgId=...&period=7d|30d|90d|custom&start=YYYY-MM-DD&end=YYYY-MM-DD
  router.get("/analytics", resolveUser, async (req, res) => {
    try {
      const { orgId, period, start, end } = req.query;
      if (!orgId) {
        return res.status(400).json({ error: { message: "Missing orgId query parameter" } });
      }
      const result = await orgAnalyticsService.getOrgAnalytics({
        orgId: String(orgId),
        uid: req.authUser?.uid,
        period: String(period || "30d"),
        start: start ? String(start) : undefined,
        end: end ? String(end) : undefined,
      });
      return res.json(result);
    } catch (error) {
      if (error.statusCode === 403 || error.statusCode === 401 || error.statusCode === 400) {
        return res.status(error.statusCode).json({ error: { message: error.message } });
      }
      console.error("[OrgAnalytics] Error:", error.message);
      return res.status(500).json({ error: { message: error.message } });
    }
  });

  // Invalidate org membership cache after member removal / org deletion
  router.post("/invalidate-member", async (req, res) => {
    try {
      const { organizationId, userId } = req.body;
      if (!organizationId || !userId) {
        return res.status(400).json({ error: { message: "Missing organizationId or userId" } });
      }

      const requestingUid = req.authUser?.uid;

      // Allow if: requester is the user being removed (leave org),
      // OR requester is an org owner/admin, OR requester is a system admin.
      const isSelf = requestingUid === userId;
      let isOrgManager = false;
      if (!isSelf) {
        try {
          const requesterMemberDoc = await db
            .collection("organizations")
            .doc(String(organizationId))
            .collection("members")
            .doc(requestingUid)
            .get();
          const role = requesterMemberDoc.data()?.role;
          isOrgManager = role === "owner" || role === "admin";
        } catch {
          // fall through -- deny
        }
        // Also allow system admins
        if (!isOrgManager) {
          const userRecord = await getCachedUser(req.authUser?.email);
          isOrgManager = userRecord?.role === "admin";
        }
      }

      if (!isSelf && !isOrgManager) {
        return res.status(403).json({
          error: { message: "Not authorized to invalidate this membership cache." },
        });
      }

      await deleteCachedOrgMembership(String(organizationId), String(userId));
      res.json({ success: true });
    } catch (error) {
      console.error("[invalidate-member] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Send Organization Invitation Email
  router.post("/send-invitation", async (req, res) => {
    try {
      const { organizationId, organizationName, inviteeEmail, role, token } = req.body;
      const inviterEmail = req.authUser?.email;

      if (!organizationId || !organizationName || !inviteeEmail || !role || !token) {
        return res.status(400).json({
          error: {
            message: "Missing required fields: organizationId, organizationName, inviteeEmail, role, token",
          },
        });
      }

      await queueService.enqueueEmail('sendInvitationEmail', {
        organizationId, organizationName, inviteeEmail, inviterEmail, role, token,
      });

      res.json({
        success: true,
        message: "Invitation email queued for delivery",
      });
    } catch (error) {
      console.error("[Invitation Email] Error:", error);
      res.status(500).json({
        error: {
          message: "Failed to queue invitation email",
          details: error.message,
        },
      });
    }
  });

  // Send Ownership Transfer Email
  router.post("/send-ownership-transfer", async (req, res) => {
    try {
      const { organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token } = req.body;

      if (!organizationId || !organizationName || !newOwnerEmail || !currentOwnerEmail || !token) {
        return res.status(400).json({
          error: {
            message: "Missing required fields: organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token",
          },
        });
      }

      await queueService.enqueueEmail('sendOwnershipTransferEmail', {
        organizationId, organizationName, newOwnerEmail, currentOwnerEmail, token,
      });

      res.json({
        success: true,
        message: "Ownership transfer email queued for delivery",
      });
    } catch (error) {
      console.error("[Ownership Transfer Email] Error:", error);
      res.status(500).json({
        error: {
          message: "Failed to queue ownership transfer email",
          details: error.message,
        },
      });
    }
  });

  return router;
}

module.exports = { createOrganizationRouter };
