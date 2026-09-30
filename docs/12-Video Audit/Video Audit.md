## Video Audit

The Video Audit page (`/video-audit`) asynchronously scores one or more videos from your own
connected channels against admin-configurable criteria using two LLM adapters: DeepSeek for
text (titles, descriptions, tags, keywords, captions) and the **Thumbnail Optimizer's
12-pillar Gemini analysis** for the thumbnail element. Thumbnails do NOT run a separate vision
pass -- the audit calls `thumbnailOptimizerService.analyze()` once per video (in parallel with
the text scoring) and reuses its `currentScore`/`expectedScore` plus the full `ThumbnailAudit`.
A BullMQ queue runs the audit job; the page polls its progress and auto-saves results to a
PostgreSQL history store. See [Video Audit](../12-Video Audit/02-Video Audit Reference) for the full
architecture, scoring contract, and admin criteria reference.

When a video audit completes, the user is notified via in-app bell, email, and (if the
tab is backgrounded) an OS notification -- see [Notification System](../13-Notification%20System/Notification%20System.md).
The `jobId` is persisted in `sessionStorage`, so leaving the page or closing the tab never
cancels the server-side job; returning resumes polling.

Relevant source files

- [backend/config/auditCriteria.js](../../backend/config/channelAuditCriteria.js)
- [backend/services/videoAuditLLM.js](../../backend/services/videoAuditLLM.js)
- [backend/services/videoAuditService.js](../../backend/services/videoAuditService.js)
- [backend/queue/videoAuditQueue.js](../../backend/queue/videoAuditQueue.js)
- [backend/queue/index.js](../../backend/queue/index.js)
- [backend/routes/videoAudit.js](../../backend/routes/videoAudit.js)
- [backend/routes/admin.js](../../backend/routes/admin.js)
- [backend/db/drizzle/0010_video_audits.sql](../../backend/db/drizzle/0010_video_audits.sql)
- [frontend/src/types/videoAudit.ts](../../frontend/src/types/videoAudit.ts)
- [frontend/src/services/videoAuditService.ts](../../frontend/src/services/videoAuditService.ts)
- [frontend/src/services/videoAuditExport.ts](../../frontend/src/services/videoAuditExport.ts)
- [frontend/src/hooks/queries/useVideoAudit.ts](../../frontend/src/hooks/queries/useVideoAudit.ts)
- [frontend/src/pages/VideoAuditPage.tsx](../../frontend/src/pages/video-audit/VideoAuditPage.tsx)
- [frontend/src/pages/VideoAuditPage.css](../../frontend/src/pages/video-audit/VideoAuditPage.css)
- [frontend/src/pages/videoAudit/VideoAuditInputForm.tsx](../../frontend/src/pages/video-audit/VideoAuditInputForm.tsx)
- [frontend/src/pages/videoAudit/VideoAuditReportHeader.tsx](../../frontend/src/pages/video-audit/VideoAuditReportHeader.tsx)
- [frontend/src/pages/videoAudit/VideoAuditTable.tsx](../../frontend/src/pages/video-audit/VideoAuditTable.tsx)
- [frontend/src/pages/videoAudit/VideoAuditDetailedAnalysis.tsx](../../frontend/src/pages/video-audit/VideoAuditDetailedAnalysis.tsx)
- [frontend/src/pages/videoAudit/VideoAuditHistoryPanel.tsx](../../frontend/src/pages/video-audit/VideoAuditHistoryPanel.tsx)
- [frontend/src/components/admin/AuditCriteriaEditor.tsx](../../frontend/src/components/admin/AuditCriteriaEditor.tsx)
- [frontend/src/pages/thumbnailOptimizer/ChannelVideoPicker.tsx](../../frontend/src/pages/thumbnail-optimizer/ChannelVideoPicker.tsx)

### Thumbnail element & detailed child audit

The thumbnail element reuses the production Thumbnail Optimizer 12-pillar engine rather than a
separate vision path:

- During `scoreVideo`, the service calls `thumbnailOptimizerService.analyze([watchUrl], niche, "", "")`
  in parallel with the text scoring. `watchUrl` is built from `videoId`
  (`https://www.youtube.com/watch?v=<id>`). The first `ThumbnailAudit` result supplies the
  element score (`currentScore * 10`) and the fix-target projection (`expectedScore * 10`), and
  the full audit is attached to the element as `thumbnailAnalysis`.
- **Normal view** (Video Audit detailed breakdown): the thumbnail element shows only its score,
  a "General Knowledge" summary (`reviewSummary`), and a **"Detailed Thumbnail Analysis"**
  button. No text-style concept alternatives are shown -- a thumbnail is not a text element.
- **Detailed child audit**: the run's child analyses are persisted into the
  Optimizer history as one `thumbnail_audits` row ("Video Audit -- <date>", row id
  exposed as `thumbnailAuditSavedId` on the job result), so clicking the button
  opens that saved entry via `/thumbnail-optimizer?audit=<rowId>&scroll=<videoId>`
  -- the page loads it through `handleLoadAudit`, expands this video's accordion,
  and smooth-scrolls to it (no AI re-run). Only when no saved row exists
  (legacy runs / save skipped) does it fall back to
  `/thumbnail-optimizer?video=<id>&niche=<niche>&auto=1`: on mount the Thumbnail
  Optimizer page auto-enqueues the full 12-pillar audit for that one video (the
  "child audit" that finishes the series) and renders the per-pillar deep dive.
  The running child audit survives navigation via `useSessionJobId`
  sessionStorage persistence.

### Concrete suggestions & per-alternative scoring

Beyond the numeric projection, `scoreVideo` returns ready-to-use copy for weak elements via one
DeepSeek JSON call (`buildSuggestionPrompt`). Each alternative is scored with the SAME
`deepSeekText` element scorer the live audit used, so the number is directly comparable to the
element's own score:

- `title.options` and `tags`/`keywords.suggested` get parallel `scores: number[]` arrays
  (e.g. 3 alt titles -> 3 independent title scores). `description.rewrite` gets a single `score`.
- The suggestion prompt enforces a quality bar (alternatives must score >= 80/100). As a safety
  net the UI only renders alternatives scoring >= `MIN_ALT_SCORE` (70); 70-79 show with a yellow
  pill, <70 are hidden.
- The recommendation card shows a concise "+N pts potential uplift" chip (no "Raise from X to Y"
  projection line) plus the concrete alternatives.
- Thumbnail `concepts` are intentionally unscored (no image to grade) and the thumbnail element
  relies on the General Knowledge box + button instead of a concept card.

See [Thumbnail Optimizer](../10-Thumbnail%20Optimizer/Thumbnail%20Optimizer.md) for the
12-pillar rubric and child-audit auto-run flow.
