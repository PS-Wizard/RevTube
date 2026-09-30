// Direct Google OAuth2 for YouTube with Authorization Code Flow (supports refresh tokens)
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';

export class YouTubeOAuth {
    private clientId: string;
    private redirectUri: string;
    private scopes: string[];
    /** Human-readable reason for the most recent failure; null when idle/success. */
    public lastError: string | null = null;

    constructor() {
        this.clientId = import.meta.env.VITE_GOOGLE_CLIENT_ID || '';
        // IMPORTANT: redirectUri must be same-origin as the app window that opened
        // the popup. localStorage + postMessage handoff only works when both pages
        // share the exact origin (same scheme/host/port). A baked-in override
        // (e.g. :5173 while serving from :8081) silently breaks the handoff and
        // leaves oauth-callback.html stuck. Only set VITE_OAUTH_REDIRECT_URI when
        // it matches the origin you actually serve the app from.
        this.redirectUri = import.meta.env.VITE_OAUTH_REDIRECT_URI || `${window.location.origin}/oauth-callback.html`;
        if (!this.clientId) {
            console.error(
                '❌ VITE_GOOGLE_CLIENT_ID is missing. Set it in frontend/.env (local) ' +
                'or rebuild the frontend container with the build arg, then retry YouTube connect.'
            );
        }
        console.log('[YouTubeOAuth] redirectUri:', this.redirectUri);
        this.scopes = [
            'https://www.googleapis.com/auth/yt-analytics.readonly',
            'https://www.googleapis.com/auth/youtube.readonly',
            'https://www.googleapis.com/auth/userinfo.email'
        ];
    }

    // ── Per-flow CSRF binding (state) + PKCE (S256) ──────────────────────────
    // `state` ties Google's redirect back to THIS browser-initiated attempt: an
    // attacker who obtains an authorization code for their own Google account
    // cannot inject it into a victim's connect flow (login-CSRF / code
    // substitution — the code would otherwise bind the ATTACKER's YouTube
    // channel to the VICTIM's account). PKCE additionally makes an intercepted
    // code worthless without the per-flow verifier held by this origin.
    private static readonly FLOW_KEY = 'yt_oauth_flow';

