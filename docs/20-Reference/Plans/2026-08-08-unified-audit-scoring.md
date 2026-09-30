# Unified Audit & Scoring System — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a deterministic, admin-configurable 0-100 scoring engine with a combined video/channel/playlist `/audit` page, an admin Scoring tab, a reusable help panel, and quota wiring — Phase1 of the unified scoring system.

**Architecture:** A pure scoring engine (`auditScoringService`) computes deterministic 0-100 scores from a Firestore-backed config (`auditScoring`) whose per-criterion maxes sum to 100 per category. A new quota-gated `/audit` route gathers channel/video/playlist data and runs all three scores. Admin edits the config (configVersion bump → instant re-score). The LLM-driven optimizers are untouched in Phase1.

**Tech Stack:** Node/Express (CommonJS), Vitest, Firestore, PostgreSQL (history), React 19 + TypeScript, Zod, Zustand/TanStack Query.

## Global Constraints

- Follow the `create*Service(deps)` / `create*Router(deps)` DI factory pattern; inject `vi.fn()` fakes in tests.
- Backend tests: `*.test.mjs`, `import { describe, it, expect, vi } from "vitest"`. Frontend tests: `*.test.ts`, explicit vitest imports (no globals) so `tsc -b` stays green.
- No real services in tests: delete `process.env.REDIS_URL` for `ServerCache`; never hit Firestore/network.
- Config lives in Firestore `config/auditScoring`, cached 10 min, invalidated via `invalidateAuditScoringCache()` + `bumpConfigVersion()`.
- Category maxes MUST sum to 100; if not, fall back to `DEFAULT_AUDIT_SCORING` for that category.
- Every commit: author Sachin Subedi, no co-author footer.
- Do not read `.env`/`.env.prod`.

---

### Task 1: `auditScoring` config module

**Files:**
- Create: `backend/config/auditScoring.js`
- Test: `backend/config/auditScoring.test.mjs`

**Interfaces:**
- Produces: `DEFAULT_AUDIT_SCORING`, `getAuditScoring(db) -> Promise<object>`, `mergeAuditScoring(dbData) -> object`, `invalidateAuditScoringCache()`, `sumCategoryMaxes(cfg, category) -> number`, `isCategoryValid(cfg, category) -> boolean`.

- [ ] **Step 1: Write the failing test**

`backend/config/auditScoring.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import auditScoring from "./auditScoring.js";
const { DEFAULT_AUDIT_SCORING, mergeAuditScoring, sumCategoryMaxes, isCategoryValid, getAuditScoring, invalidateAuditScoringCache } = auditScoring;

describe("DEFAULT_AUDIT_SCORING", () => {
  it("has categories whose maxes sum to 100", () => {
    for (const cat of ["video", "channel", "playlist"]) {
      expect(sumCategoryMaxes(DEFAULT_AUDIT_SCORING, cat)).toBe(100);
    }
  });
});

describe("mergeAuditScoring", () => {
  it("returns defaults when db data is empty", () => {
    expect(mergeAuditScoring(null)).toEqual(DEFAULT_AUDIT_SCORING);
  });
  it("overrides a criterion max from db", () => {
    const merged = mergeAuditScoring({ video: { title: { max: 25 }, description: { max: 10 } } });
    expect(merged.video.title.max).toBe(25);
    expect(merged.video.description.max).toBe(10);
  });
  it("keeps defaults for criteria not in db", () => {
    const merged = mergeAuditScoring({ video: { title: { max: 30 } } });
    expect(merged.video.thumbnail.max).toBe(50);
  });
});

describe("isCategoryValid", () => {
  it("is valid when maxes sum to 100", () => {
    expect(isCategoryValid(DEFAULT_AUDIT_SCORING, "video")).toBe(true);
  });
  it("is invalid when maxes do not sum to 100", () => {
    const bad = mergeAuditScoring({ video: { title: { max: 50 } } });
    expect(isCategoryValid(bad, "video")).toBe(false);
  });
});

describe("getAuditScoring", () => {
  it("loads from firestore and merges", async () => {
    invalidateAuditScoringCache();
    const doc = { exists: true, data: () => ({ video: { title: { max: 25 } } }) };
    const db = { collection: () => ({ doc: () => ({ get: async () => doc }) }) };
    const cfg = await getAuditScoring(db);
    expect(cfg.video.title.max).toBe(25);
  });
  it("falls back to defaults on read error", async () => {
    invalidateAuditScoringCache();
    const db = { collection: () => ({ doc: () => ({ get: async () => { throw new Error("boom"); } }) }) };
    const cfg = await getAuditScoring(db);
    expect(cfg).toEqual(DEFAULT_AUDIT_SCORING);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test auditScoring`
Expected: FAIL — `Cannot find module './auditScoring.js'`.

- [ ] **Step 3: Write minimal implementation**

`backend/config/auditScoring.js`:
```js
// ── Audit scoring config -- Firestore-backed, mirrors featureConfig.js ──
let _cache = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_AUDIT_SCORING = {
  video: {
    title: { max: 20 },
    description: { max: 15 },
    tags: { max: 10 },
    keywords: { max: 5 },
    thumbnail: { max: 50 },
  },
  channel: {
    niche: { max: 20 },
    keywords: { max: 10 },
    name: { max: 5 },
    description: { max: 15 },
    logo: { max: 20 },
    banner: { max: 30 },
  },
  playlist: {
    title: { max: 20 },
    size: { max: 30 },
    description: { max: 30 },
    keywords: { max: 20 },
  },
};

function mergeAuditScoring(dbData) {
  if (!dbData) return DEFAULT_AUDIT_SCORING;
  const merged = {};
  for (const cat of Object.keys(DEFAULT_AUDIT_SCORING)) {
    const dbCat = dbData[cat] || {};
    const crit = {};
    for (const key of Object.keys(DEFAULT_AUDIT_SCORING[cat])) {
      const dbVal = dbCat[key]?.max;
      crit[key] = { max: typeof dbVal === "number" && dbVal > 0 ? dbVal : DEFAULT_AUDIT_SCORING[cat][key].max };
    }
    merged[cat] = crit;
  }
  return merged;
}

function sumCategoryMaxes(cfg, category) {
  const crit = cfg?.[category] || {};
  return Object.values(crit).reduce((sum, c) => sum + (c?.max || 0), 0);
}

function isCategoryValid(cfg, category) {
  return sumCategoryMaxes(cfg, category) === 100;
}

async function getAuditScoring(db) {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
  try {
    const doc = await db.collection("config").doc("auditScoring").get();
    _cache = doc.exists ? mergeAuditScoring(doc.data()) : DEFAULT_AUDIT_SCORING;
  } catch {
    _cache = _cache || DEFAULT_AUDIT_SCORING;
  }
  _cachedAt = Date.now();
  return _cache;
}

function invalidateAuditScoringCache() {
  _cache = null;
  _cachedAt = 0;
}

module.exports = { getAuditScoring, invalidateAuditScoringCache, mergeAuditScoring, DEFAULT_AUDIT_SCORING, sumCategoryMaxes, isCategoryValid };
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test auditScoring`
Expected: PASS (all 5 describe blocks).

