# Management & Admin Layout Guide

## 1. Applicable Screens
- **Admin Console** (`/admin/*` - `src/pages/AdminPage.tsx`)
- **Organization Settings & Members** (`/organization` - `src/pages/OrganizationPage.tsx`)
- **User Account Profile** (`/profile` - `src/pages/ProfilePage.tsx`)

---

## 2. Layout Objective
Management and administrative screens enable account configuration, billing package controls, member invitations, and scoring rules. Their structure ensures security, clarity, and ease of maintenance:
1. **Header Chrome**: Standard `.page-header.page-header--split` with clear title, description, and primary operational CTA (e.g. "Invite Member", "Refresh Users").
2. **Tab / Subnavigation Rail**: For multi-tab consoles (like Admin or Organization), uses underline tab rail (`.analytics-tabs`) or segmented button groups.
3. **Card Surfaces**: Information grouped into distinct card containers (`.rt-card` or `.org-card`).
4. **Data Tables & Ledger Views**: Uses `.table-report` with standardized headers, sortable columns, user avatars, and status badges.
5. **Confirmation Dialogs**: Any destructive operational action (e.g. Remove Member, Delete Channel, Reset Password) must use `<ConfirmModal />` or `<AppDialog />`.

---

## 3. Structural Wireframe

```
+---------------------------------------------------------------------------------------+
| Header: Admin Console                                              [Action: Refresh]  |
+---------------------------------------------------------------------------------------+
| Subnav: [ Users (Active) ] [ Features & Packages ] [ AI Chat ] [ System Settings ]    |
+---------------------------------------------------------------------------------------+
| Body Content:                                                                         |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | Search & Filter Bar: [ Search Users... ] [ Role Filter ] [ Package Filter ]   |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
|   +-------------------------------------------------------------------------------+   |
|   | .table-report (User Table: Avatar, Email, Role, Quota Usage, Actions)         |   |
|   +-------------------------------------------------------------------------------+   |
|                                                                                       |
+---------------------------------------------------------------------------------------+
```

---

## 4. Visual Standards for Management Screens

### Profile Two-Column Layout
For settings views like `/profile`, use the responsive two-column grid:
- **Left rail (Sticky on desktop)**: User avatar, display name, email, member since date, role badge.
- **Right content**: Account credentials, security actions, notification toggles, active sessions.
- **Breakpoint**: Stacks into single column below 1024px.
