/**
 * Captions router -- fetches YouTube video captions/transcripts.
 *
 * Uses the official YouTube Captions API via OAuth.
 * Requires the user's YouTube OAuth token (API key alone returns 401).
 *
 * Mount at /captions/:videoId
 */
function createCaptionsRouter(deps) {
  const { resolveUser, handleApiError, axios, API_KEY, YOUTUBE_API_BASE } = deps;
  const { Router } = require('express');
  const router = Router();

  // Auth
  router.use(resolveUser);

  /**
   * GET /:videoId
   * Returns captions for the given video.
   * Response: { captions: Array<{ text: string, start: number, duration: number }> }
   */
  router.get('/:videoId', async (req, res) => {
    const { videoId } = req.params;
    const cleanId = String(videoId).replace(/[^0-9A-Za-z_-]/g, '');
    if (!cleanId || cleanId.length > 20) {
      return res.status(400).json({ error: { message: 'Invalid video ID' } });
    }

    const ytAuthHeader = req.headers['authorization'] || '';
    if (!ytAuthHeader) {
      return res.status(401).json({
        error: { message: 'YouTube OAuth token required. Sign in with YouTube to view captions.' },
        captions: [],
      });
    }

    const ytHeaders = { Authorization: ytAuthHeader };

    try {
      // Step 1: List available caption tracks
      const listRes = await axios.get(`${YOUTUBE_API_BASE}/captions`, {
        params: { part: 'snippet', videoId: cleanId, key: API_KEY },
        headers: ytHeaders,
        timeout: 8000,
      });

      const tracks = listRes.data?.items || [];
      if (tracks.length === 0) {
        return res.status(404).json({
          error: { message: 'No captions available for this video.' },
          captions: [],
        });
      }

      // Prefer English, otherwise take the first track
      const preferred = tracks.find((t) => t.snippet?.language?.startsWith('en'));
      const track = preferred || tracks[0];
      const trackId = track.id;

      // Step 2: Download caption content (requires OAuth)
      const downloadRes = await axios.get(
        `${YOUTUBE_API_BASE}/captions/${encodeURIComponent(trackId)}`,
        {
          params: { tfmt: 'srt' },
          headers: ytHeaders,
          timeout: 8000,
          responseType: 'text',
        }
      );

      const captions = parseSrt(downloadRes.data);
      return res.json({ captions, source: 'youtube-api', language: track.snippet?.language });
    } catch (ytErr) {
      if (ytErr.response?.status === 403 || ytErr.response?.status === 404) {
        return res.status(404).json({
          error: { message: 'No captions available for this video.' },
          captions: [],
        });
      }
      throw ytErr;
    }
  });

  return router;
}

/**
 * Parse simple SRT subtitle format into segments array.
 */
function parseSrt(srt) {
  const blocks = srt.trim().split(/\n\s*\n/);
  const segments = [];

  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.trim()).filter(Boolean);
    if (lines.length < 3) continue;

    // Line 2 is the timestamp line (e.g. "00:00:01,500 --> 00:00:04,000")
    const timeMatch = lines[1]?.match(
      /(\d{2}):(\d{2}):(\d{2})[,.](\d{3})\s*-->\s*(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/
    );
    if (!timeMatch) continue;

    const startMs =
      parseInt(timeMatch[1]) * 3600000 +
      parseInt(timeMatch[2]) * 60000 +
      parseInt(timeMatch[3]) * 1000 +
      parseInt(timeMatch[4]);

    const endMs =
      parseInt(timeMatch[5]) * 3600000 +
      parseInt(timeMatch[6]) * 60000 +
      parseInt(timeMatch[7]) * 1000 +
      parseInt(timeMatch[8]);

    const duration = (endMs - startMs) / 1000;
    const start = startMs / 1000;

    // Everything after the timestamp is caption text
    const text = lines.slice(2).join(' ').replace(/<[^>]+>/g, '').trim();

    if (text) {
      segments.push({ text, start, duration });
    }
  }

  return segments;
}

module.exports = { createCaptionsRouter };
