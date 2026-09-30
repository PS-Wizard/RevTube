import {
  collection,
  query,
  orderBy,
  limit,
  getDocs,
  deleteDoc,
  doc,
  Timestamp,
  setDoc
} from 'firebase/firestore';
import { db } from '../config/firebase';

export interface RecentChannel {
  id?: string;
  channelInput: string; // Channel ID, handle, or username
  channelName?: string;
  thumbnailUrl?: string; // Channel avatar
  timestamp: Date;
}

export interface RecentPlaylist {
  id?: string;
  playlistId: string;
  playlistName?: string;
  timestamp: Date;
}

export interface RecentComparison {
  id?: string;
  channels: string[]; // Array of channel IDs/handles
  channelNames?: string[];
  timePeriod: string;
  timestamp: Date;
}

export type RecentItem = RecentChannel | RecentPlaylist | RecentComparison;

const MAX_RECENTS = 10;

// Helper function to get user's recents subcollection path
const getUserRecentsPath = (userId: string, type: 'channels' | 'playlists' | 'comparisons') => {
  return collection(db, 'users', userId, 'recents', type, 'items');
};

/**
 * Save a recent channel search
 */
export const saveRecentChannel = async (
  userId: string,
  channelInput: string,
  channelName?: string,
  thumbnailUrl?: string
): Promise<void> => {
  try {
    // Use a consistent document ID based on channelInput to automatically handle duplicates
    const docId = encodeURIComponent(channelInput.toLowerCase().replace(/[^a-z0-9@]/g, '_'));
    const channelRef = doc(db, 'users', userId, 'recents', 'channels', 'items', docId);

    // Set (upsert) the document - will create or update
    await setDoc(channelRef, {
      channelInput,
      channelName: channelName || channelInput,
      thumbnailUrl: thumbnailUrl || null,
      timestamp: Timestamp.now()
    });

    // Clean up old entries (keep only MAX_RECENTS)
    await cleanupOldRecents(userId, 'channels');
  } catch (error) {
    console.error('[Recents] Error saving recent channel:', error);
    // Fail silently to not disrupt user experience
  }
};

/**
 * Save a recent video search - deprecated, now uses saveRecentChannel
 */
export const saveRecentVideoSearch = saveRecentChannel;

/**
 * Save a recent playlist search
 */
export const saveRecentPlaylist = async (
  userId: string,
  playlistId: string,
  playlistName?: string
): Promise<void> => {
  try {

    // Use playlist ID as document ID to automatically handle duplicates
    const docId = playlistId.replace(/[^a-zA-Z0-9]/g, '_');
    const playlistRef = doc(db, 'users', userId, 'recents', 'playlists', 'items', docId);

    // Set (upsert) the document - will create or update
    await setDoc(playlistRef, {
      playlistId,
      playlistName: playlistName || playlistId,
      timestamp: Timestamp.now()
    });


    // Clean up old entries (keep only MAX_RECENTS)
    await cleanupOldRecents(userId, 'playlists');
  } catch (error) {
    console.error('[Recents] Error saving recent playlist:', error);
    // Fail silently to not disrupt user experience
  }
};

/**
 * Save a recent comparison
 */
export const saveRecentComparison = async (
  userId: string,
  channels: string[],
  channelNames: string[],
  timePeriod: string
): Promise<void> => {
  try {

    // Sort channels to ensure consistent comparison
    const sortedChannels = [...channels].sort();
    const sortedNames = [...channelNames].sort();

    // Create a unique ID from the sorted channels and time period
    const docId = sortedChannels.map(c => c.replace(/[^a-z0-9]/gi, '_')).join('_') + '_' + timePeriod;
    const comparisonRef = doc(db, 'users', userId, 'recents', 'comparisons', 'items', docId);

    // Set (upsert) the document - will create or update
    await setDoc(comparisonRef, {
      channels: sortedChannels,
      channelNames: sortedNames,
      timePeriod,
      timestamp: Timestamp.now()
    });


    // Clean up old entries (keep only MAX_RECENTS)
    await cleanupOldRecents(userId, 'comparisons');
  } catch (error) {
    console.error('[Recents] Error saving recent comparison:', error);
    // Fail silently to not disrupt user experience
  }
};

