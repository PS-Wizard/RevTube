## Firebase Auth & YouTube OAuth Flow

Relevant source files

-   [frontend/public/oauth-callback.html](../../frontend/public/oauth-callback.html)
-   [frontend/src/components/OAuthCallback.tsx](../../frontend/src/components/OAuthCallback.tsx)
-   [frontend/src/components/SignIn.tsx](../../frontend/src/components/SignIn.tsx)
-   [frontend/src/components/VerificationRequired.tsx](../../frontend/src/components/VerificationRequired.tsx)
-   [frontend/src/contexts/AuthContext.tsx](../../frontend/src/contexts/AuthContext.tsx)
-   [frontend/src/pages/AcceptInvitePage.tsx](../../frontend/src/pages/auth/AcceptInvitePage.tsx)
-   [frontend/src/pages/ResetPasswordPage.tsx](../../frontend/src/pages/auth/ResetPasswordPage.tsx)
-   [frontend/src/pages/VerifyEmailPage.tsx](../../frontend/src/pages/auth/VerifyEmailPage.tsx)
-   [frontend/src/services/invitationService.ts](../../frontend/src/services/invitationService.ts)
-   [frontend/src/services/userService.ts](../../frontend/src/services/userService.ts)
-   [frontend/src/services/youtubeOAuth.ts](../../frontend/src/services/youtubeOAuth.ts)

This page documents the end-to-end authentication and authorization lifecycle within RevTube. The system utilizes Firebase Auth for primary identity management (email/password and Google Sign-In) and a custom YouTube OAuth 2.0 Authorization Code Flow to securely manage YouTube Data and Analytics API permissions.

## Authentication Lifecycle & Context

The `AuthProvider` serves as the root of the identity system, managing Firebase user state and synchronizing profile data with the backend.

### AuthContext & Profile Caching

To minimize "flash of unauthenticated state" and reduce redundant backend calls, the system employs a multi-layered caching strategy using `localStorage`.

