import { db } from '../config/firebase';
import {
    collection,
    doc,
    setDoc,
    deleteDoc,
    getDocs,
    query,
    where,
    Timestamp
} from 'firebase/firestore';

export interface SavedList {
    id: string;
    name: string;
    listType?: 'video' | 'playlist'; // Type of the list, defaults to 'video' for older lists
    videoIds: string[]; // Still required for backward compat, will be empty for playlist lists
    playlistIds?: string[]; // IDs for playlist lists
    trackDate?: string;
    annotations?: { date: string; title: string }[];
    channelId?: string; // Optional for backward compatibility, but should be populated
    color: string; // Color for the list (used in graphs)
    createdAt: number;
    /** id -> { title, thumbnailUrl, addedAt } for optimized-flag lists */
    itemsMeta?: Record<string, { title?: string; thumbnailUrl?: string; addedAt: number }>;
    // Organization fields
    organizationId?: string; // If set, this list belongs to an organization
    createdBy?: string; // User ID who created the list
    lastModifiedBy?: string; // User ID who last modified the list
    lastModifiedAt?: number; // Timestamp of last modification
}

/**
 * Save a list to the user's subcollection
 */
export const saveList = async (uid: string, list: SavedList) => {
    try {
        const listRef = doc(db, 'users', uid, 'savedLists', list.id);
        await setDoc(listRef, {
            ...list,
            updatedAt: Timestamp.now()
        });
        return list;
    } catch (error) {
        console.error('Error saving list:', error);
        throw error;
    }
};

/**
 * Get all saved lists for a user
 */
export const getUserLists = async (uid: string): Promise<SavedList[]> => {
    try {
        const listsRef = collection(db, 'users', uid, 'savedLists');
        const snapshot = await getDocs(listsRef);
        return snapshot.docs.map(doc => doc.data() as SavedList);
    } catch (error) {
        console.error('Error fetching lists:', error);
        return [];
    }
};

/**
 * Get lists specifically for a channel (client-side filtering is also an option if lists are few)
 * But we can query if we indexed it. For now, fetching all and filtering in UI is safer/easier 
 * until scale requires otherwise.
 */
export const getListsByChannel = async (uid: string, channelId: string): Promise<SavedList[]> => {
    try {
        const listsRef = collection(db, 'users', uid, 'savedLists');
        const q = query(listsRef, where("channelId", "==", channelId));
        const snapshot = await getDocs(q);
        return snapshot.docs.map(doc => doc.data() as SavedList);
    } catch (error) {
        console.error('Error fetching channel lists:', error);
        return [];
    }
}


/**
 * Delete a list
 */
export const deleteList = async (uid: string, listId: string) => {
    try {
        await deleteDoc(doc(db, 'users', uid, 'savedLists', listId));
    } catch (error) {
        console.error('Error deleting list:', error);
        throw error;
    }
};
