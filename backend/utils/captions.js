"use strict";

/**
 * Server-side captions utility — same core as frontend/src/utils/captions.ts
 * No yt-dlp, no fs side-effects here (caller handles caching). Controlled via
 * featureConfig `captions` (enabled/quota) like other pages.
 */

function videoId(url) {
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  let m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = url.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

function msToTs(ms) {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
}

function dedupeSrt(data) {
  const blocks = data.trim().split(/\n\s*\n/);
  const seen = [];
  const out = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
    if (lines.length && /^\d+$/.test(lines[0].trim())) lines.shift();
    if (!lines.length) continue;
    const m = lines[0].match(/^(\d\d:\d\d:\d\d,\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d,\d\d\d)/);
    if (!m) continue;
    const start = m[1];
    const text = lines.slice(1).join(' ').trim();
    const words = text.split(/\s+/).filter(Boolean);
    let overlap = 0;
    for (let n = Math.min(seen.length, words.length); n > 0; n--) {
      const tail = seen.slice(seen.length - n);
      const head = words.slice(0, n);
      if (tail.join(' ') === head.join(' ')) { overlap = n; break; }
    }
    const newWords = words.slice(overlap);
    if (newWords.length) { out.push(`${start} ${newWords.join(' ')}`); seen.push(...newWords); }
  }
  return out.join('\n') + '\n';
}

function decodeEntities(s) {
  return s
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&nbsp;/g, ' ')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, ' ')
    .trim();
}

async function fetchCaptionsViaYouTubeAPI(videoId, youtubeAccessToken) {
  if (!youtubeAccessToken) throw new Error('missing YouTube access token — re-authenticate');
  const listRes = await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${youtubeAccessToken}` },
  });
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => '');
    if (listRes.status === 401 || listRes.status === 403) throw new Error(`YouTube auth failed (${listRes.status}) — re-authenticate: ${body.slice(0, 120)}`);
    throw new Error(`captions.list failed (${listRes.status}): ${body.slice(0, 200)}`);
  }
  const listJson = await listRes.json();
  const items = listJson.items || [];
  if (!items.length) throw new Error('no captions available for this video');
  let track = items.find((t) => t.snippet.language === 'en' && t.snippet.trackKind !== 'ASR') || items.find((t) => t.snippet.language === 'en') || items[0];
  if (!track) throw new Error('no transcription available');
  const dlRes = await fetch(`https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}?tfmt=srt`, {
    headers: { Authorization: `Bearer ${youtubeAccessToken}` },
  });
  if (!dlRes.ok) {
    const body = await dlRes.text().catch(() => '');
    throw new Error(`captions.download failed (${dlRes.status}): ${body.slice(0, 200)}`);
  }
  const srt = await dlRes.text();
  if (!srt || !srt.trim()) throw new Error('no transcription available');
  return srt;
}

function parseSrtToSegments(srt) {
  const cleaned = dedupeSrt(srt);
  const blocks = srt.trim().split(/\n\s*\n/);
  const segs = [];
  for (const block of blocks) {
    const lines = block.split('\n').map((l) => l.replace(/\r$/, ''));
    if (lines.length && /^\d+$/.test(lines[0].trim())) lines.shift();
    if (!lines.length) continue;
    const m = lines[0].match(/^(\d\d):(\d\d):(\d\d),(\d\d\d)\s*-->\s*(\d\d):(\d\d):(\d\d),(\d\d\d)/);
    if (!m) continue;
    const start = Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3]) + Number(m[4]) / 1000;
    const end = Number(m[5]) * 3600 + Number(m[6]) * 60 + Number(m[7]) + Number(m[8]) / 1000;
    const text = decodeEntities(lines.slice(1).join(' '));
    if (text) segs.push({ text, start, duration: Math.max(0, end - start) });
  }
  if (cleaned && cleaned.trim().length && segs.length === 0) {
    for (const line of cleaned.split('\n')) {
      const mm = line.match(/^(\d\d):(\d\d):(\d\d),(\d\d\d)\s+(.*)$/);
      if (!mm) continue;
      const start = Number(mm[1]) * 3600 + Number(mm[2]) * 60 + Number(mm[3]) + Number(mm[4]) / 1000;
      segs.push({ text: mm[5], start, duration: 2 });
    }
  }
  return segs;
}

async function getCaptions(videoIdStr, youtubeAccessToken) {
  const id = videoId(videoIdStr) || videoIdStr;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('invalid video id');
  const srt = await fetchCaptionsViaYouTubeAPI(id, youtubeAccessToken);
  return parseSrtToSegments(srt);
}

module.exports = { videoId, msToTs, dedupeSrt, fetchCaptionsViaYouTubeAPI, parseSrtToSegments, getCaptions };