    private static randomToken(bytes = 32): string {
        const buf = new Uint8Array(bytes);
        crypto.getRandomValues(buf);
        let bin = '';
        for (const b of buf) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /** S256 PKCE challenge; null when crypto.subtle is unavailable (plain-HTTP LAN). */
    private static async s256Challenge(verifier: string): Promise<string | null> {
        if (!window.isSecureContext || !crypto.subtle) return null;
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        let bin = '';
        for (const b of new Uint8Array(digest)) bin += String.fromCharCode(b);
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    /** Persist the in-flight flow so oauth-callback.html (same origin, other tab) can validate `state`. */
    private async beginFlow(): Promise<{ state: string; verifier: string; challenge: string | null; createdAt: number; returnUrl: string }> {
        const verifier = YouTubeOAuth.randomToken(48);
        const flow = {
            state: YouTubeOAuth.randomToken(),
            verifier,
            challenge: await YouTubeOAuth.s256Challenge(verifier),
            createdAt: Date.now(),
            // Where the full-page redirect flow should land back after
            // oauth-callback.html persists the result (popup flows ignore this).
            returnUrl: window.location.pathname + window.location.search,
        };
        try { localStorage.setItem(YouTubeOAuth.FLOW_KEY, JSON.stringify(flow)); } catch { /* ignore */ }
        return flow;
    }

    private readFlow(): { state: string; verifier: string; challenge?: string; createdAt: number } | null {
        try {
            const raw = localStorage.getItem(YouTubeOAuth.FLOW_KEY);
            if (!raw) return null;
            const flow = JSON.parse(raw) as { state?: string; verifier?: string; challenge?: string; createdAt?: number };
            if (!flow || typeof flow.state !== 'string' || typeof flow.verifier !== 'string') return null;
            return { state: flow.state, verifier: flow.verifier, challenge: flow.challenge, createdAt: flow.createdAt ?? 0 };
        } catch {
            return null;
        }
    }

    /** Consume the flow binding + any pending result so neither can be replayed. */
    private endFlow(): void {
        try { localStorage.removeItem(YouTubeOAuth.FLOW_KEY); } catch { /* ignore */ }
        try { localStorage.removeItem('yt_oauth_result'); } catch { /* ignore */ }
    }

    /** True when running inside the installed PWA (Android standalone / iOS standalone). */
    static isStandalonePwa(): boolean {
        try {
            if (window.matchMedia('(display-mode: standalone)').matches) return true;
        } catch { /* ignore */ }
        try {
            if ((window.navigator as Navigator & { standalone?: boolean }).standalone === true) return true;
        } catch { /* ignore */ }
        return false;
    }

    /**
     * Full-page redirect fallback for environments where the popup handoff cannot
     * work (installed mobile PWA, popup blocked). Navigates THIS window to Google;
     * oauth-callback.html persists the result and AuthContext resumes it on return
     * via consumePendingAuthorization(). Never resolves — the page unloads.
     */
    private redirectToGoogle(authUrl: string): Promise<null> {
        console.log('[YouTubeOAuth] Using full-page redirect (popup handoff unavailable)');
        window.location.assign(authUrl);
        return new Promise<null>(() => { /* page unloads; resume happens on return */ });
    }

    /**
     * Opens Google OAuth popup and returns tokens + user email + ALL channels with thumbnails
     */
    async authorize(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; email: string; channels: Array<{ id: string; title: string; thumbnailUrl?: string }> } | null> {
        // Per-flow CSRF state + PKCE verifier, bound to this browser's tabs
        const flow = await this.beginFlow();
        const authUrl = this.buildAuthUrl(flow);
        this.lastError = null;

        // Installed PWA: window.open handoff (postMessage/localStorage back to this
        // context) is unreliable — iOS partitions PWA storage from the browser and
        // the OS may suspend the PWA behind Google consent. Redirect instead.
        if (YouTubeOAuth.isStandalonePwa()) {
            return this.redirectToGoogle(authUrl);
        }

        return new Promise((resolve) => {
            const width = 500;
            const height = 600;
            const left = window.screen.width / 2 - width / 2;
            const top = window.screen.height / 2 - height / 2;

            let popup: Window | null = null;
            try {
                popup = window.open(
                    authUrl,
                    'GoogleOAuth',
                    `width=${width},height=${height},left=${left},top=${top}`
                );
            } catch {
                popup = null;
            }

            if (!popup || popup.closed) {
                // Popup blocked or immediately dead (mobile WebView/PWA edge cases):
                // redirect this window so the flow can still complete via resume.
                // The outer promise intentionally stays pending — the page unloads.
                console.warn('[YouTubeOAuth] Popup unavailable — falling back to redirect');
                this.redirectToGoogle(authUrl);
                return;
            }

            // Flag to prevent race condition between postMessage and localStorage
            let isResolved = false;
            const LS_KEY = 'yt_oauth_result';
            let bcRef: BroadcastChannel | null = null;
            let checkClosed: ReturnType<typeof setInterval> | undefined = undefined;
            let localStoragePoll: ReturnType<typeof setInterval> | undefined = undefined;

            /**
             * Process the authorization code: exchange for tokens, fetch email + channels.
             * Shared by both the postMessage listener and the localStorage polling path
             * so whichever arrives first handles the code and the other is a no-op.
             */
            const handleCode = async (code: string, verifier?: string) => {
                if (isResolved) return;
                isResolved = true;

                cleanup();
                popup.close();

                try {
                    // Exchange code for tokens via backend (PKCE verifier when generated)
                    const tokens = await this.exchangeCodeForTokens(code, verifier || flow.verifier);
                    if (!tokens) {
                        console.error('Failed to exchange code for tokens — check the backend /oauth/exchange response in the network tab (common causes: redirect_uri_mismatch, missing YOUTUBE_CLIENT_ID/SECRET in backend env, not signed in).');
                        resolve(null);
                        return;
                    }

                    const { accessToken, refreshToken, expiresIn } = tokens;

                    // Get user email from the token
                    const email = await this.getUserEmail(accessToken);

                    // Get ALL channels accessible by this token.
                    // Returns null when the fetch itself failed (transient) — that
                    // must NOT be reported as "account has no channel".
                    const channels = await this.getAllChannels(accessToken, email || '');
                    if (!channels) {
                        console.error('Failed to load channels after consent — transient fetch failure, not an empty account.');
                        resolve(null);
                        return;
                    }

                    resolve({
                        accessToken,
                        refreshToken,
                        expiresIn,
                        email: email || '',
                        channels
                    });
                } catch (err) {
                    // Never let an unexpected failure (network drop, Firebase session
                    // expired, etc.) leave the promise unresolved — the UI would stay
                    // on "Connecting channel…" forever with no feedback.
                    console.error('❌ Unexpected error completing OAuth code exchange:', err);
                    resolve(null);
                }
            };

            const handleError = (errorMsg: string) => {
                if (isResolved) return;
                isResolved = true;

                cleanup();
                popup.close();
                console.error('❌ OAuth error:', errorMsg);
                resolve(null);
            };

            const cleanup = () => {
                if (checkClosed) clearInterval(checkClosed);
                if (localStoragePoll) clearInterval(localStoragePoll);
                window.removeEventListener('message', handleMessage);
                window.removeEventListener('storage', handleStorageEvent);
                try { bcRef?.close(); } catch { /* ignore */ }
                // Clean the localStorage key so a subsequent attempt doesn't pick up stale data
                try { localStorage.removeItem('yt_oauth_result'); } catch { /* ignore */ }
                // Consume the flow binding (state + PKCE verifier) so it can't be replayed
                try { localStorage.removeItem(YouTubeOAuth.FLOW_KEY); } catch { /* ignore */ }
            };

            // ── Path 1: postMessage (fast path, works on local dev) ──
            const handleMessage = async (event: MessageEvent) => {
                if (event.origin !== window.location.origin) {
                    return;
                }

                // CSRF binding: reject payloads that don't belong to this flow
                if (event.data.state !== flow.state) {
                    console.error('❌ OAuth state mismatch via postMessage — ignoring (stale or forged result).');
                    return;
                }
                if (event.data.type === 'YOUTUBE_OAUTH_SUCCESS') {
                    const { code } = event.data;
                    if (!code) return;
                    await handleCode(code, flow.verifier);
                } else if (event.data.type === 'YOUTUBE_OAUTH_ERROR') {
                    handleError(event.data.error || 'Unknown error');
                }
            };

            window.addEventListener('message', handleMessage);

            // ── Path 1b: BroadcastChannel + storage event (instant cross-tab) ──
            // oauth-callback.html broadcasts on the `yt_oauth` channel and writes
            // the same payload to localStorage. Listening to both closes the race
            // where polling hadn't ticked yet when the popup closed itself.
            const handlePayload = (data: { type?: string; code?: string; error?: string; state?: string }) => {
                if (!data || !data.type) return;
                // CSRF binding: reject results that don't belong to this flow
                if (data.state !== flow.state) {
                    console.error('❌ OAuth state mismatch — ignoring (stale or forged result).');
                    return;
                }
                if (data.type === 'YOUTUBE_OAUTH_SUCCESS' && data.code) {
                    void handleCode(data.code, flow.verifier);
                } else if (data.type === 'YOUTUBE_OAUTH_ERROR') {
                    handleError(data.error || 'OAuth error');
                }
            };
            const handleStorageEvent = (event: StorageEvent) => {
                if (event.key !== LS_KEY || !event.newValue) return;
                try {
                    handlePayload(JSON.parse(event.newValue));
                } catch { /* ignore */ }
            };
            window.addEventListener('storage', handleStorageEvent);
            try {
                bcRef = new BroadcastChannel('yt_oauth');
                bcRef.onmessage = (event: MessageEvent) => handlePayload(event.data);
            } catch { bcRef = null; }

            // ── Path 2: localStorage polling (fallback for beta / COOP environments) ──
            // On beta, Cross-Origin-Opener-Policy: same-origin makes window.opener === null
            // in the popup, so postMessage never fires. The callback writes to localStorage
            // instead, and we pick it up here.
            localStoragePoll = setInterval(() => {
                try {
                    const raw = localStorage.getItem(LS_KEY);
                    if (!raw) return;

                    const data = JSON.parse(raw);
                    if (!data || !data.type) return;

                    // Guard against stale entries from a prior attempt + CSRF binding
                    if (data.state !== flow.state) return;
                    if (!data.timestamp || Date.now() - data.timestamp > 10 * 60 * 1000) return;

                    if (data.type === 'YOUTUBE_OAUTH_SUCCESS' && data.code) {
                        void handleCode(data.code, flow.verifier);
                    } else if (data.type === 'YOUTUBE_OAUTH_ERROR') {
                        handleError(data.error || 'OAuth error');
                    }
                } catch {
                    // ignore parse / read errors
                }
            }, 300);

            // ── Path 3: popup closed without resolution (user cancelled / timed out) ──
            // NOTE: a COOP popup may report `closed === true` immediately on some
            // browsers even while Google auth is in progress, so only treat it as
            // cancelled after a 5-minute grace window.
            const popupOpenedAt = Date.now();
            const POPUP_GRACE_MS = 5 * 60 * 1000;
            checkClosed = setInterval(() => {
                // Before the grace window expires the user is still on Google's
                // consent screen — ignore `closed` (may be a COOP false-positive).
                if (popup.closed && Date.now() - popupOpenedAt > POPUP_GRACE_MS) {
                    if (isResolved) return;
                    isResolved = true;

                    cleanup();
                    resolve(null);
                }
            }, 1000);
        });
    }

    /**
     * Resume an interrupted OAuth flow (e.g. PWA standalone windows where the
     * popup handoff via postMessage/localStorage polling was lost because the
     * main app window was navigated away). Reads a fresh (< 5 min old) result
     * written by oauth-callback.html, consumes it, and — for a success code —
     * runs the same exchange → email → channels pipeline as authorize().
     * Returns null when there is nothing pending.
     */
    async consumePendingAuthorization(): Promise<{ accessToken: string; refreshToken: string; expiresIn: number; email: string; channels: Array<{ id: string; title: string; thumbnailUrl?: string }> } | null> {
        const LS_KEY = 'yt_oauth_result';
        let data: { type?: string; code?: string; error?: string; timestamp?: number; state?: string } | null = null;
        try {
            const raw = localStorage.getItem(LS_KEY);
            if (!raw) return null;
            data = JSON.parse(raw);
        } catch {
            try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }
            return null;
        }

        // Always consume the entry so it can't be replayed on later loads.
        try { localStorage.removeItem(LS_KEY); } catch { /* ignore */ }

        if (!data || !data.type || !data.timestamp) return null;
        // Guard against stale entries from a prior session/attempt.
        if (Date.now() - data.timestamp > 5 * 60 * 1000) return null;

        // CSRF binding: a stored result is only valid while a flow started by
        // THIS browser is pending, and only when the state matches it.
        const flow = this.readFlow();
        this.endFlow();
        if (!flow || !data.state || data.state !== flow.state) {
            console.error('❌ Resumed OAuth result has no matching pending flow (stale or forged) — ignoring.');
            return null;
        }

        if (data.type === 'YOUTUBE_OAUTH_ERROR') {
            console.error('❌ Resumed OAuth error:', data.error);
            return null;
        }
        if (data.type !== 'YOUTUBE_OAUTH_SUCCESS' || !data.code) return null;

        const tokens = await this.exchangeCodeForTokens(data.code, flow.verifier);
        if (!tokens) {
            console.error('❌ Failed to exchange resumed OAuth code for tokens');
            return null;
        }
        const email = await this.getUserEmail(tokens.accessToken);
        const channels = await this.getAllChannels(tokens.accessToken, email || '');
        if (!channels) {
            console.error('❌ Failed to load channels for resumed OAuth (transient fetch failure)');
            return null;
        }
        return { ...tokens, email: email || '', channels };
    }

    private async exchangeCodeForTokens(code: string, codeVerifier?: string): Promise<{ accessToken: string; refreshToken: string; expiresIn: number } | null> {
        try {
            const baseUrl = getResolvedApiBaseUrl();

            const response = await fetch(`${baseUrl}/oauth/exchange`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await getFirebaseAuthHeader())
                },
                body: JSON.stringify({
                    code,
                    redirectUri: this.redirectUri,
                    // PKCE — required by Google whenever the auth request carried a code_challenge
                    ...(codeVerifier ? { codeVerifier } : {})
                })
            });