/**
 * Get recent channels for a user
 */
export const getRecentChannels = async (userId: string): Promise<RecentChannel[]> => {
  try {

    const channelsPath = getUserRecentsPath(userId, 'channels');
    const q = query(
      channelsPath,
      orderBy('timestamp', 'desc'),
      limit(MAX_RECENTS)
    );

    const querySnapshot = await getDocs(q);

    const channels = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        channelInput: data.channelInput,
        channelName: data.channelName,
        thumbnailUrl: data.thumbnailUrl,
        timestamp: data.timestamp.toDate()
      } as RecentChannel;
    });

    return channels;
  } catch (error) {
    console.error('[Recents] Error getting recent channels:', error);
    return [];
  }
};

/**
 * Get recent video searches - deprecated, now uses getRecentChannels
 */
export const getRecentVideoSearches = getRecentChannels;

/**
 * Get recent playlists for a user
 */
export const getRecentPlaylists = async (userId: string): Promise<RecentPlaylist[]> => {
  try {

    const playlistsPath = getUserRecentsPath(userId, 'playlists');
    const q = query(
      playlistsPath,
      orderBy('timestamp', 'desc'),
      limit(MAX_RECENTS)
    );

    const querySnapshot = await getDocs(q);

    const playlists = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        playlistId: data.playlistId,
        playlistName: data.playlistName,
        timestamp: data.timestamp.toDate()
      } as RecentPlaylist;
    });

    return playlists;
  } catch (error) {
    console.error('[Recents] Error getting recent playlists:', error);
    return [];
  }
};

/**
 * Get recent comparisons for a user
 */
export const getRecentComparisons = async (userId: string): Promise<RecentComparison[]> => {
  try {

    const comparisonsPath = getUserRecentsPath(userId, 'comparisons');
    const q = query(
      comparisonsPath,
      orderBy('timestamp', 'desc'),
      limit(MAX_RECENTS)
    );

    const querySnapshot = await getDocs(q);

    const comparisons = querySnapshot.docs.map(doc => {
      const data = doc.data();
      return {
        id: doc.id,
        channels: data.channels,
        channelNames: data.channelNames,
        timePeriod: data.timePeriod,
        timestamp: data.timestamp.toDate()
      } as RecentComparison;
    });

    return comparisons;
  } catch (error) {
    console.error('[Recents] Error getting recent comparisons:', error);
    return [];
  }
};

/**
 * Delete a recent item
 */
export const deleteRecentItem = async (
  userId: string,
  type: 'channels' | 'playlists' | 'comparisons',
  itemId: string
): Promise<void> => {
  try {
    const itemRef = doc(db, 'users', userId, 'recents', type, 'items', itemId);
    await deleteDoc(itemRef);
  } catch (error) {
    console.error('[Recents] Error deleting recent item:', error);
  }
};

/**
 * Clean up old entries, keeping only the most recent MAX_RECENTS items
 */
const cleanupOldRecents = async (
  userId: string,
  type: 'channels' | 'playlists' | 'comparisons'
): Promise<void> => {
  try {
    const recentsPath = getUserRecentsPath(userId, type);
    const q = query(
      recentsPath,
      orderBy('timestamp', 'desc')
    );

    const querySnapshot = await getDocs(q);

    // If we have more than MAX_RECENTS, delete the excess
    if (querySnapshot.docs.length > MAX_RECENTS) {
      const docsToDelete = querySnapshot.docs.slice(MAX_RECENTS);
      const deletePromises = docsToDelete.map(doc => deleteDoc(doc.ref));
      await Promise.all(deletePromises);
    }
  } catch (error) {
    console.error('[Recents] Error cleaning up old recents:', error);
  }
};

