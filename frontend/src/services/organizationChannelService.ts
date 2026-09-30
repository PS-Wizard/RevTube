import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocs,
  query,
  where,
  collectionGroup,
  Timestamp
} from 'firebase/firestore';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';
import { devDebug } from '../utils/devLog';

export interface OrganizationChannel {
  id: string; // YouTube channel ID
  organizationId: string;
  channelTitle: string;
  thumbnailUrl?: string;
  addedBy: string; // User ID who added the channel
  addedAt: number;
  movedFromPersonal?: boolean;
  // Shared OAuth token -- lets all org members use this channel for analytics
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
}

/**
 * Add a channel to an organization
 */
export const addChannelToOrganization = async (
  orgId: string,
  channelId: string,
  channelTitle: string,
  thumbnailUrl: string | undefined,
  userId: string,
  movedFromPersonal: boolean = false,
  token?: { accessToken: string; refreshToken: string; expiresAt: number }
): Promise<void> => {
  try {
    const channelRef = doc(db, 'organizations', orgId, 'channels', channelId);
    const orgChannel: OrganizationChannel = {
      id: channelId,
      organizationId: orgId,
      channelTitle,
      thumbnailUrl,
      addedBy: userId,
      addedAt: Date.now(),
      movedFromPersonal,
      ...(token && {
        accessToken: token.accessToken,
        refreshToken: token.refreshToken,
        expiresAt: token.expiresAt,
      }),
    };

    await setDoc(channelRef, {
      ...orgChannel,
      updatedAt: Timestamp.now()
    });
  } catch (error) {
    console.error('Error adding channel to organization:', error);
    throw error;
  }
};

const orgRefreshInFlight = new Map<string, Promise<string | null>>();

/**
 * Refresh the shared access token stored on an org channel document.
 * Called when the current token is expired and a member needs a fresh one.
 * Must send Firebase auth -- `/oauth/refresh` is protected by `authenticateRequest` on the backend.
 */
export const refreshOrgChannelToken = async (
  orgId: string,
  channelId: string,
  refreshToken: string
): Promise<string | null> => {
  const dedupeKey = `${orgId}:${channelId}`;
  const existing = orgRefreshInFlight.get(dedupeKey);
  if (existing) return existing;

  const promise = (async (): Promise<string | null> => {
    try {
      const baseUrl = getResolvedApiBaseUrl();

      const response = await fetch(`${baseUrl}/oauth/refresh`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getFirebaseAuthHeader()),
        },
        body: JSON.stringify({ refreshToken }),
      });

      if (!response.ok) {
        console.error('[refreshOrgChannelToken] Refresh failed', response.status);
        // Mark the org channel doc so members see "owner must re-authorize"
        // instead of hitting this dead refresh token on every request.
        try {
          const errBody = await response.json().catch(() => null);
          if (errBody?.error?.code === 'REFRESH_TOKEN_EXPIRED') {
            await setDoc(
              doc(db, 'organizations', orgId, 'channels', channelId),
              { tokenNeedsReauth: true, updatedAt: Timestamp.now() },
              { merge: true }
            );
          }
        } catch { /* best-effort flag only */ }
        return null;
      }

      const data = await response.json();
      const newAccessToken: string = data.accessToken;
      const expiresIn = data.expiresIn as number;
      if (!newAccessToken || typeof expiresIn !== 'number') {
        console.error('[refreshOrgChannelToken] Invalid response shape');
        return null;
      }
      const expiresAt = Date.now() + expiresIn * 1000;

      await setDoc(
        doc(db, 'organizations', orgId, 'channels', channelId),
        { accessToken: newAccessToken, expiresAt, updatedAt: Timestamp.now() },
        { merge: true }
      );

      return newAccessToken;
    } catch (error) {
      console.error('[refreshOrgChannelToken] Error:', error);
      return null;
    } finally {
      orgRefreshInFlight.delete(dedupeKey);
    }
  })();

  orgRefreshInFlight.set(dedupeKey, promise);
  return promise;
};

/**
 * Get all channels for an organization
 */
