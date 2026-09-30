# RevTube Documentation

Single source of truth for the RevTube (TubeKeter Analytics) codebase.

> **Last verified against source: 2026-09-28.** Every route, table, queue, env var and
> library version in these docs was read out of the code, not recalled. When code and
> docs disagree, the code wins and the doc is the bug.

## How the docs are organised

Folders are numbered so the reading order matches how a request flows through the
system: overview, then backend, then auth, then the user-facing surfaces, then the
frontend, then infrastructure, then the individual feature subsystems, then
reference material.

| # | Section | What it covers |
|---|---------|----------------|
| [01](01-Project%20Overview/Project%20Overview.md) | Project Overview | What the product is, repo layout, architecture, local setup |
| [02](02-Backend%20Service/Backend%20Service.md) | Backend Service | Express wiring, API reference, caching, ingestion, cron, queues, testing |
| [03](03-Authentication%20%26%20Authorization/Authentication%20%26%20Authorization.md) | Auth & Authorization | Firebase, YouTube OAuth, orgs/permissions, feature toggles, quota |
| [04](04-Analytics%20Dashboard/Analytics%20Dashboard.md) | Analytics Dashboard | Zustand store, XState machine, query hooks, dashboard UI |
| [05](05-Content%20Pages/Content%20Pages.md) | Content Pages | Channel inspector, videos/playlists browser, compare |
| [06](06-Frontend%20Architecture/Frontend%20Architecture.md) | Frontend Architecture | Shell/routing, design system, services, charts |
| [07](07-Infrastructure%20%26%20Deployment/Infrastructure%20%26%20Deployment.md) | Infrastructure | Docker, DB schema, Drizzle, prod vs local |
| [08](08-Glossary/Glossary.md) | Glossary | Term definitions |
| [09](09-AI%20Chat%20System/AI%20Chat%20System.md) | AI Chat System | DeepSeek agent, tools, guardrails, memory |
| [10](10-Thumbnail%20Optimizer/Thumbnail%20Optimizer.md) | Thumbnail Optimizer | Gemini-powered thumbnail scoring |
| [11](11-Playlist%20Optimizer/Playlist%20Optimizer.md) | Playlist Optimizer | Playlist decay/scoring engine |
| [12](12-Video%20Audit/Video%20Audit.md) | Video Audit | Per-video LLM audit pipeline |
| [13](13-Notification%20System/Notification%20System.md) | Notification System | In-app + email notifications |
| [14](14-Goals%20%26%20Forecasting%20System/01-Goals%20%26%20Forecasting.md) | Goals & Forecasting | Goal pacing, adaptive baselines, client-side forecasting |
| [15](15-Anomaly%20Detection/Anomaly%20Detection.md) | Anomaly Detection | Deterministic spike/dip/trend scanner + AI explanations |
| [16](16-Full%20Audit%20Orchestrator/Full%20Audit%20Orchestrator.md) | Full Audit Orchestrator | Unified multi-stage channel audit |
| [17](17-Public%20Audit/Public%20Audit.md) | Public Audit | Admin-only audits of arbitrary public channels |
| [18](18-Custom%20Dashboards/Custom%20Dashboards.md) | Custom Dashboards | `/my-dashboard` widget grid |
| [19](19-Channel%20Focus/Channel%20Focus.md) | Channel Focus | Shared per-channel AI context store |
| [20](20-Reference/Reference.md) | Reference | Testing, source-audit findings, historical plans |

## Conventions in this documentation set

- **Page naming**: every folder has an overview page named after the folder
  (`Backend Service.md`) plus numbered child pages (`01-…`, `02-…`).
- **Links are relative** and verified to resolve. The old flat `docs/*.md` files
  (PROJECT_GUIDE, CACHING, QUEUE, DESIGN_LANGUAGE, …) no longer exist at that level;
  they were folded into the numbered sections below.
- **No em dashes** in prose (project convention).
- **Paths are absolute-from-repo-root** in code blocks (`backend/routes/dashboard.js`),
  relative in markdown links.

## Separate, deliberately untouched

- [`context/`](context/README.md) — dated per-system change log, written by
  the agent workflow. Not part of the reference set; do not edit when refreshing
  the reference docs.
- [`../frontend/docs/UI_STANDARDS.md`](../frontend/docs/UI_STANDARDS.md) — button and
  component contracts, owned by the frontend package.

## Regenerating the API reference

`docs/02-Backend Service/01-API Endpoints & Middleware.md` is the complete route
table. It was produced by parsing every `router.<verb>(…)` call site in
`backend/routes/*.js`, `backend/index.js` and `backend/chat/index.js`, so it is
exhaustive rather than curated. Re-derive it after adding or removing any route.
