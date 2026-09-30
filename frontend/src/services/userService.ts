import { db } from '../config/firebase';
import { doc, setDoc, collection, getDocs, deleteDoc, Timestamp } from 'firebase/firestore';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';
import { parseJsonFromText } from '../utils/readJsonResponse';
import { parseUserInitResponse } from '../utils/apiResponseSchemas';
import { syncOrgChannelTokens } from './organizationChannelService';

export interface YouTubeToken {
    accessToken: string;
    refreshToken: string;
    expiresAt: number;  // Timestamp when token expires
    email: string;
    channelId?: string;
    channelTitle?: string;
    thumbnailUrl?: string;
    authorizedAt: string;
}

/**
 * Save a YouTube token to a subcollection (like recents)
 * Each channel gets its own document
 */
export const saveYouTubeToken = async (uid: string, token: YouTubeToken) => {
    try {
        const channelId = token.channelId || `email_${token.email.replace(/[^a-zA-Z0-9]/g, '_')}`;
        const tokenRef = doc(db, 'users', uid, 'youtubeTokens', channelId);
        
        await setDoc(tokenRef, {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
            email: token.email,
            channelId: token.channelId,
            channelTitle: token.channelTitle,
            thumbnailUrl: token.thumbnailUrl,
            authorizedAt: token.authorizedAt,
            timestamp: Timestamp.now()
        });
        // Keep the shared org snapshot in sync so org members never refresh
        // with a stale refresh token (owner re-authorizations invalidate it).
        if (token.channelId && token.accessToken && token.refreshToken) {
            await syncOrgChannelTokens(token.channelId, {
                accessToken: token.accessToken,
                refreshToken: token.refreshToken,
                expiresAt: token.expiresAt,
            });
        }
    } catch (error) {
        console.error('❌ [saveYouTubeToken] Failed:', error);
        throw error;
    }
};

/**
 * Save multiple tokens at once
 */
export const saveMultipleYouTubeTokens = async (uid: string, newTokens: YouTubeToken[]) => {
    try {
        // Save each token as a separate document in subcollection
        await Promise.all(newTokens.map(token => saveYouTubeToken(uid, token)));
    } catch (error) {
        console.error('❌ [saveMultipleYouTubeTokens] Failed:', error);
        throw error;
    }
};

/**
 * Get all YouTube tokens from the subcollection
 */
export const getUserTokens = async (uid: string): Promise<YouTubeToken[]> => {
    try {
        const tokensRef = collection(db, 'users', uid, 'youtubeTokens');
        const snapshot = await getDocs(tokensRef);
        
        const tokens = snapshot.docs.map(docSnap => {
            const data = docSnap.data();
            return {
                accessToken: data.accessToken,
                refreshToken: data.refreshToken,
                expiresAt: data.expiresAt,
                email: data.email,
                channelId: data.channelId,
                channelTitle: data.channelTitle,
                thumbnailUrl: data.thumbnailUrl,
                authorizedAt: data.authorizedAt
            } as YouTubeToken;
        });
        
        return tokens;
    } catch (error) {
        console.error('❌ [getUserTokens] Failed:', error);
        return [];
    }
};

/**
 * Delete a YouTube token from the subcollection
 */
export const deleteYouTubeToken = async (uid: string, channelId: string) => {
    try {
        const tokenRef = doc(db, 'users', uid, 'youtubeTokens', channelId);
        await deleteDoc(tokenRef);
    } catch (error) {
        console.error('❌ [deleteYouTubeToken] Failed:', error);
        throw error;
    }
};

const personalRefreshInFlight = new Map<string, Promise<string | null>>();

/**
 * Refresh an expired access token using the refresh token
 */
export const refreshAccessToken = async (uid: string, channelId: string, refreshToken: string): Promise<string | null> => {
    const dedupeKey = `${uid}:${channelId}`;
    const existing = personalRefreshInFlight.get(dedupeKey);
    if (existing) return existing;

    const promise = (async (): Promise<string | null> => {
        try {
            const baseUrl = getResolvedApiBaseUrl();

            const response = await fetch(`${baseUrl}/oauth/refresh`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(await getFirebaseAuthHeader())
                },
                body: JSON.stringify({ refreshToken })
            });

            const body = await response.text();
            if (response.ok) {
                try {
                    const data = parseJsonFromText(body, response.status, 'refreshAccessToken') as {
                        accessToken?: string;
                        expiresIn?: number;
                    };
                    const newAccessToken = data.accessToken;
                    const expiresIn = data.expiresIn;
                    if (!newAccessToken || expiresIn == null) {
                        console.error('❌ [refreshAccessToken] Missing accessToken or expiresIn in response');
                        return null;
                    }
                    const expiresAt = Date.now() + expiresIn * 1000;

                    const tokenRef = doc(db, 'users', uid, 'youtubeTokens', channelId);
                    await setDoc(
                        tokenRef,
                        {
                            accessToken: newAccessToken,
                            expiresAt,
                            timestamp: Timestamp.now(),
                        },
                        { merge: true }
                    );

                    return newAccessToken;
                } catch (e) {
                    console.error('❌ [refreshAccessToken] Invalid response:', e);
                    return null;
                }
            } else {
                try {
                    const errorData = parseJsonFromText(body, response.status, 'refreshAccessToken') as {
                        error?: { code?: string; message?: string };
                    };
                    if (errorData.error?.code === 'REFRESH_TOKEN_EXPIRED') {
                        console.error('❌ [refreshAccessToken] Refresh token expired, need to re-authorize');
                        await deleteYouTubeToken(uid, channelId);
                    }
                    console.error('❌ [refreshAccessToken] Failed:', errorData);
                } catch (e) {
                    console.error('❌ [refreshAccessToken] Failed (non-JSON body):', e);
                }
            }
        } catch (error) {
            console.error('❌ [refreshAccessToken] Failed:', error);
        }

        return null;
    })();

    personalRefreshInFlight.set(dedupeKey, promise);
    try {
        return await promise;
    } finally {
        personalRefreshInFlight.delete(dedupeKey);
    }
};
/**
 * Get consolidated initialization data for the user
 * (Profile sync, organizations, tokens)
 */
export const getUserInit = async (userData: {
  uid: string;
  email: string;
  displayName: string | null;
  photoURL: string | null;
}) => {
  try {
    const baseUrl = getResolvedApiBaseUrl();

    const response = await fetch(`${baseUrl}/user/init`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeader())
      },
      body: JSON.stringify(userData)
    });

    const body = await response.text();
    try {
      if (response.ok) {
        const raw = parseJsonFromText(body, response.status, 'getUserInit');
        const parsed = parseUserInitResponse(raw);
        if (!parsed) return null;
        return {
          user: parsed.user as { role?: string; package?: string },
          tokens: parsed.tokens as YouTubeToken[],
          organizations: parsed.organizations,
          memberships: parsed.memberships,
        };
      }
      const errorData = parseJsonFromText(body, response.status, 'getUserInit');
      console.error('❌ [getUserInit] Failed:', errorData);
      return null;
    } catch (e) {
      console.error('❌ [getUserInit] Error:', e);
      return null;
    }
  } catch (error) {
    console.error('❌ [getUserInit] Error:', error);
    return null;
  }
};
