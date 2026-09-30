import { db } from '../config/firebase';
import { devLog } from '../utils/devLog';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  updateDoc,
  writeBatch,
  arrayUnion,
  arrayRemove,
  setDoc
} from 'firebase/firestore';
import type {
  Organization,
  OrganizationMember,
  OrganizationRole,
  OwnershipTransferInvitation
} from '../types/organization';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';

/**
 * Invalidate the backend membership cache for a specific user/org pair.
 * Fire-and-forget safe -- failure does not affect the Firestore operation.
 * Backend caches { isMember, role } with a 15-minute TTL; explicit invalidation
 * is required on membership state changes so changes take effect immediately.
 */
const invalidateMembershipCache = async (organizationId: string, userId: string): Promise<void> => {
  try {
    const baseUrl = getResolvedApiBaseUrl();
    const response = await fetch(`${baseUrl}/organization/invalidate-member`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(await getFirebaseAuthHeader()),
      },
      body: JSON.stringify({ organizationId, userId }),
      // Avoid hanging on streaming/NDJSON responses from some backend stacks
      // (a 200 with body still flowing can otherwise fail).
      cache: 'no-store',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Invalidation failed: ${response.status} ${text}`);
    }
  } catch (error) {
    devLog?.(
      `[MembershipCache] Invalidate failed for org=${organizationId}, user=${userId}:`,
      error,
    );
    // Non-critical -- cache expires naturally after 15 min TTL
  }
};

/**
 * Create a new organization
 */
export const createOrganization = async (
  userId: string,
  userEmail: string,
  name: string
): Promise<Organization> => {
  const orgId = `org_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
  const now = Date.now();

  const organization: Organization = {
    id: orgId,
    name: name.trim(),
    ownerId: userId,
    createdAt: now,
    updatedAt: now,
    plan: 'pro'
  };

  const batch = writeBatch(db);

  // Create organization document
  const orgRef = doc(db, 'organizations', orgId);
  batch.set(orgRef, organization);

  // Add owner as member
  const memberRef = doc(db, 'organizations', orgId, 'members', userId);
  const ownerMember: OrganizationMember = {
    userId,
    email: userEmail,
    role: 'owner',
    joinedAt: now,
    invitedBy: userId
  };
  batch.set(memberRef, ownerMember);

  // Update user's organizations array - use set with merge to handle missing document
  const userRef = doc(db, 'users', userId);
  
  // First check if user document exists
  const userDoc = await getDoc(userRef);
  const existingOrgs = userDoc.exists() ? (userDoc.data().organizations || []) : [];
  
  batch.set(userRef, {
    organizations: [...existingOrgs, orgId],
    currentOrganizationId: orgId
  }, { merge: true });

  await batch.commit();

  return organization;
};

/**
 * Get organization by ID
 */
export const getOrganization = async (
  orgId: string
): Promise<Organization | null> => {
  try {
    const orgDoc = await getDoc(doc(db, 'organizations', orgId));
    if (!orgDoc.exists()) return null;
    return orgDoc.data() as Organization;
  } catch (error) {
    console.error('Error fetching organization:', error);
    return null;
  }
};

/**
 * Update organization
 */
export const updateOrganization = async (
  orgId: string,
  updates: Partial<Omit<Organization, 'id' | 'ownerId' | 'createdAt'>>
): Promise<void> => {
  try {
    const orgRef = doc(db, 'organizations', orgId);
    await updateDoc(orgRef, {
      ...updates,
      updatedAt: Date.now()
    });
  } catch (error) {
    console.error('Error updating organization:', error);
    throw error;
  }
};

/**
 * Delete organization and all related data
 */
export const deleteOrganization = async (
  orgId: string
): Promise<void> => {
  try {
    // Get all members first (before modifying anything)
    const membersSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'members')
    );

    const memberIds: string[] = [];
    const batch = writeBatch(db);

    // Delete organization document
    const orgRef = doc(db, 'organizations', orgId);
    batch.delete(orgRef);

    // Remove org from each member and also delete their member sub-doc
    membersSnapshot.docs.forEach((memberDoc) => {
      const member = memberDoc.data() as OrganizationMember;
      if (!member.userId) return;
      memberIds.push(member.userId);

      // Remove org from user's organizations array (use set with merge to avoid
      // failing if the user doc doesn't exist -- e.g., was deleted by GDPR purge)
      const userRef = doc(db, 'users', member.userId);
      batch.set(userRef, {
        organizations: arrayRemove(orgId),
        currentOrganizationId: null
      }, { merge: true });

      // Delete the member subcollection document
      const memberRef = doc(db, 'organizations', orgId, 'members', member.userId);
      batch.delete(memberRef);
    });

    // Also clean up invitations subcollection
    const invitationsSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'invitations')
    );
    invitationsSnapshot.docs.forEach((inviteDoc) => {
      batch.delete(inviteDoc.ref);
    });

    await batch.commit();

    // Evict backend membership cache for all former members immediately
    memberIds.forEach(uid => void invalidateMembershipCache(orgId, uid));
  } catch (error) {
    console.error('Error deleting organization:', error);
    throw error;
  }
};

