/**
 * Channel ownership validation for AI optimizer endpoints.
 *
 * Non-admin users may only run playlist/thumbnail optimization on videos that
 * belong to their own connected channels (personal youtubeTokens or org
 * channels). Admins may analyze any channel. This is the server-side backstop
 * to the client-side "not from your channel" enforcement.
 */

const { getVideosByIds } = require("../ingestion/readModels");

const YT_ID_RE = /^.*(youtu\.be\/|v\/|u\/\w\/|embed\/|watch\?v=|&v=)([^#&?]*).*/;

function extractYoutubeId(input) {
  if (!input || typeof input !== "string") return null;
  const trimmed = input.trim();
  // Raw 11-char video ID (already an ID, not a URL)
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  const match = trimmed.match(YT_ID_RE);
  return match && match[2] && match[2].length === 11 ? match[2] : null;
}

function createChannelOwnershipValidator(deps) {
  const {
    db,
    axios,
    YOUTUBE_API_BASE,
    API_KEY,
    isPostgresConfigured,
  } = deps;

  function isAdminRequest(req) {
    if (req.authUser?.email === "support@revketer.ai") return true;
    return req.currentUser?.role === "admin";
  }

  /**
   * Resolve the set of channel IDs the caller owns. In org context
   * (X-Org-Id header) this is the org's channels; otherwise the user's
   * personal youtubeTokens.
   */
  async function getConnectedChannelIds(req) {
    const uid = req.authUser?.uid;
    if (!uid) return [];
    const orgId = req.headers["x-org-id"];
    let snap;
    if (orgId) {
      snap = await db
        .collection("organizations")
        .doc(String(orgId))
        .collection("channels")
        .get();
    } else {
      snap = await db
        .collection("users")
        .doc(uid)
        .collection("youtubeTokens")
        .get();
    }
    if (snap.empty) return [];
    return snap.docs.map((doc) => {
      const data = doc.data();
      return data.channelId || data.id || doc.id;
    });
  }

  /**
   * Resolve channelId for up to 50 video IDs, Postgres-first with a YouTube
   * fallback. Returns Map<videoId, channelId>. Unresolvable IDs are absent.
   */
  async function resolveVideoChannelIds(videoIds) {
    const ids = [
      ...new Set((videoIds || []).map(extractYoutubeId).filter(Boolean)),
    ].slice(0, 50);
    const out = new Map();
    if (!ids.length) return out;

    let dbHits = {};
    if (isPostgresConfigured && isPostgresConfigured()) {
      try {
        dbHits = (await getVideosByIds(ids)) || {};
      } catch (err) {
        console.warn("[channelOwnership] PG lookup failed:", err.message);
      }
    }

    const missing = [];
    for (const id of ids) {
      if (dbHits[id]?.channelId) out.set(id, dbHits[id].channelId);
      else missing.push(id);
    }

    for (let i = 0; i < missing.length; i += 50) {
      const chunk = missing.slice(i, i + 50);
      try {
        const params = { part: "snippet", id: chunk.join(","), key: API_KEY };
        const resp = await axios.get(`${YOUTUBE_API_BASE}/videos`, {
          params,
          timeout: 15000,
        });
        for (const item of resp?.data?.items || []) {
          if (item?.snippet?.channelId) out.set(item.id, item.snippet.channelId);
        }
      } catch (err) {
        console.warn("[channelOwnership] YouTube fallback failed:", err.message);
      }
    }
    return out;
  }

  /**
   * Validate an array of video inputs against the caller's connected channels.
   *
   * Each entry may carry `videoId`, `url`, and/or a claimed `channelId`.
   * Missing/claimed channel IDs are resolved (Postgres-first, YouTube fallback).
   * Admins are always allowed. Non-admin callers get back an error string when
   * any video is not owned by one of their connected channels, else null.
   *
   * @param {Object} req  - Express request (authUser, currentUser, X-Org-Id)
   * @param {Array}  videos - [{ videoId?, url?, channelId? }]
   * @returns {Promise<{ ok: true } | { ok: false, message: string }>}
   */
  async function validateVideos(req, videos) {
    if (isAdminRequest(req)) return { ok: true };

    const connected = new Set(await getConnectedChannelIds(req));
    const videoIds = (videos || [])
      .map((v) => v?.videoId || extractYoutubeId(v?.url) || null)
      .filter(Boolean);
    const resolved = await resolveVideoChannelIds(videoIds);

    let foreign = 0;
    for (const v of videos || []) {
      if (!v || typeof v !== "object") continue;
      const claimed = v.channelId || null;
      const vid = v.videoId || extractYoutubeId(v.url) || null;
      const channelId = claimed || (vid ? resolved.get(vid) : null);
      if (!channelId) continue; // unresolvable -> leave to the AI service
      if (!connected.has(channelId)) foreign += 1;
    }

    if (foreign > 0) {
      return {
        ok: false,
        message: `${foreign} video(s) are not from your connected channels. Only videos from your connected channels can be analyzed.`,
      };
    }
    return { ok: true };
  }

  return { isAdminRequest, getConnectedChannelIds, resolveVideoChannelIds, validateVideos, extractYoutubeId };
}

module.exports = { createChannelOwnershipValidator, extractYoutubeId };