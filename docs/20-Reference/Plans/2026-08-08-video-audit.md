# Video Audit Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add an admin-configurable, LLM-scored **video audit** to RevTube — pick one or a batch of your own videos, score each on title/description/tags/keywords/thumbnail/caption against admin-defined criteria, via an async BullMQ queue.

**Architecture:** New `config/auditCriteria` (admin-defined freeform criteria) + `videoAuditService` (Gemini for image elements, DeepSeek for text elements, weighted-mean normalization to 0-100 with niche boost) + a BullMQ `video-audit` queue + `POST /video-audit` (enqueue) / `GET /video-audit/jobs/:id` (poll) / history routes. Frontend `/video-audit` page (channel picker + video multi-select + run + poll + results) and an admin criteria editor. Kept **separate** from the Phase1 deterministic engine.

**Tech Stack:** Express 5 (CommonJS), BullMQ + IORedis, YouTube Data API, Gemini (images) + DeepSeek (text), Vitest (backend `.test.mjs` ESM; frontend `.test.ts` no globals).

## Global Constraints

- Deterministic weighting is done by the ENGINE, not the LLM. The LLM returns a 0-10 score per criterion; the engine normalizes weights to a 0-100 total. See Task 2's `scoreVideo` formula (authoritative).
- Gemini scores only `element: "thumbnail"` criteria; DeepSeek scores every other element (title/description/tags/keywords/caption). Both are injected deps so tests use fakes and never call a real model.
- Niche boost: if `criterion.niches` includes the channel's niche, `weight *= 1.5` before aggregation.
- Missing element data -> those criteria score 0 with a note; the audit still completes.
- New `videoAudit` page key in `DEFAULT_FEATURE_CONFIG` (backend) + frontend `DEFAULT_CONFIG`; gated by `requireQuota("videoAudit")` at enqueue + `FeatureGuard pageKey="videoAudit"` + `UsageBar`.
- When REDIS_URL is unset, the queue is a no-op and `POST /video-audit` returns 503 "queue unavailable" (mirrors existing queues).
- No EM dashes in any user-visible text or comments (use " / " or " to ").
- Commit author Sachin Subedi, NO co-author footer.
- Backend tests: `const { describe, it, expect, vi } = require("vitest")` (ESM `.test.mjs`). Frontend tests: explicit `import { describe, it, expect } from "vitest"`.
- No real services in tests — plain DI fakes (`vi.fn()`); tests pass with no env/Redis/Firebase/network.
- DRY/KISS.

---

### Task 1: `auditCriteria` config module

**Files:**
- Create: `backend/config/auditCriteria.js`
- Test: `backend/config/auditCriteria.test.mjs`

**Interfaces:**
- Consumes: none (mirrors `backend/config/auditScoring.js`).
- Produces: `DEFAULT_AUDIT_CRITERIA`, `getAuditCriteria(db)`, `mergeAuditCriteria()`, `invalidateAuditCriteriaCache()`, `normalizeVideoCriteria(cfg)`.

- [ ] **Step 1: Write the failing test**

`backend/config/auditCriteria.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import {
  DEFAULT_AUDIT_CRITERIA,
  getAuditCriteria,
  mergeAuditCriteria,
  invalidateAuditCriteriaCache,
  normalizeVideoCriteria,
} from "./auditCriteria.js";

describe("auditCriteria config", () => {
  it("defaults have a sensible video criteria set", () => {
    expect(Array.isArray(DEFAULT_AUDIT_CRITERIA.video)).toBe(true);
    expect(DEFAULT_AUDIT_CRITERIA.video.length).toBeGreaterThanOrEqual(4);
    for (const c of DEFAULT_AUDIT_CRITERIA.video) {
      expect(typeof c.key).toBe("string");
      expect(typeof c.label).toBe("string");
      expect(typeof c.weight).toBe("number");
      expect(typeof c.element).toBe("string");
      expect(typeof c.instruction).toBe("string");
      expect(Array.isArray(c.niches)).toBe(true);
    }
  });

  it("merges db criteria, falling back per-item on invalid entries", () => {
    const db = {
      video: [
        { key: "funny", label: "Funny", weight: 15, element: "title", instruction: "is it funny", niches: ["comedy"] },
        { key: "bad", weight: -5 }, // invalid: missing label/element/instruction
      ],
    };
    const merged = mergeAuditCriteria(db);
    const funny = merged.video.find((c) => c.key === "funny");
    expect(funny.weight).toBe(15);
    expect(funny.niches).toEqual(["comedy"]);
    // invalid entry dropped, default set retained
    expect(merged.video.some((c) => c.key === "bad")).toBe(false);
    expect(merged.video.length).toBeGreaterThanOrEqual(4);
  });

  it("getAuditCriteria reads Firestore and caches 10min", async () => {
    const db = {
      collection: () => ({
        doc: () => ({
          get: async () => ({ exists: false }),
        }),
      }),
    };
    const cfg = await getAuditCriteria(db);
    expect(Array.isArray(cfg.video)).toBe(true);
    invalidateAuditCriteriaCache();
  });

  it("normalizeVideoCriteria drops zero/negative weights and returns the weighted set", () => {
    const norm = normalizeVideoCriteria(DEFAULT_AUDIT_CRITERIA.video);
    expect(norm.every((c) => c.weight > 0)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test auditCriteria`
Expected: FAIL — module not found / exports missing.

- [ ] **Step 3: Write minimal implementation**

`backend/config/auditCriteria.js` (mirror `auditScoring.js`; criteria are ARRAYS of freeform objects, not fixed keys):
```js
// ── Audit criteria config -- Firestore-backed, mirrors auditScoring.js ──
let _cache = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 10 * 60 * 1000;

const DEFAULT_AUDIT_CRITERIA = {
  video: [
    { key: "title_clear", label: "Title Clarity", weight: 20, element: "title", instruction: "How clear and click-worthy is the title?", niches: [] },
    { key: "title_curiosity", label: "Title Curiosity", weight: 15, element: "title", instruction: "Does the title create curiosity or a question?", niches: [] },
    { key: "description_rich", label: "Description Richness", weight: 15, element: "description", instruction: "How complete and helpful is the description?", niches: [] },
    { key: "tags_quality", label: "Tag Quality", weight: 10, element: "tags", instruction: "Are the tags relevant and well-chosen?", niches: [] },
    { key: "keywords_match", label: "Keyword Relevance", weight: 10, element: "keywords", instruction: "Do keywords match the title and description?", niches: [] },
    { key: "caption_value", label: "Caption Value", weight: 15, element: "caption", instruction: "Does the caption/transcript add value?", niches: [] },
    { key: "thumbnail_pop", label: "Thumbnail Pop", weight: 15, element: "thumbnail", instruction: "How eye-catching and on-topic is the thumbnail?", niches: [] },
  ],
};

function isValidCriterion(c) {
  return !!(
    c &&
    typeof c.key === "string" &&
    c.key &&
    typeof c.label === "string" &&
    typeof c.weight === "number" &&
    c.weight > 0 &&
    typeof c.element === "string" &&
    typeof c.instruction === "string"
  );
}

function mergeAuditCriteria(dbData) {
  const dbVideo = Array.isArray(dbData?.video) ? dbData.video : [];
  const mergedVideo = dbVideo.filter(isValidCriterion);
  // If the admin supplied NO valid video criteria, fall back to defaults.
  const video = mergedVideo.length ? mergedVideo : DEFAULT_AUDIT_CRITERIA.video;
  return { video };
}

function normalizeVideoCriteria(criteria) {
  return (Array.isArray(criteria) ? criteria : DEFAULT_AUDIT_CRITERIA.video).filter(isValidCriterion);
}

async function getAuditCriteria(db) {
  if (_cache && Date.now() - _cachedAt < CACHE_TTL_MS) return _cache;
  try {
    const doc = await db.collection("config").doc("auditCriteria").get();
    _cache = doc.exists ? mergeAuditCriteria(doc.data()) : DEFAULT_AUDIT_CRITERIA;
  } catch {
    _cache = _cache || DEFAULT_AUDIT_CRITERIA;
  }
  _cachedAt = Date.now();
  return _cache;
}

function invalidateAuditCriteriaCache() {
  _cache = null;
  _cachedAt = 0;
}

module.exports = {
  DEFAULT_AUDIT_CRITERIA,
  getAuditCriteria,
  mergeAuditCriteria,
  invalidateAuditCriteriaCache,
  normalizeVideoCriteria,
  isValidCriterion,
};
```

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test auditCriteria`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/config/auditCriteria.js backend/config/auditCriteria.test.mjs
git commit -m "feat: add audit criteria config module"
```

