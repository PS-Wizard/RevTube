/**
 * Channel Focus & Knowledge Service
 *
 * One editable "focus" record per (channel, scope) where scope is personal
 * (organization_id NULL) or one organization — the same scoping model as
 * channel_goals. Flow: AI generates the initial focus from channel data
 * (initial audit), it is saved, and the user can edit it afterwards.
 */
const { eq, and, sql, desc } = require('drizzle-orm');
const { channelFocus, analyticsChannels, analyticsVideos } = require('../db/schema');
const { sanitizeCacheSegment } = require('../utils/cacheScope');

const FOCUS_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PILLARS = 6;
// Top-level context only (never a detailed per-video audit): enough for the
// AI to ground niche/pillars/audience without burning quota on depth.
const CONTEXT_TOP_VIDEOS = 15;
const PROMPT_VIDEOS = 10;
const PROMPT_PLAYLISTS = 12;
const STOPWORDS = new Set(
  'the,a,an,and,or,of,to,in,on,for,with,by,at,from,as,is,are,was,were,be,been,it,its,this,that,these,those,you,your,we,our,they,their,he,she,his,her,video,videos,watch,new,best,top,how,why,what,all,part,episode,official,full,hd'.split(','),
);

function normalizeOrgId(organizationId) {
  if (organizationId === undefined || organizationId === null) return null;
  const s = String(organizationId).trim();
  return s ? s : null;
}

function focusCacheKey(channelId, organizationId) {
  const ch = sanitizeCacheSegment(channelId);
  const org = normalizeOrgId(organizationId);
  return org
    ? `chfocus:org:${sanitizeCacheSegment(org)}:${ch}`
    : `chfocus:personal:${ch}`;
}

/** Whitelist + trim user input; pillars capped at MAX_PILLARS non-empty strings. */
function sanitizeFocusInput(input = {}) {
  const str = (v, max = 2000) => {
    if (v === undefined || v === null) return null;
    const s = String(v).trim();
    if (!s) return null;
    return s.length > max ? s.slice(0, max) : s;
  };
  const pillars = Array.isArray(input.contentPillars)
    ? input.contentPillars.map((p) => String(p || '').trim()).filter(Boolean).slice(0, MAX_PILLARS)
    : Array.isArray(input.content_pillars)
      ? input.content_pillars.map((p) => String(p || '').trim()).filter(Boolean).slice(0, MAX_PILLARS)
      : undefined;
  const out = {
    niche: str(input.niche, 500),
    audience: str(input.audience, 2000),
    tone: str(input.tone, 500),
    goalsNotes: input.goalsNotes !== undefined ? str(input.goalsNotes, 4000) : str(input.goals_notes, 4000),
  };
  if (pillars !== undefined) out.contentPillars = pillars;
  return out;
}

function topWords(texts, limit = 5) {
  const counts = new Map();
  for (const t of texts) {
    for (const raw of String(t || '').toLowerCase().split(/[^a-z0-9]+/)) {
      if (raw.length < 3 || STOPWORDS.has(raw)) continue;
      counts.set(raw, (counts.get(raw) || 0) + 1);
    }
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, limit).map(([w]) => w);
}

/**
 * Deterministic fallback when no LLM key is configured: derives a first
 * draft from the channel snapshot (titles/descriptions/tags/stats).
 * Pure — safe to unit test.
 */
function buildHeuristicFocus(snapshot = {}) {
  const title = String(snapshot.title || snapshot.channelTitle || '').trim();
  const description = String(snapshot.description || '').trim();
  const tags = Array.isArray(snapshot.tags) ? snapshot.tags : [];
  const videos = Array.isArray(snapshot.topVideos) ? snapshot.topVideos : [];
  const videoTexts = videos.map((v) => `${v?.title || ''} ${Array.isArray(v?.tags) ? v.tags.join(' ') : ''}`);
  const topics = topWords([description, tags.join(' '), ...videoTexts], 5);
  const niche = topics.length
    ? `${topics.slice(0, 3).join(' / ')}${title ? ` — ${title}` : ''}`
    : (title || 'General');
  const stats = snapshot.stats || {};
  const subs = Number(stats.subscriberCount) || 0;
  const views = Number(stats.viewCount) || 0;
  const audience = subs || views
    ? `Est. audience from channel data: ${subs ? `${subs.toLocaleString('en-US')} subscribers` : ''}${subs && views ? ', ' : ''}${views ? `${views.toLocaleString('en-US')} total views` : ''}. Refine who this content serves best.`
    : 'Audience not yet described — edit after reviewing analytics.';
  return {
    niche,
    audience,
    contentPillars: topics.slice(0, 4),
    tone: '',
    goalsNotes: videos.length
      ? `Based on ${videos.length} sampled video(s). Review pillars against full analytics, then edit.`
      : 'Initial draft from channel metadata. Review against analytics, then edit.',
  };
}

