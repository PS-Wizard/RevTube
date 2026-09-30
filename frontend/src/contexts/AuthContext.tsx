/* eslint-disable react-refresh/only-export-components */
import { createContext, useCallback, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import {
  onAuthStateChanged,
  signOut,
  sendEmailVerification,
} from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth } from '../config/firebase';
import { saveMultipleYouTubeTokens, getUserTokens, refreshAccessToken, getUserInit, type YouTubeToken } from '../services/userService';
import { YouTubeOAuth } from '../services/youtubeOAuth';
import { devLog } from '../utils/devLog';
import type { Organization, OrganizationMember } from '../types/organization';

const PROFILE_CACHE_KEY = 'revtube:auth-profile:v1';
const PROFILE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const AUTH_HINT_KEY = 'revtube:auth-hint:v1';
const AUTH_HINT_TTL_MS = 24 * 60 * 60 * 1000;

type CachedProfile = {
  uid: string;
  role: string;
  userPackage: string;
  cachedAt: number;
};

type AuthHint = {
  uid: string;
  emailVerified: boolean;
  cachedAt: number;
};

const readAuthHint = (): AuthHint | null => {
  try {
    const raw = localStorage.getItem(AUTH_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as AuthHint;
    if (!parsed?.uid) return null;
    if (Date.now() - parsed.cachedAt > AUTH_HINT_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeAuthHint = (uid: string, emailVerified: boolean) => {
  try {
    const payload: AuthHint = {
      uid,
      emailVerified,
      cachedAt: Date.now(),
    };
    localStorage.setItem(AUTH_HINT_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

const clearAuthHint = () => {
  try {
    localStorage.removeItem(AUTH_HINT_KEY);
  } catch {
    // ignore storage failures
  }
};

const readCachedProfile = (uid: string): CachedProfile | null => {
  try {
    const raw = localStorage.getItem(PROFILE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedProfile;
    if (!parsed || parsed.uid !== uid) return null;
    if (Date.now() - parsed.cachedAt > PROFILE_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCachedProfile = (uid: string, role: string, userPackage: string) => {
  try {
    const payload: CachedProfile = {
      uid,
      role,
      userPackage,
      cachedAt: Date.now(),
    };
    localStorage.setItem(PROFILE_CACHE_KEY, JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

const clearCachedProfile = () => {
  try {
    localStorage.removeItem(PROFILE_CACHE_KEY);
  } catch {
    // ignore storage failures
  }
};

// Load and parse allowed domains from environment variables
// Using both VITE_ and non-VITE for fallback, though non-VITE is usually hidden on client

export interface AuthContextType {
  isAuthenticated: boolean;
  isCheckingAuth: boolean;
  isLoadingTokens: boolean;
  /** True while a redirect-based (mobile PWA) OAuth result is being completed on load. */
  isResumingOAuth: boolean;
  isEmailVerified: boolean;
  authError: string | null;
  user: User | null;
  role: string | null;
  userPackage: string | null;
  accessToken: string | null;
  allTokens: YouTubeToken[];
  setAccessToken: (token: string | null) => void;
  setAuthError: (error: string | null) => void;
  handleSignOut: () => Promise<void>;
  loginWithYouTube: () => Promise<YouTubeToken[] | null>;
  getValidToken: (channelId: string) => Promise<string | null>;
  resendVerificationEmail: () => Promise<void>;
  refreshUserProfile: () => Promise<void>;
  initialData?: {
    organizations: Organization[];
    memberships: Record<string, OrganizationMember>;
  };
}

export const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const bootstrapUser = auth.currentUser;
  const bootstrapHint = !bootstrapUser ? readAuthHint() : null;
  const bootstrapUid = bootstrapUser?.uid || bootstrapHint?.uid;
  const bootstrapProfile = bootstrapUid ? readCachedProfile(bootstrapUid) : null;
  const optimisticAuthenticated = !bootstrapUser && !!bootstrapHint;

  const [isAuthenticated, setIsAuthenticated] = useState<boolean>(!!bootstrapUser || optimisticAuthenticated);
  const [isEmailVerified, setIsEmailVerified] = useState<boolean>(!!bootstrapUser?.emailVerified || !!bootstrapHint?.emailVerified);
  const [isCheckingAuth, setIsCheckingAuth] = useState<boolean>(!bootstrapUser && !optimisticAuthenticated);
  const [authError, setAuthError] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(bootstrapUser);
  const [role, setRole] = useState<string | null>(bootstrapProfile?.role ?? ((bootstrapUser || optimisticAuthenticated) ? 'user' : null));
  const [userPackage, setUserPackage] = useState<string | null>(bootstrapProfile?.userPackage ?? ((bootstrapUser || optimisticAuthenticated) ? 'free' : null));
  const [accessToken, setAccessTokenState] = useState<string | null>(null);
  const [allTokens, setAllTokens] = useState<YouTubeToken[]>([]);
  const [isLoadingTokens, setIsLoadingTokens] = useState<boolean>(true);
  const [isResumingOAuth, setIsResumingOAuth] = useState<boolean>(false);
  const refreshTimerRef = useRef<number | null>(null);
  /** Timestamp of the last successful getUserInit -- prevents pile-up on rapid tab focus. */
  const lastSyncedAtRef = useRef<number>(0);
  const SYNC_DEBOUNCE_MS = 60_000; // re-sync at most once per minute on tab focus

  const setAccessToken = useCallback((token: string | null) => {
    setAccessTokenState(token);
  }, []);

  const [initialData, setInitialData] = useState<{
    organizations: Organization[];
    memberships: Record<string, OrganizationMember>;
  } | undefined>(undefined);

  const syncUserProfile = async (firebaseUser: User) => {
    try {
      const initData = await getUserInit({
        uid: firebaseUser.uid,
        email: firebaseUser.email || '',
        displayName: firebaseUser.displayName,
        photoURL: firebaseUser.photoURL
      });

      if (initData) {
        const { user: userData, tokens, organizations, memberships } = initData;
        // Hardcode support email as admin (matches backend auth.js pattern)
        const effectiveRole = firebaseUser.email === 'support@revketer.ai' ? 'admin' : (userData.role || 'user');
        setRole(effectiveRole);
        setUserPackage(userData.package || 'free');
        writeCachedProfile(firebaseUser.uid, effectiveRole, userData.package || 'free');
        
        // Store consolidated tokens
        setAllTokens(tokens || []);
        setIsLoadingTokens(false);

        // Store initial organization data for the Org provider to pick up
        setInitialData({ organizations, memberships });
        lastSyncedAtRef.current = Date.now();

        // Auto-select first token if none is selected
        if (tokens && tokens.length > 0 && !accessToken) {
          const token = tokens[0];
          if (token.expiresAt && Date.now() < token.expiresAt - 60000) {
            setAccessToken(token.accessToken);
          } else {
            // Need refresh - will be handled by the other useEffect or we can trigger it here
          }
        }
      } else {
        console.error('Failed to sync user profile with backend');
      }
    } catch (error) {
      console.error('Error syncing user profile:', error);
    }
  };

  // Re-sync role/package from backend (call on tab focus or whenever stale data suspected)
  const refreshUserProfile = async () => {
    const firebaseUser = auth.currentUser;
    if (!firebaseUser) return;
    await syncUserProfile(firebaseUser);
  };

  // Re-sync when user returns to this tab so admin changes are picked up
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        // Skip if we synced recently -- prevents backend hammering on rapid tab switches
        if (Date.now() - lastSyncedAtRef.current < SYNC_DEBOUNCE_MS) return;
        refreshUserProfile();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);
    return () => document.removeEventListener('visibilitychange', handleVisibility);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      if (firebaseUser) {
        const cached = readCachedProfile(firebaseUser.uid);

        setIsAuthenticated(true);
        setUser(firebaseUser);
        setIsEmailVerified(firebaseUser.emailVerified);
        setAuthError(null);
        setRole(cached?.role || 'user');
        setUserPackage(cached?.userPackage || 'free');
        writeAuthHint(firebaseUser.uid, firebaseUser.emailVerified);
        setIsCheckingAuth(false);

        firebaseUser.reload().then(() => {
          const refreshedUser = auth.currentUser;
          if (refreshedUser) {
            setUser(refreshedUser);
            setIsEmailVerified(refreshedUser.emailVerified);
          }
        }).catch((error) => {
          console.error('Background auth reload failed:', error);
        });

        syncUserProfile(firebaseUser).catch(err => {
          console.error('Background user sync failed:', err);
        });
      } else {
        setIsAuthenticated(false);
        setUser(null);
        setRole(null);
        setUserPackage(null);
        setIsEmailVerified(false);
        clearCachedProfile();
        clearAuthHint();
        setIsLoadingTokens(false);
      }
      setIsCheckingAuth(false);
    });

    const authReady = (auth as { authStateReady?: () => Promise<void> }).authStateReady;
    if (typeof authReady === 'function') {
      void authReady.call(auth).then(() => {
        if (auth.currentUser || readAuthHint()) {
          setIsCheckingAuth(false);
        }
      });
    }

    return () => unsubscribe();
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load persistent tokens from Firestore (managed by user/init now)
  // This is kept as a fallback/manual refresh if needed, but suppressed on initial load
  useEffect(() => {
    const loadTokens = async () => {
      // Only load if user is authenticated AND auth check is complete AND we don't have tokens already (from init)
      if (user && !isCheckingAuth && allTokens.length === 0) {
        try {
          const tokens = await getUserTokens(user.uid);
          // ... rest of logic
          setAllTokens(tokens);
          // Auto-select first token if none is selected
          if (tokens.length > 0 && !accessToken) {
            // Check if token needs refresh
            const token = tokens[0];
            if (token.expiresAt && Date.now() >= token.expiresAt - 60000) {
              const newAccessToken = await refreshAccessToken(user.uid, token.channelId!, token.refreshToken);
              if (newAccessToken) {
                setAccessToken(newAccessToken);
                // Reload tokens to get updated expiresAt
                const updatedTokens = await getUserTokens(user.uid);
                setAllTokens(updatedTokens);
              } else {
                console.error('❌ Failed to refresh token, user needs to re-authorize');
                setAuthError('Your YouTube authorization has expired. Please reconnect.');
              }
            } else {
              setAccessToken(token.accessToken);
            }
          }
        } catch (error) {
          console.error('Error loading tokens:', error);
        } finally {
          setIsLoadingTokens(false);
        }
      } else if (!isCheckingAuth) {
        // Set to false immediately if no user (don't block UI)
        setIsLoadingTokens(false);
      }
    };
    
    // Don't block - load tokens in background
    loadTokens();
  }, [user, isCheckingAuth, accessToken, allTokens.length, setAccessToken]);
  // Auto-refresh token before expiry
  useEffect(() => {
    if (!user || !accessToken || allTokens.length === 0) {
      return;
    }

    // Find the current token
    const currentToken = allTokens.find(t => t.accessToken === accessToken);
    if (!currentToken || !currentToken.expiresAt) {
      return;
    }

    // Clear any existing timer
    if (refreshTimerRef.current) {
      window.clearTimeout(refreshTimerRef.current);
    }

    // Calculate time until refresh (5 minutes before expiry)
    const timeUntilRefresh = currentToken.expiresAt - Date.now() - (5 * 60 * 1000);
    
    if (timeUntilRefresh > 0) {
      refreshTimerRef.current = window.setTimeout(async () => {
        const newAccessToken = await refreshAccessToken(user.uid, currentToken.channelId!, currentToken.refreshToken);
        if (newAccessToken) {
          setAccessToken(newAccessToken);
          // Reload tokens to get updated expiresAt
          const updatedTokens = await getUserTokens(user.uid);
          setAllTokens(updatedTokens);
        } else {
          console.error('❌ Auto-refresh failed, user needs to re-authorize');
          setAuthError('Your YouTube authorization has expired. Please reconnect.');
        }
      }, timeUntilRefresh);
    } else {
      // Token already expired or expiring very soon, refresh immediately
      refreshAccessToken(user.uid, currentToken.channelId!, currentToken.refreshToken).then(newAccessToken => {
        if (newAccessToken) {
          setAccessToken(newAccessToken);
          getUserTokens(user.uid).then(updatedTokens => setAllTokens(updatedTokens));
        } else {
          setAuthError('Your YouTube authorization has expired. Please reconnect.');
        }
      });
    }

    // Cleanup on unmount
    return () => {
      if (refreshTimerRef.current) {
        window.clearTimeout(refreshTimerRef.current);
      }
    };
  }, [user, accessToken, allTokens, setAccessToken]);

  const handleSignOut = async () => {
    try {
      await signOut(auth);
      setIsAuthenticated(false);
      setUser(null);
      setAccessToken(null);
      setAuthError(null);
      clearCachedProfile();
      clearAuthHint();
    } catch (err) {
      console.error('Sign out error:', err);
      setAuthError('Failed to sign out');
    }
  };

  /**
   * Save tokens from a successful OAuth result (shared by the popup flow and
   * the PWA resume-on-load path so both behave identically).
   */
  const applyOAuthResult = useCallback(async (result: NonNullable<Awaited<ReturnType<YouTubeOAuth['authorize']>>>): Promise<YouTubeToken[] | null> => {
    if (!user) {
      setAuthError('Please sign in first');
      return null;
    }

    if (result.channels.length === 0) {
      console.error('❌ No channels found for this account');
      setAuthError('Your Google account doesn\'t have a YouTube channel. Create a YouTube channel first, or sign in with a Google account that has one.');
      return null;
    }

    const { accessToken, refreshToken, expiresIn, email, channels } = result;

    // Calculate expiration timestamp
    const expiresAt = Date.now() + (expiresIn * 1000);

    // Build token objects for all channels (usually just 1)
    const newTokens: YouTubeToken[] = channels.map(channel => ({
      accessToken,
      refreshToken,
      expiresAt,
      email,
      channelId: channel.id,
      channelTitle: channel.title,
      thumbnailUrl: channel.thumbnailUrl,
      authorizedAt: new Date().toISOString()
    }));

    // Save all tokens atomically
    try {
      await saveMultipleYouTubeTokens(user.uid, newTokens);
    } catch (saveError) {
      console.error('❌ Failed to save tokens to Firestore:', saveError);
      setAuthError('Failed to save channel connection. Check console for details.');
      return null;
    }

    // Set the access token to the one we just got
    setAccessToken(accessToken);

    // Use the tokens we just built instead of re-fetching from Firestore.
    // Firestore collection queries (getDocs) are eventually consistent --
    // the newly written token document may not be visible yet, causing
    // setAllTokens to receive an empty array and leave the dashboard in
    // a "Connect Your YouTube Channel" state forever.
    // We already have all the data in newTokens, so use it directly.
    // Merge (not replace): a replace drops previously connected channels from
    // the dashboard until the next full reload re-reads Firestore.
    setAllTokens((prev) => {
      const merged = [...prev];
      for (const t of newTokens) {
        const idx = merged.findIndex((p) => p.channelId && p.channelId === t.channelId);
        if (idx >= 0) merged[idx] = t;
        else merged.push(t);
      }
      return merged;
    });

    setAuthError(null);
    return newTokens;
  }, [user, setAccessToken]);

  // PWA resume: if the OAuth callback page couldn't hand the code back (the
  // popup handoff is lost when the standalone app window navigates to the
  // callback), it redirects back to "/" and the stored result is consumed
  // here on startup.
  const applyOAuthResultRef = useRef(applyOAuthResult);
  // Keep the ref pointing at the latest applyOAuthResult -- ref writes are
  // only allowed in effects, never during render (same pattern as RtECharts).
  useEffect(() => {
    applyOAuthResultRef.current = applyOAuthResult;
  }, [applyOAuthResult]);
  useEffect(() => {
    if (!user) return;
    void (async () => {
      setIsResumingOAuth(true);
      try {
        const oauth = new YouTubeOAuth();
        const pending = await oauth.consumePendingAuthorization();
        if (pending) {
          console.log('Resumed pending YouTube OAuth from storage');
          await applyOAuthResultRef.current(pending);
        } else if (oauth.lastError) {
          // A redirect-based flow returned but completion failed (e.g. token
          // exchange rejected) — surface the reason instead of failing silently.
          setAuthError(oauth.lastError);
        }
      } catch (err) {
        console.error('Failed to resume pending OAuth:', err);
      } finally {
        setIsResumingOAuth(false);
      }
    })();
  }, [user, user?.uid]);

  const loginWithYouTube = async (): Promise<YouTubeToken[] | null> => {
    if (!user) {
      setAuthError('Please sign in first');
      return null;
    }

    try {
      const oauth = new YouTubeOAuth();
      const result = await oauth.authorize();
      
      if (!result) {
        console.error('❌ OAuth returned null - authorization failed or was cancelled');
        setAuthError(oauth.lastError || 'YouTube authorization failed. Please try again.');
        return null;
      }
      
      return await applyOAuthResult(result);
    } catch (err) {
      console.error('❌ YouTube login error:', err);
      setAuthError('Failed to authorize YouTube access.');
      return null;
    }
  };

  // Per-channel in-flight refresh promise -- prevents concurrent callers from
  // each firing their own refresh when the token expires ("thundering herd").
  const refreshPromiseRef = useRef<Map<string, Promise<string | null>>>(new Map());

  const getValidToken = async (channelId: string): Promise<string | null> => {
    if (!user) return null;

    const tokenData = allTokens.find(t => t.channelId === channelId);

    if (!tokenData) {
      if (channelId === 'MINE') return accessToken;
      return null;
    }

    // Token is still valid -- return immediately
    const isExpired = !tokenData.expiresAt || Date.now() >= (tokenData.expiresAt - 5 * 60 * 1000);
    if (!isExpired) {
      return tokenData.accessToken;
    }

    // If a refresh is already in-flight for this channel, wait on it instead of
    // firing another request -- this deduplications concurrent callers.
    const existing = refreshPromiseRef.current.get(channelId);
    if (existing) {
      devLog(`[getValidToken] Reusing in-flight refresh for ${channelId}`);
      return existing;
    }

    // Start the refresh and register it so other callers can share it
    devLog(`[getValidToken] Token for ${channelId} expired, refreshing...`);
    const refreshPromise = (async () => {
      try {
        const newAccessToken = await refreshAccessToken(user.uid, channelId, tokenData.refreshToken);
        if (newAccessToken) {
          const updatedTokens = await getUserTokens(user.uid);
          setAllTokens(updatedTokens);
          if (accessToken === tokenData.accessToken) {
            setAccessToken(newAccessToken);
          }
          return newAccessToken;
        }
      } catch (err) {
        console.error(`[getValidToken] Refresh failed for ${channelId}:`, err);
      } finally {
        // Always clean up so the next expiry triggers a fresh refresh
        refreshPromiseRef.current.delete(channelId);
      }
      return null;
    })();

    refreshPromiseRef.current.set(channelId, refreshPromise);
    return refreshPromise;
  };


  const resendVerificationEmail = async () => {
    if (auth.currentUser) {
      try {
        const actionCodeSettings = {
          url: (import.meta.env.VITE_FRONTEND_URL || window.location.origin) + '/verify-email',
          handleCodeInApp: false,
        };
        await sendEmailVerification(auth.currentUser, actionCodeSettings);
      } catch (err) {
        console.error('Failed to send verification email:', err);
        throw err;
      }
    }
  };

  return (
    <AuthContext.Provider
      value={{
        isAuthenticated,
        isEmailVerified,
        isCheckingAuth,
        isLoadingTokens,
        isResumingOAuth,
        authError,
        user,
        role,
        userPackage,
        accessToken,
        allTokens,
        setAccessToken,
        setAuthError,
        handleSignOut,
        loginWithYouTube,
        getValidToken,
        resendVerificationEmail,
        refreshUserProfile,
        initialData,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};