---

### Task 2: `videoAuditService` (LLM scoring engine)

**Files:**
- Create: `backend/services/videoAuditService.js`
- Test: `backend/services/videoAuditService.test.mjs`

**Interfaces:**
- Consumes: `DEFAULT_AUDIT_CRITERIA`/`normalizeVideoCriteria` from Task 1.
- Produces: `createVideoAuditService(deps)` returning `scoreVideo(input, criteria, channelNiche)` and `auditBatch(inputs, criteria, channelNiche)`. `deps` = `{ geminiVision, deepSeekText }` (both `async (payload) => number` returning a 0-10 score).

- [ ] **Step 1: Write the failing test**

`backend/services/videoAuditService.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import { createVideoAuditService } from "./videoAuditService.js";

const CRITERIA = [
  { key: "title_clear", label: "Title Clarity", weight: 20, element: "title", instruction: "clear?", niches: [] },
  { key: "thumbnail_pop", label: "Thumbnail Pop", weight: 15, element: "thumbnail", instruction: "pop?", niches: [] },
  { key: "comedy_funny", label: "Funny", weight: 10, element: "title", instruction: "funny?", niches: ["comedy"] },
];

describe("videoAuditService", () => {
  it("scores text elements via deepSeekText and image via geminiVision", async () => {
    const geminiVision = vi.fn().mockResolvedValue(8);
    const deepSeekText = vi.fn().mockResolvedValue(7);
    const svc = createVideoAuditService({ geminiVision, deepSeekText });
    const input = { title: "My Video", thumbnail: { url: "http://x/1.jpg" }, videoId: "abc123" };
    const { total, breakdown } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(geminiVision).toHaveBeenCalledTimes(1); // only thumbnail
    expect(deepSeekText).toHaveBeenCalledTimes(2); // 2 title criteria
    expect(total).toBeGreaterThanOrEqual(0);
    expect(total).toBeLessThanOrEqual(100);
    expect(breakdown.length).toBe(3);
  });

  it("weights sum to 100 via weighted mean of scores", async () => {
    const svc = createVideoAuditService({
      geminiVision: vi.fn().mockResolvedValue(10),
      deepSeekText: vi.fn().mockResolvedValue(0),
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const { total } = await svc.scoreVideo(input, CRITERIA, "tech");
    // weights: title_clear 20(0/10), thumbnail_pop 15(10/10), comedy_funny 10(0/10)
    // weighted avg = (20*0 + 15*1 + 10*0) / 45 = 15/45 = 33.33 -> 33
    expect(total).toBe(33);
  });

  it("applies niche boost x1.5 to matching-niche criteria", async () => {
    const svc = createVideoAuditService({
      geminiVision: vi.fn().mockResolvedValue(0),  // thumbnail scores 0
      deepSeekText: vi.fn().mockResolvedValue(10), // title criteria score 10
    });
    const input = { title: "x", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" };
    const boosted = await svc.scoreVideo(input, CRITERIA, "comedy");
    const plain = await svc.scoreVideo(input, CRITERIA, "tech");
    // comedy: comedy_funny weight 10*1.5=15. weighted = (10*20 + 0*15 + 10*15)/(20+15+15) = 350/50 = 7 -> 70
    // plain: comedy_funny weight 10. weighted = (10*20 + 0*15 + 10*10)/(20+15+10) = 300/45 = 6.67 -> 67
    expect(boosted.total).toBe(70);
    expect(plain.total).toBe(67);
  });

  it("scores 0 with a note when element data is missing", async () => {
    const deepSeekText = vi.fn().mockResolvedValue(7);
    const svc = createVideoAuditService({ geminiVision: vi.fn().mockResolvedValue(8), deepSeekText });
    const input = {}; // no title, no thumbnail
    const { total, breakdown } = await svc.scoreVideo(input, CRITERIA, "tech");
    expect(total).toBe(0);
    expect(breakdown[0].earned).toBe(0);
    expect(deepSeekText).not.toHaveBeenCalled();
    expect(geminiVision).not.toHaveBeenCalled();
  });

  it("auditBatch returns per-video results and a batch overall", async () => {
    const svc = createVideoAuditService({
      geminiVision: vi.fn().mockResolvedValue(10),
      deepSeekText: vi.fn().mockResolvedValue(10),
    });
    const inputs = [
      { title: "a", thumbnail: { url: "http://x/1.jpg" }, videoId: "a" },
      { title: "b", thumbnail: { url: "http://x/2.jpg" }, videoId: "b" },
    ];
    const batch = await svc.auditBatch(inputs, CRITERIA, "tech");
    expect(batch.results.length).toBe(2);
    expect(batch.overall).toBe(100);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test videoAuditService`
Expected: FAIL — service not found.

- [ ] **Step 3: Write minimal implementation**

