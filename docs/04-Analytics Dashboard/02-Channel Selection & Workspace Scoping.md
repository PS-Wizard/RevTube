# Channel Selection & Workspace Scoping

This note documents how channel selection state is loaded, scoped, and cleaned when switching between personal and organization contexts. It also covers the recent fix that prevents token errors when a personal account has no channels yet.

## Scoped storage keys

- Personal context: `selectedChannel_personal_{uid}`
- Organization context: `selectedChannel_org_{orgId}`
- Global fallback: `selectedChannel_last`

When the user switches context (personal ↔ org), the selector clears scoped keys and invalidates workspace-scoped React Query caches so analytics queries do not bleed across contexts.

## Zero-channel personal onboarding

When a personal account has not connected any YouTube channel yet, dashboard analytics loaders and list flows used to call token resolution and surface “No access token available” or toast errors. The flow now short-circuits when:
- `isPersonalContext` is true
- `channels.length === 0`

This skips token lookups, React Query analytics fetches, and list creation token checks so the dashboard can render the empty/connect state cleanly.

## Implementation notes

- `useDashboardChannel.ts`: `getEffectiveToken()` returns early when `isPersonalContext` is true and no org fallback exists.
- `useDashboardAnalytics.ts`: `loadAllData`, dimension loads, full-list loads, and channel analytics runners bail out early when `personalEmpty` is true.
- Query hooks (`useAnalyticsQuery`, `useChannelAnalyticsQuery`, `useVideosQuery`, `usePlaylistsQuery`, `useDimensionsQuery`, `useDashboardFullListsData`) disable React Query fetches with `enabled = ... && !(isPersonalContext && channels.length === 0)`.
- `useDashboardLists.ts`: list creation short-circuits before token checks when the personal empty-state condition applies.

## Related files

- frontend/src/hooks/useDashboardChannel.ts
- frontend/src/hooks/useDashboardAnalytics.ts
- frontend/src/hooks/useDashboardLists.ts
- frontend/src/hooks/useDashboardFullListsData.ts
- frontend/src/hooks/queries/*Query.ts