/**
 * Get all organizations for a user
 */
export const getUserOrganizations = async (
  userId: string
): Promise<Organization[]> => {
  try {
    // Get user's organization IDs
    const userDoc = await getDoc(doc(db, 'users', userId));
    if (!userDoc.exists()) return [];

    const userData = userDoc.data();
    const orgIds = userData.organizations || [];

    if (orgIds.length === 0) return [];

    // Fetch all organizations
    const organizations = await Promise.all(
      orgIds.map(async (orgId: string) => {
        const org = await getOrganization(orgId);
        return org;
      })
    );

    return organizations.filter((org): org is Organization => org !== null);
  } catch (error) {
    console.error('Error fetching user organizations:', error);
    return [];
  }
};

/**
 * Get all members of an organization
 */
export const getOrganizationMembers = async (
  orgId: string
): Promise<OrganizationMember[]> => {
  try {
    const membersSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'members')
    );

    return membersSnapshot.docs.map(
      (doc) => doc.data() as OrganizationMember
    );
  } catch (error) {
    console.error('Error fetching organization members:', error);
    return [];
  }
};

/**
 * Get a specific member
 */
export const getOrganizationMember = async (
  orgId: string,
  userId: string
): Promise<OrganizationMember | null> => {
  try {
    const memberDoc = await getDoc(
      doc(db, 'organizations', orgId, 'members', userId)
    );
    if (!memberDoc.exists()) return null;
    return memberDoc.data() as OrganizationMember;
  } catch (error) {
    console.error('Error fetching organization member:', error);
    return null;
  }
};

/**
 * Add member to organization (used by invitation acceptance)
 */
export const addMemberToOrganization = async (
  orgId: string,
  userId: string,
  email: string,
  role: Exclude<OrganizationRole, 'owner'>,
  invitedBy: string
): Promise<void> => {
  try {
    const batch = writeBatch(db);

    // Add member document
    const memberRef = doc(db, 'organizations', orgId, 'members', userId);
    const member: OrganizationMember = {
      userId,
      email,
      role,
      joinedAt: Date.now(),
      invitedBy
    };
    batch.set(memberRef, member);

    // Update user's organizations array
    const userRef = doc(db, 'users', userId);
    batch.update(userRef, {
      organizations: arrayUnion(orgId)
    });

    await batch.commit();

    void invalidateMembershipCache(orgId, userId);
  } catch (error) {
    console.error('Error adding member to organization:', error);
    throw error;
  }
};

/**
 * Remove member from organization
 */
export const removeMember = async (
  orgId: string,
  userId: string
): Promise<void> => {
  try {
    const batch = writeBatch(db);

    // Delete member document
    const memberRef = doc(db, 'organizations', orgId, 'members', userId);
    batch.delete(memberRef);

    // Update user's organizations array
    const userRef = doc(db, 'users', userId);
    batch.update(userRef, {
      organizations: arrayRemove(orgId),
      currentOrganizationId: null
    });

    await batch.commit();

    // Evict backend membership cache immediately so the removed user
    // loses org-plan access without waiting for the 2-min TTL to expire.
    void invalidateMembershipCache(orgId, userId);
  } catch (error) {
    console.error('Error removing member:', error);
    throw error;
  }
};

/**
 * Update member role
 */
export const updateMemberRole = async (
  orgId: string,
  userId: string,
  role: Exclude<OrganizationRole, 'owner'>
): Promise<void> => {
  try {
    const memberRef = doc(db, 'organizations', orgId, 'members', userId);
    await updateDoc(memberRef, { role });

    void invalidateMembershipCache(orgId, userId);
  } catch (error) {
    console.error('Error updating member role:', error);
    throw error;
  }
};

/**
 * Leave organization (for non-owners)
 */
export const leaveOrganization = async (
  orgId: string,
  userId: string
): Promise<void> => {
  try {
    // Check if user is owner
    const member = await getOrganizationMember(orgId, userId);
    if (member?.role === 'owner') {
      throw new Error('Owner cannot leave organization. Transfer ownership or delete the organization.');
    }

    await removeMember(orgId, userId);
  } catch (error) {
    console.error('Error leaving organization:', error);
    throw error;
  }
};

/**
 * Switch user's current organization context
 */
