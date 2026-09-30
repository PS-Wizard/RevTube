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
import type { SavedList } from './savedListService';

/**
 * Save a list to an organization's subcollection
 */
export const saveOrganizationList = async (
  orgId: string,
  list: SavedList,
  userId: string
): Promise<SavedList> => {
  try {
    const listRef = doc(db, 'organizations', orgId, 'lists', list.id);
    const now = Date.now();
    
    const orgList: SavedList = {
      ...list,
      organizationId: orgId,
      createdBy: list.createdBy || userId,
      lastModifiedBy: userId,
      lastModifiedAt: now
    };

    await setDoc(listRef, {
      ...orgList,
      updatedAt: Timestamp.now()
    });
    
    return orgList;
  } catch (error) {
    console.error('Error saving organization list:', error);
    throw error;
  }
};

/**
 * Get all lists for an organization
 */
export const getOrganizationLists = async (
  orgId: string
): Promise<SavedList[]> => {
  try {
    const listsRef = collection(db, 'organizations', orgId, 'lists');
    const snapshot = await getDocs(listsRef);
    return snapshot.docs.map(doc => doc.data() as SavedList);
  } catch (error) {
    console.error('Error fetching organization lists:', error);
    return [];
  }
};

/**
 * Get organization lists for a specific channel
 */
export const getOrganizationListsByChannel = async (
  orgId: string,
  channelId: string
): Promise<SavedList[]> => {
  try {
    const listsRef = collection(db, 'organizations', orgId, 'lists');
    const q = query(listsRef, where('channelId', '==', channelId));
    const snapshot = await getDocs(q);
    return snapshot.docs.map(doc => doc.data() as SavedList);
  } catch (error) {
    console.error('Error fetching organization channel lists:', error);
    return [];
  }
};

/**
 * Delete an organization list
 */
export const deleteOrganizationList = async (
  orgId: string,
  listId: string
): Promise<void> => {
  try {
    await deleteDoc(doc(db, 'organizations', orgId, 'lists', listId));
  } catch (error) {
    console.error('Error deleting organization list:', error);
    throw error;
  }
};

/**
 * Update an existing organization list
 */
export const updateOrganizationList = async (
  orgId: string,
  list: SavedList,
  userId: string
): Promise<SavedList> => {
  try {
    const listRef = doc(db, 'organizations', orgId, 'lists', list.id);
    const now = Date.now();
    
    const updatedList: SavedList = {
      ...list,
      organizationId: orgId,
      lastModifiedBy: userId,
      lastModifiedAt: now
    };

    await setDoc(listRef, {
      ...updatedList,
      updatedAt: Timestamp.now()
    });
    
    return updatedList;
  } catch (error) {
    console.error('Error updating organization list:', error);
    throw error;
  }
};
