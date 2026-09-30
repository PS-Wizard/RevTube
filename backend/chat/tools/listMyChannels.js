/**
 * Tool: listMyChannels
 * List the authenticated user's connected YouTube channels.
 * For admins: lists ALL channels across all users and orgs system-wide,
 * with optional name search filtering.
 * Cross-references PostgreSQL to indicate which channels have analytics data.
 */
module.exports = {
  name: 'listMyChannels',
  description: 'List your YouTube channels (or ALL channels for admins). Admins can search by channel name. Returns channel IDs, titles, ownership info, and whether analytics data is available.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'Optional search term to filter channels by name',
      },
    },
    required: [],
  },

  execute: async (args, { deps, userContext }) => {
    const { admin, db } = deps;
    const uid = userContext?.uid;
    const orgId = userContext?.orgId;
    const isAdmin = userContext?.isAdmin === true;
    const searchQuery = (args?.query || '').toLowerCase().trim();

    if (!uid) {
      return { error: 'User not authenticated.' };
    }

    try {
      // ── Admin: list ALL channels across all users/orgs ──────────────
      if (isAdmin) {
        // 1. Collection group query: all user youtubeTokens
        const userTokensSnap = await db.collectionGroup('youtubeTokens').get();
        const fromUsers = userTokensSnap.docs.map((doc) => {
          const d = doc.data();
          return {
            channelId: d.channelId || doc.id,
            channelTitle: d.channelTitle || d.channelName || 'Unknown',
            thumbnailUrl: d.thumbnailUrl || null,
            owner: { type: 'user', uid: d.uid || doc.ref.parent.parent?.id || null },
          };
        });

        // 2. Collection group query: all org channels
        const orgChannelsSnap = await db.collectionGroup('channels').get();
        const fromOrgs = orgChannelsSnap.docs.map((doc) => {
          const d = doc.data();
          return {
            channelId: d.channelId || doc.id,
            channelTitle: d.channelTitle || d.channelName || 'Unknown',
            thumbnailUrl: d.thumbnailUrl || null,
            owner: { type: 'org', orgId: doc.ref.parent.parent?.id || null },
          };
        });

        // 3. Merge & dedup by channelId
        const all = [...fromUsers, ...fromOrgs];
        const seen = new Set();
        const unique = all.filter((ch) => {
          if (seen.has(ch.channelId)) return false;
          seen.add(ch.channelId);
          return true;
        });

        // 4. Cross-reference PostgreSQL for analytics data availability
        let pgChannels = new Set();
        if (deps.isPostgresConfigured && deps.isPostgresConfigured()) {
          try {
            const result = await deps.query(
              'SELECT channel_id FROM analytics_channels WHERE channel_id = ANY($1)',
              [unique.map((c) => c.channelId)],
            );
            if (result?.rows) {
              for (const row of result.rows) {
                pgChannels.add(row.channel_id);
              }
            }
          } catch (pgErr) {
            console.warn('[Tool:listMyChannels] PG lookup failed:', pgErr.message);
          }
        }

        // 5. Attach hasAnalytics flag
        for (const ch of unique) {
          ch.hasAnalytics = pgChannels.has(ch.channelId);
        }

        // 6. Filter by search term if provided
        const filtered = searchQuery
          ? unique.filter((ch) => ch.channelTitle.toLowerCase().includes(searchQuery))
          : unique;

        // 7. Sort by title (channels with data first)
        filtered.sort((a, b) => {
          if (a.hasAnalytics !== b.hasAnalytics) return a.hasAnalytics ? -1 : 1;
          return a.channelTitle.localeCompare(b.channelTitle);
        });

        const withData = filtered.filter((c) => c.hasAnalytics).length;

        return {
          message: `Found ${filtered.length} channel(s) system-wide${searchQuery ? ` matching "${searchQuery}"` : ''}. ${withData} have analytics data available.`,
          channels: filtered,
          total: filtered.length,
          mode: 'admin',
        };
      }

      // ── Regular user: list their own channels (personal or org) ────
      let snapshot;
      if (orgId) {
        snapshot = await db
          .collection('organizations')
          .doc(orgId)
          .collection('channels')
          .get();
      } else {
        snapshot = await db
          .collection('users')
          .doc(uid)
          .collection('youtubeTokens')
          .get();
      }

      if (snapshot.empty) {
        return {
          message: 'No YouTube channels connected to your account.',
          channels: [],
          total: 0,
        };
      }

      const channels = [];
      for (const doc of snapshot.docs) {
        const data = doc.data();
        if (data.channelId || data.id) {
          channels.push({
            channelId: data.channelId || data.id,
            channelTitle: data.channelTitle || data.channelName || null,
            connectedAt: data.createdAt || null,
          });
        }
      }

      // Cross-reference PG for users too
      let pgUserChannels = new Set();
      if (deps.isPostgresConfigured && deps.isPostgresConfigured()) {
        try {
          const result = await deps.query(
            'SELECT channel_id FROM analytics_channels WHERE channel_id = ANY($1)',
            [channels.map((c) => c.channelId)],
          );
          if (result?.rows) {
            for (const row of result.rows) {
              pgUserChannels.add(row.channel_id);
            }
          }
        } catch (pgErr) {
          // non-fatal
        }
      }
      for (const ch of channels) {
        ch.hasAnalytics = pgUserChannels.has(ch.channelId);
      }

      // Filter by name if user provided a query
      const filtered = searchQuery
        ? channels.filter((c) => c.channelTitle?.toLowerCase().includes(searchQuery))
        : channels;

      return {
        message: `Found ${filtered.length} connected channel(s)${searchQuery ? ` matching "${searchQuery}"` : ''}.`,
        channels: filtered,
        total: filtered.length,
      };
    } catch (err) {
      console.warn('[Tool:listMyChannels] Firestore query failed:', err.message);
      return { error: `Failed to list channels: ${err.message}` };
    }
  },
};