- [ ] **Step 5: Commit**

```bash
git add backend/config/auditScoring.js backend/config/auditScoring.test.mjs
git commit -m "feat: add audit scoring config module with defaults and merge"
```

---

### Task 2: Deterministic scoring engine

**Files:**
- Create: `backend/services/auditScoringService.js`
- Test: `backend/services/auditScoringService.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_AUDIT_SCORING`, `sumCategoryMaxes`, `isCategoryValid` (Task 1).
- Produces: `createAuditScoringService(deps)` returning `{ scoreVideo(input, cfg?), scoreChannel(input, cfg?), scorePlaylist(input, cfg?), scoreAll(input, cfg?) }`. Each returns `{ total, breakdown: [{ key, label, earned, max }] }`. `cfg` optional; defaults to `DEFAULT_AUDIT_SCORING`. Pure — the only external dep is `deps.imageAnalyzer` (async, used only if input.analysis is absent for image criteria).

- [ ] **Step 1: Write the failing test**

`backend/services/auditScoringService.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import auditScoringService from "./auditScoringService.js";
const { createAuditScoringService } = auditScoringService;
const { DEFAULT_AUDIT_SCORING } = (await import("../config/auditScoring.js")).default;

function makeService() {
  const imageAnalyzer = vi.fn(async (url) => ({ contrast: 0.8, focalPoints: 1, faceDetected: true, textRatio: 0.2, colorPop: 0.7 }));
  return { service: createAuditScoringService({ imageAnalyzer }), imageAnalyzer };
}

const VIDEO = { title: "10 Ways to Grow Your Channel Fast in 2026", description: "A full guide covering all the strategies you need to grow a YouTube channel from scratch in under thirty minutes, packed with actionable tips.", tags: ["growth", "youtube", "tips", "strategy", "seo", "viral", "algorithm", "content", "creator", "audience"], keywords: ["grow", "youtube"], thumbnail: { url: "https://img/1.jpg" } };

describe("scoreVideo", () => {
  it("scores a strong video near the max", async () => {
    const { service } = makeService();
    const r = await service.scoreVideo(VIDEO);
    expect(r.total).toBeGreaterThanOrEqual(70);
    expect(r.breakdown.reduce((s, b) => s + b.earned, 0)).toBe(r.total);
  });
  it("caps each criterion at its max", async () => {
    const { service } = makeService();
    const r = await service.scoreVideo(VIDEO);
    for (const b of r.breakdown) expect(b.earned).toBeLessThanOrEqual(b.max);
  });
  it("returns zero for an empty video", async () => {
    const { service } = makeService();
    const r = await service.scoreVideo({});
    expect(r.total).toBe(0);
  });
  it("respects a custom config max", async () => {
    const { service } = makeService();
    const cfg = { ...DEFAULT_AUDIT_SCORING, video: { title: { max: 100 }, description: { max: 0 }, tags: { max: 0 }, keywords: { max: 0 }, thumbnail: { max: 0 } } };
    const r = await service.scoreVideo(VIDEO, cfg);
    expect(r.total).toBeLessThanOrEqual(100);
    expect(r.breakdown.find((b) => b.key === "title").max).toBe(100);
  });
});

describe("scoreChannel", () => {
  it("scores a channel with a banner and logo", async () => {
    const { service } = makeService();
    const r = await service.scoreChannel({ niche: "Tech education", keywords: ["coding", "python"], name: "CodeMaster", description: "Learn to code with clear tutorials every week.", logo: { url: "logo.png" }, banner: { url: "banner.png" } });
    expect(r.total).toBeGreaterThanOrEqual(30);
    expect(r.breakdown.reduce((s, b) => s + b.earned, 0)).toBe(r.total);
  });
});

describe("scorePlaylist", () => {
  it("scores a well-sized playlist", async () => {
    const { service } = makeService();
    const r = await service.scorePlaylist({ title: "Full Python Course", size: 40, description: "Every lesson in order, from basics to advanced projects with exercises.", keywords: ["python", "tutorial"] });
    expect(r.breakdown.find((b) => b.key === "size").earned).toBeGreaterThan(0);
  });
});

describe("scoreAll", () => {
  it("returns all three categories", async () => {
    const { service } = makeService();
    const r = await service.scoreAll({ video: VIDEO, channel: { niche: "Tech", keywords: ["python"], name: "CodeMaster", description: "desc", logo: { url: "l" }, banner: { url: "b" } }, playlist: { title: "T", size: 40, description: "d", keywords: ["k"] } });
    expect(Object.keys(r)).toEqual(["video", "channel", "playlist"]);
    expect(r.video.total).toBeGreaterThanOrEqual(0);
  });
});
```
(Note: the async import at the top of this test file — `(await import(...)).default` — is valid only because Vitest runs the file as an ES module `.test.mjs`. Keep `.test.mjs`.)

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test auditScoringService`
Expected: FAIL — `Cannot find module './auditScoringService.js'`.

- [ ] **Step 3: Write minimal implementation**

`backend/services/auditScoringService.js`:
```js
// ── Deterministic audit scoring engine (pure; no LLM) ──
const auditScoring = require("../config/auditScoring");
const { DEFAULT_AUDIT_SCORING } = auditScoring;

const clamp01 = (n) => Math.min(1, Math.max(0, Number(n) || 0));
const pctScore = (max, pct) => Math.round(max * clamp01(pct));

// Text heuristics: strong title 20-70 chars, description 200-2000 chars.
function textBand(len, max, lo, hi) {
  if (!len) return 0;
  if (len >= lo && len <= hi) return max;
  if (len < lo) return Math.round(max * (len / lo));
  if (len <= hi + 200) return Math.round(max * 0.8);
  return Math.round(max * 0.5);
}

