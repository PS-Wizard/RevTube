# Feature Toggles

Control which features/pages are exposed in the UI without deploying code changes. Features can be toggled on/off per environment from the Admin panel.

## How It Works

Each page registered in `FeatureConfig` now has an `enabled: boolean` field. When `enabled` is `false`:

- **Sidebar**: The nav item is hidden from non-admin users
- **Direct access**: The `FeatureGuard` component renders a "This feature is currently disabled" message
- **Admins**: Always see everything — sidebar items remain visible and pages are accessible

The default for any new or missing config entry is `enabled: true`, so existing deployments see zero behavior change until an admin explicitly toggles something off.

## Configuration

### Default values (code)

Defined in `backend/config/featureConfig.js` — every page starts as `enabled: true`:

```js
dashboard: {
  label: "Channel Analytics",
  enabled: true,
  premiumOnly: false,
  freeLimit: 10,
  proLimit: 100,
},
```

### Firestore override

The merged config lives at `config/features` in Firestore. To disable a page, an admin uses the UI (Admin > Features > Enabled toggle) or writes directly:

```json
{
  "pages": {
    "chat": {
      "label": "AI Chat",
      "enabled": false,
      "premiumOnly": false,
      "freeLimit": 50,
      "proLimit": 500
    }
  }
}
```

When `enabled` is absent from Firestore, the Zod schema defaults it to `true` on the frontend and the backend's `mergeFeatureConfigPages` preserves the code default.

## Frontend Architecture

### Schema (`frontend/src/utils/featureConfigSchema.ts`)

```ts
export const pageConfigSchema = z.object({
  label: z.string(),
  enabled: z.boolean().default(true),   // <-- added
  premiumOnly: z.boolean(),
  freeLimit: z.number(),
  proLimit: z.number(),
});
```

### Context (`frontend/src/contexts/FeatureConfigContext.tsx`)

Exposes `isPageEnabled(pageKey: string): boolean` via the context value. Falls back to `true` for unknown page keys.

### FeatureGuard (`frontend/src/components/FeatureGuard.tsx`)

The guard runs an enabled check **before** the premium-only check:

1. Page disabled + not admin → show disabled message with `MdVisibilityOff` icon
2. Premium-only + not Pro + personal context → show upgrade prompt
3. Otherwise → render children

### Sidebar visibility (`frontend/src/components/Layout.tsx`)

A new `isNavItemVisible(pageKey)` helper gates each NavLink:

```ts
const isNavItemVisible = (pageKey: string): boolean => {
  if (role === "admin") return true;
  const pageCfg = config.pages[pageKey];
  if (!pageCfg) return true;
  return pageCfg.enabled !== false;
};
```

Applied to all 9 feature nav items in the sidebar. Admin-only nav items (Users, System, etc.) are unchanged.

## Admin UI

The **Features** tab (`/admin/features`) now has an **Enabled** column with a toggle as the second column of the table, so admins can quickly see and change feature visibility.

*(screenshot: admin feature-toggles table)*

## Data Flow

```
Admin toggles Enabled off
  → PUT /api/admin/config
    → Firestore config/features merged with defaults
    → Config version bumped (analytics caches invalidated)
    → FeatureConfig cache invalidated
  → Frontend polls GET /api/admin/config every 60s
    → FeatureConfigProvider re-renders with new config
      → isPageEnabled() returns false
        → FeatureGuard shows disabled message for direct visits
        → Layout sidebar hides the nav item (non-admin)
```

## Adding a New Feature

To add a toggle-able feature to the system:

1. Add the page entry to `DEFAULT_FEATURE_CONFIG` in `backend/config/featureConfig.js` with `enabled: true`
2. Add the page entry to `DEFAULT_CONFIG` in `frontend/src/contexts/FeatureConfigContext.tsx` with `enabled: true`
3. Add a `<FeatureGuard pageKey="yourKey">` wrapper in `App.tsx` routes
4. Add a `<NavLink>` in `Layout.tsx` wrapped with `isNavItemVisible("yourKey")`
5. The Admin Features table automatically picks up the new page on next config fetch

The `enabled` field is already in the Zod schema and Firestore merge logic — no additional schema changes needed.
