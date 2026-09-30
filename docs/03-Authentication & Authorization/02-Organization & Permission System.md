## Organization & Permission System

Relevant source files

-   [frontend/src/components/CreateOrganizationModal.tsx](../../frontend/src/components/CreateOrganizationModal.tsx)
-   [frontend/src/components/InviteMemberModal.tsx](../../frontend/src/components/InviteMemberModal.tsx)
-   [frontend/src/components/OrganizationSwitcher.tsx](../../frontend/src/components/OrganizationSwitcher.tsx)
-   [frontend/src/contexts/OrganizationContext.tsx](../../frontend/src/contexts/OrganizationContext.tsx)
-   [frontend/src/hooks/useAuth.ts](../../frontend/src/hooks/useAuth.ts)
-   [frontend/src/hooks/useOrganization.ts](../../frontend/src/hooks/useOrganization.ts)
-   [frontend/src/pages/OrganizationPage.tsx](../../frontend/src/pages/organization/OrganizationPage.tsx)
-   [frontend/src/services/organizationChannelService.ts](../../frontend/src/services/organizationChannelService.ts)
-   [frontend/src/services/organizationService.ts](../../frontend/src/services/organizationService.ts)
-   [frontend/src/services/permissionService.ts](../../frontend/src/services/permissionService.ts)

The Organization & Permission System provides a multi-tenant architecture for RevTube, allowing users to collaborate in shared workspaces. It handles role-based access control (RBAC), organization-scoped resource management (channels and lists), and cross-user invitations.

## System Overview

