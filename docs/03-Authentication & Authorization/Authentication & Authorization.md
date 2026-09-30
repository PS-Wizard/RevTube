## Authentication & Authorization

Relevant source files

-   [backend/middleware/auth.js](../../backend/middleware/auth.js)
-   [backend/middleware/quota.js](../../backend/middleware/quota.js)
-   [backend/middleware/premiumAccess.js](../../backend/middleware/premiumAccess.js)
-   [backend/middleware/orgToken.js](../../backend/middleware/orgToken.js)
-   [frontend/src/contexts/AuthContext.tsx](../../frontend/src/contexts/AuthContext.tsx)
-   [frontend/src/contexts/OrganizationContext.tsx](../../frontend/src/contexts/OrganizationContext.tsx)
-   [frontend/src/hooks/useAuth.ts](../../frontend/src/hooks/useAuth.ts)
-   [frontend/src/hooks/useOrganization.ts](../../frontend/src/hooks/useOrganization.ts)
-   [frontend/src/services/userService.ts](../../frontend/src/services/userService.ts)

The RevTube platform implements a multi-layered security model that combines identity management, external API delegation, and a multi-tenant permission system. Authentication is handled via Firebase, while authorization for YouTube data is managed through OAuth 2.0. Access control within the application is governed by a hierarchical organization model and tiered usage limits.

## Authentication System Overview

The core of the identity layer is `AuthContext`, which manages the Firebase authentication lifecycle and synchronizes user profiles with the backend.

-   Firebase Auth: Handles user sign-in, email verification, and session persistence [frontend/src/contexts/AuthContext.tsx#4-9](../../frontend/src/contexts/AuthContext.tsx)
-   Performance Optimization: The system uses "Auth Hints" and profile caching in `localStorage` to provide an optimistic authenticated state, reducing UI flicker during Firebase initialization [frontend/src/contexts/AuthContext.tsx#14-43](../../frontend/src/contexts/AuthContext.tsx)
-   Profile Synchronization: Upon login, `syncUserProfile` calls the `/user/init` endpoint to fetch the user's role, package (Free/Pro), and associated organization memberships [frontend/src/contexts/AuthContext.tsx#158-196](../../frontend/src/contexts/AuthContext.tsx)

For details on the sign-in lifecycle and token management, see [Firebase Auth & YouTube OAuth Flow](01-Firebase Auth & YouTube OAuth Flow.md).

### Auth Entity Relationship

This diagram maps the logical authentication concepts to their implementations in the codebase.

Sources: [frontend/src/contexts/AuthContext.tsx#14-24](../../frontend/src/contexts/AuthContext.tsx) [frontend/src/contexts/AuthContext.tsx#128-156](../../frontend/src/contexts/AuthContext.tsx) [frontend/src/services/userService.ts#186-196](../../frontend/src/services/userService.ts)

___

## Organization & Permission Model

RevTube uses a multi-tenant architecture where users can belong to multiple Organizations. Authorization is determined by the intersection of the user's role within an organization and their global subscription tier.

-   OrganizationContext: Manages the "Active Workspace" state. It tracks whether a user is in their personal context or an organization context [frontend/src/contexts/OrganizationContext.tsx#75-80](../../frontend/src/contexts/OrganizationContext.tsx)
-   Role Hierarchy: Supports roles such as `owner`, `admin`, and `write`, which dictate permissions for managing members, inviting users, and editing channel settings [frontend/src/contexts/OrganizationContext.tsx#61-67](../../frontend/src/contexts/OrganizationContext.tsx)
-   Context Switching: Users can switch between organizations via `switchOrganization`, which updates the `lastOrgContext` in `localStorage` and refreshes the token resolution logic [frontend/src/contexts/OrganizationContext.tsx#167-198](../../frontend/src/contexts/OrganizationContext.tsx)

For details on role definitions and membership management, see [Organization & Permission System](02-Organization & Permission System.md).

___

## Usage Limits & Feature Gating

To support a "Freemium" model, the system enforces limits on API usage and UI features based on the `userPackage` (e.g., `free`, `pro`).

-   Backend Enforcement: Middleware such as `requireQuota` (atomic `INCRBY key 0` read via `quotaService.readCount()`) and `consumeQuota(req, opts)` (overshoot detection) enforce monthly quotas per page key. Channel metadata routes (`/channel/handle/:handle`, `/channel/id/:id`, `/channel/username/:username`) have `requireQuota("channel")` and consume channel quota via `consumeQuota(req, { billable: true })`. True resolve-only endpoints (`/channel-videos/:channelId`, `/video/:videoId`) skip quota and are rate-limited by `resolveLimiter` instead [middleware/quota.js](../../backend/middleware/quota.js) [services/quotaService.js](../../backend/services/quotaService.js)
-   Frontend Gating: The `FeatureGuard` component and `FeatureConfig` map specific page keys to limit thresholds, preventing access to Pro features for Free users [frontend/src/contexts/AuthContext.tsx#112-114](../../frontend/src/contexts/AuthContext.tsx)
-   Error Propagation: When limits are exceeded, the backend returns a `UsageLimitError`, which the frontend catches to display upgrade prompts [frontend/src/services/userService.ts#159-162](../../frontend/src/services/userService.ts)

For details on quota configuration and tiered access, see [Usage Limits & Feature Gating](03-Usage Limits & Feature Gating.md).

___

## Token Resolution Pipeline

A critical aspect of the system is resolving the correct YouTube OAuth token based on the current UI context (Personal vs. Organization).

### Token Resolution Flow

How the system identifies which YouTube credentials to use for an API call.

Sources: [frontend/src/contexts/AuthContext.tsx#158-189](../../frontend/src/contexts/AuthContext.tsx) [frontend/src/services/userService.ts#23-38](../../frontend/src/services/userService.ts) [frontend/src/services/userService.ts#105-149](../../frontend/src/services/userService.ts)