            if (response.ok) {
                const data = await response.json();
                return {
                    accessToken: data.accessToken,
                    refreshToken: data.refreshToken,
                    expiresIn: data.expiresIn
                };
            } else {
                const errorText = await response.text();
                console.error('❌ Token exchange failed:', response.status, errorText);
                this.lastError = `YouTube connection was rejected by the server (HTTP ${response.status}): ${YouTubeOAuth.shortBackendMessage(errorText)}`;
            }
        } catch (err) {
            console.error('❌ Failed to exchange code for tokens:', err);
            this.lastError = 'Could not reach the server to complete the YouTube connection. Check your connection and try again.';
        }
        return null;
    }

    /** Extract `error.message` from a backend JSON error body, else a truncated raw string. */
    private static shortBackendMessage(errorText: string): string {
        try {
            const parsed = JSON.parse(errorText) as { error?: { message?: string } };
            if (parsed?.error?.message) return parsed.error.message;
        } catch { /* not JSON — fall through */ }
        return errorText.slice(0, 160) || 'unknown error';
    }

    /**
     * Fetch ALL channels for the fresh OAuth token via our backend proxy.
     *
     * Returns the channel list, an empty array when the account genuinely has no
     * channel, or null when the fetch itself failed (network/HTTP error). Callers
     * must treat null as "unknown — retry" and never as "no channel exists".
     *
     * Retries with backoff: right after consent YouTube can briefly return an
     * empty list (token/channel propagation), and mobile networks flake — a
     * single attempt would wrongly report "no channel exists".
     */
    private async getAllChannels(accessToken: string, _email: string): Promise<Array<{ id: string; title: string; thumbnailUrl?: string }> | null> {
      void _email; // reserved for future backend validation
        const baseUrl = getResolvedApiBaseUrl();
        const delaysMs = [0, 1200, 3000];
        let lastError: unknown = null;

        for (let attempt = 0; attempt < delaysMs.length; attempt++) {
            if (attempt > 0) {
                await new Promise((r) => setTimeout(r, delaysMs[attempt]));
            }
            const ctrl = new AbortController();
            const timeout = setTimeout(() => ctrl.abort(), 15000);
            try {
                const response = await fetch(`${baseUrl}/channels/mine?fresh=true`, {
                    headers: {
                        Authorization: `Bearer ${accessToken}`,
                        ...(await getFirebaseAuthHeader())
                    },
                    signal: ctrl.signal
                });

                if (response.ok) {
                    const data = await response.json();
                    if (data.items && data.items.length > 0) {
                        // Return ALL channels with thumbnails, not just the first one
                        return data.items.map((item: { id: string; snippet: { title: string; thumbnails?: { default?: { url?: string }; medium?: { url?: string }; high?: { url?: string } } } }) => ({
                            id: item.id,
                            title: item.snippet.title,
                            thumbnailUrl: item.snippet.thumbnails?.default?.url || item.snippet.thumbnails?.medium?.url || item.snippet.thumbnails?.high?.url
                        }));
                    }
                    // Empty but successful — may be propagation lag right after
                    // consent, so retry; only the final attempt returns [].
                    lastError = null;
                    if (attempt === delaysMs.length - 1) return [];
                    continue;
                }

                lastError = new Error(`channels/mine HTTP ${response.status}: ${await response.text()}`);
                // 4xx (auth/quota/scope) won't heal by waiting — stop retrying.
                if (response.status < 500 && response.status !== 429) break;
            } catch (err) {
                // Network failure / abort — retryable.
                lastError = err;
            } finally {
                clearTimeout(timeout);
            }
        }
        console.error('Failed to get channel details after retries:', lastError);
        this.lastError = 'Connected to Google, but the channel list could not be loaded. Please try again.';
        return null;
    }

    private buildAuthUrl(flow: { state: string; challenge?: string | null }): string {
        const params = new URLSearchParams({
            client_id: this.clientId,
            redirect_uri: this.redirectUri,
            response_type: 'code',  // Authorization code flow instead of implicit
            scope: this.scopes.join(' '),
            access_type: 'offline',  // Request refresh token
            prompt: 'select_account consent',  // Allow account selection AND ensure refresh token
            include_granted_scopes: 'true',
            state: flow.state  // CSRF binding — validated by oauth-callback.html and authorize()
        });
        if (flow.challenge) {
            // PKCE (S256) — a leaked/intercepted code is useless without the verifier
            params.set('code_challenge', flow.challenge);
            params.set('code_challenge_method', 'S256');
        }

        return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
    }

    private async getUserEmail(accessToken: string): Promise<string | null> {
        try {
            const response = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: {
                    Authorization: `Bearer ${accessToken}`
                }
            });

            if (response.ok) {
                const data = await response.json();
                return data.email;
            }
        } catch (err) {
            console.error('Failed to get user email:', err);
        }
        return null;
    }
}
