/**
 * Client-side captions utility — no yt-dlp, no fs, no Node APIs.
 * Ported from transcribe.js get() path: videoId + InnerTube fetch + dedupe.
 * Controlled via featureConfig `captions` (enabled/quota).
 */

export interface CaptionSegment {
  text: string;
  start: number; // seconds
  duration: number;
}

export function videoId(url: string): string | null {
  if (/^[A-Za-z0-9_-]{11}$/.test(url)) return url;
  let m = url.match(/[?&]v=([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = url.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  m = url.match(/\/(?:shorts|embed|live|v)\/([A-Za-z0-9_-]{11})/);
  if (m) return m[1];
  return null;
}

export function msToTs(ms: number): string {
  const h = String(Math.floor(ms / 3600000)).padStart(2, '0');
  const m = String(Math.floor((ms % 3600000) / 60000)).padStart(2, '0');
  const s = String(Math.floor((ms % 60000) / 1000)).padStart(2, '0');
  const f = String(ms % 1000).padStart(3, '0');
  return `${h}:${m}:${s},${f}`;
}

// Dedupe port from dedupe.py / transcribe.js dedupeSrt — handles YouTube's rolling-window repeats
export function dedupeSrt(data: string): string {
  const blocks = data.trim().split(/\n\s*\n/);
  const seen: string[] = [];
  const out: string[] = [];
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
    if (newWords.length) {
      out.push(`${start} ${newWords.join(' ')}`);
      seen.push(...newWords);
    }
  }
  return out.join('\n') + '\n';
}

function decodeEntities(s: string): string {
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

// Official YouTube Data API v3 — https://developers.google.com/youtube/v3/docs/captions
// captions.list + captions.download (requires OAuth youtube.force-ssl, owned video or public with permission)
export async function fetchCaptionsViaYouTubeAPI(videoId: string, youtubeAccessToken: string): Promise<string> {
  if (!youtubeAccessToken) throw new Error('missing YouTube access token — re-authenticate');
  // 1) list tracks
  const listRes = await fetch(`https://www.googleapis.com/youtube/v3/captions?part=snippet&videoId=${encodeURIComponent(videoId)}`, {
    headers: { Authorization: `Bearer ${youtubeAccessToken}` },
  });
  if (!listRes.ok) {
    const body = await listRes.text().catch(() => '');
    if (listRes.status === 401 || listRes.status === 403) throw new Error(`YouTube auth failed (${listRes.status}) — re-authenticate: ${body.slice(0,120)}`);
    throw new Error(`captions.list failed (${listRes.status}): ${body.slice(0,200)}`);
  }
  const listJson = await listRes.json() as { items?: Array<{ id: string; snippet: { language: string; trackKind: string; name?: string; isDraft?: boolean } }> };
  const items = listJson.items || [];
  if (!items.length) throw new Error('no captions available for this video');
  // prefer en standard > en ASR > any en > first
  let track = items.find((t) => t.snippet.language === 'en' && t.snippet.trackKind !== 'ASR')
    || items.find((t) => t.snippet.language === 'en')
    || items[0];
  if (!track) throw new Error('no transcription available');
  // 2) download as SRT
  const dlRes = await fetch(`https://www.googleapis.com/youtube/v3/captions/${encodeURIComponent(track.id)}?tfmt=srt`, {
    headers: { Authorization: `Bearer ${youtubeAccessToken}` },
  });
  if (!dlRes.ok) {
    const body = await dlRes.text().catch(() => '');
    throw new Error(`captions.download failed (${dlRes.status}): ${body.slice(0,200)}`);
  }
  const srt = await dlRes.text();
  if (!srt || !srt.trim()) throw new Error('no transcription available');
  return srt;
}

export function parseSrtToSegments(srt: string): CaptionSegment[] {
  const cleaned = dedupeSrt(srt);
  // cleaned format is "HH:MM:SS,mmm text" per line — convert back to segments
  // Re-parse original srt blocks into timed segments for UI
  const blocks = srt.trim().split(/\n\s*\n/);
  const segs: CaptionSegment[] = [];
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
  // If deduped version differs, rebuild segs from deduped lines as fallback
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

// High-level helper for VideoDetailDialog — fetches + dedupes + parses (official API)
export async function getCaptions(videoIdStr: string, youtubeAccessToken: string): Promise<CaptionSegment[]> {
  const id = videoId(videoIdStr) || videoIdStr;
  if (!id || !/^[A-Za-z0-9_-]{11}$/.test(id)) throw new Error('invalid video id');
  const srt = await fetchCaptionsViaYouTubeAPI(id, youtubeAccessToken);
  return parseSrtToSegments(srt);
}