RevTube operates on a "Workspace" model where a user can operate in their Personal Context or switch to one or more Organization Contexts [frontend/src/contexts/OrganizationContext.tsx#70-71](../../frontend/src/contexts/OrganizationContext.tsx)

### Core Concepts

-   Organization: A top-level entity containing members, shared YouTube channels, and saved lists [frontend/src/types/organization.ts](../../frontend/src/types/organization.ts)
-   Personal Context: The default state where resources are private to the individual user [frontend/src/components/OrganizationSwitcher.tsx#93-98](../../frontend/src/components/OrganizationSwitcher.tsx)
-   Roles: Hierarchy defining what a member can do: `owner`, `admin`, `write`, and `read` [frontend/src/types/organization.ts](../../frontend/src/types/organization.ts)

### Organization Data Flow

The following diagram illustrates how organization state is hydrated and synchronized between the UI, LocalStorage, and Firestore.

Organization State Hydration & Switching

Sources: [frontend/src/contexts/OrganizationContext.tsx#93-112](../../frontend/src/contexts/OrganizationContext.tsx) [frontend/src/contexts/OrganizationContext.tsx#167-198](../../frontend/src/contexts/OrganizationContext.tsx) [frontend/src/services/organizationService.ts#192-218](../../frontend/src/services/organizationService.ts)

## Permission Hierarchy & Computation

Permissions are computed dynamically based on the `currentMember` role within the `OrganizationContext`. The system uses a centralized `permissionService.ts` to enforce logic across the UI and API calls.

### Role Capabilities

### Permission Computation Logic

The `OrganizationContext` exposes boolean flags for easy UI gating:

-   `isOwner`: `currentMember.role === 'owner'` [frontend/src/services/permissionService.ts#124-128](../../frontend/src/services/permissionService.ts)
-   `canEdit`: `role` is `owner`, `admin`, or `write` [frontend/src/services/permissionService.ts#142-147](../../frontend/src/services/permissionService.ts)
-   `canInvite`: `role` is `owner` or `admin` [frontend/src/services/permissionService.ts#60-64](../../frontend/src/services/permissionService.ts)

Sources: [frontend/src/contexts/OrganizationContext.tsx#61-67](../../frontend/src/contexts/OrganizationContext.tsx) [frontend/src/services/permissionService.ts#1-178](../../frontend/src/services/permissionService.ts)

## Membership & Invitation Lifecycle

The system manages membership through an invitation flow to ensure security and user consent.

1.  Invitation: An Admin/Owner triggers `inviteMember`, creating a document in the `invitations` subcollection [frontend/src/components/InviteMemberModal.tsx#48-54](../../frontend/src/components/InviteMemberModal.tsx). The backend enqueues an email job to the BullMQ `email` queue (async, returns 200 immediately) instead of blocking on SMTP delivery.
2.  Acceptance: When a user accepts, the system adds them to the `members` subcollection and updates the user's `organizations` array [frontend/src/services/organizationService.ts#83-92](../../frontend/src/services/organizationService.ts)
3.  Cache Invalidation: On membership changes, the frontend calls `invalidateMembershipCache` on the backend. This is critical because the backend caches membership checks for 15 minutes to reduce Firestore read costs [frontend/src/services/organizationService.ts#29-55](../../frontend/src/services/organizationService.ts)

Sources: [frontend/src/services/organizationService.ts#24-55](../../frontend/src/services/organizationService.ts) [frontend/src/components/InviteMemberModal.tsx#30-67](../../frontend/src/components/InviteMemberModal.tsx)

## Shared Resource Management

Organizations allow members to share access to YouTube channels and Saved Lists without sharing Google credentials directly.

### Organization Channels

When a channel is added to an organization, its OAuth tokens can be stored on the organization channel document [frontend/src/services/organizationChannelService.ts#16-28](../../frontend/src/services/organizationChannelService.ts)

-   Token Sharing: This allows any member with `read` access to fetch analytics for that channel using the shared `accessToken` [frontend/src/services/organizationChannelService.ts#24-27](../../frontend/src/services/organizationChannelService.ts)
-   Token Refresh: If a shared token expires, `refreshOrgChannelToken` is called, which proxies the refresh through the backend `/oauth/refresh` endpoint and updates the Firestore document for all members [frontend/src/services/organizationChannelService.ts#76-129](../../frontend/src/services/organizationChannelService.ts)

### Saved Lists

Lists created within an organization context include an `organizationId` [frontend/src/services/permissionService.ts#7-9](../../frontend/src/services/permissionService.ts)

-   Edit Rules: Only members with `write` access or higher can modify organization lists [frontend/src/services/permissionService.ts#24-27](../../frontend/src/services/permissionService.ts)
-   Delete Rules: Only the creator, an admin, or the owner can delete a list [frontend/src/services/permissionService.ts#42-45](../../frontend/src/services/permissionService.ts)

Sources: [frontend/src/services/organizationChannelService.ts#33-67](../../frontend/src/services/organizationChannelService.ts) [frontend/src/services/permissionService.ts#14-55](../../frontend/src/services/permissionService.ts)

## UI Implementation

### OrganizationSwitcher

The `OrganizationSwitcher` component, typically located in the sidebar, allows users to toggle between workspaces.

-   Personal Option: Always available; clears the `currentOrganization` state [frontend/src/components/OrganizationSwitcher.tsx#93-114](../../frontend/src/components/OrganizationSwitcher.tsx)
-   PRO Gating: The ability to create new organizations is restricted to users with a `pro` package [frontend/src/components/OrganizationSwitcher.tsx#144-160](../../frontend/src/components/OrganizationSwitcher.tsx)

### OrganizationPage

The management interface for the current workspace [frontend/src/pages/OrganizationPage.tsx#34](../../frontend/src/pages/organization/OrganizationPage.tsx)

-   Member Management: Lists current members and allows role updates via `updateMemberRole` or removal via `removeMember` [frontend/src/pages/OrganizationPage.tsx#168-184](../../frontend/src/pages/organization/OrganizationPage.tsx)
-   Channel Management: Allows adding/removing YouTube channels from the shared workspace [frontend/src/pages/OrganizationPage.tsx#22](../../frontend/src/pages/organization/OrganizationPage.tsx)
-   Settings: Allows the owner to rename or delete the organization [frontend/src/pages/OrganizationPage.tsx#114-150](../../frontend/src/pages/organization/OrganizationPage.tsx)

Organization Management Component Tree

Sources: [frontend/src/pages/OrganizationPage.tsx#1-32](../../frontend/src/pages/organization/OrganizationPage.tsx) [frontend/src/components/OrganizationSwitcher.tsx#12-60](../../frontend/src/components/OrganizationSwitcher.tsx)

## Technical Implementation Details

### Membership Cache Invalidation

The backend maintains a cache of `{ isMember, role }` to avoid excessive Firestore lookups during API requests. When the frontend performs a write operation that affects membership (e.g., changing a role or deleting an org), it must trigger an invalidation:

[frontend/src/services/organizationService.ts#29-42](../../frontend/src/services/organizationService.ts)

```
<p><span><span>const</span><span> </span><span>invalidateMembershipCache</span><span> </span><span>=</span><span> </span><span>async</span><span> (</span><span>organizationId</span><span>:</span><span> </span><span>string</span><span>, </span><span>userId</span><span>:</span><span> </span><span>string</span><span>)</span><span>:</span><span> </span><span>Promise</span><span>&lt;</span><span>void</span><span>&gt; </span><span>=&gt;</span><span> {</span></span></p><p><span><span>  </span><span>const</span><span> </span><span>baseUrl</span><span> </span><span>=</span><span> </span><span>getResolvedApiBaseUrl</span><span>();</span></span></p><p><span><span>  </span><span>await</span><span> </span><span>fetch</span><span>(</span><span>`${</span><span>baseUrl</span><span>}/organization/invalidate-member`</span><span>, {</span></span></p><p><span><span>    method: </span><span>'POST'</span><span>,</span></span></p><p><span><span>    headers: { </span><span>...await</span><span> </span><span>getFirebaseAuthHeader</span><span>() },</span></span></p><p><span><span>    body: </span><span>JSON</span><span>.</span><span>stringify</span><span>({ organizationId, userId }),</span></span></p><p><span><span>  });</span></span></p><p><span><span>};</span></span></p>
```

### Organization Context Provider

The `OrganizationProvider` implements a dual-layer hydration strategy:

1.  Auth Hydration: If `AuthContext` provides `initialData` (consolidated fetch), the org state is set immediately [frontend/src/contexts/OrganizationContext.tsx#94-112](../../frontend/src/contexts/OrganizationContext.tsx)
2.  Background Refresh: The provider then fetches fresh data from Firestore to ensure the UI is eventually consistent with the server [frontend/src/contexts/OrganizationContext.tsx#124-154](../../frontend/src/contexts/OrganizationContext.tsx)

### Frontend Cache Scoping

Several pages maintain `localStorage` caches that were originally global — switching between personal and org mode would load stale cached data from the wrong context. Each affected page now scopes its cache keys with a `::org:{orgId}` suffix when `currentOrganization` is set:

- **VideosPage** — `videos_page_cache` / `videos_page_last_session` → `::org:{orgId}` suffix
- **PlaylistPage** — `playlist_page_cache` / `playlist_page_last_session` → `::org:{orgId}` suffix
- **ChannelPage** — `channel_inspector_cache_{input}` / `channel_inspector_cache_last` → `::org:{orgId}` suffix
- **Compare** — `compare_cache` → `compare_cache::org:{orgId}` suffix

Additionally, **ChannelPage** and **Compare** include a `useEffect` on `[currentOrganization?.id]` that reloads data from the correct cache namespace immediately when the user switches contexts, rather than waiting for the next manual fetch. All five pages/components pass `currentOrganization?.id || null` as the 3rd argument to `YouTubeService` so the `X-Org-Id` header is sent to the backend.

Sources: [frontend/src/pages/VideosPage.tsx](../../frontend/src/pages/videos/VideosPage.tsx) [frontend/src/pages/PlaylistPage.tsx](../../frontend/src/pages/playlist/PlaylistPage.tsx) [frontend/src/pages/ChannelPage.tsx](../../frontend/src/pages/channel/ChannelPage.tsx) [frontend/src/components/Compare.tsx](../../frontend/src/components/Compare.tsx)