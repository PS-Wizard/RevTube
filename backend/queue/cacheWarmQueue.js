/**
 * Cache-warm queue processor -- handles dashboard bundle, dimensions,
 * audience data, retention, and channel-video warming for a given channel.
 *
 * Expected job data:
 *   { channelId: string, accessToken: string, periods: number[], orgId?: string|null }
 *
 * The cron enqueues these jobs every 6 hours for all channels. By warming
 * audience + retention caches ahead of time, users see near-instant tab loads
 * even on first visit.
 */

function createCacheWarmProcessor(deps) {
  const {
    generateDashboardBundle,
    generateDimensions,
    generateChannelVideos,
    generateAudienceActiveTimeFromDb,
    generateRetentionByHour,
    generateAudienceActiveTime,
  } = deps;

  return async function processCacheWarm(job) {
    const { channelId, accessToken, periods: rawPeriods = [7, 30, 90], orgId } = job.data;

    if (!channelId || !accessToken) {
      throw new Error(`Invalid cache-warm job data: missing channelId or accessToken`);
    }

    console.log(`[Queue] warm:${channelId} → starting (job ${job.id})`);

    const today = new Date();
    const endDate = today.toISOString().split('T')[0];

    // Total steps for progress: bundles(periods.length) + dimensions(3 periods) + videos + db-activity + retention + yt-activity
    const totalSteps = rawPeriods.length + 3 + 1 + 1 + 1 + 1;
    let stepsDone = 0;

    // ── 1. Warm dashboard bundle per period ──────────────────────────────
    for (const period of rawPeriods) {
      try {
        const startDate = new Date(today.getTime() - period * 86400000).toISOString().split('T')[0];
        await generateDashboardBundle({
          channelId,
          period,
          compare: true,
          trueDelta: false,
          filters: '',
          clientLatestDate: null,
          accessToken,
        });
        stepsDone++;
        job.updateProgress(Math.round((stepsDone / totalSteps) * 100));
      } catch (err) {
        console.warn(`[Queue] warm:${channelId} → ${period}d bundle failed: ${err.message}`);
      }
    }

    // ── 2. Warm dimensions for multiple periods ──────────────────────────
    for (const period of [7, 30, 90]) {
      try {
        const startDate = new Date(today.getTime() - period * 86400000).toISOString().split('T')[0];
        await generateDimensions({
          channelId,
          startDate,
          endDate,
          filters: '',
          accessToken,
        });
        stepsDone++;
        job.updateProgress(Math.round((stepsDone / totalSteps) * 100));
      } catch (err) {
        console.warn(`[Queue] warm:${channelId} → ${period}d dimensions failed: ${err.message}`);
      }
    }

    // ── 3. Warm video list ───────────────────────────────────────────────
    try {
      const videoScope = orgId
        ? `org:${orgId}:${channelId}`
        : `cron:${channelId}`;
      await generateChannelVideos({
        channelId,
        maxResults: 500,
        accessToken,
        cacheScope: videoScope,
      });
      stepsDone++;
      job.updateProgress(Math.round((stepsDone / totalSteps) * 100));
    } catch (err) {
      console.warn(`[Queue] warm:${channelId} → video list failed: ${err.message}`);
    }

    // ── 4. Warm DB-powered audience active time (view-velocity model) ─────
    try {
      const scope = orgId ? `org:${orgId}` : `cron:${channelId}`;
      await generateAudienceActiveTimeFromDb({
        channelId,
        scope,
        timezone: 'UTC',
      });
      stepsDone++;
      job.updateProgress(Math.round((stepsDone / totalSteps) * 100));
    } catch (err) {
      console.warn(`[Queue] warm:${channelId} → audience activity (DB) failed: ${err.message}`);
    }

    // ── 5. Warm retention trend ──────────────────────────────────────────
    try {
      const scope = orgId ? `org:${orgId}` : `cron:${channelId}`;
      await generateRetentionByHour({
        channelId,
        accessToken,
        period: 30,
        latestDate: endDate,
        scope,
        req: null,   // warm jobs don't carry an Express req
      });
      stepsDone++;
      job.updateProgress(Math.round((stepsDone / totalSteps) * 100));
    } catch (err) {
      console.warn(`[Queue] warm:${channelId} → retention failed: ${err.message}`);
    }

    // ── 6. Warm YT API audience active time (day-of-week) ────────────────
    try {
      const scope = orgId ? `org:${orgId}` : `cron:${channelId}`;
      await generateAudienceActiveTime({
        channelId,
        accessToken,
        period: 30,
        latestDate: endDate,
        scope,
        req: null,   // warm jobs don't carry an Express req
      });
      stepsDone++;
      job.updateProgress(Math.round((stepsDone / totalSteps) * 100));
    } catch (err) {
      console.warn(`[Queue] warm:${channelId} → audience activity (YT) failed: ${err.message}`);
    }

    console.log(
      `[Queue] warm:${channelId} → OK (` +
      `${stepsDone}/${totalSteps} steps, ` +
      `periods:[${rawPeriods.join(',')}], ` +
      `dimensions:[7,30,90], videos, db-activity, retention, yt-activity)`,
    );

    return { warmed: true, channelId, stepsDone, totalSteps };
  };
}

module.exports = { createCacheWarmProcessor };
