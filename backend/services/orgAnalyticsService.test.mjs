import { describe, it, expect, vi } from "vitest";
import { createOrgAnalyticsService } from "./orgAnalyticsService.js";

function daysAgo(n) {
  return new Date(Date.now() - n * 86400000).toISOString().slice(0, 10);
}

function makeDeps({ membership = { isMember: true, role: "owner" }, dailyRows = [], lifetimeRows = [], videoLifetimeRows = [], historyRows = [], metaRows = [], channelIds = ["UC1", "UC2"] } = {}) {
  const db = {
    collection: () => ({
      doc: () => ({
        collection: () => ({
          get: async () => ({
            forEach: (fn) =>
              channelIds.forEach((id) => fn({ id, data: () => ({ channelId: id }) })),
          }),
        }),
      }),
    }),
  };
  const serverCache = {
    get: vi.fn(async () => null),
    set: vi.fn(async () => {}),
  };
  const query = vi.fn(async (sql) => {
    if (sql.includes("analytics_channels")) return { rows: metaRows };
    // Lifetime video cumulative query (analytics_videos)
    if (sql.includes("analytics_videos")) return { rows: videoLifetimeRows };
    // Lifetime daily-history query (watch time / subs since first ingest)
    if (sql.includes("MIN(metric_date)")) return { rows: historyRows };
    return { rows: dailyRows };
  });
  const service = createOrgAnalyticsService({
    db,
    serverCache,
    getCachedOrgMembership: vi.fn(async () => membership),
    query,
    isPostgresConfigured: () => true,
    withInFlightTimeout: (_map, _key, factory) => factory(),
  });
  return { service, serverCache, query };
}

describe("orgAnalyticsService", () => {
  it("returns 403-style error for non-members", async () => {
    const { service } = makeDeps({ membership: null });
    await expect(
      service.getOrgAnalytics({ orgId: "org1", uid: "u1" }),
    ).rejects.toMatchObject({ statusCode: 403 });
  });

  it("returns configured:false when postgres is unavailable", async () => {
    const { serverCache, query } = makeDeps();
    const service = createOrgAnalyticsService({
      db: {
        collection: () => ({
          doc: () => ({
            collection: () => ({ get: async () => ({ forEach: () => {} }) }),
          }),
        }),
      },
      serverCache,
      getCachedOrgMembership: async () => ({ isMember: true }),
      query, isPostgresConfigured: () => false,
      withInFlightTimeout: (_m, _k, f) => f(),
    });
    const result = await service.getOrgAnalytics({ orgId: "org1", uid: "u1" });
    expect(result.configured).toBe(false);
    expect(result.channels).toEqual([]);
  });

  it("aggregates per-channel and org totals with deltas", async () => {
    // Dates are relative to "today" so the fixture never ages out of the
    // service's trailing 30d window (start = today - 29d, prev = older).
    const dailyRows = [
      // UC1 current period
      { channel_id: "UC1", metric_date: daysAgo(3), views: "100", watchMinutes: "50", likes: "10", comments: "2", shares: "1", subsGained: "5", subsLost: "1" },
      // UC1 previous period
      { channel_id: "UC1", metric_date: daysAgo(40), views: "80", watchMinutes: "40", likes: "5", comments: "1", shares: "0", subsGained: "2", subsLost: "2" },
      // UC2 current period only
      { channel_id: "UC2", metric_date: daysAgo(2), views: "200", watchMinutes: "90", likes: "30", comments: "8", shares: "4", subsGained: "10", subsLost: "0" },
    ];
    const metaRows = [
      { channelId: "UC1", title: "Channel One", videoCount: "12", lastSyncedAt: "2026-08-28T00:00:00Z" },
      { channelId: "UC2", title: "Channel Two", videoCount: "7", lastSyncedAt: null },
    ];
    // Lifetime views come from analytics_videos cumulative counters (NOT the
    // ~90-day daily window); watch time/subs lifetime from full daily history.
    const { service } = makeDeps({
      dailyRows,
      metaRows,
      videoLifetimeRows: [
        { channel_id: "UC1", views: "1500", likes: "120", comments: "30" },
        { channel_id: "UC2", views: "900000", likes: "5400", comments: "800" },
      ],
      historyRows: [
        { channel_id: "UC1", watchMinutes: "900", subsGained: "7", subsLost: "3", historyStart: "2026-01-15" },
        { channel_id: "UC2", watchMinutes: "2200", subsGained: "40", subsLost: "10", historyStart: "2026-01-10" },
      ],
    });
    const result = await service.getOrgAnalytics({ orgId: "org1", uid: "u1", period: "30d" });

    expect(result.configured).toBe(true);
    expect(result.channels).toHaveLength(2);
    // Leaderboard: UC2 first (200 views > 100)
    expect(result.channels[0].channelId).toBe("UC2");
    expect(result.channels[0].totals.views).toBe(200);
    expect(result.channels[0].totals.netSubs).toBe(10);
    // UC1 delta: (100-80)/80 = 25%
    const uc1 = result.channels[1];
    expect(uc1.deltas.views).toBe(25);
    // Previous net subs = 2-2 = 0 -> delta is null (avoid /0)
    expect(uc1.deltas.netSubs).toBeNull();
    // Org totals: views 300, net subs 14
    expect(result.totals.views).toBe(300);
    expect(result.totals.netSubs).toBe(14);
    // Lifetime views = cumulative video counters, not the daily window
    expect(result.lifetime.views).toBe(901500);
    expect(result.lifetime.watchMinutes).toBe(3100);
    expect(result.lifetime.netSubs).toBe(34);
    // Earliest ingested daily row is surfaced so the UI can qualify
    // watch-time / subscriber lifetime figures
    expect(result.historyStart).toBe("2026-01-10");
    expect(result.channels[1].historyStart).toBe("2026-01-15");
    expect(result.series).toHaveLength(2);
  });

  it("caches results per org+period+channel-set", async () => {
    const { service, serverCache } = makeDeps({ dailyRows: [], metaRows: [] });
    await service.getOrgAnalytics({ orgId: "org1", uid: "u1", period: "7d" });
    expect(serverCache.set).toHaveBeenCalledWith(
      // Key includes a hash of the channel set so newly added channels
      // bypass the cache instead of waiting out the 30-minute TTL.
      expect.stringMatching(/^org:analytics:org1:[0-9a-f]{8}:7d$/),
      expect.objectContaining({ orgId: "org1", period: "7d" }),
      expect.any(Number),
    );
  });

  it("uses a different cache key when the org channel set changes", async () => {
    const depsA = makeDeps({ channelIds: ["UC1"] });
    await depsA.service.getOrgAnalytics({ orgId: "org1", uid: "u1", period: "7d" });
    const depsB = makeDeps({ channelIds: ["UC1", "UC2"] });
    await depsB.service.getOrgAnalytics({ orgId: "org1", uid: "u1", period: "7d" });
    const keysA = depsA.serverCache.set.mock.calls[0][0];
    const keysB = depsB.serverCache.set.mock.calls[0][0];
    expect(keysA).not.toBe(keysB);
  });
});