/**
 * Condense a full audit bundle ({ channel, videos, playlists } as produced
 * by gatherAuditInput) into top-level context: channel facts, top videos by
 * views, playlist titles + sizes. Pure — safe to unit test.
 */
function summarizeAuditInput(input = {}) {
  const channel = input?.channel || {};
  const videos = (Array.isArray(input?.videos) ? input.videos : [])
    .map((v) => ({
      title: v?.title || '',
      viewCount: Number(v?.viewCount) || 0,
      likeCount: Number(v?.likeCount) || 0,
      tags: Array.isArray(v?.tags) ? v.tags.slice(0, 8) : [],
    }))
    .sort((a, b) => b.viewCount - a.viewCount);
  const totalViews = videos.reduce((s, v) => s + v.viewCount, 0);
  const totalLikes = videos.reduce((s, v) => s + v.likeCount, 0);
  const playlists = (Array.isArray(input?.playlists) ? input.playlists : [])
    .map((p) => ({ title: p?.title || '', size: Number(p?.size) || 0 }))
    .filter((p) => p.title)
    .sort((a, b) => b.size - a.size)
    .slice(0, PROMPT_PLAYLISTS);
  return {
    title: channel.name || channel.username || '',
    description: channel.description || '',
    tags: Array.isArray(channel.keywords) ? channel.keywords : [],
    stats: {
      videoCount: videos.length,
      totalViews,
      avgLikeRate: totalViews > 0 ? totalLikes / totalViews : 0,
    },
    topVideos: videos.slice(0, CONTEXT_TOP_VIDEOS).map((v) => ({
      title: v.title,
      viewCount: v.viewCount,
      tags: v.tags,
    })),
    playlists,
  };
}

/**
 * Render a saved focus as a compact prompt section for ANY audit or AI
 * service (chat, video audit, playlist/thumbnail optimizers, orchestrator).
 * Owner-defined and manually editable — consumers must prefer it over
 * inference. Pure — safe to unit test. Returns '' when there is no focus.
 */
function buildFocusContextBlock(focus) {
  if (!focus || typeof focus !== 'object') return '';
  const lines = [];
  if (focus.niche) lines.push(`- Niche: ${focus.niche}`);
  if (focus.audience) lines.push(`- Audience: ${focus.audience}`);
  if (Array.isArray(focus.contentPillars) && focus.contentPillars.length) {
    lines.push(`- Content pillars: ${focus.contentPillars.join(', ')}`);
  }
  if (focus.tone) lines.push(`- Tone/voice: ${focus.tone}`);
  if (focus.goalsNotes) lines.push(`- Goals: ${focus.goalsNotes}`);
  if (!lines.length) return '';
  return [
    'CHANNEL FOCUS & KNOWLEDGE (owner-defined for this channel — prefer over inference):',
    ...lines,
  ].join('\n');
}

function toPublicRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    channelId: row.channelId,
    organizationId: row.organizationId || null,
    niche: row.niche || '',
    audience: row.audience || '',
    contentPillars: Array.isArray(row.contentPillars) ? row.contentPillars : [],
    tone: row.tone || '',
    goalsNotes: row.goalsNotes || '',
    source: row.source || 'manual',
    createdBy: row.createdBy,
    updatedAt: row.updatedAt,
  };
}