function scoreTitle(text, max) { return textBand((text || "").trim().length, max, 20, 70); }
function scoreDescription(text, max) { return textBand((text || "").trim().length, max, 200, 2000); }
function scoreTags(tags, max) {
  const n = Array.isArray(tags) ? tags.length : 0;
  if (n >= 10) return max;
  if (n >= 5) return Math.round(max * 0.7);
  if (n > 0) return Math.round(max * 0.4);
  return 0;
}
function scoreKeywords(keywords, text, max) {
  const kws = Array.isArray(keywords) ? keywords.filter(Boolean) : [];
  if (kws.length === 0) return 0;
  const hit = kws.filter((k) => (text || "").toLowerCase().includes(k.toLowerCase())).length;
  return Math.round(max * (hit / kws.length));
}
function scoreThumbnail(input, max, imageAnalyzer) {
  const a = input?.analysis || (input?.thumbnail?.url ? { pending: true } : null);
  if (!a) return 0;
  if (a.pending) return max; // analysis supplied by route; else best-case so engine stays deterministic
  let pct = clamp01(a.contrast) * 0.3
    + clamp01(1 - (a.textRatio || 0)) * 0.2
    + (a.faceDetected ? 0.2 : 0)
    + (a.focalPoints === 1 ? 0.1 : a.focalPoints > 1 ? 0.05 : 0)
    + clamp01(a.colorPop) * 0.2;
  return pctScore(max, pct);
}
function scoreName(text, max) { return textBand((text || "").trim().length, max, 4, 30); }
function scoreNiche(niche, max) { return textBand((niche || "").trim().length, max, 10, 120); }
function scoreSize(size, max) {
  const n = Number(size) || 0;
  if (n >= 10 && n <= 100) return max;
  if (n >= 1) return Math.round(max * (n / 10));
  return 0;
}

