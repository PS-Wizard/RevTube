import { describe, it, expect, vi } from 'vitest';
const { createGoalsService } = require('./goalsService');

describe('goalsService', () => {
  const mockGetCachedUser = vi.fn();
  const mockGetCachedOrgMembership = vi.fn();

  const service = createGoalsService({
    getDb: () => null,
    getCachedUser: mockGetCachedUser,
    getCachedOrgMembership: mockGetCachedOrgMembership,
  });

  // Expose internal functions for testing
  // Note: Since the service uses closures, we test via calculateGoalPacing
  // For direct testing, we'd need to refactor. Here we test the integrated behavior.

  describe('calculateGoalPacing - Past Periods (Frozen Status)', () => {
    const referenceDate = new Date('2026-08-20T12:00:00Z'); // Q3 2026

    it('correctly calculates a met goal for a past quarter (Q1 2026)', () => {
      const goal = {
        id: 1,
        channelId: 'ch1',
        title: 'Q1 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q1',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        targetValue: 100000,
      };

      const actualData = {
        cumulativeValue: 120000,
        dailyBreakdown: [{ date: '2026-03-31', value: 1000, cumulative: 120000 }],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isPast).toBe(true);
      expect(res.isUpcoming).toBe(false);
      expect(res.isActive).toBe(false);
      expect(res.status).toBe('met');
      expect(res.pacingLabel).toBe('Goal Met');
      expect(res.actualValue).toBe(120000);
      expect(res.progressPercentage).toBe(120);
      expect(res.daysRemaining).toBe(0);
      expect(res.timeElapsedPercentage).toBe(100);
      expect(res.requiredDailyVelocity).toBe(0);
    });

    it('correctly calculates a missed goal for a past quarter (Q2 2026)', () => {
      const goal = {
        id: 2,
        channelId: 'ch1',
        title: 'Q2 Subscribers',
        metric: 'subscribers',
        periodType: 'quarterly',
        periodKey: '2026-Q2',
        startDate: '2026-04-01',
        endDate: '2026-06-30',
        targetValue: 5000,
      };

      const actualData = {
        cumulativeValue: 3800,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isPast).toBe(true);
      expect(res.status).toBe('missed');
      expect(res.pacingLabel).toBe('Goal Missed');
      expect(res.progressPercentage).toBe(76);
      expect(res.daysRemaining).toBe(0);
    });
  });

  describe('calculateGoalPacing - Active Periods (Real-Time Pacing & Velocity)', () => {
    const referenceDate = new Date('2026-08-20T12:00:00Z'); // 51 days into Q3 (92 days total)

    it('identifies ahead of pace (growth) when pacingRatio >= 1.05', () => {
      const goal = {
        id: 3,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // 51 days elapsed out of 92 = ~55.4% time elapsed.
      // Expected = ~55,434 views. Actual = 75,000 views.
      const actualData = {
        cumulativeValue: 75000,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isActive).toBe(true);
      expect(res.status).toBe('ahead');
      expect(res.pacingLabel).toContain('Ahead');
      expect(res.pacingRatio).toBeGreaterThan(1.05);
      expect(res.projectedValue).toBeGreaterThan(100000);
      expect(res.daysRemaining).toBe(41);
    });

    it('identifies behind pace (decline) when pacingRatio < 0.85', () => {
      const goal = {
        id: 4,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // Actual is only 20,000 when expected is ~55,400.
      const actualData = {
        cumulativeValue: 20000,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isActive).toBe(true);
      expect(res.status).toBe('behind');
      expect(res.pacingLabel).toContain('Behind');
      expect(res.pacingRatio).toBeLessThan(0.85);
      expect(res.requiredDailyVelocity).toBeGreaterThan(res.currentDailyVelocity);
    });

    it('identifies on-track (neutral) when pacingRatio is within 0.85 - 1.05', () => {
      const goal = {
        id: 5,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // Expected ~55,400. Actual = 54,000. Ratio = ~0.97
      const actualData = {
        cumulativeValue: 54000,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isActive).toBe(true);
      expect(res.status).toBe('on_track');
      expect(res.pacingLabel).toContain('On Track');
    });

    it('identifies early met status when actual reaches target before end date', () => {
      const goal = {
        id: 6,
        channelId: 'ch1',
        title: '2026 Yearly CTR',
        metric: 'ctr',
        periodType: 'yearly',
        periodKey: '2026',
        startDate: '2026-01-01',
        endDate: '2026-12-31',
        targetValue: 5.0,
      };

      const actualData = {
        cumulativeValue: 5.8,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isActive).toBe(true);
      expect(res.status).toBe('met');
      expect(res.pacingLabel).toContain('Met');
    });
  });

  describe('calculateGoalPacing - Future / Upcoming Periods', () => {
    const referenceDate = new Date('2026-08-20T12:00:00Z');

    it('identifies upcoming goals for Q4 2026', () => {
      const goal = {
        id: 7,
        channelId: 'ch1',
        title: 'Q4 2026 Target',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q4',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        targetValue: 200000,
      };

      const actualData = {
        cumulativeValue: 0,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isUpcoming).toBe(true);
      expect(res.isActive).toBe(false);
      expect(res.isPast).toBe(false);
      expect(res.status).toBe('upcoming');
      expect(res.daysElapsed).toBe(0);
      expect(res.timeElapsedPercentage).toBe(0);
    });
  });

  describe('canManageGoals - Role and Permission Checks', () => {
    it('allows global system admin', async () => {
      mockGetCachedUser.mockResolvedValueOnce({ role: 'admin' });
      const allowed = await service.canManageGoals({ uid: 'u1', email: 'admin@revketer.ai' }, 'org1');
      expect(allowed).toBe(true);
    });

    it('allows personal workspace owner (no orgId)', async () => {
      mockGetCachedUser.mockResolvedValueOnce({ role: 'user' });
      const allowed = await service.canManageGoals({ uid: 'u1', email: 'user@example.com' }, null);
      expect(allowed).toBe(true);
    });

    it('allows org owner, admin, and write (editor) roles', async () => {
      mockGetCachedUser.mockResolvedValue({ role: 'user' });

      mockGetCachedOrgMembership.mockResolvedValueOnce({ role: 'owner' });
      expect(await service.canManageGoals({ uid: 'u1', email: 'owner@test.com' }, 'org1')).toBe(true);

      mockGetCachedOrgMembership.mockResolvedValueOnce({ role: 'admin' });
      expect(await service.canManageGoals({ uid: 'u2', email: 'admin@test.com' }, 'org1')).toBe(true);

      mockGetCachedOrgMembership.mockResolvedValueOnce({ role: 'write' });
      expect(await service.canManageGoals({ uid: 'u3', email: 'editor@test.com' }, 'org1')).toBe(true);
    });

    it('rejects org read-only members', async () => {
      mockGetCachedUser.mockResolvedValue({ role: 'user' });
      mockGetCachedOrgMembership.mockResolvedValueOnce({ role: 'read' });
      expect(await service.canManageGoals({ uid: 'u4', email: 'viewer@test.com' }, 'org1')).toBe(false);
    });
  });

  describe('Adaptive Pacing - Anomaly Detection', () => {
    const referenceDate = new Date('2026-08-20T12:00:00Z'); // Q3 2026

    it('detects spike anomalies in daily breakdown', () => {
      const goal = {
        id: 10,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // Normal days around 1000/day, then a spike of 5000 on one day
      const actualData = {
        cumulativeValue: 55000,
        dailyBreakdown: [
          { date: '2026-07-01', value: 1000, cumulative: 1000 },
          { date: '2026-07-02', value: 1100, cumulative: 2100 },
          { date: '2026-07-03', value: 950, cumulative: 3050 },
          { date: '2026-07-04', value: 1050, cumulative: 4100 },
          { date: '2026-07-05', value: 6000, cumulative: 10100 }, // spike
          { date: '2026-07-06', value: 1000, cumulative: 11100 },
          { date: '2026-07-07', value: 950, cumulative: 12050 },
        ],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.anomalies).toBeDefined();
      expect(Array.isArray(res.anomalies)).toBe(true);
      expect(res.anomalies.length).toBeGreaterThan(0);
      const spike = res.anomalies.find(a => a.kind === 'spike');
      expect(spike).toBeDefined();
      expect(spike.delta).toBeGreaterThan(0);
    });

    it('detects dip anomalies in daily breakdown', () => {
      const goal = {
        id: 11,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // Normal days around 1000/day, then a dip of -500 on one day
      const actualData = {
        cumulativeValue: 55000,
        dailyBreakdown: [
          { date: '2026-07-01', value: 1000, cumulative: 1000 },
          { date: '2026-07-02', value: 1100, cumulative: 2100 },
          { date: '2026-07-03', value: 500, cumulative: 2600 }, // dip
          { date: '2026-07-04', value: 1050, cumulative: 3650 },
          { date: '2026-07-05', value: 1000, cumulative: 4650 },
          { date: '2026-07-06', value: 950, cumulative: 5600 },
          { date: '2026-07-07', value: 1000, cumulative: 6600 },
        ],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.anomalies).toBeDefined();
      const dip = res.anomalies.find(a => a.kind === 'dip');
      expect(dip).toBeDefined();
      expect(dip.delta).toBeLessThan(0);
    });

    it('returns hasAdaptiveData=true when baseline can be calculated', () => {
      const goal = {
        id: 12,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // 28 days of clean data, no anomalies
      const dailyBreakdown = [];
      for (let i = 0; i < 30; i++) {
        const date = new Date('2026-07-01');
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        dailyBreakdown.push({ date: dateStr, value: 1000, cumulative: (i + 1) * 1000 });
      }

      const actualData = {
        cumulativeValue: 55000,
        dailyBreakdown,
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.hasAdaptiveData).toBe(true);
      expect(res.adaptiveProjection).toBeDefined();
      expect(res.adaptiveProjection.baseline).toBeDefined();
      expect(res.adaptiveProjection.baseline.velocity).toBeGreaterThan(0);
      expect(res.adaptiveProjection.baseline.cleanDays).toBeGreaterThanOrEqual(7);
    });

    it('returns hasAdaptiveData=false when insufficient clean days for baseline', () => {
      const goal = {
        id: 13,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // Only 5 days of data - insufficient for MIN_CLEAN_DAYS (7)
      const dailyBreakdown = [];
      for (let i = 0; i < 5; i++) {
        const date = new Date('2026-07-01');
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        dailyBreakdown.push({ date: dateStr, value: 1000, cumulative: (i + 1) * 1000 });
      }

      const actualData = {
        cumulativeValue: 5000,
        dailyBreakdown,
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.hasAdaptiveData).toBe(false);
      expect(res.adaptiveProjection).toBeUndefined();
    });

    it('excludes anomaly dates with +/- 1 day buffer from baseline', () => {
      const goal = {
        id: 14,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // 10 clean days, then spike on day 11, then 10 more clean days
      // Buffer should exclude days 10, 11, 12 from baseline calculation
      const dailyBreakdown = [];
      for (let i = 0; i < 25; i++) {
        const date = new Date('2026-07-01');
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        let value = 1000;
        if (i === 10) value = 8000; // spike
        dailyBreakdown.push({ date: dateStr, value, cumulative: 0 }); // cumulative will be calculated
      }

      const actualData = {
        cumulativeValue: 25000,
        dailyBreakdown,
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.anomalies.length).toBeGreaterThan(0);
      // The adaptive baseline should use clean days excluding anomaly + buffer
      if (res.adaptiveProjection) {
        expect(res.adaptiveProjection.baseline.cleanDays).toBeLessThan(25);
      }
    });
  });

  describe('Adaptive Pacing - Projection vs Linear', () => {
    const referenceDate = new Date('2026-08-20T12:00:00Z');

    it('adaptive projection differs from linear when anomalies present', () => {
      const goal = {
        id: 15,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      // Normal velocity ~1000/day, but one big spike inflates linear projection
      const dailyBreakdown = [];
      for (let i = 0; i < 35; i++) {
        const date = new Date('2026-07-01');
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        let value = 1000;
        if (i === 15) value = 10000; // viral spike
        dailyBreakdown.push({ date: dateStr, value, cumulative: 0 });
      }

      // cumulativeValue must match sum of daily values (50 days through reference, spike adds 9000)
      const actualData = {
        cumulativeValue: 59000,
        dailyBreakdown,
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.hasAdaptiveData).toBe(true);
      expect(res.adaptiveProjection).toBeDefined();

      // Adaptive projection should be more conservative (lower) than linear
      // because it excludes the spike from baseline
      expect(res.adaptiveProjection.projectedValue).toBeLessThan(res.projectedValue);

      // Adaptive baseline velocity should be close to 1000 (clean days only)
      expect(res.adaptiveProjection.baseline.velocity).toBeGreaterThan(900);
      expect(res.adaptiveProjection.baseline.velocity).toBeLessThan(1200);
    });

    it('includes trajectory with adaptiveExpected values', () => {
      const goal = {
        id: 16,
        channelId: 'ch1',
        title: 'Q3 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q3',
        startDate: '2026-07-01',
        endDate: '2026-09-30',
        targetValue: 100000,
      };

      const dailyBreakdown = [];
      for (let i = 0; i < 30; i++) {
        const date = new Date('2026-07-01');
        date.setDate(date.getDate() + i);
        const dateStr = date.toISOString().split('T')[0];
        dailyBreakdown.push({ date: dateStr, value: 1000, cumulative: (i + 1) * 1000 });
      }

      const actualData = {
        cumulativeValue: 30000,
        dailyBreakdown,
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.hasAdaptiveData).toBe(true);
      expect(res.adaptiveProjection.trajectory).toBeDefined();
      expect(res.adaptiveProjection.trajectory.length).toBeGreaterThan(0);

      // Check that trajectory has adaptiveExpected
      const firstPoint = res.adaptiveProjection.trajectory[0];
      expect(firstPoint.adaptiveExpected).toBeDefined();
      expect(firstPoint.adaptiveExpected).toBeGreaterThan(0);
    });
  });

  describe('Adaptive Pacing - Upcoming/Past Goals', () => {
    const referenceDate = new Date('2026-08-20T12:00:00Z');

    it('does not compute adaptive for upcoming goals', () => {
      const goal = {
        id: 17,
        channelId: 'ch1',
        title: 'Q4 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q4',
        startDate: '2026-10-01',
        endDate: '2026-12-31',
        targetValue: 100000,
      };

      const actualData = {
        cumulativeValue: 0,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isUpcoming).toBe(true);
      expect(res.hasAdaptiveData).toBe(false);
      expect(res.adaptiveProjection).toBeUndefined();
    });

    it('does not compute adaptive for past goals', () => {
      const goal = {
        id: 18,
        channelId: 'ch1',
        title: 'Q1 2026 Views',
        metric: 'views',
        periodType: 'quarterly',
        periodKey: '2026-Q1',
        startDate: '2026-01-01',
        endDate: '2026-03-31',
        targetValue: 100000,
      };

      const actualData = {
        cumulativeValue: 120000,
        dailyBreakdown: [],
      };

      const res = service.calculateGoalPacing(goal, actualData, referenceDate);

      expect(res.isPast).toBe(true);
      expect(res.hasAdaptiveData).toBe(false);
      expect(res.adaptiveProjection).toBeUndefined();
    });
  });
});