function createChannelFocusService(deps = {}) {
  const { getDb, getCachedOrgMembership, getCachedUser, deepSeekJson, serverCache } = deps;
  // Live "initial audit" bundle ({ channel, videos, playlists }). Injected
  // late because gatherAuditInput is defined after this service in index.js —
  // see setAuditInputSource. Null in tests / DB-only environments.
  let getAuditInput = deps.getAuditInput || null;

  function setAuditInputSource(fn) {
    getAuditInput = typeof fn === 'function' ? fn : null;
  }

  async function isSysAdmin(authUser) {
    try {
      if (!authUser?.email || typeof getCachedUser !== 'function') return false;
      const rec = await getCachedUser(authUser.email);
      return rec?.role === 'admin';
    } catch {
      return false;
    }
  }

  async function canRead(authUser, organizationId) {
    if (!authUser?.uid) return false;
    const orgId = normalizeOrgId(organizationId);
    if (!orgId) return true;
    if (await isSysAdmin(authUser)) return true;
    try {
      return !!(await getCachedOrgMembership(String(orgId), authUser.uid));
    } catch {
      return false;
    }
  }

  async function canManage(authUser, organizationId) {
    if (!authUser?.uid) return false;
    if (await isSysAdmin(authUser)) return true;
    const orgId = normalizeOrgId(organizationId);
    if (!orgId) return true;
    try {
      const member = await getCachedOrgMembership(String(orgId), authUser.uid);
      return !!(member && (member.role === 'owner' || member.role === 'admin' || member.role === 'write'));
    } catch {
      return false;
    }
  }

  async function getFocus(channelId, organizationId = null) {
    if (!channelId) return null;
    const orgId = normalizeOrgId(organizationId);
    const cacheKey = focusCacheKey(channelId, orgId);
    if (serverCache) {
      try {
        const cached = await serverCache.get(cacheKey);
        if (cached) return cached;
      } catch { /* cache miss — fall through to DB */ }
    }
    const db = getDb ? getDb() : null;
    if (!db) return null;
    const rows = await db
      .select()
      .from(channelFocus)
      .where(
        orgId
          ? and(eq(channelFocus.channelId, String(channelId)), eq(channelFocus.organizationId, orgId))
          : and(eq(channelFocus.channelId, String(channelId)), sql`${channelFocus.organizationId} IS NULL`),
      )
      .limit(1);
    const pub = toPublicRow(rows[0] || null);
    if (pub && serverCache) {
      try { await serverCache.set(cacheKey, pub, FOCUS_CACHE_TTL_MS); } catch { /* best-effort */ }
    }
    return pub;
  }

  async function upsertFocus(data = {}) {
    const db = getDb ? getDb() : null;
    if (!db) throw new Error('Database not configured');
    const channelId = String(data.channelId || '').trim();
    if (!channelId) throw new Error('Missing channelId');
    const orgId = normalizeOrgId(data.organizationId);
    const clean = sanitizeFocusInput(data);
    const now = new Date();
    const base = {
      channelId,
      organizationId: orgId,
      createdBy: String(data.createdBy || 'anonymous'),
      niche: clean.niche,
      audience: clean.audience,
      contentPillars: clean.contentPillars !== undefined ? clean.contentPillars : [],
      tone: clean.tone,
      goalsNotes: clean.goalsNotes,
      source: data.source === 'ai' ? 'ai' : 'manual',
      updatedAt: now,
    };
    if (data.aiSnapshot !== undefined) base.aiSnapshot = data.aiSnapshot;

    const existing = await db
      .select({ id: channelFocus.id })
      .from(channelFocus)
      .where(
        orgId
          ? and(eq(channelFocus.channelId, channelId), eq(channelFocus.organizationId, orgId))
          : and(eq(channelFocus.channelId, channelId), sql`${channelFocus.organizationId} IS NULL`),
      )
      .limit(1);

    let row;
    if (existing.length) {
      const { createdBy, channelId: _c, organizationId: _o, ...updatable } = base;
      const updated = await db
        .update(channelFocus)
        .set(updatable)
        .where(eq(channelFocus.id, existing[0].id))
        .returning();
      row = updated[0];
    } else {
      const inserted = await db.insert(channelFocus).values({ ...base, createdAt: now }).returning();
      row = inserted[0];
    }
    const pub = toPublicRow(row);
    if (serverCache) {
      const cacheKey = focusCacheKey(channelId, orgId);
      try {
        if (typeof serverCache.delete === 'function') await serverCache.delete(cacheKey);
        await serverCache.set(cacheKey, pub, FOCUS_CACHE_TTL_MS);
      } catch { /* best-effort */ }
    }
    return pub;
  }

  /**
   * Gather top-level channel context for generation, cheapest source first:
   *  1. Postgres analytics (ingested catalog — free, no YouTube quota),
   *  2. live "initial audit" bundle (channel + videos + playlists, billable),
   *  3. caller-provided snapshot only.
   * Returns { dataSource: 'db'|'live'|'snapshot', fetchedLive, title,
   * description, tags, stats, topVideos, playlists }.
   */
  async function getChannelContext(channelId, { authHeader, snapshot = {} } = {}) {
    const fallback = {
      dataSource: 'snapshot',
      fetchedLive: false,
      title: snapshot.title || snapshot.channelTitle || '',
      description: snapshot.description || '',
      tags: Array.isArray(snapshot.tags) ? snapshot.tags : [],
      stats: snapshot.stats || {},
      topVideos: Array.isArray(snapshot.topVideos) ? snapshot.topVideos : [],
      playlists: [],
    };
    if (!channelId) return fallback;

    // 1. Postgres-first: already-ingested catalog (6h ingestion cron).
    const db = getDb ? getDb() : null;
    if (db) {
      try {
        const chRows = await db
          .select({ title: analyticsChannels.title })
          .from(analyticsChannels)
          .where(eq(analyticsChannels.channelId, String(channelId)))
          .limit(1);
        const vidRows = await db
          .select({
            title: analyticsVideos.title,
            description: analyticsVideos.description,
            tags: analyticsVideos.tags,
            viewCount: analyticsVideos.viewCount,
            likeCount: analyticsVideos.likeCount,
            publishedAt: analyticsVideos.publishedAt,
          })
          .from(analyticsVideos)
          .where(eq(analyticsVideos.channelId, String(channelId)))
          .orderBy(desc(analyticsVideos.viewCount))
          .limit(CONTEXT_TOP_VIDEOS);
        if (vidRows.length) {
          const summary = summarizeAuditInput({
            channel: {
              name: chRows[0]?.title || fallback.title,
              description: fallback.description,
              keywords: fallback.tags,
            },
            videos: vidRows,
            playlists: [],
          });
          return { ...summary, dataSource: 'db', fetchedLive: false };
        }
      } catch (err) {
        console.warn(`[channelFocus] DB context failed for ${channelId}: ${err?.message || err}`);
      }
    }

    // 2. Live fallback: full initial-audit bundle, condensed to top level.
    if (typeof getAuditInput === 'function') {
      try {
        const bundle = await getAuditInput({ channelId: String(channelId), authHeader });
        const summary = summarizeAuditInput(bundle || {});
        if (summary.topVideos.length || summary.title) {
          return { ...summary, dataSource: 'live', fetchedLive: true };
        }
      } catch (err) {
        console.warn(`[channelFocus] Live audit context failed for ${channelId}: ${err?.message || err}`);
      }
    }

    return fallback;
  }

  function buildFocusPrompt(enriched) {
    const videos = (enriched.topVideos || [])
      .slice(0, PROMPT_VIDEOS)
      .map((v) => `- ${v?.title || 'Untitled'}${v?.viewCount ? ` (${Number(v.viewCount).toLocaleString('en-US')} views)` : ''}`)
      .join('\n');
    const playlists = (enriched.playlists || [])
      .map((p) => `- ${p.title} (${p.size} videos)`)
      .join('\n');
    const stats = enriched.stats || {};
    return [
      'You analyze a YouTube channel and produce its Focus & Knowledge profile as JSON.',
      `Channel title: ${enriched.title || 'Unknown'}`,
      `Description: ${String(enriched.description || '').slice(0, 1500)}`,
      `Channel tags: ${(enriched.tags || []).slice(0, 15).join(', ') || 'none'}`,
      `Catalog: ${stats.videoCount ?? '?'} videos, ${Number(stats.totalViews || 0).toLocaleString('en-US')} total views${stats.avgLikeRate ? `, ${(Number(stats.avgLikeRate) * 100).toFixed(1)}% avg like rate` : ''}`,
      videos ? `Top videos by views:\n${videos}` : 'Top videos: none available',
      playlists ? `Playlists:\n${playlists}` : 'Playlists: none available',
      'Reply with JSON only: {"niche": "<1-line niche/focus>", "audience": "<2-3 sentence audience description>", "contentPillars": ["<pillar1>", "<pillar2>", "<pillar3>"], "tone": "<voice/tone, 1 line>", "goalsNotes": "<2-3 sentence growth direction>"}',
      'Ground EVERY field in the actual videos/playlists above — never generic advice. Keep contentPillars to 3-5 short noun phrases.',
    ].join('\n');
  }

  /**
   * Build the AI first draft from channel data. Accepts either a bare
   * snapshot (backward compatible) or { channelId, authHeader, snapshot } —
   * with a channelId the server enriches from Postgres analytics first, then
   * a live channel+videos+playlists audit bundle. Tries the LLM (DeepSeek
   * JSON mode, same adapter as the video audit) and falls back to the
   * heuristic when no key is configured or the call fails.
   * Pure preview — never saves. Returns { ..., source, dataSource }.
   */
  async function generateFocus(args = {}) {
    const params = args && typeof args === 'object' && ('channelId' in args || 'snapshot' in args)
      ? args
      : { snapshot: args };
    const { channelId, authHeader, snapshot = {} } = params;
    const ctx = await getChannelContext(channelId, { authHeader, snapshot });
    // Merged view: live/DB facts win, snapshot fills the gaps.
    const enriched = {
      title: ctx.title || snapshot.title || snapshot.channelTitle || '',
      description: ctx.description || snapshot.description || '',
      tags: (ctx.tags && ctx.tags.length ? ctx.tags : snapshot.tags) || [],
      stats: { ...(snapshot.stats || {}), ...(ctx.stats || {}) },
      topVideos: (ctx.topVideos && ctx.topVideos.length ? ctx.topVideos : snapshot.topVideos) || [],
      playlists: ctx.playlists || [],
    };
    const heuristic = buildHeuristicFocus(enriched);
    if (typeof deepSeekJson !== 'function') return { ...heuristic, source: 'heuristic', dataSource: ctx.dataSource, fetchedLive: !!ctx.fetchedLive };
    try {
      const out = await deepSeekJson({ prompt: buildFocusPrompt(enriched) });
      if (!out || typeof out !== 'object') return { ...heuristic, source: 'heuristic', dataSource: ctx.dataSource, fetchedLive: !!ctx.fetchedLive };
      const clean = sanitizeFocusInput({
        niche: out.niche,
        audience: out.audience,
        contentPillars: out.contentPillars,
        tone: out.tone,
        goalsNotes: out.goalsNotes,
      });
      return {
        niche: clean.niche || heuristic.niche,
        audience: clean.audience || heuristic.audience,
        contentPillars: (clean.contentPillars && clean.contentPillars.length ? clean.contentPillars : heuristic.contentPillars),
        tone: clean.tone || heuristic.tone,
        goalsNotes: clean.goalsNotes || heuristic.goalsNotes,
        source: 'ai',
        dataSource: ctx.dataSource, fetchedLive: !!ctx.fetchedLive,
      };
    } catch (err) {
      console.warn(`[channelFocus] LLM generate failed, using heuristic: ${err?.message || err}`);
      return { ...heuristic, source: 'heuristic', dataSource: ctx.dataSource, fetchedLive: !!ctx.fetchedLive };
    }
  }

  /**
   * Best-effort focus lookup for AI consumers (audits, chat, optimizers).
   * Uses the read cache; never throws — callers treat null as "no focus" and
   * fall back to inference. No permission check: callers already authorized
   * the channel (ownership / membership) before invoking AI.
   */
  async function getFocusForAI(channelId, organizationId = null) {
    if (!channelId) return null;
    try {
      return await getFocus(String(channelId), organizationId);
    } catch (err) {
      console.warn(`[channelFocus] getFocusForAI failed for ${channelId}: ${err?.message || err}`);
      return null;
    }
  }

  return { canRead, canManage, getFocus, upsertFocus, generateFocus, getChannelContext, setAuditInputSource, getFocusForAI };
}

module.exports = {
  createChannelFocusService,
  normalizeOrgId,
  focusCacheKey,
  sanitizeFocusInput,
  buildHeuristicFocus,
  summarizeAuditInput,
  buildFocusContextBlock,
  FOCUS_CACHE_TTL_MS,
};