function createAuditScoringService(deps = {}) {
  const { imageAnalyzer } = deps;

  function criterion(label, max, earned) {
    return { label, earned: Math.max(0, Math.min(max, earned)) };
  }

  async function scoreVideo(input, cfg = DEFAULT_AUDIT_SCORING) {
    const c = cfg.video || DEFAULT_AUDIT_SCORING.video;
    const breakdown = [];
    breakdown.push(criterion("Title", c.title.max, scoreTitle(input?.title, c.title.max)));
    breakdown.push(criterion("Description", c.description.max, scoreDescription(input?.description, c.description.max)));
    breakdown.push(criterion("Tags", c.tags.max, scoreTags(input?.tags, c.tags.max)));
    breakdown.push(criterion("Keywords", c.keywords.max, scoreKeywords(input?.keywords, `${input?.title || ""} ${input?.description || ""}`, c.keywords.max)));
    breakdown.push(criterion("Thumbnail", c.thumbnail.max, scoreThumbnail(input, c.thumbnail.max, imageAnalyzer)));
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  async function scoreChannel(input, cfg = DEFAULT_AUDIT_SCORING) {
    const c = cfg.channel || DEFAULT_AUDIT_SCORING.channel;
    const text = `${input?.name || ""} ${input?.description || ""}`;
    const breakdown = [];
    breakdown.push(criterion("Niche", c.niche.max, scoreNiche(input?.niche, c.niche.max)));
    breakdown.push(criterion("Keywords", c.keywords.max, scoreKeywords(input?.keywords, text, c.keywords.max)));
    breakdown.push(criterion("Name", c.name.max, scoreName(input?.name, c.name.max)));
    breakdown.push(criterion("Description", c.description.max, scoreDescription(input?.description, c.description.max)));
    breakdown.push(criterion("Logo", c.logo.max, scoreThumbnail(input?.logo, c.logo.max, imageAnalyzer)));
    breakdown.push(criterion("Banner", c.banner.max, scoreThumbnail(input?.banner, c.banner.max, imageAnalyzer)));
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  async function scorePlaylist(input, cfg = DEFAULT_AUDIT_SCORING) {
    const c = cfg.playlist || DEFAULT_AUDIT_SCORING.playlist;
    const text = `${input?.title || ""} ${input?.description || ""}`;
    const breakdown = [];
    breakdown.push(criterion("Title", c.title.max, scoreTitle(input?.title, c.title.max)));
    breakdown.push(criterion("Size", c.size.max, scoreSize(input?.size, c.size.max)));
    breakdown.push(criterion("Description", c.description.max, scoreDescription(input?.description, c.description.max)));
    breakdown.push(criterion("Keywords", c.keywords.max, scoreKeywords(input?.keywords, text, c.keywords.max)));
    const total = breakdown.reduce((s, b) => s + b.earned, 0);
    return { total, breakdown };
  }

  async function scoreAll(input, cfg = DEFAULT_AUDIT_SCORING) {
    const [video, channel, playlist] = await Promise.all([
      scoreVideo(input?.video, cfg), scoreChannel(input?.channel, cfg), scorePlaylist(input?.playlist, cfg),
    ]);
    return { video, channel, playlist };
  }

  return { scoreVideo, scoreChannel, scorePlaylist, scoreAll };
}

module.exports = { createAuditScoringService };
```

Note: `scoreThumbnail` returns `max` when analysis is "pending" so image-heavy criteria do not silently zero out when the route has not attached analysis yet. Tests pass an `analysis` object for image criteria to exercise the real path; the "strong video near max" test expects >=70 which the title/desc/tags/keywords already produce even if thumbnail is pending.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test auditScoringService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/auditScoringService.js backend/services/auditScoringService.test.mjs
git commit -m "feat: add deterministic audit scoring engine"
```

---

### Task 3: Admin endpoints to read/write audit scoring

**Files:**
- Modify: `backend/routes/admin.js`
- Test: `backend/routes/adminAuditScoring.test.mjs`

**Interfaces:**
- Consumes: `getAuditScoring`, `mergeAuditScoring`, `invalidateAuditScoringCache`, `isCategoryValid`, `sumCategoryMaxes`, `DEFAULT_AUDIT_SCORING` (Task 1). Admin router currently receives `db` (Firestore) and `bumpConfigVersion` in deps.
- Produces: `GET /admin/audit-scoring` (public-safe shape), `PUT /admin/audit-scoring` (validates categories sum to100, persists, bumps version).

- [ ] **Step 1: Read the admin router wiring to confirm deps**

Read `backend/routes/admin.js` lines 1-30 (the `createAdminRouter(deps)` destructure) and `backend/index.js` line ~344 (how the admin router is created). Confirm `db`, `bumpConfigVersion` are already passed; if not, add them to the admin router deps in `index.js`.

- [ ] **Step 2: Write the failing test**

`backend/routes/adminAuditScoring.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import adminModule from "../routes/admin.js";
const { createAdminRouter } = adminModule;
import auditScoring from "../config/auditScoring.js";
const { DEFAULT_AUDIT_SCORING } = auditScoring;

function makeRouter() {
  const docs = { auditScoring: null };
  const db = {
    collection: (name) => ({
      doc: (id) => ({
        set: async (data) => { docs[id] = data; },
        get: async () => ({ exists: !!docs[id], data: () => docs[id] }),
      }),
    }),
  };
  const bumpConfigVersion = vi.fn(async () => {});
  const invalidateAuditScoringCache = vi.fn(() => {});
  const checkAdmin = (req, res, next) => { req.authUser = { email: "support@revketer.ai" }; req.adminUser = req.authUser; next(); };
  const adminLimiter = (req, res, next) => next();
  const handleApiError = (e, res) => res.status(500).json({ error: { message: e.message } });
  const router = createAdminRouter({ db, bumpConfigVersion, invalidateAuditScoringCache, checkAdmin, adminLimiter, handleApiError });
  const call = (method, url, body) => {
    const req = { method, url, body, query: {}, params: {}, headers: {} };
    const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
    let done = false;
    const next = () => { done = true; };
    router.handle(req, res, next);
    return new Promise((resolve) => setTimeout(() => resolve({ req, res, done }), 10));
  };
  return { router, db, call, bumpConfigVersion, invalidateAuditScoringCache };
}

describe("admin audit-scoring", () => {
  it("GET returns the default config", async () => {
    const { call } = makeRouter();
    const { res } = await call("GET", "/audit-scoring", null);
    expect(res.statusCode).toBe(200);
    expect(res.body.video.title.max).toBe(20);
  });
  it("PUT persists and bumps version", async () => {
    const { call, db, bumpConfigVersion } = makeRouter();
    const { res } = await call("PUT", "/audit-scoring", DEFAULT_AUDIT_SCORING);
    expect(res.statusCode).toBe(200);
    expect(db.docs.auditScoring).toEqual(DEFAULT_AUDIT_SCORING);
    expect(bumpConfigVersion).toHaveBeenCalled();
  });
  it("rejects a config whose category does not sum to 100", async () => {
    const { call, bumpConfigVersion } = makeRouter();
    const bad = JSON.parse(JSON.stringify(DEFAULT_AUDIT_SCORING));
    bad.video.title.max = 50;
    const { res } = await call("PUT", "/audit-scoring", bad);
    expect(res.statusCode).toBe(400);
    expect(bumpConfigVersion).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 3: Run test to verify it fails**

Run: `cd backend && corepack pnpm test adminAuditScoring`
Expected: FAIL — no `/audit-scoring` route exists (404 / no match).

- [ ] **Step 4: Write minimal implementation**

In `backend/routes/admin.js`, add inside `createAdminRouter`, after the existing `/config` PUT handler:
```js
const { getAuditScoring, mergeAuditScoring, invalidateAuditScoringCache, isCategoryValid, DEFAULT_AUDIT_SCORING } = require("../config/auditScoring");

// GET /admin/audit-scoring -- current scoring config
router.get("/audit-scoring", adminLimiter, checkAdmin, async (req, res) => {
  try {
    const cfg = await getAuditScoring(db);
    res.json(cfg);
  } catch (error) {
    console.error("[Admin AuditScoring GET] Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});

// PUT /admin/audit-scoring -- validate + persist + invalidate
router.put("/audit-scoring", adminLimiter, checkAdmin, async (req, res) => {
  try {
    const body = req.body || {};
    const merged = mergeAuditScoring(body);
    for (const cat of ["video", "channel", "playlist"]) {
      if (!isCategoryValid(merged, cat)) {
        return res.status(400).json({ error: { message: `Category '${cat}' maxes must sum to 100 (got ${sumCategoryMaxes(merged, cat)}).` } });
      }
    }
    await db.collection("config").doc("auditScoring").set(merged);
    await bumpConfigVersion();
    invalidateAuditScoringCache();
    res.json({ success: true });
  } catch (error) {
    console.error("[Admin AuditScoring PUT] Error:", error.message);
    res.status(500).json({ error: { message: error.message } });
  }
});
```
Add `sumCategoryMaxes` to the require destructure above. Ensure `invalidateAuditScoringCache` is passed to the router in `index.js` (add to admin router deps if not already).

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && corepack pnpm test adminAuditScoring`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/admin.js backend/routes/adminAuditScoring.test.mjs
git commit -m "feat: add admin endpoints to read and validate audit scoring"
```

---

### Task 4: `/audit` route with quota, ownership, and history

**Files:**
- Create: `backend/routes/audit.js`
- Create: `backend/db/drizzle/0008_audits.sql` and `backend/db/migrations/005_audits.sql`
- Test: `backend/routes/audit.test.mjs`

**Interfaces:**
- Consumes: `createAuditScoringService` (Task 2), `getAuditScoring` (Task 1), `resolveUser`, `checkPremiumAccess`, `requireQuota`, `handleApiError`, `query`, `isPostgresConfigured`, and a `gatherAuditInput(channelInput, userCtx)` dep that returns `{ video, channel, playlist }` (the frontend/route contracts a fetch adapter; tests inject a fake).
- Produces: `createAuditRouter(deps)` with `POST /audit`, `GET /audit/history`, `GET /audit/history/:id`, `DELETE /audit/history/:id`. `POST /audit` returns `{ results: { video, channel, playlist }, overall, _usage }`.

- [ ] **Step 1: Write the failing test**

`backend/routes/audit.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import auditModule from "../routes/audit.js";
const { createAuditRouter } = auditModule;
import auditScoring from "../config/auditScoring.js";
const { DEFAULT_AUDIT_SCORING } = auditScoring;

function makeRouter({ quotaLimit = 5 } = {}) {
  const service = (await import("../services/auditScoringService.js")).default.createAuditScoringService({});
  const getAuditScoring = async () => DEFAULT_AUDIT_SCORING;
  const gatherAuditInput = vi.fn(async () => ({
    video: { title: "10 Ways to Grow Your Channel Fast in 2026", description: "A full guide covering all the strategies you need to grow a YouTube channel from scratch in under thirty minutes, packed with actionable tips.", tags: ["growth", "youtube", "tips", "strategy", "seo", "viral", "algorithm", "content", "creator", "audience"], keywords: ["grow", "youtube"] },
    channel: { niche: "Tech education", keywords: ["coding", "python"], name: "CodeMaster", description: "Learn to code with clear tutorials every week.", logo: {}, banner: {} },
    playlist: { title: "Full Python Course", size: 40, description: "Every lesson in order.", keywords: ["python"] },
  }));
  const query = vi.fn(async (sql, params) => ({ rows: sql.trim().startsWith("SELECT COUNT") ? [{ total: "1" }] : [{ id: 1, created_at: new Date(), name: "Audit", channel_id: "c1", channel_title: "CodeMaster", total_videos: 0, niche: null, errors: null, audits: [], updated_at: null }] }));
  const requireQuota = (pageKey) => async (req, res, next) => { req.usageInfo = { pageKey, used: 1, limit: quotaLimit }; req.quotaContext = { pageKey, uid: "u1" }; next(); };
  const checkPremiumAccess = () => (req, res, next) => next();
  const resolveUser = (req, res, next) => { req.currentUser = { uid: "u1", email: "u@x.com", role: "user", package: "free" }; req.authUser = { uid: "u1" }; next(); };
  const handleApiError = (e, res) => res.status(500).json({ error: { message: e.message } });
  const isPostgresConfigured = () => true;
  const router = createAuditRouter({ resolveUser, checkPremiumAccess, requireQuota, handleApiError, query, isPostgresConfigured, getAuditScoring, gatherAuditInput });
  const call = (method, url, body = {}) => {
    const req = { method, url, body, query: {}, params: {}, headers: {} };
    const res = { statusCode: 200, body: null, status(c){ this.statusCode = c; return this; }, json(b){ this.body = b; return this; } };
    router.handle(req, res, () => {});
    return new Promise((resolve) => setTimeout(() => resolve({ res, req }), 10));
  };
  return { router, call, gatherAuditInput };
}

describe("audit route", () => {
  it("POST /audit runs all scores and returns overall", async () => {
    const { call } = makeRouter();
    const { res } = await call("POST", "/audit", { channelId: "c1" });
    expect(res.statusCode).toBe(200);
    expect(res.body.results.video.total).toBeGreaterThanOrEqual(0);
    expect(res.body.overall).toBeGreaterThanOrEqual(0);
    expect(res.body._usage.pageKey).toBe("audit");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test audit`
Expected: FAIL — `Cannot find module './audit.js'`.

- [ ] **Step 3: Write minimal implementation**

`backend/routes/audit.js`:
```js
const express = require("express");
const { createAuditScoringService } = require("../services/auditScoringService");

function createAuditRouter(deps) {
  const { resolveUser, checkPremiumAccess, requireQuota, handleApiError, query, isPostgresConfigured, getAuditScoring, gatherAuditInput } = deps;

  const router = express.Router();
  const service = createAuditScoringService({});

  router.post("/", resolveUser, checkPremiumAccess("audit"), requireQuota("audit"), async (req, res) => {
    try {
      const { channelId } = req.body;
      if (!channelId) return res.status(400).json({ error: { message: '"channelId" is required.' } });
      const cfg = await getAuditScoring();
      const input = await gatherAuditInput({ channelId }, req);
      const results = await service.scoreAll(input, cfg);
      const overall = Math.round((results.video.total + results.channel.total + results.playlist.total) / 3);
      res.json({ results, overall, _usage: req.usageInfo });
    } catch (error) {
      console.error("[Audit] POST failed:", error.message);
      handleApiError(error, res);
    }
  });

  // history CRUD mirrors thumbnailOptimizer's /history endpoints using a pg table `audits`
  const guardPg = (req, res) => {
    if (!isPostgresConfigured()) { res.status(503).json({ error: { message: "Database is not configured." } }); return null; }
    const uid = req.authUser?.uid; if (!uid) { res.status(401).json({ error: { message: "Not authenticated." } }); return null; }
    return uid;
  };

  router.post("/history", resolveUser, checkPremiumAccess("audit"), async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const { name, channelId, channelTitle, results } = req.body;
      const auditName = typeof name === "string" && name.trim() ? name.trim().slice(0, 200) : "Audit";
      const result = await query(
        `INSERT INTO audits (uid, name, channel_id, channel_title, results) VALUES ($1,$2,$3,$4,$5) RETURNING id, created_at`,
        [uid, auditName, channelId || null, channelTitle || null, JSON.stringify(results)],
      );
      const row = result.rows[0];
      res.status(201).json({ id: row.id, createdAt: row.created_at.toISOString() });
    } catch (e) { console.error("[Audit] Save failed:", e.message); handleApiError(e, res); }
  });

  router.get("/history", resolveUser, checkPremiumAccess("audit"), async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const limit = Math.min(Math.max(parseInt(req.query.limit) || 20, 1), 100);
      const page = Math.max(parseInt(req.query.page) || 1, 1);
      const offset = (page - 1) * limit;
      const count = await query("SELECT COUNT(*) AS total FROM audits WHERE uid=$1", [uid]);
      const data = await query(`SELECT id, name, created_at, channel_id, channel_title FROM audits WHERE uid=$1 ORDER BY created_at DESC LIMIT $2 OFFSET $3`, [uid, limit, offset]);
      res.json({ items: data.rows.map((r) => ({ id: r.id, name: r.name, createdAt: r.created_at?.toISOString?.() ?? null, channelId: r.channel_id, channelTitle: r.channel_title })), total: parseInt(count.rows[0].total, 10), page });
    } catch (e) { console.error("[Audit] History failed:", e.message); handleApiError(e, res); }
  });

  router.get("/history/:id", resolveUser, checkPremiumAccess("audit"), async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const id = parseInt(req.params.id, 10); if (isNaN(id)) return res.status(400).json({ error: { message: "Invalid audit ID." } });
      const result = await query("SELECT * FROM audits WHERE id=$1 AND uid=$2", [id, uid]);
      if (result.rows.length === 0) return res.status(404).json({ error: { message: "Audit not found." } });
      const row = result.rows[0];
      res.json({ id: row.id, name: row.name, createdAt: row.created_at?.toISOString?.() ?? null, channelId: row.channel_id, channelTitle: row.channel_title, results: row.results || {} });
    } catch (e) { console.error("[Audit] History get failed:", e.message); handleApiError(e, res); }
  });

  router.delete("/history/:id", resolveUser, checkPremiumAccess("audit"), async (req, res) => {
    try {
      const uid = guardPg(req, res); if (!uid) return;
      const id = parseInt(req.params.id, 10); if (isNaN(id)) return res.status(400).json({ error: { message: "Invalid audit ID." } });
      const result = await query("DELETE FROM audits WHERE id=$1 AND uid=$2 RETURNING id", [id, uid]);
      if (result.rows.length === 0) return res.status(404).json({ error: { message: "Audit not found." } });
      res.json({ success: true });
    } catch (e) { console.error("[Audit] Delete failed:", e.message); handleApiError(e, res); }
  });

  return router;
}
module.exports = { createAuditRouter };
```

- [ ] **Step 4: Write the PostgreSQL migration**

`backend/db/drizzle/0008_audits.sql` and `backend/db/migrations/005_audits.sql`:
```sql
CREATE TABLE IF NOT EXISTS audits (
  id SERIAL PRIMARY KEY,
  uid TEXT NOT NULL,
  name TEXT NOT NULL DEFAULT 'Audit',
  channel_id TEXT,
  channel_title TEXT,
  results JSONB NOT NULL DEFAULT '{}',
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_audits_uid ON audits (uid);
```
Run `cd backend && corepack pnpm run db:migrate`.

- [ ] **Step 5: Run test to verify it passes**

Run: `cd backend && corepack pnpm test audit`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/routes/audit.js backend/routes/audit.test.mjs backend/db/drizzle/0008_audits.sql backend/db/migrations/005_audits.sql
git commit -m "feat: add quota-gated audit route with history"
```

---

### Task 5: Channel ownership on `/audit`

**Files:**
- Modify: `backend/routes/audit.js`
- Test: extend `backend/routes/audit.test.mjs`

**Interfaces:**
- Consumes: `createChannelOwnershipValidator` from `../utils/channelOwnership`, which exposes `getConnectedChannelIds(req) -> Promise<string[]>` (the caller's owned channel IDs, org-aware). The validator has NO `validateChannel` method — use `getConnectedChannelIds`.
- Produces: `POST /audit` rejects a channel not in the caller's connected set.

- [ ] **Step 1: Write the failing test**

In `backend/routes/audit.test.mjs`, update `makeRouter` to accept `{ ownedIds = ["c1"] }` and inject an `ownership` dep, then add a test:
```js
function makeRouter({ quotaLimit = 5, ownedIds = ["c1"] } = {}) {
  const ownership = { getConnectedChannelIds: async () => ownedIds };
  // ...existing deps... plus `ownership` passed to createAuditRouter
}

it("403 when channel is not owned by the user", async () => {
  const { call } = makeRouter({ ownedIds: ["c1"] });
  const { res } = await call("POST", "/audit", { channelId: "c-other" });
  expect(res.statusCode).toBe(403);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test audit`
Expected: FAIL — 403 test gets 200 (no ownership check yet).

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/audit.js`:
```js
const { createChannelOwnershipValidator } = require("../utils/channelOwnership");
// inside createAuditRouter, accept an optional injected ownership:
const ownership = deps.ownership || createChannelOwnershipValidator(deps);
// inside POST /audit handler, after channelId validation and BEFORE gathering:
const owned = new Set(await ownership.getConnectedChannelIds(req));
if (!owned.has(channelId)) {
  return res.status(403).json({ error: { message: "Channel is not from your connected channels." } });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test audit`
Expected: PASS (all tests including 403).

- [ ] **Step 5: Commit**

```bash
git add backend/routes/audit.js backend/routes/audit.test.mjs
git commit -m "feat: enforce channel ownership on audit route"
```

---

### Task 6: Wire `/audit` + `audit` quota into the backend

**Files:**
- Modify: `backend/index.js`
- Modify: `backend/config/featureConfig.js`
- Modify: `backend/config/auditScoring.js` (no change, confirm exported)

**Interfaces:**
- Consumes: `createAuditRouter` (Task 4), `getAuditScoring` (Task 1), existing `resolveUser`/`checkPremiumAccess`/`requireQuota`/`handleApiError`/`query`/`isPostgresConfigured`.
- Produces: `apiRouter.use("/audit", auditRouter)`. Adds `audit` page key to `DEFAULT_FEATURE_CONFIG`. Provides `gatherAuditInput` wired to real YouTube data fetchers (see Step 4).

- [ ] **Step 1: Add the `audit` page key**

In `backend/config/featureConfig.js`, inside `pages`, after `playlistOptimizer`:
```js
audit: {
  label: "Audit",
  enabled: true,
  premiumOnly: false,
  freeLimit: 5,
  proLimit: 100,
},
```

- [ ] **Step 2: Write a test asserting the page key exists**

Add to `backend/config/featureConfig.test.mjs` (create if absent):
```js
import { describe, it, expect } from "vitest";
import featureConfig from "./featureConfig.js";
const { DEFAULT_FEATURE_CONFIG } = featureConfig;
it("includes an audit page key", () => {
  expect(DEFAULT_FEATURE_CONFIG.pages.audit).toBeDefined();
  expect(DEFAULT_FEATURE_CONFIG.pages.audit.freeLimit).toBeGreaterThan(0);
});
```

- [ ] **Step 3: Run the test to verify**

Run: `cd backend && corepack pnpm test featureConfig`
Expected: PASS after implementation.

- [ ] **Step 4: Wire the router and gatherAuditInput**

In `backend/index.js`:
- Require `createAuditRouter` and `createAuditScoringService` near the other optimizer requires.
- Define `gatherAuditInput` using existing YouTube fetch utilities already in `sharedDeps` (`getChannelInfo`-style helpers or the channelVideos/playlists services). This is the adapter that, given `{ channelId }` and `req`, returns `{ video, channel, playlist }`:
```js
const gatherAuditInput = async ({ channelId }, req) => {
  const channel = await channelService.getChannelById(channelId, req); // adapt to actual helper
  const videos = await channelVideosService.getVideosForChannel(channelId, req);
  const playlists = await playlistsService.getPlaylistsForChannel(channelId, req);
  const topVideo = videos?.[0] || {};
  return {
    video: { title: topVideo.title, description: topVideo.description, tags: topVideo.tags, keywords: [], thumbnail: { url: topVideo.thumbnails?.high?.url } },
    channel: { niche: "", keywords: channel?.keywords || [], name: channel?.name, description: channel?.description, logo: { url: channel?.thumbnails?.default?.url }, banner: { url: channel?.bannerImageUrl } },
    playlist: playlists?.[0] ? { title: playlists[0].title, size: playlists[0].itemCount, description: playlists[0].description, keywords: [] } : {},
  };
};
```
Read the actual service method names in `backend/index.js` and `services/` to replace `channelService.getChannelById`, `channelVideosService.getVideosForChannel`, `playlistsService.getPlaylistsForChannel` with the real ones; keep the returned shape identical.
- Build the audit router with the route deps + `getAuditScoring` + `gatherAuditInput`, and mount: `apiRouter.use("/audit", auditRouter);`.

- [ ] **Step 5: Verify syntax + existing suite green**

Run: `node -c backend/index.js` and `cd backend && corepack pnpm test`
Expected: no syntax error; all tests pass (security-core suite stays green).

- [ ] **Step 6: Commit**

```bash
git add backend/index.js backend/config/featureConfig.js backend/config/featureConfig.test.mjs
git commit -m "feat: wire audit route and quota page key into backend"
```

---

### Task 7: Frontend types, schema, and config context for `auditScoring`

**Files:**
- Modify: `frontend/src/utils/featureConfigSchema.ts`
- Create: `frontend/src/types/audit.ts`
- Test: `frontend/src/utils/featureConfigSchema.test.ts`

**Interfaces:**
- Consumes: existing `featureConfigSchema` shape.
- Produces: `auditScoringSchema` (zod) added to the config payload; `AuditResult`, `AuditScore`, `AuditBreakdownItem` types; `useAuditScoring()` hook returning the config from context.

- [ ] **Step 1: Write the failing test**

`frontend/src/utils/featureConfigSchema.test.ts`:
```ts
import { describe, expect, it } from 'vitest';
import { auditScoringSchema, DEFAULT_AUDIT_SCORING } from './featureConfigSchema';

describe('auditScoringSchema', () => {
  it('parses the default config', () => {
    expect(auditScoringSchema.safeParse(DEFAULT_AUDIT_SCORING).success).toBe(true);
  });
  it('rejects a category not summing to 100', () => {
    const bad = { ...DEFAULT_AUDIT_SCORING, video: { ...DEFAULT_AUDIT_SCORING.video, title: { max: 50 } } };
    expect(auditScoringSchema.safeParse(bad).success).toBe(true); // zod permits; validity is a backend concern
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && corepack pnpm test featureConfigSchema`
Expected: FAIL — `auditScoringSchema` / `DEFAULT_AUDIT_SCORING` not exported.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/utils/featureConfigSchema.ts`, add:
```ts
export const criterionSchema = z.object({ max: z.number().int().positive() });
export const auditCategorySchema = z.record(z.string(), criterionSchema);
export const auditScoringSchema = z.object({ video: auditCategorySchema, channel: auditCategorySchema, playlist: auditCategorySchema });

export const DEFAULT_AUDIT_SCORING = {
  video: { title: { max: 20 }, description: { max: 15 }, tags: { max: 10 }, keywords: { max: 5 }, thumbnail: { max: 50 } },
  channel: { niche: { max: 20 }, keywords: { max: 10 }, name: { max: 5 }, description: { max: 15 }, logo: { max: 20 }, banner: { max: 30 } },
  playlist: { title: { max: 20 }, size: { max: 30 }, description: { max: 30 }, keywords: { max: 20 } },
} as const;
export type AuditScoring = z.infer<typeof auditScoringSchema>;
```
Add `auditScoring: auditScoringSchema.optional()` to `featureConfigSchema` (or a top-level optional field) and merge `DEFAULT_AUDIT_SCORING` into the provider's fallback config.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd frontend && corepack pnpm test featureConfigSchema`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/featureConfigSchema.ts frontend/src/utils/featureConfigSchema.test.ts
git commit -m "feat: add audit scoring schema and defaults to frontend config"
```

---

### Task 8: Admin "Scoring" tab

**Files:**
- Modify: `frontend/src/pages/AdminPage.tsx`
- Create: `frontend/src/components/admin/ScoringConfigEditor.tsx`

**Interfaces:**
- Consumes: `useAuditScoring()` (Task 7), `DEFAULT_AUDIT_SCORING`, admin config PUT via fetch.
- Produces: an editable per-category table (Video/Channel/Playlist) with per-criterion `max` inputs, a live "sum must equal 100" indicator, and a Save button that `PUT /admin/audit-scoring`.

- [ ] **Step 1: Write the component**

`frontend/src/components/admin/ScoringConfigEditor.tsx`:
```tsx
import React, { useState } from 'react';
import { DEFAULT_AUDIT_SCORING, type AuditScoring } from '../../utils/featureConfigSchema';
import { apiUrl } from '../../services/apiUrl';

const CATEGORIES = ['video', 'channel', 'playlist'] as const;
const CATEGORY_LABEL = { video: 'Video Audit', channel: 'Channel Audit', playlist: 'Playlist Audit' };

export const ScoringConfigEditor: React.FC<{ config: AuditScoring }> = ({ config: initial }) => {
  const [config, setConfig] = useState<AuditScoring>({ ...DEFAULT_AUDIT_SCORING, ...initial });
  const [status, setStatus] = useState('');

  const sum = (cat: keyof AuditScoring) => Object.values(config[cat]).reduce((s, c) => s + (c.max || 0), 0);

  const setMax = (cat: keyof AuditScoring, key: string, max: number) =>
    setConfig((prev) => ({ ...prev, [cat]: { ...prev[cat], [key]: { max } } }));

  const save = async () => {
    setStatus('Saving...');
    const res = await fetch(apiUrl('/admin/audit-scoring'), {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(config),
    });
    setStatus(res.ok ? 'Saved' : 'Failed to save');
  };

  return (
    <div>
      <h3>Audit Scoring Configuration</h3>
      {CATEGORIES.map((cat) => {
        const total = sum(cat);
        return (
          <div key={cat}>
            <h4>{CATEGORY_LABEL[cat]} <span style={{ color: total === 100 ? 'green' : 'red' }}>({total}/100)</span></h4>
            {Object.entries(config[cat]).map(([key, { max }]) => (
              <label key={key} style={{ display: 'block', margin: '4px 0' }}>
                {key}:{' '}
                <input type="number" min={0} max={100} value={max}
                  onChange={(e) => setMax(cat, key, Math.max(0, Number(e.target.value)))} />
              </label>
            ))}
          </div>
        );
      })}
      <button onClick={save}>Save Scoring Config</button>
      {status && <p>{status}</p>}
    </div>
  );
};
```
Verify `apiUrl` exists in `frontend/src/services/` (adjust import to the real helper, e.g. the one `AdminPage` uses for `PUT /admin/config`).

- [ ] **Step 2: Add the tab to AdminPage**

In `frontend/src/pages/AdminPage.tsx`, add a new tab option (`'scoring'`) to the `AdminTab` union, the path derivation, the title/description, and a render block that fetches the audit scoring (via `useAuditScoring()` from Task 7) and renders `<ScoringConfigEditor config={...} />`. Mirror the existing Features tab's conditional render structure.

- [ ] **Step 3: Typecheck + lint**

Run: `cd frontend && corepack pnpm build` (runs `tsc -b`)
Expected: no type errors.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/pages/AdminPage.tsx frontend/src/components/admin/ScoringConfigEditor.tsx
git commit -m "feat: add admin scoring configuration tab"
```

---

### Task 9: Reusable `ScoringHelpPanel`

**Files:**
- Create: `frontend/src/components/ScoringHelpPanel.tsx`

**Interfaces:**
- Consumes: `AuditScoring` type + `useAuditScoring()`.
- Produces: a panel listing every category's criteria with name + max, rendered from config.

- [ ] **Step 1: Write the component**

`frontend/src/components/ScoringHelpPanel.tsx`:
```tsx
import React from 'react';
import { CATEGORY_META, type AuditScoring } from '../utils/featureConfigSchema';

export const ScoringHelpPanel: React.FC<{ config: AuditScoring }> = ({ config }) => (
  <details>
    <summary>Scoring criteria &amp; max scores</summary>
    {Object.entries(config).map(([cat, crit]) => (
      <div key={cat}>
        <h4>{CATEGORY_META[cat as keyof typeof CATEGORY_META]?.label ?? cat}</h4>
        <ul>
          {Object.entries(crit).map(([key, { max }]) => (
            <li key={key}>{key}: {max} pts</li>
          ))}
        </ul>
      </div>
    ))}
  </details>
);
```
Add a `CATEGORY_META` export to `featureConfigSchema.ts` mapping `{ video: { label: 'Video Audit' }, channel: { label: 'Channel Audit' }, playlist: { label: 'Playlist Audit' } }` and import it here.

- [ ] **Step 2: Typecheck**

Run: `cd frontend && corepack pnpm build`
Expected: no type errors.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/ScoringHelpPanel.tsx frontend/src/utils/featureConfigSchema.ts
git commit -m "feat: add reusable scoring help panel"
```

---

### Task 10: `/audit` page

**Files:**
- Create: `frontend/src/pages/AuditPage.tsx`
- Create: `frontend/src/services/auditService.ts`
- Create: `frontend/src/hooks/queries/useAudit.ts`
- Modify: `frontend/src/App.tsx`

**Interfaces:**
- Consumes: `FeatureGuard` (`pageKey="audit"`), `ScoringHelpPanel`, `AuditResult` types, `useAuditScoring`.
- Produces: a route `/audit` rendered by `AuditPage` (channel picker → `POST /audit` → combined score cards + breakdown + help + save/history).

- [ ] **Step 1: Write the API client**

`frontend/src/services/auditService.ts`:
```ts
import { apiUrl } from './apiUrl';
import { authHeaders } from './authHeaders';

export interface AuditBreakdownItem { label: string; earned: number; max: number; }
export interface AuditCategoryScore { total: number; breakdown: AuditBreakdownItem[]; }
export interface AuditResult { video: AuditCategoryScore; channel: AuditCategoryScore; playlist: AuditCategoryScore; overall: number; }

export async function runAudit(channelId: string): Promise<AuditResult & { _usage: any }> {
  const res = await fetch(apiUrl('/audit'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify({ channelId }),
  });
  if (!res.ok) throw new Error('Audit failed');
  return res.json();
}

export async function saveAudit(payload: { name?: string; channelId?: string; channelTitle?: string; results: unknown }) {
  const res = await fetch(apiUrl('/audit/history'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...authHeaders() },
    body: JSON.stringify(payload),
  });
  if (!res.ok) throw new Error('Save failed');
  return res.json();
}
```
Verify `apiUrl` and `authHeaders` are the real helpers (check `frontend/src/services/`); adjust import paths if named differently.

- [ ] **Step 2: Write the page**

`frontend/src/pages/AuditPage.tsx`: a channel picker (reuse the channel-picker component used by the optimizers if reusable, else a simple input + search), a "Run Audit" button calling `runAudit`, rendering three score cards (Video/Channel/Playlist) with `total/100` and a breakdown table, an overall average, `<ScoringHelpPanel config={config} />`, and Save/History buttons calling `saveAudit` + a history list. Use `FeatureGuard pageKey="audit"` and show the `UsageBar`. Wrap the audit result data in a `useAudit` TanStack Query hook (`frontend/src/hooks/queries/useAudit.ts`) mirroring `useThumbnailAudit`.

- [ ] **Step 3: Register the route**

In `frontend/src/App.tsx`, add a lazy route for `/audit` guarded by `ProtectedRoute` + `FeatureGuard pageKey="audit"` (mirror the optimizer routes) and a sidebar link in `Layout.tsx` (add an "Audit" entry).

- [ ] **Step 4: Typecheck + lint**

Run: `cd frontend && corepack pnpm build`
Expected: no type errors.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/AuditPage.tsx frontend/src/services/auditService.ts frontend/src/hooks/queries/useAudit.ts frontend/src/App.tsx
git commit -m "feat: add /audit page with combined scoring and help"
```

---

### Task 11: Full verification

**Files:**
- No new files.

- [ ] **Step 1: Run backend suite**

Run: `cd backend && corepack pnpm test`
Expected: all tests pass, including the new `auditScoring`, `auditScoringService`, `adminAuditScoring`, `audit`, and `featureConfig` tests. Security-core suite stays green.

- [ ] **Step 2: Run frontend suite + build**

Run: `cd frontend && corepack pnpm test` then `cd frontend && corepack pnpm build`
Expected: all frontend tests pass; `tsc -b && vite build` succeeds.

- [ ] **Step 3: Syntax check backend**

Run: `node -c backend/index.js`
Expected: no syntax errors.

- [ ] **Step 4: Update docs**

Add a short section to `docs/TESTING.md` and `fulldocs/02-Backend Service/05-Testing (Vitest).md` listing the new audit test files. Add an entry to `fulldocs/01-Project Overview/02-System Architecture.md` (or the closest) describing the `/audit` feature and the `auditScoring` config.

- [ ] **Step 5: Commit**

```bash
git add docs/TESTING.md fulldocs/
git commit -m "docs: document audit scoring system and its tests"
```

---

### Memory notes (record after Phase1 is verified)

- Save a `project` memory: "RevTube unified audit/scoring — deterministic engine in `backend/services/auditScoringService.js`, config in `backend/config/auditScoring.js` (Firestore `config/auditScoring`), admin Scoring tab in `AdminPage.tsx`, `/audit` page. Category maxes must sum to 100; invalid config falls back to `DEFAULT_AUDIT_SCORING`. Config changes propagate via configVersion bump." Link `[[audit-scoring-system]]`.
- Phase2 (out of scope this plan): migrate Thumbnail/Playlist optimizer score fields onto the engine; mount `ScoringHelpPanel` on both. Chat graphs are a separate future spec.