`backend/services/videoAuditService.js`:
```js
// ── Video audit scoring engine -- LLM-scored, deterministic weighting ──
const { DEFAULT_AUDIT_CRITERIA, normalizeVideoCriteria } = require("../config/auditCriteria");

const clampScore = (n) => Math.min(10, Math.max(0, Math.round(Number(n) || 0)));

function createVideoAuditService(deps = {}) {
  const { geminiVision, deepSeekText } = deps;

  // Image elements -> Gemini; all text elements -> DeepSeek.
  function scorerFor(element, payload) {
    if (element === "thumbnail") return geminiVision(payload);
    return deepSeekText(payload);
  }

  // Guard: only call the LLM when the element actually has data.
  function hasElementData(input, element) {
    if (element === "thumbnail") return !!(input?.thumbnail?.url || input?.url);
    if (element === "tags") return Array.isArray(input?.tags) && input.tags.length > 0;
    return !!(input?.[element] || "");
  }

  async function scoreVideo(input, criteria = DEFAULT_AUDIT_CRITERIA.video, channelNiche = "") {
    const crit = normalizeVideoCriteria(criteria);
    const breakdown = [];
    for (const c of crit) {
      let weight = c.weight;
      if (c.niches?.includes(channelNiche)) weight *= 1.5;
      if (!hasElementData(input, c.element)) {
        breakdown.push({ key: c.key, label: c.label, score: 0, earned: 0, weight, max: 0, note: "no data" });
        continue;
      }
      const payload =
        c.element === "thumbnail"
          ? { url: input?.thumbnail?.url || input?.url, instruction: c.instruction }
          : { text: String(input?.[c.element] || ""), instruction: c.instruction, niche: channelNiche };
      let score = 0;
      try {
        score = clampScore(await scorerFor(c.element, payload));
      } catch {
        score = 0; // LLM failure -> 0, audit continues
      }
      breakdown.push({ key: c.key, label: c.label, score, earned: score, weight, max: 10, note: "" });
    }
    const totalWeight = breakdown.reduce((s, b) => s + b.weight, 0);
    const weightedSum = breakdown.reduce((s, b) => s + b.earned * b.weight, 0);
    const total = totalWeight ? Math.round((weightedSum / totalWeight) * 10) : 0;
    return { total, breakdown };
  }

  async function auditBatch(inputs = [], criteria = DEFAULT_AUDIT_CRITERIA.video, channelNiche = "") {
    const results = [];
    for (const input of inputs) {
      results.push({ videoId: input?.videoId, title: input?.title, ...(await scoreVideo(input, criteria, channelNiche)) });
    }
    const overall = results.length
      ? Math.round(results.reduce((s, r) => s + r.total, 0) / results.length)
      : 0;
    return { results, overall };
  }

  return { scoreVideo, auditBatch };
}

module.exports = { createVideoAuditService };
```

Note the weight formula: each `score` is 0-10; `earned = score` (0-10 scale). `total = round((sum(earned*weight) / sum(weight)) * 10)` converts the weighted mean (0-10) to a 0-100 percent. This is the authoritative formula the tests assert.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test videoAuditService`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/services/videoAuditService.js backend/services/videoAuditService.test.mjs
git commit -m "feat: add LLM-scored video audit engine"
```

---

### Task 3: Admin `auditCriteria` endpoints

**Files:**
- Modify: `backend/routes/admin.js`
- Test: `backend/routes/adminAuditCriteria.test.mjs`

**Interfaces:**
- Consumes: `getAuditCriteria`, `mergeAuditCriteria`, `invalidateAuditCriteriaCache` (Task 1).
- Produces: `GET /admin/audit-criteria`, `PUT /admin/audit-criteria` (admin-gated, validates items, bumps configVersion).

- [ ] **Step 1: Write the failing test**

`backend/routes/adminAuditCriteria.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import { createAdminRouter } from "./admin.js";

function makeRouter(overrides = {}) {
  const invalidate = vi.fn();
  const bump = vi.fn().mockResolvedValue(undefined);
  const cfg = { video: [{ key: "funny", label: "Funny", weight: 15, element: "title", instruction: "funny?", niches: [] }] };
  const deps = {
    getAuditCriteria: vi.fn().mockResolvedValue(cfg),
    mergeAuditCriteria: (x) => x,
    invalidateAuditCriteriaCache: invalidate,
    bumpConfigVersion: bump,
    checkAdmin: (req, res, next) => next(),
    adminLimiter: (req, res, next) => next(),
    ...overrides,
  };
  return { router: createAdminRouter(deps), invalidate, bump, cfg };
}

describe("admin audit-criteria endpoints", () => {
  it("GET returns the current audit criteria", async () => {
    const { router, cfg } = makeRouter();
    const req = { method: "GET", url: "/admin/audit-criteria", headers: {}, body: {} };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await router.handle(req, res);
    expect(res.json).toHaveBeenCalledWith(cfg);
  });

  it("PUT saves valid criteria and bumps config version", async () => {
    const { router, invalidate, bump, cfg } = makeRouter();
    const req = { method: "PUT", url: "/admin/audit-criteria", headers: {}, body: cfg };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await router.handle(req, res);
    expect(bump).toHaveBeenCalled();
    expect(invalidate).toHaveBeenCalled();
    expect(res.json).toHaveBeenCalledWith({ success: true });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test adminAuditCriteria`
Expected: FAIL — endpoint missing.

- [ ] **Step 3: Write minimal implementation**

In `backend/routes/admin.js`, require the config module at top and add after the existing `/audit-scoring` block:
```js
const { getAuditCriteria, mergeAuditCriteria, invalidateAuditCriteriaCache } = require("../config/auditCriteria");
```
Add endpoints (mirror the `/audit-scoring` block):
```js
  // Admin: Get current audit criteria config
  router.get("/audit-criteria", adminLimiter, checkAdmin, async (req, res) => {
    try {
      const cfg = await getAuditCriteria(db);
      res.json(cfg);
    } catch (error) {
      console.error("[Admin AuditCriteria GET] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });

  // Admin: Update audit criteria config (freeform admin-defined criteria)
  router.put("/audit-criteria", adminLimiter, checkAdmin, async (req, res) => {
    try {
      const body = req.body || {};
      const merged = mergeAuditCriteria(body);
      if (!Array.isArray(merged.video) || merged.video.length === 0) {
        return res.status(400).json({ error: { message: "At least one valid video criterion is required." } });
      }
      await db.collection("config").doc("auditCriteria").set(merged);
      await bumpConfigVersion();
      invalidateAuditCriteriaCache();
      res.json({ success: true });
    } catch (error) {
      console.error("[Admin AuditCriteria PUT] Error:", error.message);
      res.status(500).json({ error: { message: error.message } });
    }
  });
```
Ensure `db`, `bumpConfigVersion`, `adminLimiter`, `checkAdmin` are already in scope in the admin router factory (they are — the `/audit-scoring` endpoints use them).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test adminAuditCriteria`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/admin.js backend/routes/adminAuditCriteria.test.mjs
git commit -m "feat: add admin endpoints for audit criteria"
```

---

### Task 4: BullMQ `video-audit` queue

**Files:**
- Create: `backend/queue/videoAuditQueue.js`
- Modify: `backend/queue/index.js`
- Test: `backend/queue/videoAuditQueue.test.mjs`

**Interfaces:**
- Consumes: `createVideoAuditService` (Task 2), a `fetchVideoInputs` dep (fetches per-video data — wired in `index.js`, Task 5).
- Produces: `createVideoAuditProcessor(deps)` and an `enqueueVideoAudit` method on the queue service.

- [ ] **Step 1: Write the failing test**

`backend/queue/videoAuditQueue.test.mjs`:
```js
import { describe, it, expect, vi } from "vitest";
import { createVideoAuditProcessor } from "./videoAuditQueue.js";

describe("videoAuditQueue processor", () => {
  it("fetches inputs, scores, and updates progress", async () => {
    const fetchVideoInputs = vi.fn().mockResolvedValue([
      { videoId: "a", title: "A", thumbnail: { url: "http://x/a.jpg" } },
    ]);
    const scoreVideo = vi.fn().mockResolvedValue({ total: 80, breakdown: [] });
    const auditBatch = vi.fn().mockResolvedValue({ results: [{ videoId: "a", total: 80 }], overall: 80 });
    const processor = createVideoAuditProcessor({ fetchVideoInputs, auditBatch });
    const updateProgress = vi.fn();
    const result = await processor({ id: "j1", data: { channelId: "c1", videoIds: ["a"], authHeader: "h" }, updateProgress });
    expect(fetchVideoInputs).toHaveBeenCalledWith({ channelId: "c1", videoIds: ["a"], authHeader: "h" });
    expect(auditBatch).toHaveBeenCalled();
    expect(updateProgress).toHaveBeenCalledWith(100);
    expect(result.overall).toBe(80);
  });

  it("throws on missing job data", async () => {
    const processor = createVideoAuditProcessor({ fetchVideoInputs: vi.fn(), auditBatch: vi.fn() });
    await expect(processor({ id: "j1", data: {}, updateProgress: vi.fn() })).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test videoAuditQueue`
