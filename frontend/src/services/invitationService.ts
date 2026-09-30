import { db } from '../config/firebase';
import {
  collection,
  doc,
  setDoc,
  getDoc,
  getDocs,
  updateDoc,
  deleteDoc
} from 'firebase/firestore';
import type {
  OrganizationInvitation,
  OrganizationRole
} from '../types/organization';
import { addMemberToOrganization } from './organizationService';
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';
import { devLog } from '../utils/devLog';

/**
 * Generate a secure random token for invitation
 */
const generateInvitationToken = (): string => {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, byte => byte.toString(16).padStart(2, '0')).join('');
};

/**
 * Invite a member to an organization
 */
export const inviteMember = async (
  orgId: string,
  email: string,
  role: Exclude<OrganizationRole, 'owner'>,
  invitedBy: string,
  _inviterEmail: string
): Promise<string> => {
  try {
    // Check if user is already a member
    const membersSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'members')
    );
    const existingMember = membersSnapshot.docs.find(
      doc => doc.data().email === email.toLowerCase()
    );
    if (existingMember) {
      throw new Error('User is already a member of this organization');
    }

    // Check if there's already a pending invitation
    const invitationsSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'invitations')
    );
    const pendingInvite = invitationsSnapshot.docs.find(
      doc => doc.data().email === email.toLowerCase() && doc.data().status === 'pending'
    );
    if (pendingInvite) {
      throw new Error('An invitation has already been sent to this email');
    }

    const inviteId = `inv_${Date.now()}_${Math.random().toString(36).substring(2, 11)}`;
    const token = generateInvitationToken();
    const now = Date.now();
    const expiresAt = now + 7 * 24 * 60 * 60 * 1000; // 7 days

    const invitation: OrganizationInvitation = {
      id: inviteId,
      organizationId: orgId,
      email: email.toLowerCase(),
      role,
      invitedBy,
      invitedAt: now,
      expiresAt,
      status: 'pending',
      token
    };

    const inviteRef = doc(db, 'organizations', orgId, 'invitations', inviteId);
    await setDoc(inviteRef, invitation);

    // Send invitation email via backend
    try {
      const baseUrl = getResolvedApiBaseUrl();
      
      // Get organization name
      const orgDoc = await getDoc(doc(db, 'organizations', orgId));
      const organizationName = orgDoc.exists() ? orgDoc.data().name : 'Organization';
      
      const response = await fetch(`${baseUrl}/organization/send-invitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getFirebaseAuthHeader())
        },
        body: JSON.stringify({
          organizationId: orgId,
          organizationName,
          inviteeEmail: email.toLowerCase(),
          role,
          token: invitation.token
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error('[Invitation] Email delivery failed (HTTP', response.status, '):', errBody);
      } else {
        devLog('[Invitation] Email sent successfully to:', email);
      }
    } catch (emailError) {
      console.error('[Invitation] Network error sending invitation email:', emailError);
    }

    return inviteId;
  } catch (error) {
    console.error('Error inviting member:', error);
    throw error;
  }
};

/**
 * Get all invitations for an organization
 */
export const getOrganizationInvitations = async (
  orgId: string
): Promise<OrganizationInvitation[]> => {
  try {
    const invitationsSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'invitations')
    );

    const invitations = invitationsSnapshot.docs.map(
      doc => doc.data() as OrganizationInvitation
    );

    // Update expired invitations
    const now = Date.now();
    const expiredInvitations = invitations.filter(
      inv => inv.status === 'pending' && inv.expiresAt < now
    );

    if (expiredInvitations.length > 0) {
      await Promise.all(
        expiredInvitations.map(inv =>
          updateInvitationStatus(orgId, inv.id, 'expired')
        )
      );
    }

    return invitations;
  } catch (error) {
    console.error('Error fetching invitations:', error);
    return [];
  }
};

/**
 * Cancel an invitation
 */
export const cancelInvitation = async (
  orgId: string,
  inviteId: string
): Promise<void> => {
  try {
    const inviteRef = doc(db, 'organizations', orgId, 'invitations', inviteId);
    await deleteDoc(inviteRef);
  } catch (error) {
    console.error('Error canceling invitation:', error);
    throw error;
  }
};

/**
 * Get invitation by token (searches across all organizations)
 * Note: This is not ideal for performance. In production, consider using a separate collection.
 * For now, use getInvitationByTokenAndOrg with orgId from URL instead.
 */
export const getInvitationByToken = async (
  _token: string
): Promise<OrganizationInvitation | null> => {
  try {
    // We need to search across all organizations
    // This is not ideal for performance, but invitations are rare
    // In production, consider using a separate collection for invitations
    
    // For now, we'll return null and handle this in the accept flow
    // The token should include the orgId in the URL
    return null;
  } catch (error) {
    console.error('Error fetching invitation by token:', error);
    return null;
  }
};

/**
 * Get invitation by token and organization ID
 */
export const getInvitationByTokenAndOrg = async (
  orgId: string,
  token: string
): Promise<OrganizationInvitation | null> => {
  try {
    const invitationsSnapshot = await getDocs(
      collection(db, 'organizations', orgId, 'invitations')
    );

    const inviteDoc = invitationsSnapshot.docs.find(
      doc => doc.data().token === token
    );

    if (!inviteDoc) return null;

    return inviteDoc.data() as OrganizationInvitation;
  } catch (error) {
    console.error('Error fetching invitation:', error);
    return null;
  }
};

/**
 * Update invitation status
 */
const updateInvitationStatus = async (
  orgId: string,
  inviteId: string,
  status: 'accepted' | 'expired'
): Promise<void> => {
  try {
    const inviteRef = doc(db, 'organizations', orgId, 'invitations', inviteId);
    await updateDoc(inviteRef, { status });
  } catch (error) {
    console.error('Error updating invitation status:', error);
    throw error;
  }
};

/**
 * Accept an invitation
 */
export const acceptInvitation = async (
  orgId: string,
  token: string,
  userId: string,
  userEmail: string
): Promise<{ organizationId: string; organizationName: string }> => {
  try {
    // Get invitation
    const invitation = await getInvitationByTokenAndOrg(orgId, token);

    if (!invitation) {
      throw new Error('Invitation not found');
    }

    if (invitation.status !== 'pending') {
      throw new Error(`Invitation is ${invitation.status}`);
    }

    if (Date.now() > invitation.expiresAt) {
      await updateInvitationStatus(orgId, invitation.id, 'expired');
      throw new Error('Invitation has expired');
    }

    if (invitation.email.toLowerCase() !== userEmail.toLowerCase()) {
      throw new Error('This invitation was sent to a different email address');
    }

    // Add user to organization
    await addMemberToOrganization(
      orgId,
      userId,
      userEmail,
      invitation.role,
      invitation.invitedBy
    );

    // Mark invitation as accepted
    await updateInvitationStatus(orgId, invitation.id, 'accepted');

    // Get organization name
    const orgDoc = await getDoc(doc(db, 'organizations', orgId));
    const orgName = orgDoc.exists() ? orgDoc.data().name : 'Organization';

    return {
      organizationId: orgId,
      organizationName: orgName
    };
  } catch (error) {
    console.error('Error accepting invitation:', error);
    throw error;
  }
};

/**
 * Resend invitation email
 */
export const resendInvitation = async (
  orgId: string,
  inviteId: string,
  _inviterEmail: string
): Promise<void> => {
  try {
    const inviteDoc = await getDoc(
      doc(db, 'organizations', orgId, 'invitations', inviteId)
    );

    if (!inviteDoc.exists()) {
      throw new Error('Invitation not found');
    }

    const invitation = inviteDoc.data() as OrganizationInvitation;

    if (invitation.status !== 'pending') {
      throw new Error('Can only resend pending invitations');
    }

    // Extend expiry
    const newExpiresAt = Date.now() + 7 * 24 * 60 * 60 * 1000;
    await updateDoc(inviteDoc.ref, { expiresAt: newExpiresAt });

    // Send invitation email via backend
    try {
      const baseUrl = getResolvedApiBaseUrl();
      
      // Get organization name
      const orgDoc = await getDoc(doc(db, 'organizations', orgId));
      const organizationName = orgDoc.exists() ? orgDoc.data().name : 'Organization';
      
      const response = await fetch(`${baseUrl}/organization/send-invitation`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(await getFirebaseAuthHeader())
        },
        body: JSON.stringify({
          organizationId: orgId,
          organizationName,
          inviteeEmail: invitation.email,
          role: invitation.role,
          token: invitation.token
        })
      });

      if (!response.ok) {
        const errBody = await response.text();
        console.error('[Invitation] Resend email failed (HTTP', response.status, '):', errBody);
      } else {
        devLog('[Invitation] Resend email sent successfully to:', invitation.email);
      }
    } catch (emailError) {
      console.error('[Invitation] Network error resending invitation email:', emailError);
    }
  } catch (error) {
    console.error('Error resending invitation:', error);
    throw error;
  }
};