export const getOrganizationChannels = async (
  orgId: string
): Promise<OrganizationChannel[]> => {
  try {
    const channelsSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'channels')
    );

    return channelsSnapshot.docs.map(doc => doc.data() as OrganizationChannel);
  } catch (error) {
    console.error('Error fetching organization channels:', error);
    return [];
  }
};

/**
 * Remove a channel from an organization
 */
export const removeChannelFromOrganization = async (
  orgId: string,
  channelId: string
): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'organizations', orgId, 'channels', channelId));
  } catch (error) {
    console.error('Error removing channel from organization:', error);
    throw error;
  }
};

/**
 * Check if a channel belongs to an organization
 */
export const isChannelInOrganization = async (
  orgId: string,
  channelId: string
): Promise<boolean> => {
  try {
    const channelsSnapshot = await getDocs(
      query(
        collection(db, 'organizations', orgId, 'channels'),
        where('id', '==', channelId)
      )
    );

    return !channelsSnapshot.empty;
  } catch (error) {
    console.error('Error checking channel in organization:', error);
    return false;
  }
};

/**
 * Get all organizations that have a specific channel
 */
export const getOrganizationsWithChannel = async (
  channelId: string
): Promise<string[]> => {
  try {
    // Collection-group query across all organizations' channels subcollections
    const snapshot = await getDocs(
      query(collectionGroup(db, 'channels'), where('id', '==', channelId))
    );
    return snapshot.docs.map(docSnap => docSnap.ref.parent.parent!.id);
  } catch (error) {
    console.error('Error getting organizations with channel:', error);
    return [];
  }
};

/**
 * Sync freshly authorized YouTube credentials onto every org channel document
 * that references the given channelId. Called when the owner's personal token
 * is saved so the shared org snapshot never goes stale (the root cause of
 * member-side REFRESH_TOKEN_EXPIRED errors).
 */
export const syncOrgChannelTokens = async (
  channelId: string,
  token: { accessToken: string; refreshToken: string; expiresAt: number }
): Promise<void> => {
  try {
    const orgIds = await getOrganizationsWithChannel(channelId);
    await Promise.all(
      orgIds.map(orgId =>
        setDoc(
          doc(db, 'organizations', orgId, 'channels', channelId),
          {
            accessToken: token.accessToken,
            refreshToken: token.refreshToken,
            expiresAt: token.expiresAt,
            updatedAt: Timestamp.now(),
          },
          { merge: true }
        )
      )
    );
    if (orgIds.length > 0) {
      devDebug('[syncOrgChannelTokens] Synced token to orgs:', orgIds);
    }
  } catch (error) {
    // Never block the owner's own authorization flow because of this side effect
    console.error('Error syncing token to organization channels:', error);
  }
};

/**
 * Move a personal channel to an organization
 */
export const moveChannelToOrganization = async (
  orgId: string,
  channelId: string,
  channelTitle: string,
  thumbnailUrl: string | undefined,
  userId: string,
  token?: { accessToken: string; refreshToken: string; expiresAt: number }
): Promise<void> => {
  try {
    await addChannelToOrganization(orgId, channelId, channelTitle, thumbnailUrl, userId, true, token);
  } catch (error) {
    console.error('Error moving channel to organization:', error);
    throw error;
  }
};

/**
 * Get channels available to user (personal + organization channels)
 */
export const getUserAvailableChannels = async (
  userId: string,
  currentOrgId: string | null
): Promise<{
  personalChannels: string[];
  organizationChannels: OrganizationChannel[];
}> => {
  try {
    // TODO: Implement personal channel tracking
    const personalChannels: string[] = [];
    let organizationChannels: OrganizationChannel[] = [];

    if (currentOrgId) {
      organizationChannels = await getOrganizationChannels(currentOrgId);
    }

    // Note: userId parameter reserved for future personal channel tracking
    devDebug('Getting available channels for user:', userId);

    return {
      personalChannels,
      organizationChannels
    };
  } catch (error) {
    console.error('Error getting user available channels:', error);
    return {
      personalChannels: [],
      organizationChannels: []
    };
  }
};