Expected: FAIL — module not found.

- [ ] **Step 3: Write minimal implementation**

`backend/queue/videoAuditQueue.js` (mirror `ingestionQueue.js`):
```js
/**
 * Video audit queue processor -- runs a batch video audit as a BullMQ job.
 *
 * Expected job data:
 *   { channelId: string, videoIds: string[], authHeader: string, criteriaVersion?: number }
 */
function createVideoAuditProcessor(deps) {
  const { fetchVideoInputs, auditBatch } = deps;

  return async function processVideoAudit(job) {
    const { channelId, videoIds, authHeader } = job.data || {};
    if (!channelId || !Array.isArray(videoIds) || videoIds.length === 0 || !authHeader) {
      throw new Error("Invalid video audit job data: missing channelId, videoIds, or authHeader");
    }

    console.log(`[Queue] video-audit:${channelId} -> starting (job ${job.id})`);

    const inputs = await fetchVideoInputs({ channelId, videoIds, authHeader });
    const result = await auditBatch(inputs);
    job.updateProgress(100);
    return result;
  };
}

module.exports = { createVideoAuditProcessor };
```

In `backend/queue/index.js`, wire the new queue (mirror the existing queues):
- Require: `const { createVideoAuditProcessor } = require("./videoAuditQueue");`
- Create the queue:
```js
const videoAuditQueue = new Queue("video-audit", {
  connection,
  defaultJobOptions: { attempts: 3, backoff: { type: "exponential", delay: 60_000 }, removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
});
```
- Create the worker: `const videoAuditWorker = new Worker("video-audit", createVideoAuditProcessor(deps), { connection, concurrency: 2 });`
- Add `setupWorkerEvents(videoAuditWorker, "video-audit");`
- Add to Bull Board: `new BullMQAdapter(videoAuditQueue)`.
- Add to the returned service object:
```js
enqueueVideoAudit(data, opts = {}) {
  return videoAuditQueue.add("video-audit", data, opts);
},
```
and to `queues: { ..., videoAudit: videoAuditQueue }`.

Note: `deps` passed to `createVideoAuditProcessor` must include `fetchVideoInputs` and `auditBatch` — these are wired from `index.js` in Task 5, so `index.js` must inject them into the queue service deps. If not yet present when this task runs, pass stubs so the file loads; Task 5 wires the real ones.

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test videoAuditQueue`
Expected: PASS. Also run `node -c backend/queue/index.js` and `node -c backend/index.js` to confirm no syntax errors from the wiring.

- [ ] **Step 5: Commit**

```bash
git add backend/queue/videoAuditQueue.js backend/queue/videoAuditQueue.test.mjs backend/queue/index.js
git commit -m "feat: add video audit BullMQ queue"
```

---

### Task 5: `/video-audit` route + `index.js` wiring

**Files:**
- Create: `backend/routes/videoAudit.js`
- Modify: `backend/index.js`
- Test: `backend/routes/videoAudit.test.mjs`

**Interfaces:**
- Consumes: `requireQuota`, `checkPremiumAccess`, `resolveUser`, `handleApiError`, `getConnectedChannelIds` (ownership), `getAuditCriteria`, `getAuditScoring` (not needed here), `queueService.enqueueVideoAudit`, a `fetchVideoInputs` implementation.
- Produces: `POST /video-audit` (enqueue), `GET /video-audit/jobs/:id` (status/poll), history CRUD against a PG `video_audits` table.

- [ ] **Step 1: Write the failing test**

`backend/routes/videoAudit.test.mjs` (DI fakes):
```js
import { describe, it, expect, vi } from "vitest";
import { createVideoAuditRouter } from "./videoAudit.js";

function makeRouter(overrides = {}) {
  const enqueue = vi.fn().mockResolvedValue({ id: "job1" });
  const jobsGet = vi.fn().mockResolvedValue({ id: "job1", state: "completed", returnvalue: { overall: 80, results: [] }, progress: 100 });
  const query = vi.fn().mockResolvedValue({ rows: [] });
  const isPostgresConfigured = vi.fn().mockReturnValue(true);
  const deps = {
    resolveUser: (req, res, next) => next(),
    checkPremiumAccess: () => (req, res, next) => next(),
    requireQuota: () => (req, res, next) => next(),
    handleApiError: (err, res) => res.status(500).json({ error: { message: err.message } }),
    getConnectedChannelIds: vi.fn().mockResolvedValue(new Set(["c1"])),
    enqueueVideoAudit: enqueue,
    jobsGet,
    query,
    isPostgresConfigured,
    ...overrides,
  };
  return { router: createVideoAuditRouter(deps), enqueue, jobsGet, query };
}