-   Auth Hint: Stores `uid` and `emailVerified` status to allow the UI to optimistically render authenticated layouts while Firebase initializes [frontend/src/contexts/AuthContext.tsx#26-56](../../frontend/src/contexts/AuthContext.tsx)
-   Profile Cache: Caches the user's `role` (e.g., admin, user) and `userPackage` (e.g., free, pro) for 24 hours [frontend/src/contexts/AuthContext.tsx#14-24](../../frontend/src/contexts/AuthContext.tsx)
-   Initialization: On mount, the provider checks for a Firebase user. If found, it calls `getUserInit` to sync the local state with the backend PostgreSQL/Firestore records [frontend/src/contexts/AuthContext.tsx#158-196](../../frontend/src/contexts/AuthContext.tsx)

### Data Flow: Firebase Sign-In

The `SignIn` component handles various authentication modes including Google OAuth and Email/Password [frontend/src/components/SignIn.tsx#12-21](../../frontend/src/components/SignIn.tsx)

1.  Google Sign-In: Uses `signInWithPopup` with the Firebase `googleProvider` [frontend/src/components/SignIn.tsx#24-40](../../frontend/src/components/SignIn.tsx)
2.  Email/Password: Supports signup, signin, and password resets [frontend/src/components/SignIn.tsx#41-102](../../frontend/src/components/SignIn.tsx)
3.  Verification: If a user signs up via email, the system enforces email verification using `sendEmailVerification` and a dedicated `VerifyEmailPage` [frontend/src/pages/VerifyEmailPage.tsx#21-50](../../frontend/src/pages/auth/VerifyEmailPage.tsx)

Auth Flow Logic

Sources: [frontend/src/contexts/AuthContext.tsx](../../frontend/src/contexts/AuthContext.tsx) [frontend/src/components/SignIn.tsx](../../frontend/src/components/SignIn.tsx) [frontend/src/services/userService.ts](../../frontend/src/services/userService.ts)

___

## YouTube OAuth Flow

RevTube requires specific scopes (`yt-analytics.readonly`, `youtube.readonly`) that are handled separately from the primary Firebase login to ensure the application can obtain refresh tokens for background data ingestion.

### Authorization Code Exchange

The `YouTubeOAuth` class manages the popup-based flow [frontend/src/services/youtubeOAuth.ts#5-19](../../frontend/src/services/youtubeOAuth.ts)

1.  Popup Initiation: `authorize()` opens a Google OAuth window targeting `oauth-callback.html` [frontend/src/services/youtubeOAuth.ts#24-43](../../frontend/src/services/youtubeOAuth.ts)
2.  Callback Handling: The `oauth-callback.html` page extracts the `code` from the URL and sends it to the main window via `window.opener.postMessage` and writes it to `localStorage` as a COOP fallback [frontend/public/oauth-callback.html#90-111](../../frontend/public/oauth-callback.html)
3.  Backend Exchange: The frontend sends the `code` to the backend `/oauth/exchange` endpoint to receive an `accessToken` and `refreshToken` [frontend/src/services/youtubeOAuth.ts#133-164](../../frontend/src/services/youtubeOAuth.ts)
4.  Channel Fetch: The frontend calls `GET /api/channels/mine?fresh=true` to fetch the user's YouTube channels. The `?fresh=true` param bypasses the Redis cache so the user always sees their current channel list. Empty results (Google account with no YouTube channel) are **never cached** on the backend [frontend/src/services/youtubeOAuth.ts#196-220](../../frontend/src/services/youtubeOAuth.ts)
5.  Token Storage: Tokens are persisted in Firestore under the user's subcollection: `users/{uid}/youtubeTokens/{channelId}` [frontend/src/services/userService.ts#23-43](../../frontend/src/services/userService.ts)

### Token Structure

Tokens are stored with metadata to support multi-channel management.

| Field | Description |
| --- | --- |
| `accessToken` | Short-lived bearer token for API requests. |
| `refreshToken` | Long-lived token used to generate new access tokens. |
| `expiresAt` | MS timestamp indicating when the access token expires. |
| `channelId` | The unique YouTube Channel ID associated with the token. |

### Backend Token Refresh Error Handling

The `refreshGoogleToken` function in `backend/services/tokenService.js` now has enhanced error handling for OAuth token refresh failures:

1. **Full error body logging**: The `axios.post` to `oauth2.googleapis.com/token` is wrapped in a try/catch that logs the complete error response body (e.g. `{"error":"invalid_grant","error_description":"Bad request"}`) via `console.error`. Previously only the HTTP status code was logged, making it impossible to distinguish between transient network errors and permanent token revocations.

2. **Dead token cache clearing**: When the OAuth provider returns an error body (indicating the refresh token is expired, revoked, or invalid), the cached token entry is **immediately deleted from Redis** via `serverCache.delete(cacheKey)`. This prevents the cron job (and other automated processes) from retrying a dead token every cycle until TTL expiry (~55 minutes), eliminating wasted API quota and noise in error logs.

3. **Structured error propagation**: The thrown error includes both the HTTP status code and the response body as a single message (e.g. `"Token refresh failed (400): {\"error\":\"invalid_grant\"}"`), enabling callers to present specific error messages to users (e.g. "YouTube authorization expired, please reconnect your channel").

Sources: [backend/services/tokenService.js#24-50](../../backend/services/tokenService.js) [frontend/src/services/youtubeOAuth.ts](../../frontend/src/services/youtubeOAuth.ts) [frontend/src/services/userService.ts](../../frontend/src/services/userService.ts) [frontend/public/oauth-callback.html](../../frontend/public/oauth-callback.html)

___

## Token Management & Deduplication

To prevent expired tokens from breaking analytics requests, the system implements an automated refresh mechanism with in-flight deduplication.

### getValidToken Pattern

The `AuthContext` provides a `getValidToken(channelId)` method that ensures a usable token is always available [frontend/src/contexts/AuthContext.tsx#244-279](../../frontend/src/contexts/AuthContext.tsx)

1.  Check Expiry: If the current `accessToken` is within 1 minute of expiring (or already expired), it triggers a refresh [frontend/src/contexts/AuthContext.tsx#254-257](../../frontend/src/contexts/AuthContext.tsx)
2.  Deduplication: `refreshAccessToken` uses a `personalRefreshInFlight` Map to ensure that if multiple components request a refresh for the same channel simultaneously, only one network request is made [frontend/src/services/userService.ts#100-110](../../frontend/src/services/userService.ts)
3.  Update: The new token is saved back to Firestore and the local `allTokens` state is updated [frontend/src/services/userService.ts#138-147](../../frontend/src/services/userService.ts)

Token Refresh Entity Mapping

Sources: [frontend/src/contexts/AuthContext.tsx](../../frontend/src/contexts/AuthContext.tsx) [frontend/src/services/userService.ts](../../frontend/src/services/userService.ts)

___

## Invitations & Organization Access

Authentication extends to organizational membership through an invitation system.

1.  Invitation Generation: `inviteMember` creates a document in `organizations/{orgId}/invitations` with a secure 32-byte token [frontend/src/services/invitationService.ts#32-80](../../frontend/src/services/invitationService.ts)
2.  Acceptance Flow: The `AcceptInvitePage` handles the transition. It requires the user to be authenticated via Firebase first [frontend/src/pages/AcceptInvitePage.tsx#210-215](../../frontend/src/pages/auth/AcceptInvitePage.tsx)
3.  Validation: The system verifies the invitation hasn't expired and that the authenticated user's email matches the invitee's email [frontend/src/pages/AcceptInvitePage.tsx#150-155](../../frontend/src/pages/auth/AcceptInvitePage.tsx)
4.  Role Granting: Upon acceptance, the user is added to the `members` subcollection of the organization [frontend/src/services/invitationService.ts#241-270](../../frontend/src/services/invitationService.ts)

Sources: [frontend/src/services/invitationService.ts](../../frontend/src/services/invitationService.ts) [frontend/src/pages/AcceptInvitePage.tsx](../../frontend/src/pages/auth/AcceptInvitePage.tsx)