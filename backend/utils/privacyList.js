/**
 * Shared helper for surfacing owner-only (private/unlisted) playlists.
 *
 * `playlists.list?channelId=` only returns public playlists, even when
 * authorized as the channel owner. `mine=true` returns the owner's full list
 * including private/unlisted ones, so we page through it and keep only items
 * belonging to the requested channel that are not public.
 */
async function fetchOwnedHiddenPlaylists({
  channelId, accessToken, axios, YOUTUBE_API_BASE, maxPages = 4,
}) {
  const items = [];
  let pageToken;
  for (let page = 0; page < maxPages; page++) {
    const res = await axios.get(`${YOUTUBE_API_BASE}/playlists`, {
      params: {
        part: "snippet,contentDetails,status", mine: true, maxResults: 50,
        ...(pageToken ? { pageToken } : {}),
      },
      headers: { Authorization: accessToken },
    });
    for (const item of res.data.items || []) {
      if (
        item.snippet?.channelId === channelId &&
        item.status?.privacyStatus &&
        item.status.privacyStatus !== "public"
      ) {
        items.push(item);
      }
    }
    pageToken = res.data.nextPageToken;
    if (!pageToken) break;
  }
  return items;
}

/** Merge owner-only playlist items into a public list response (dedupe by id).
 *
 * Pass isFirstPage:false for follow-up pages: the hidden set is identical on
 * every page, so merging it per page repeats the same rows in each response
 * (and burns up to 4 mine=true quota units per page). The frontend dedupes by
 * id as a second line of defense.
 */
async function mergeOwnedHiddenPlaylists(responseData, { channelId, accessToken, axios, YOUTUBE_API_BASE, isFirstPage = true }) {
  if (isFirstPage === false) return responseData;
  try {
    const hiddenItems = await fetchOwnedHiddenPlaylists({ channelId, accessToken, axios, YOUTUBE_API_BASE });
    if (hiddenItems.length === 0) return responseData;
    const seen = new Set((responseData.items || []).map((item) => item.id));
    responseData.items = [...(responseData.items || []), ...hiddenItems.filter((item) => !seen.has(item.id))];
  } catch (err) {
    console.warn("[privacyList] Hidden-playlist enrichment failed:", err.response?.data?.error?.message || err.message);
  }
  return responseData;
}

module.exports = { fetchOwnedHiddenPlaylists, mergeOwnedHiddenPlaylists };