export const switchOrganization = async (
  userId: string,
  orgId: string | null
): Promise<void> => {
  try {
    const userRef = doc(db, 'users', userId);
    await updateDoc(userRef, {
      currentOrganizationId: orgId
    });
  } catch (error) {
    console.error('Error switching organization:', error);
    throw error;
  }
};
/**
 * Transfer ownership of organization to another member (creates invitation)
 */
export const transferOwnership = async (
  orgId: string,
  currentOwnerId: string,
  newOwnerId: string
): Promise<void> => {
  try {
    // Get organization and member details
    const [org, newOwnerMember] = await Promise.all([
      getOrganization(orgId),
      getOrganizationMember(orgId, newOwnerId)
    ]);

    if (!org) throw new Error('Organization not found');
    if (!newOwnerMember) throw new Error('New owner is not a member of this organization');

    // Get current owner member to get their email
    const currentOwnerMember = await getOrganizationMember(orgId, currentOwnerId);
    if (!currentOwnerMember) throw new Error('Current owner not found');

    // Create ownership transfer invitation
    const transferId = `transfer_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const token = Math.random().toString(36).substring(2, 15) + Math.random().toString(36).substring(2, 15);
    const now = Date.now();
    const expiresAt = now + (7 * 24 * 60 * 60 * 1000); // 7 days

    const transferInvitation = {
      id: transferId,
      organizationId: orgId,
      organizationName: org.name,
      currentOwnerId,
      currentOwnerEmail: currentOwnerMember.email,
      newOwnerId,
      newOwnerEmail: newOwnerMember.email,
      invitedAt: now,
      expiresAt,
      status: 'pending' as const,
      token
    };

    // Save the transfer invitation
    const transferRef = doc(db, 'ownershipTransfers', transferId);
    await setDoc(transferRef, transferInvitation);

    // Send email notification to new owner
    try {
      const baseUrl = getResolvedApiBaseUrl();

      const response = await fetch(`${baseUrl}/organization/send-ownership-transfer`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getFirebaseAuthHeader())
        },
        body: JSON.stringify({
          organizationId: orgId,
          organizationName: org.name,
          newOwnerEmail: newOwnerMember.email,
          currentOwnerEmail: currentOwnerMember.email,
          token
        })
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to send ownership transfer email:', errorText);
        // Don't throw - the invitation is created, email is just a notification
      } else {
        devLog('Ownership transfer email sent successfully');
      }
    } catch (emailError) {
      console.error('Error sending ownership transfer email:', emailError);
      // Don't throw - the invitation is created, email is just a notification
    }

    devLog('Ownership transfer invitation created:', transferId);
  } catch (error) {
    console.error('Error creating ownership transfer invitation:', error);
    throw error;
  }
};

/**
 * Get ownership transfer by token
 */
export const getOwnershipTransferByToken = async (
  token: string
): Promise<OwnershipTransferInvitation | null> => {
  try {
    const transfersSnapshot = await getDocs(collection(db, 'ownershipTransfers'));
    const transfer = transfersSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as OwnershipTransferInvitation))
      .find(transfer => transfer.token === token);

    return transfer || null;
  } catch (error) {
    console.error('Error fetching ownership transfer by token:', error);
    return null;
  }
};
export const getPendingOwnershipTransfers = async (
  userId: string
): Promise<OwnershipTransferInvitation[]> => {
  try {
    const transfersSnapshot = await getDocs(collection(db, 'ownershipTransfers'));
    const transfers = transfersSnapshot.docs
      .map(doc => ({ id: doc.id, ...doc.data() } as OwnershipTransferInvitation))
      .filter(transfer =>
        transfer.newOwnerId === userId &&
        transfer.status === 'pending' &&
        transfer.expiresAt > Date.now()
      );

    return transfers;
  } catch (error) {
    console.error('Error fetching pending ownership transfers:', error);
    return [];
  }
};

/**
 * Accept ownership transfer
 */
export const acceptOwnershipTransfer = async (
  transferId: string,
  userId: string
): Promise<void> => {
  try {
    // Get the transfer invitation
    const transferDoc = await getDoc(doc(db, 'ownershipTransfers', transferId));
    if (!transferDoc.exists()) {
      throw new Error('Transfer invitation not found');
    }

    const transfer = transferDoc.data();
    if (transfer.newOwnerId !== userId) {
      throw new Error('You are not authorized to accept this transfer');
    }

    if (transfer.status !== 'pending') {
      throw new Error('This transfer invitation is no longer valid');
    }

    if (transfer.expiresAt < Date.now()) {
      throw new Error('This transfer invitation has expired');
    }

    const batch = writeBatch(db);

    // Update the organization owner
    const orgRef = doc(db, 'organizations', transfer.organizationId);
    batch.update(orgRef, {
      ownerId: transfer.newOwnerId,
      updatedAt: Date.now()
    });

    // Update the new owner's role to 'owner'
    const newOwnerRef = doc(db, 'organizations', transfer.organizationId, 'members', transfer.newOwnerId);
    batch.update(newOwnerRef, { role: 'owner' });

    // Update the current owner's role to 'admin'
    const currentOwnerRef = doc(db, 'organizations', transfer.organizationId, 'members', transfer.currentOwnerId);
    batch.update(currentOwnerRef, { role: 'admin' });

    // Mark transfer as accepted
    const transferRef = doc(db, 'ownershipTransfers', transferId);
    batch.update(transferRef, { 
      status: 'accepted',
      acceptedAt: Date.now()
    });

    await batch.commit();

    // Evict backend membership cache for both affected members
    void invalidateMembershipCache(transfer.organizationId, transfer.newOwnerId);
    void invalidateMembershipCache(transfer.organizationId, transfer.currentOwnerId);
  } catch (error) {
    console.error('Error accepting ownership transfer:', error);
    throw error;
  }
};

/**
 * Decline ownership transfer
 */
export const declineOwnershipTransfer = async (
  transferId: string,
  userId: string
): Promise<void> => {
  try {
    // Get the transfer invitation
    const transferDoc = await getDoc(doc(db, 'ownershipTransfers', transferId));
    if (!transferDoc.exists()) {
      throw new Error('Transfer invitation not found');
    }

    const transfer = transferDoc.data();
    if (transfer.newOwnerId !== userId) {
      throw new Error('You are not authorized to decline this transfer');
    }

    // Mark transfer as declined
    const transferRef = doc(db, 'ownershipTransfers', transferId);
    await updateDoc(transferRef, { 
      status: 'declined',
      declinedAt: Date.now()
    });
  } catch (error) {
    console.error('Error declining ownership transfer:', error);
    throw error;
  }
};

/**
 * Org-wide analytics types (cross-channel comparison from PostgreSQL read models)
 */
export type OrgAnalyticsMetrics = {
  views: number;
  watchMinutes: number;
  likes: number;
  comments: number;
  shares: number;
  subsGained: number;
  subsLost: number;
  netSubs: number;
};

export type OrgAnalyticsChannel = {
  channelId: string;
  title: string | null;
  videoCount: number;
  lastSyncedAt: string | null;
  totals: OrgAnalyticsMetrics;
  prevTotals: OrgAnalyticsMetrics;
  /** All-time aggregate for this channel. */
  lifetime: OrgAnalyticsMetrics;
  /**
   * Earliest day of ingested daily metrics. Views/likes/comments lifetime
   * are true cumulative totals from analytics_videos, but watch-minutes and
   * subscriber deltas only cover history from this date onward.
   */
  historyStart: string | null;
  deltas: Partial<Record<keyof OrgAnalyticsMetrics, number | null>>;
  series: ({ date: string } & OrgAnalyticsMetrics)[];
};

export type OrgAnalyticsData = {
  configured: boolean;
  orgId: string;
  period: '7d' | '30d' | '90d' | 'custom';
  range?: { start: string; end: string; prevStart: string };
  totals: OrgAnalyticsMetrics;
  prevTotals: OrgAnalyticsMetrics;
  /** All-time aggregate (views/likes/comments = true lifetime; watch time & subs = full ingested history). */
  lifetime: OrgAnalyticsMetrics;
  /** Earliest day of ingested daily metrics (see OrgAnalyticsChannel.historyStart). */
  historyStart: string | null;
  deltas: Partial<Record<keyof OrgAnalyticsMetrics, number | null>>;
  series: ({ date: string } & OrgAnalyticsMetrics)[];
  channels: OrgAnalyticsChannel[];
};

export type OrgAnalyticsPeriod = '7d' | '30d' | '90d' | 'custom';

export type OrgAnalyticsCustomRange = { start: string; end: string };

/**
 * Fetch aggregated analytics for all channels in an organization.
 * Read-model only (no YouTube quota); membership enforced server-side.
 */
export const getOrgAnalytics = async (
  orgId: string,
  period: OrgAnalyticsPeriod = '30d',
  customRange?: OrgAnalyticsCustomRange
): Promise<OrgAnalyticsData> => {
  const baseUrl = getResolvedApiBaseUrl();
  let url = `${baseUrl}/organization/analytics?orgId=${encodeURIComponent(orgId)}&period=${period}`;
  if (period === 'custom' && customRange) {
    url += `&start=${encodeURIComponent(customRange.start)}&end=${encodeURIComponent(customRange.end)}`;
  }
  const response = await fetch(url, {
    headers: {
      'Content-Type': 'application/json',
      'X-Org-Id': orgId,
      ...(await getFirebaseAuthHeader()),
    },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null);
    throw new Error(body?.error?.message || `Failed to load org analytics (${response.status})`);
  }
  return response.json();
};