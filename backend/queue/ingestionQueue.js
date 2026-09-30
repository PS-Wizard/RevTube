/**
 * Ingestion queue processor -- handles ingestChannelDaily jobs.
 *
 * Expected job data:
 *   { channelId: string, authHeader: string, maxVideos?: number, days?: number }
 */

function createIngestionProcessor(deps) {
  const { ingestChannelDaily, DEFAULT_MAX_VIDEOS_PER_CHANNEL } = deps;

  return async function processIngestion(job) {
    const { channelId, authHeader, maxVideos = DEFAULT_MAX_VIDEOS_PER_CHANNEL, days = 730 } = job.data;

    if (!channelId || !authHeader) {
      throw new Error(`Invalid ingestion job data: missing channelId or authHeader`);
    }

    console.log(`[Queue] ingest:${channelId} → starting (job ${job.id})`);

    const stats = await ingestChannelDaily({
      channelId,
      authHeader,
      maxVideos,
      days,
    });

    job.updateProgress(100);

    console.log(
      `[Queue] ingest:${channelId} → OK: ${stats.videosSynced} videos, ` +
      `${stats.videoMetricDays} video-metric days, ${stats.channelMetricDays} channel-metric days (${stats.elapsedMs}ms)`
    );

    return stats;
  };
}

module.exports = { createIngestionProcessor };
