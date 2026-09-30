/**
 * Channel videos service -- fetches all videos for a channel via YouTube Data API.
 */
function createChannelVideosService(deps) {
  const {
    serverCache,
    shortHash,
    isPostgresConfigured,
    loadChannelVideosFromPostgres,
    YT_DATA_CACHE_TTL_MS,
    axios,
    ANALYTICS_SOURCE,
    YOUTUBE_API_BASE,
    API_KEY,
    markQuotaBillable,
  } = deps;

  // Cap for the private/unlisted enrichment (search.list forMine=true pages of 50).
  // Bumped from 4 -> 10 (500 videos) so channels with many private/unlisted
  // uploads are not silently truncated at 200. Configurable via env.
  const MAX_HIDDEN_VIDEO_PAGES = Math.max(1, parseInt(process.env.MAX_HIDDEN_VIDEO_PAGES || "10", 10) || 10);

  /**
   * Normalize a raw privacy status (e.g. "PRIVACY_PUBLIC", "PRIVACY_UNLISTED",
   * "PRIVACY_PRIVATE", or lowercase) to the canonical "public" | "unlisted" |
   * "private". Returns undefined when the value is missing/unknown so consumers
   * can distinguish it from a real "public".
   */
  function normalizePrivacy(value) {
    if (!value) return undefined;
    const s = String(value).toLowerCase();
    if (s.includes("unlisted")) return "unlisted";
    if (s.includes("private")) return "private";
    if (s.includes("public")) return "public";
    return undefined;
  }

  /**
   * Filter videos to the exact requested status groups. 'all' keeps everything;
   * unknown-status rows (non-owner views) are treated as public to avoid
   * emptying the default list. Never mutates its input.
   */
  function filterByPrivacy(videos, privacy) {
    if (!privacy || privacy === "all") return videos;
    const status = privacy === "public" || privacy === "private" || privacy === "unlisted" ? privacy : "public";
    return videos.filter((v) => (normalizePrivacy(v.privacyStatus) || "public") === status);
  }

  /**
   * Fetch private + unlisted videos owned by the authenticated channel.
   * The uploads playlist only exposes public videos, so owner-only search is
   * required to surface hidden uploads. Returns [] when anything fails so the
   * public list is still served.
   */
  async function fetchHiddenVideos(channelId, ytHeaders) {
    const hidden = [];
    const seenIds = new Set();
    let pageToken;
    try {
      for (let page = 0; page < MAX_HIDDEN_VIDEO_PAGES; page++) {
        const searchRes = await axios.get(`${YOUTUBE_API_BASE}/search`, {
          params: {
            part: "snippet", forMine: true, type: "video", order: "date",
            maxResults: 50, ...(pageToken ? { pageToken } : {}),
          },
          headers: ytHeaders,
        });
        for (const item of searchRes.data.items || []) {
          const videoId = item.id?.videoId;
          if (videoId && item.snippet?.channelId === channelId && !seenIds.has(videoId)) {
            seenIds.add(videoId);
            hidden.push({
              position: undefined,
              title: item.snippet.title,
              videoId,
              publishedAt: item.snippet.publishedAt,
              channelTitle: item.snippet.channelTitle,
              description: item.snippet.description,
              thumbnailUrl: item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.default?.url || "",
            });
          }
        }
        pageToken = searchRes.data.nextPageToken;
        if (!pageToken) break;
      }

      if (hidden.length === 0) return hidden;

      // Enrich in batches of 50 with stats/status/duration (same shape as public videos).
      for (let i = 0; i < hidden.length; i += 50) {
        const chunk = hidden.slice(i, i + 50);
        const statsRes = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
          params: { part: "statistics,contentDetails,snippet,status", id: chunk.map((v) => v.videoId).join(",") },
          headers: ytHeaders,
        });
        const detailsMap = new Map(statsRes.data.items.map((item) => [item.id, item]));
        for (const video of chunk) {
          const item = detailsMap.get(video.videoId);
          video.viewCount = parseInt(item?.statistics?.viewCount) || 0;
          video.likeCount = parseInt(item?.statistics?.likeCount) || 0;
          video.commentCount = parseInt(item?.statistics?.commentCount) || 0;
          video.duration = item?.contentDetails?.duration;
          video.tags = item?.snippet?.tags;
          video.privacyStatus = normalizePrivacy(item?.status?.privacyStatus) || "private";
        }
      }
      return hidden;
    } catch (err) {
      console.warn("[generateChannelVideos] Hidden-video enrichment failed:", err.response?.data?.error?.message || err.message);
      return [];
    }
  }

  /**
   * Cheap freshness top-up for server-cached channel lists: fetch the newest
   * uploads page (playlistItems page-1, 1 unit) and stats-enrich just the ids
   * missing from the cached list (1 unit). Brand-new public uploads become
   * visible in picker traffic without the full live pagination (which also
   * runs the expensive owner-only hidden-video search). The uploads playlist
   * only ever exposes public videos, so this cannot surface brand-new private
   * /unlisted uploads (they appear when the L1 entry ages out instead). Never
   * throws -- on any failure the cached list is served as-is.
   */
  async function topUpWithNewestUploads(
    videos,
    { channelId, ytHeaders, useApiKeyFallback, effectivePrivacy },
  ) {
    try {
      if (!channelId.startsWith("UC")) return videos;
      const uploadsId = "UU" + channelId.slice(2);
      const headParams = { part: "snippet", playlistId: uploadsId, maxResults: 50 };
      if (useApiKeyFallback) headParams.key = API_KEY;
      const headRes = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
        params: headParams,
        ...(useApiKeyFallback ? {} : { headers: ytHeaders }),
      });
      const knownIds = new Set(videos.map((v) => v.videoId));
      const headVideos = (headRes.data.items || [])
        .map((item) => ({
          position: item.snippet?.position,
          title: item.snippet?.title,
          videoId: item.snippet?.resourceId?.videoId,
          publishedAt: item.snippet?.publishedAt,
          channelTitle: item.snippet?.channelTitle,
          description: item.snippet?.description,
          thumbnailUrl:
            item.snippet?.thumbnails?.medium?.url ||
            item.snippet?.thumbnails?.default?.url ||
            "",
        }))
        .filter((v) => v.videoId && !knownIds.has(v.videoId));
      if (headVideos.length === 0) return videos;

      const statsParams = {
        part: "statistics,contentDetails,snippet,status",
        id: headVideos.map((v) => v.videoId).join(","),
      };
      if (useApiKeyFallback) statsParams.key = API_KEY;
      const statsRes = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
        params: statsParams,
        ...(useApiKeyFallback ? {} : { headers: ytHeaders }),
      });
      const detailsMap = new Map(
        (statsRes.data.items || []).map((item) => [
          item.id,
          {
            viewCount: parseInt(item.statistics?.viewCount) || 0,
            likeCount: parseInt(item.statistics?.likeCount) || 0,
            commentCount: parseInt(item.statistics?.commentCount) || 0,
            duration: item.contentDetails?.duration,
            tags: item.snippet?.tags,
            privacyStatus: normalizePrivacy(item.status?.privacyStatus),
          },
        ]),
      );
      const newVideos = filterByPrivacy(
        headVideos.map((video) => {
          const details = detailsMap.get(video.videoId);
          return {
            ...video,
            viewCount: details?.viewCount || 0,
            likeCount: details?.likeCount || 0,
            commentCount: details?.commentCount || 0,
            duration: details?.duration,
            tags: details?.tags,
            privacyStatus: details?.privacyStatus,
          };
        }),
        effectivePrivacy,
      );
      if (newVideos.length === 0) return videos;
      console.log(`[Cache] Channel videos TOP-UP: +${newVideos.length} new upload(s) for ${channelId}`);
      return [...newVideos, ...videos];
    } catch (err) {
      console.warn(
        "[generateChannelVideos] Top-up failed, serving cached list:",
        err.response?.data?.error?.message || err.message,
      );
      return videos;
    }
  }

  async function generateChannelVideos({
    channelId, maxResults, accessToken, cacheScope, orgRefreshToken, req, includePrivate, privacy, topUp,
  }) {
    // privacy: 'public' | 'private' | 'unlisted' | 'all'  -- exact status requested.
    // Backward-compat: when not provided, fall back to the legacy includePrivate boolean.
    // topUp: picker mode -- serve the server cache but top the list up with the
    // newest uploads page (2 API units) so brand-new public uploads appear
    // immediately instead of when the 90-min L1 entry ages out.
    const effectivePrivacy = privacy || (includePrivate ? "all" : "public");
    const isPublicOnly = effectivePrivacy === "public";
    const needsHidden = !isPublicOnly; // private/unlisted/all must include the owner-only hidden set.

    const scopePart = cacheScope != null ? String(cacheScope) : shortHash(accessToken);
    const limitPart = typeof maxResults === "number" ? String(maxResults) : "all";
    // Privacy suffix invalidates cache across the different status filters and old
    // pre-privacyStatus entries (they would otherwise render private as public).
    const privacyPart = `p=${effectivePrivacy}`;
    const cacheKey = `channel_videos:${scopePart}:${channelId}:${limitPart}:${privacyPart}`;
    const useApiKeyFallback = !accessToken || !accessToken.startsWith("Bearer ");
    const ytHeaders = useApiKeyFallback ? {} : { Authorization: accessToken };

    const cached = await serverCache.get(cacheKey);
    if (cached) {
      if (topUp) {
        // Top-up consumes YouTube units, so flag the request as billable.
        markQuotaBillable(req);
        const list = await topUpWithNewestUploads(cached, {
          channelId, ytHeaders, useApiKeyFallback, effectivePrivacy,
        });
        if (list !== cached) {
          await serverCache.set(cacheKey, list, YT_DATA_CACHE_TTL_MS.CHANNEL_VIDEOS);
        }
        return list;
      }
      console.log("[Cache] Channel videos HIT:", cacheKey.slice(0, 72));
      return cached;
    }

    markQuotaBillable(req);

    // L2: Postgres read-model (cron-ingested). Always consulted -- regardless of
    // whether the request carries an owner OAuth token -- so the dashboard serves
    // from the DB (near-zero YouTube quota) and only falls through to the live
    // YouTube API (L3) when the DB has no data for this channel. Picker traffic
    // (topUp=1) still gets the cheap newest-uploads top-up over the DB rows, so
    // cron staleness never hides brand-new public uploads. Staleness is
    // otherwise handled by the manual admin ingestion refresh.
    if (ANALYTICS_SOURCE !== "youtube-only" && isPostgresConfigured()) {
      try {
        const pgVideos = await loadChannelVideosFromPostgres(channelId, maxResults);
        if (pgVideos?.length) {
          let filtered = filterByPrivacy(pgVideos, effectivePrivacy);
          if (topUp) {
            filtered = await topUpWithNewestUploads(filtered, {
              channelId, ytHeaders, useApiKeyFallback, effectivePrivacy,
            });
          }
          await serverCache.set(cacheKey, filtered, YT_DATA_CACHE_TTL_MS.CHANNEL_VIDEOS);
          console.log("[Cache] Channel videos L2 (Postgres) HIT:", cacheKey.slice(0, 72), `(n=${filtered.length})`);
          return filtered;
        }
      } catch (err) {
        console.warn("[Channel Videos] Postgres path failed, falling back to live API:", err.message);
      }
    }

    let retriedWithOrgToken = false;

    try {
      let uploadsId;
      if (channelId.startsWith("UC")) {
        uploadsId = "UU" + channelId.slice(2);
      } else {
        const channelRes = await axios.get(
          `${YOUTUBE_API_BASE}/channels`,
          { params: { part: "contentDetails", id: channelId, key: API_KEY } },
        );
        if (!channelRes.data.items || channelRes.data.items.length === 0) {
          throw new Error("Channel not found");
        }
        uploadsId = channelRes.data.items[0].contentDetails.relatedPlaylists.uploads;
      }
      console.log(`[generateChannelVideos] channel=${channelId} uploadsPlaylistId=${uploadsId}`);

      const allVideos = [];
      let pageToken = undefined;

      do {
        const remainingNeeded =
          typeof maxResults === "number" ? maxResults - allVideos.length : 50;
        const limit = Math.min(remainingNeeded, 50);
        if (limit <= 0) break;

        const params = { part: "snippet", playlistId: uploadsId, maxResults: limit };
        if (pageToken) params.pageToken = pageToken;

        let activeRes;
        try {
          if (useApiKeyFallback) params.key = API_KEY;
          activeRes = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
            params,
            ...(useApiKeyFallback ? {} : { headers: ytHeaders }),
          });
        } catch (playlistErr) {
          if (playlistErr.response?.status === 404) {
            if (orgRefreshToken && !retriedWithOrgToken) {
              try {
                console.warn(
                  `[generateChannelVideos] Playlist 404, retrying with fresh org token for channel=${channelId}`,
                );
                const refreshRes = await axios.post(
                  "https://oauth2.googleapis.com/token",
                  {
                    refresh_token: orgRefreshToken,
                    client_id: process.env.YOUTUBE_CLIENT_ID || "",
                    client_secret: process.env.YOUTUBE_CLIENT_SECRET || "",
                    grant_type: "refresh_token",
                  },
                  { timeout: 10000 },
                );
                ytHeaders.Authorization = `Bearer ${refreshRes.data.access_token}`;
                retriedWithOrgToken = true;
                activeRes = await axios.get(`${YOUTUBE_API_BASE}/playlistItems`, {
                  params,
                  headers: ytHeaders,
                });
              } catch (retryErr) {
                if (retryErr.response?.status === 404) {
                  console.warn(
                    `[generateChannelVideos] Uploads playlist ${uploadsId} not accessible after token refresh for channel=${channelId}. Returning empty list.`,
                  );
                  await serverCache.set(cacheKey, [], YT_DATA_CACHE_TTL_MS.CHANNEL_VIDEOS);
                  return [];
                }
                throw retryErr;
              }
            } else {
              console.warn(
                `[generateChannelVideos] Uploads playlist ${uploadsId} not accessible (404) for channel=${channelId}. Returning empty list.`,
              );
              await serverCache.set(cacheKey, [], YT_DATA_CACHE_TTL_MS.CHANNEL_VIDEOS);
              return [];
            }
          } else {
            throw playlistErr;
          }
        }

        const rawVideos = activeRes.data.items.map((item) => ({
          position: item.snippet.position,
          title: item.snippet.title,
          videoId: item.snippet.resourceId.videoId,
          publishedAt: item.snippet.publishedAt,
          channelTitle: item.snippet.channelTitle,
          description: item.snippet.description,
          thumbnailUrl:
            item.snippet.thumbnails.medium?.url ||
            item.snippet.thumbnails.default?.url ||
            "",
        }));

        if (rawVideos.length > 0) {
          const videoIds = rawVideos.map((v) => v.videoId).join(",");
          const statsParams = { part: "statistics,contentDetails,snippet,status", id: videoIds };
          if (useApiKeyFallback) statsParams.key = API_KEY;
          const statsRes = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
            params: statsParams,
            ...(useApiKeyFallback ? {} : { headers: ytHeaders }),
          });

          const detailsMap = new Map(
            statsRes.data.items.map((item) => [
              item.id,
              {
                viewCount: parseInt(item.statistics.viewCount) || 0,
                likeCount: parseInt(item.statistics.likeCount) || 0,
                commentCount: parseInt(item.statistics.commentCount) || 0,
                duration: item.contentDetails?.duration,
                tags: item.snippet?.tags,
                // Keep privacyStatus only when YouTube actually returns it
                // (normalized to canonical public|unlisted|private). Missing value
                // (e.g. API-key / non-owner fetch) => leave undefined,
                // do NOT coerce to "public".
                privacyStatus: normalizePrivacy(item.status?.privacyStatus),
              },
            ]),
          );

          const enrichedChunk = rawVideos.map((video) => {
            const details = detailsMap.get(video.videoId);
            return {
              ...video,
              viewCount: details?.viewCount || 0,
              likeCount: details?.likeCount || 0,
              commentCount: details?.commentCount || 0,
              duration: details?.duration,
              tags: details?.tags,
              privacyStatus: details?.privacyStatus,
            };
          });

          allVideos.push(...enrichedChunk);
        }

        pageToken = activeRes.data.nextPageToken;
      } while (
        pageToken &&
        (typeof maxResults !== "number" || allVideos.length < maxResults)
      );

      // Owner-only enrichment: append private/unlisted uploads after the public list.
      if (needsHidden && !useApiKeyFallback) {
        const publicIds = new Set(allVideos.map((v) => v.videoId));
        const hiddenVideos = (await fetchHiddenVideos(channelId, ytHeaders)).filter(
          (v) => !publicIds.has(v.videoId),
        );
        if (hiddenVideos.length > 0) {
          allVideos.push(...hiddenVideos);
        }
      }

      // Filter to the exact requested status groups (public only / private only / unlisted only / all).
      const filtered = filterByPrivacy(allVideos, effectivePrivacy);

      await serverCache.set(cacheKey, filtered, YT_DATA_CACHE_TTL_MS.CHANNEL_VIDEOS);
      console.log("[Cache] Channel videos WRITE:", cacheKey.slice(0, 72), `(Fetched ${filtered.length})`);

      return filtered;
    } catch (error) {
      console.error("[generateChannelVideos] Error:", error.response?.data || error.message);
      throw error;
    }
  }

  return { generateChannelVideos };
}

module.exports = { createChannelVideosService };