describe("video-audit route", () => {
  it("POST enqueues a job for an owned channel and returns jobId", async () => {
    const { router, enqueue } = makeRouter();
    const req = { method: "POST", url: "/video-audit", headers: {}, body: { channelId: "c1", videoIds: ["a", "b"] }, authUser: { uid: "u1" } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await router.handle(req, res);
    expect(enqueue).toHaveBeenCalledWith(expect.objectContaining({ channelId: "c1", videoIds: ["a", "b"] }), expect.any(Object));
    expect(res.json).toHaveBeenCalledWith({ jobId: "job1" });
  });

  it("POST 403 for a non-owned channel", async () => {
    const { router } = makeRouter();
    const req = { method: "POST", url: "/video-audit", headers: {}, body: { channelId: "c9", videoIds: ["a"] }, authUser: { uid: "u1" } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await router.handle(req, res);
    expect(res.status).toHaveBeenCalledWith(403);
  });

  it("GET /jobs/:id returns job status", async () => {
    const { router, jobsGet } = makeRouter();
    const req = { method: "GET", url: "/video-audit/jobs/job1", headers: {}, body: {}, authUser: { uid: "u1" } };
    const res = { json: vi.fn(), status: vi.fn().mockReturnThis() };
    await router.handle(req, res);
    expect(jobsGet).toHaveBeenCalledWith("job1");
    expect(res.json).toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test videoAudit`
Expected: FAIL — route not found.

- [ ] **Step 3: Write minimal implementation**

`backend/routes/videoAudit.js`:
```js
// ── Video Audit Route -- POST /video-audit (enqueue), GET /jobs/:id (poll), history CRUD ──
const express = require("express");

function createVideoAuditRouter(deps) {
  const { resolveUser, checkPremiumAccess, requireQuota, handleApiError, getConnectedChannelIds, enqueueVideoAudit, jobsGet, query, isPostgresConfigured } = deps;
  const router = express.Router();

  const guardPg = (req, res) => {
    if (!isPostgresConfigured()) {
      res.status(503).json({ error: { message: "Database not configured." } });
      return false;
    }
    return true;
  };

  // POST /video-audit -- enqueue a batch audit for an owned channel
  router.post("/", resolveUser, checkPremiumAccess("videoAudit"), requireQuota("videoAudit"), async (req, res) => {
    try {
      const { channelId, videoIds } = req.body;
      if (!channelId || !Array.isArray(videoIds) || videoIds.length === 0) {
        return res.status(400).json({ error: { message: '"channelId" and non-empty "videoIds" are required.' } });
      }
      const owned = new Set(await getConnectedChannelIds(req));
      if (!owned.has(channelId)) {
        return res.status(403).json({ error: { message: "Channel is not from your connected channels." } });
      }
      const job = await enqueueVideoAudit(
        { channelId, videoIds, authHeader: req.headers?.authorization || "" },
        { removeOnComplete: { age: 3600 * 24 }, removeOnFail: { age: 3600 * 24 * 7 } },
      );
      res.json({ jobId: job?.id });
    } catch (error) {
      console.error("[VideoAudit] POST failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/jobs/:id -- poll job status
  router.get("/jobs/:id", resolveUser, async (req, res) => {
    try {
      const job = await jobsGet(String(req.params.id).replace(/[^0-9A-Za-z_-]/g, ""));
      if (!job) return res.status(404).json({ error: { message: "Job not found." } });
      const state = await job.getState();
      res.json({
        jobId: job.id,
        state,
        progress: job.progress ?? 0,
        ...(state === "completed" ? { result: job.returnvalue } : {}),
      });
    } catch (error) {
      console.error("[VideoAudit] Jobs GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // POST /video-audit/history -- save an audit result
  router.post("/history", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const { name, channelId, channelTitle, results } = req.body || {};
    try {
      const out = await query(
        "INSERT INTO video_audits (uid, name, channel_id, channel_title, results, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, now(), now()) RETURNING id, created_at",
        [uid, name || "Video Audit", channelId || null, channelTitle || null, results ? JSON.stringify(results) : "{}"],
      );
      res.json(out.rows[0]);
    } catch (error) {
      console.error("[VideoAudit] History POST failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/history -- list saved audits
  router.get("/history", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const limit = Math.min(parseInt(req.query?.limit, 10) || 20, 50);
    const page = Math.max(parseInt(req.query?.page, 10) || 1, 1);
    try {
      const out = await query(
        "SELECT id, name, channel_id, channel_title, created_at FROM video_audits WHERE uid = $1 ORDER BY created_at DESC LIMIT $2 OFFSET $3",
        [uid, limit, (page - 1) * limit],
      );
      const count = await query("SELECT count(*)::int AS total FROM video_audits WHERE uid = $1", [uid]);
      res.json({ items: out.rows, total: count.rows[0]?.total ?? 0, page });
    } catch (error) {
      console.error("[VideoAudit] History GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // GET /video-audit/history/:id -- view one saved audit
  router.get("/history/:id", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const id = String(req.params.id).replace(/[^0-9a-f-]/gi, "");
    try {
      const out = await query("SELECT id, name, channel_id, channel_title, results, created_at FROM video_audits WHERE id = $1 AND uid = $2", [id, uid]);
      if (!out.rows[0]) return res.status(404).json({ error: { message: "Audit not found." } });
      res.json(out.rows[0]);
    } catch (error) {
      console.error("[VideoAudit] History item GET failed:", error.message);
      handleApiError(error, res);
    }
  });

  // DELETE /video-audit/history/:id
  router.delete("/history/:id", resolveUser, async (req, res) => {
    if (!guardPg(req, res)) return;
    const uid = req.authUser?.uid;
    const id = String(req.params.id).replace(/[^0-9a-f-]/gi, "");
    try {
      await query("DELETE FROM video_audits WHERE id = $1 AND uid = $2", [id, uid]);
      res.json({ success: true });
    } catch (error) {
      console.error("[VideoAudit] History DELETE failed:", error.message);
      handleApiError(error, res);
    }
  });

  return router;
}

module.exports = { createVideoAuditRouter };
```

In `backend/index.js`:
- Require at top: `const { createVideoAuditRouter } = require("./routes/videoAudit");` and `const { createVideoAuditService } = require("./services/videoAuditService");` and `const { getAuditCriteria } = require("./config/auditCriteria");`
- Implement `fetchVideoInputs` (a module-scope function mirroring `gatherAuditInput`, but per-video):
```js
// Fetch title/desc/tags/keywords/thumbnail/caption per video via the YouTube Data API.
async function fetchVideoInputs({ channelId, videoIds, authHeader }) {
  const useKey = !authHeader || !authHeader.startsWith("Bearer ");
  const params = { part: "snippet,contentDetails", id: videoIds.join(","), maxResults: 50 };
  const config = { params, timeout: 8000 };
  if (!useKey) config.headers = { Authorization: authHeader };
  else params.key = API_KEY;
  const resp = await axios.get(`${YOUTUBE_API_BASE}/videos`, config);
  const items = resp?.data?.items || [];
  return items.map((it) => ({
    videoId: it.id,
    title: it.snippet?.title,
    description: it.snippet?.description,
    tags: it.snippet?.tags || [],
    keywords: typeof it.snippet?.tags === "string" ? it.snippet.tags.split(/[,\s]+/).filter(Boolean) : it.snippet?.tags || [],
    thumbnail: { url: it.snippet?.thumbnails?.maxres?.url || it.snippet?.thumbnails?.high?.url },
    // caption left undefined here; a follow-up can enrich via captions route (best-effort)
  }));
}
```
- Build the LLM wrappers and service (place near the audit router wiring, around line 440-460). These mirror `thumbnailOptimizerService.js` (Gemini) and `playlistOptimizerService.js` (DeepSeek):
```js
const GEMINI_API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";
const GEMINI_MODEL = process.env.GEMINI_MODEL || "gemini-3.1-flash-lite";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const DEEPSEEK_API_BASE = "https://api.deepseek.com";
const DEEPSEEK_MODEL = process.env.DEEPSEEK_MODEL || "deepseek-chat";
const DEEPSEEK_API_KEY = process.env.DEEPSEEK_API_KEY;

async function retryWithBackoff(fn, maxRetries = 3, baseDelay = 2000) {
  let lastError;
  for (let i = 0; i < maxRetries; i++) {
    try { return await fn(); }
    catch (error) {
      lastError = error;
      const status = error?.response?.status || error?.status || 0;
      const msg = error?.message || "";
      const isRateLimit = status === 429 || msg.includes("429") || msg.includes("RESOURCE_EXHAUSTED") || msg.includes("rate_limit");
      if ((isRateLimit || (status >= 500 && status < 600)) && i < maxRetries - 1) {
        await new Promise((resolve) => setTimeout(resolve, baseDelay * Math.pow(2, i)));
        continue;
      }
      throw error;
    }
  }
  throw lastError;
}

async function fetchThumbnailBase64(videoId) {
  const url = `https://i.ytimg.com/vi/${videoId}/maxresdefault.jpg`;
  const response = await axios.get(url, { responseType: "arraybuffer", timeout: 10000 });
  return { base64: Buffer.from(response.data).toString("base64"), mimeType: response.headers["content-type"] || "image/jpeg" };
}

// Gemini vision scorer: returns 0-10 for a thumbnail criterion.
async function geminiVision(payload) {
  const videoId = String(payload?.url || "").match(/[?&]v=([^&]+)/)?.[1] || String(payload?.url || "").split("/").pop();
  const { base64, mimeType } = await fetchThumbnailBase64(videoId || "default");
  const prompt = `Judge the thumbnail against this criterion and return a JSON object {"score": 0-10}.
Criterion: ${payload.instruction}
Context: the score is 0 (worst) to 10 (best). Only return JSON.`;
  const response = await retryWithBackoff(async () => {
    const res = await axios.post(
      `${GEMINI_API_BASE}/${GEMINI_MODEL}:generateContent?key=${GEMINI_API_KEY}`,
      { contents: [{ parts: [{ inlineData: { mimeType, data: base64 } }, { text: prompt }] }],
        generationConfig: { responseMimeType: "application/json", responseSchema: { type: "object", properties: { score: { type: "number" } }, required: ["score"] } } },
      { timeout: 30000 },
    );
    return res.data;
  });
  return JSON.parse(response?.candidates?.[0]?.content?.parts?.[0]?.text || "{}")?.score ?? 0;
}

// DeepSeek text scorer: returns 0-10 for a text criterion.
async function deepSeekText(payload) {
  const system = "You are a strict YouTube content auditor. Return only JSON.";
  const prompt = `Judge the following content against this criterion and return JSON {"score": 0-10}.
Criterion: ${payload.instruction}
Channel niche: ${payload.niche || "General"}
Content:
${String(payload.text || "").slice(0, 8000)}
Score 0 (worst) to 10 (best). Only return JSON.`;
  const response = await retryWithBackoff(async () => {
    const res = await axios.post(
      `${DEEPSEEK_API_BASE}/chat/completions`,
      { model: DEEPSEEK_MODEL, messages: [{ role: "system", content: system }, { role: "user", content: prompt }],
        response_format: { type: "json_object" }, temperature: 0.4, max_tokens: 1000 },
      { headers: { Authorization: `Bearer ${DEEPSEEK_API_KEY}`, "Content-Type": "application/json" }, timeout: 120000 },
    );
    return res.data;
  });
  return JSON.parse(response?.choices?.[0]?.message?.content || "{}")?.score ?? 0;
}

const videoAuditService = createVideoAuditService({ geminiVision, deepSeekText });
const videoAuditRouter = createVideoAuditRouter({
  ...routeDeps,
  getConnectedChannelIds: (req) => channelOwnership.getConnectedChannelIds(req),
  enqueueVideoAudit: (data, opts) => queueService.enqueueVideoAudit(data, opts),
  jobsGet: (id) => queueService?.queues?.videoAudit?.getJob?.(id),
  fetchVideoInputs,
});
```
Note: `queueService` may be a no-op when REDIS_URL is unset — its `enqueueVideoAudit` should throw/return a rejected job so the route surfaces a 503. Guard the POST route's enqueue to return 503 when the queue is unavailable (e.g. `if (!queueService || !queueService.queues?.videoAudit) return res.status(503).json({ error: { message: "Queue unavailable." } });` before enqueuing).
- Mount: `apiRouter.use("/video-audit", videoAuditRouter);` (place after the `/audit` mount).
- Add the `video-audit` queue worker deps to the queue service: pass `fetchVideoInputs` and `videoAuditService.auditBatch` into `createQueueService`'s deps (Task 4 wired the processor; this task supplies the real `fetchVideoInputs` and `auditBatch`).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test videoAudit`
Expected: PASS. Run `node -c backend/index.js` to confirm no syntax errors.

- [ ] **Step 5: Commit**

```bash
git add backend/routes/videoAudit.js backend/routes/videoAudit.test.mjs backend/index.js
git commit -m "feat: add video audit route and backend wiring"
```

---

### Task 6: `videoAudit` page key + PG migration

**Files:**
- Modify: `backend/config/featureConfig.js`
- Modify: `backend/config/featureConfig.test.mjs`
- Create: `backend/db/drizzle/0010_video_audits.sql`
- Create: `backend/db/migrations/007_video_audits.sql`

**Interfaces:**
- Consumes: existing `featureConfig` merge/validation.
- Produces: `videoAudit` page key in `DEFAULT_FEATURE_CONFIG.pages`; a PG `video_audits` table migration.

- [ ] **Step 1: Write the failing test**

Add to `backend/config/featureConfig.test.mjs`:
```js
it("videoAudit page key is present with limits", () => {
  const { DEFAULT_FEATURE_CONFIG } = require("./featureConfig");
  const page = DEFAULT_FEATURE_CONFIG.pages.videoAudit;
  expect(page).toBeDefined();
  expect(page.freeLimit).toBeGreaterThan(0);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && corepack pnpm test featureConfig`
Expected: FAIL — `videoAudit` page key missing.

- [ ] **Step 3: Write minimal implementation**

In `backend/config/featureConfig.js`, add after the `audit` page key (line 70):
```js
    videoAudit: {
      label: "Video Audit",
      enabled: true,
      premiumOnly: false,
      freeLimit: 3,
      proLimit: 100,
    },
```

`backend/db/migrations/007_video_audits.sql`:
```sql
CREATE TABLE IF NOT EXISTS video_audits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  uid text NOT NULL,
  name text NOT NULL,
  channel_id text,
  channel_title text,
  results jsonb NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS video_audits_uid_idx ON video_audits (uid);
```

`backend/db/drizzle/0010_video_audits.sql`: same content (mirror how `0009_audits.sql`/`006_audits.sql` duplicate).

- [ ] **Step 4: Run test to verify it passes**

Run: `cd backend && corepack pnpm test featureConfig`
Expected: PASS. Confirm migration numbers don't collide (`ls backend/db/migrations/` and `backend/db/drizzle/`).

- [ ] **Step 5: Commit**

```bash
git add backend/config/featureConfig.js backend/config/featureConfig.test.mjs backend/db/
git commit -m "feat: add videoAudit page key and PG migration"
```

---

### Task 7: Frontend schema/types/context for `auditCriteria`

**Files:**
- Modify: `frontend/src/utils/featureConfigSchema.ts`
- Create: `frontend/src/types/videoAudit.ts`
- Modify: `frontend/src/hooks/useFeatureConfig.ts`
- Modify: `frontend/src/contexts/FeatureConfigContext.tsx`
- Test: `frontend/src/utils/featureConfigSchema.test.ts`

**Interfaces:**
- Consumes: existing `featureConfigSchema` shape.
- Produces: `auditCriteriaSchema`, `DEFAULT_AUDIT_CRITERIA` (frontend), `AuditCriterion`, `VideoAuditResult`, `VideoAuditBatch` types; `useAuditCriteria()` hook.

- [ ] **Step 1: Write the failing test**

Add to `frontend/src/utils/featureConfigSchema.test.ts`:
```ts
import { auditCriteriaSchema, DEFAULT_AUDIT_CRITERIA } from './featureConfigSchema';
it('auditCriteriaSchema parses the default criteria', () => {
  expect(auditCriteriaSchema.safeParse(DEFAULT_AUDIT_CRITERIA).success).toBe(true);
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd frontend && corepack pnpm test featureConfigSchema`
Expected: FAIL — exports missing.

- [ ] **Step 3: Write minimal implementation**

In `frontend/src/utils/featureConfigSchema.ts`:
```ts
export const auditCriterionSchema = z.object({
  key: z.string(),
  label: z.string(),
  weight: z.number().positive(),
  element: z.string(),
  instruction: z.string(),
  niches: z.array(z.string()).default([]),
});
export const auditCriteriaSchema = z.object({
  video: z.array(auditCriterionSchema),
});
export type AuditCriterion = z.infer<typeof auditCriterionSchema>;
export type AuditCriteria = z.infer<typeof auditCriteriaSchema>;

export const DEFAULT_AUDIT_CRITERIA: AuditCriteria = {
  video: [
    { key: 'title_clear', label: 'Title Clarity', weight: 20, element: 'title', instruction: 'How clear and click-worthy is the title?', niches: [] },
    { key: 'title_curiosity', label: 'Title Curiosity', weight: 15, element: 'title', instruction: 'Does the title create curiosity?', niches: [] },
    { key: 'description_rich', label: 'Description Richness', weight: 15, element: 'description', instruction: 'How complete and helpful is the description?', niches: [] },
    { key: 'tags_quality', label: 'Tag Quality', weight: 10, element: 'tags', instruction: 'Are the tags relevant?', niches: [] },
    { key: 'keywords_match', label: 'Keyword Relevance', weight: 10, element: 'keywords', instruction: 'Do keywords match the title and description?', niches: [] },
    { key: 'caption_value', label: 'Caption Value', weight: 15, element: 'caption', instruction: 'Does the caption add value?', niches: [] },
    { key: 'thumbnail_pop', label: 'Thumbnail Pop', weight: 15, element: 'thumbnail', instruction: 'How eye-catching is the thumbnail?', niches: [] },
  ],
};
```
Add `auditCriteria: auditCriteriaSchema.optional()` to `featureConfigSchema`. Extend `FeatureConfigContextValue` with `auditCriteria: AuditCriteria` (defaulting to `DEFAULT_AUDIT_CRITERIA` via `config.auditCriteria ?? DEFAULT_AUDIT_CRITERIA`), add a `useAuditCriteria()` hook in `useFeatureConfig.ts` returning `ctx.auditCriteria`, and expose `auditCriteria` in the provider value.

`frontend/src/types/videoAudit.ts`:
```ts
export interface VideoAuditCriterionScore {
  key: string;
  label: string;
  score: number;
  earned: number;
  weight: number;
  max: number;
  note?: string;
}
export interface VideoAuditResult {
  videoId: string;
  title?: string;
  total: number;
  breakdown: VideoAuditCriterionScore[];
}
export interface VideoAuditBatch {
  results: VideoAuditResult[];
  overall: number;
}
```

- [ ] **Step 4: Run test to verify it passes + typecheck**

Run: `cd frontend && corepack pnpm test featureConfigSchema` then `cd frontend && corepack pnpm exec tsc -b --pretty false`
Expected: PASS; clean typecheck.

- [ ] **Step 5: Commit**

```bash
git add frontend/src/utils/featureConfigSchema.ts frontend/src/types/videoAudit.ts frontend/src/hooks/useFeatureConfig.ts frontend/src/contexts/FeatureConfigContext.tsx frontend/src/utils/featureConfigSchema.test.ts
git commit -m "feat: add audit criteria schema, types, and context"
```

---

### Task 8: Admin Video Audit Criteria editor

**Files:**
- Create: `frontend/src/components/admin/AuditCriteriaEditor.tsx`
- Modify: `frontend/src/pages/AdminPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `AuditCriteria`/`DEFAULT_AUDIT_CRITERIA` types, `getFirebaseAuthHeader`, `apiUrl`.
- Produces: an editable list of criteria (key/label/weight/element/instruction/niches) with a live total indicator and Save (`PUT /admin/audit-criteria`).

- [ ] **Step 1: Write the component**

`frontend/src/components/admin/AuditCriteriaEditor.tsx`:
```tsx
import React, { useState } from 'react';
import { DEFAULT_AUDIT_CRITERIA, type AuditCriterion, type AuditCriteria } from '../../utils/featureConfigSchema';
import { apiUrl } from '../../utils/apiBase';
import { getFirebaseAuthHeader } from '../../services/authHeaders';

const ELEMENTS = ['title', 'description', 'tags', 'keywords', 'caption', 'thumbnail'];

export const AuditCriteriaEditor: React.FC<{ config: AuditCriteria }> = ({ config: initial }) => {
  const [items, setItems] = useState<AuditCriterion[]>(initial.video?.length ? initial.video : DEFAULT_AUDIT_CRITERIA.video);
  const [status, setStatus] = useState('');

  const update = (i: number, patch: Partial<AuditCriterion>) =>
    setItems((prev) => prev.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));

  const add = () =>
    setItems((prev) => [...prev, { key: `criterion_${prev.length + 1}`, label: '', weight: 10, element: 'title', instruction: '', niches: [] }]);

  const remove = (i: number) => setItems((prev) => prev.filter((_, idx) => idx !== i));

  const save = async () => {
    setStatus('Saving...');
    try {
      const headers = { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeader()) };
      const res = await fetch(apiUrl('/admin/audit-criteria'), { method: 'PUT', headers, body: JSON.stringify({ video: items }) });
      setStatus(res.ok ? 'Saved' : 'Failed to save');
    } catch {
      setStatus('Failed to save');
    }
  };

  return (
    <div>
      <h3>Video Audit Criteria</h3>
      {items.map((c, i) => (
        <div key={i} style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
          <input placeholder="label" value={c.label} onChange={(e) => update(i, { label: e.target.value })} />
          <input type="number" min={1} value={c.weight} onChange={(e) => update(i, { weight: Number(e.target.value) })} />
          <select value={c.element} onChange={(e) => update(i, { element: e.target.value })}>
            {ELEMENTS.map((el) => <option key={el} value={el}>{el}</option>)}
          </select>
          <input placeholder="instruction" value={c.instruction} onChange={(e) => update(i, { instruction: e.target.value })} />
          <input placeholder="niches (comma separated)" value={c.niches.join(', ')} onChange={(e) => update(i, { niches: e.target.value.split(',').map((s) => s.trim()).filter(Boolean) })} />
          <button onClick={() => remove(i)}>x</button>
        </div>
      ))}
      <button onClick={add}>Add criterion</button>
      <button onClick={save}>Save</button>
      <span>{status}</span>
    </div>
  );
};
```

In `AdminPage.tsx`: add a `'video-audit-criteria'` tab (or a sub-section under an existing tab), fetch `GET /admin/audit-criteria` on open (with auth header, fallback `DEFAULT_AUDIT_CRITERIA`), and render `<AuditCriteriaEditor config={...} />`. In `App.tsx` add a route `admin/video-audit-criteria` (AdminRoute + AdminPage). In `Layout.tsx` add a nav item gated by admin. Keep it minimal and consistent with the existing Scoring tab (Task 8 of Phase1).

- [ ] **Step 2: Typecheck + test**

Run: `cd frontend && corepack pnpm build` (tsc -b), then `cd frontend && corepack pnpm test`.
Expected: clean; all tests pass.

- [ ] **Step 3: Commit**

```bash
git add frontend/src/components/admin/AuditCriteriaEditor.tsx frontend/src/pages/AdminPage.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat: add admin video audit criteria editor"
```

---

### Task 9: `/video-audit` page

**Files:**
- Create: `frontend/src/services/videoAuditService.ts`
- Create: `frontend/src/hooks/queries/useVideoAudit.ts`
- Create: `frontend/src/pages/VideoAuditPage.tsx`
- Modify: `frontend/src/App.tsx`
- Modify: `frontend/src/components/Layout.tsx`

**Interfaces:**
- Consumes: `types/videoAudit.ts`, `useAuditCriteria()`, `apiUrl`, `getFirebaseAuthHeader`, `FeatureGuard`.
- Produces: `/video-audit` route; page = channel picker + video multi-select + Run (enqueue) + poll job status + per-video results + weighted batch overall + save/history.

- [ ] **Step 1: Write the API client**

`frontend/src/services/videoAuditService.ts`:
```ts
import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from './authHeaders';
import type { VideoAuditBatch } from '../types/videoAudit';

async function request(path: string, init?: RequestInit) {
  const headers = { 'Content-Type': 'application/json', ...(await getFirebaseAuthHeader()), ...(init?.headers || {}) };
  const res = await fetch(apiUrl(path), { ...init, headers });
  if (!res.ok) throw new Error(`Request failed: ${res.status}`);
  return res.json();
}

export async function startVideoAudit(channelId: string, videoIds: string[]) {
  return request('/video-audit', { method: 'POST', body: JSON.stringify({ channelId, videoIds }) }) as Promise<{ jobId: string }>;
}

export async function getVideoAuditJob(jobId: string) {
  return request(`/video-audit/jobs/${encodeURIComponent(jobId)}`) as Promise<{ jobId: string; state: string; progress: number; result?: VideoAuditBatch }>;
}

export async function saveVideoAudit(payload: { name?: string; channelId?: string; channelTitle?: string; results: unknown }) {
  return request('/video-audit/history', { method: 'POST', body: JSON.stringify(payload) });
}

export async function getVideoAuditHistory(limit = 20, page = 1) {
  return request(`/video-audit/history?limit=${limit}&page=${page}`);
}

export async function getVideoAuditHistoryItem(id: string) {
  return request(`/video-audit/history/${encodeURIComponent(id)}`);
}

export async function deleteVideoAuditHistory(id: string) {
  return request(`/video-audit/history/${encodeURIComponent(id)}`, { method: 'DELETE' });
}
```

`frontend/src/hooks/queries/useVideoAudit.ts` (mirror `useThumbnailAudit.ts`):
```ts
import { useMutation } from '@tanstack/react-query';
import * as VideoAuditService from '../../services/videoAuditService';

export function useStartVideoAudit(opts: { onSuccess?: (data: { jobId: string }) => void; onError?: (e: Error) => void } = {}) {
  return useMutation({
    mutationFn: (params: { channelId: string; videoIds: string[] }) => VideoAuditService.startVideoAudit(params.channelId, params.videoIds),
    onSuccess: opts.onSuccess,
    onError: opts.onError,
    retry: 0,
    meta: { suppressGlobalErrorToast: true },
  });
}
```

- [ ] **Step 2: Write the page**

`frontend/src/pages/VideoAuditPage.tsx`:
- Wrapped in `FeatureGuard pageKey="videoAudit"`.
- Channel picker: load connected channels (personal `allTokens` / org `getOrganizationChannels`, mirroring `AuditPage.tsx` lines ~335-363).
- Video multi-select: after picking a channel, load that channel's videos (reuse the channel-video fetch pattern from `AuditPage`/`ChannelVideoPicker`) and show checkboxes to pick one or a batch.
- "Run Audit" button: `useStartVideoAudit` mutation -> `{ jobId }` -> poll `getVideoAuditJob(jobId)` every ~3s until `state === 'completed'` (show `progress`), then render `result`.
- Results: per-video cards (score ring `total/100`, per-criterion breakdown: label, score/10, weight, rationale note) + batch `overall`.
- Save button (`saveVideoAudit({ channelId, channelTitle, results })`) + a minimal history list (load/view/delete).
- Use `useAuditCriteria()` for the criteria display; mount `ScoringHelpPanel` if helpful.
- Show a `UsageBar` for the `videoAudit` quota key (add `videoAudit: "videoAudit"` to Layout's `pageKeyMap`).

In `App.tsx`: add a lazy route `/video-audit` wrapped in `Suspense` + `FeatureGuard pageKey="videoAudit"`, adjacent to the optimizer/audit routes. In `Layout.tsx`: add a "Video Audit" nav item gated by `isNavItemVisible("videoAudit")`, add `videoAudit: "videoAudit"` to `pageKeyMap`, and an icon from `react-icons/md`.

- [ ] **Step 3: Typecheck + test**

Run: `cd frontend && corepack pnpm build` (tsc -b), then `cd frontend && corepack pnpm test`.
Expected: clean; all tests pass.

- [ ] **Step 4: Commit**

```bash
git add frontend/src/services/videoAuditService.ts frontend/src/hooks/queries/useVideoAudit.ts frontend/src/pages/VideoAuditPage.tsx frontend/src/App.tsx frontend/src/components/Layout.tsx
git commit -m "feat: add video audit page"
```

---

### Task 10: Full verification + docs

**Files:**
- No new source files.
- Modify: `docs/TESTING.md`, `fulldocs/02-Backend Service/05-Testing (Vitest).md`, `fulldocs/01-Project Overview/02-System Architecture.md`

- [ ] **Step 1: Backend suite**

Run: `cd backend && corepack pnpm test`
Expected: all pass, including the new `auditCriteria`, `videoAuditService`, `adminAuditCriteria`, `videoAudit`, `videoAuditQueue`, and `featureConfig` tests. Security-core suite stays green.

- [ ] **Step 2: Frontend suite + build**

Run: `cd frontend && corepack pnpm test` then `cd frontend && corepack pnpm build`
Expected: all frontend tests pass; `tsc -b && vite build` succeeds.

- [ ] **Step 3: Syntax check**

Run: `node -c backend/index.js`
Expected: no syntax errors.

- [ ] **Step 4: Update docs**

Add a short section to `docs/TESTING.md` and `fulldocs/02-Backend Service/05-Testing (Vitest).md` listing the new video-audit test files. Add an entry to `fulldocs/01-Project Overview/02-System Architecture.md` (or closest) describing the `/video-audit` feature and the `auditCriteria` config (Gemini for images, DeepSeek for text, BullMQ queue). No EM dashes.

- [ ] **Step 5: Commit**

```bash
git add docs/TESTING.md fulldocs/
git commit -m "docs: document video audit system and its tests"
```

---

## Memory note (record after verification)

Save a `project` memory: "RevTube video audit (2026-08-08) — admin-configurable LLM-scored engine separate from Phase1 deterministic audit. `config/auditCriteria.js` (Firestore `config/auditCriteria`, freeform criteria: key/label/weight/element/instruction/niches). `services/videoAuditService.js` scores Gemini (thumbnail) / DeepSeek (text) criteria, weighted-mean to 0-100 with x1.5 niche boost. BullMQ `video-audit` queue + `POST /video-audit` enqueue / `GET /jobs/:id` poll, PG `video_audits` history. Frontend `/video-audit` page + admin criteria editor. Phase2: migrate channel/playlist/optimizers onto this engine." Link `[[audit-scoring-system]]`.
