const express = require('express');

function createGoalsRouter(deps) {
  const { goalsService, analyticsReadLimiter, resolveUser, handleApiError } = deps;
  const router = express.Router();

  // GET /api/goals - List all goals for a channel with real-time pacing
  router.get('/', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { channelId, organizationId } = req.query;
      if (!channelId) {
        return res.status(400).json({ error: { message: 'Missing channelId query parameter' } });
      }

      const goals = await goalsService.listGoals(String(channelId), organizationId ? String(organizationId) : null);
      res.json({ goals });
    } catch (error) {
      console.error('[Goals GET] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // GET /api/goals/summary - High-level goals overview for dashboard widget
  router.get('/summary', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { channelId, organizationId } = req.query;
      if (!channelId) {
        return res.status(400).json({ error: { message: 'Missing channelId query parameter' } });
      }

      const summary = await goalsService.getGoalsSummary(String(channelId), organizationId ? String(organizationId) : null);
      res.json(summary);
    } catch (error) {
      console.error('[Goals Summary GET] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // GET /api/goals/:id - Get specific goal details
  router.get('/:id', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { id } = req.params;
      const goal = await goalsService.getGoalById(id);
      if (!goal) {
        return res.status(404).json({ error: { message: 'Goal not found' } });
      }
      res.json({ goal });
    } catch (error) {
      console.error('[Goals GET :id] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // POST /api/goals - Create a new goal (Editors, Admins, Owners, Personal owners)
  router.post('/', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const {
        channelId,
        organizationId,
        title,
        metric,
        periodType,
        periodKey,
        startDate,
        endDate,
        targetValue,
        notes,
      } = req.body;

      if (!channelId || !metric || !periodType || !startDate || !endDate || targetValue === undefined) {
        return res.status(400).json({
          error: { message: 'Missing required fields: channelId, metric, periodType, startDate, endDate, targetValue' },
        });
      }

      const canManage = await goalsService.canManageGoals(req.authUser, organizationId);
      if (!canManage) {
        return res.status(403).json({
          error: { message: 'Forbidden: Insufficient permissions to create goals in this organization' },
        });
      }

      const goal = await goalsService.createGoal({
        channelId,
        organizationId: organizationId || null,
        createdBy: req.authUser?.uid || 'anonymous',
        title,
        metric,
        periodType,
        periodKey,
        startDate,
        endDate,
        targetValue,
        notes,
      });

      res.status(201).json({ goal });
    } catch (error) {
      console.error('[Goals POST] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // PUT /api/goals/:id - Update an existing goal
  router.put('/:id', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await goalsService.getGoalById(id);
      if (!existing) {
        return res.status(404).json({ error: { message: 'Goal not found' } });
      }

      const canManage = await goalsService.canManageGoals(req.authUser, existing.organizationId);
      if (!canManage) {
        return res.status(403).json({
          error: { message: 'Forbidden: Insufficient permissions to update this goal' },
        });
      }

      const updated = await goalsService.updateGoal(id, req.body);
      res.json({ goal: updated });
    } catch (error) {
      console.error('[Goals PUT] Error:', error.message);
      handleApiError(error, res);
    }
  });

  // DELETE /api/goals/:id - Delete an existing goal
  router.delete('/:id', analyticsReadLimiter, resolveUser, async (req, res) => {
    try {
      const { id } = req.params;
      const existing = await goalsService.getGoalById(id);
      if (!existing) {
        return res.status(404).json({ error: { message: 'Goal not found' } });
      }

      const canManage = await goalsService.canManageGoals(req.authUser, existing.organizationId);
      if (!canManage) {
        return res.status(403).json({
          error: { message: 'Forbidden: Insufficient permissions to delete this goal' },
        });
      }

      await goalsService.deleteGoal(id);
      res.json({ success: true, message: 'Goal deleted successfully' });
    } catch (error) {
      console.error('[Goals DELETE] Error:', error.message);
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createGoalsRouter };
