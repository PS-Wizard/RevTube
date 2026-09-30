/**
 * Organization and collaboration types
 */

export type OrganizationRole = 'owner' | 'admin' | 'write' | 'read';
export type InvitationStatus = 'pending' | 'accepted' | 'expired';

/**
 * Organization entity
 */
export interface Organization {
  id: string;
  name: string;
  ownerId: string;
  createdAt: number;
  updatedAt: number;
  plan: 'pro';
}

/**
 * Organization member
 */
export interface OrganizationMember {
  userId: string;
  email: string;
  role: OrganizationRole;
  joinedAt: number;
  invitedBy: string;
}

/**
 * Organization invitation
 */
export interface OrganizationInvitation {
  id: string;
  organizationId: string;
  email: string;
  role: Exclude<OrganizationRole, 'owner'>; // Can't invite as owner
  invitedBy: string;
  invitedAt: number;
  expiresAt: number;
  status: InvitationStatus;
  token: string;
}

/**
 * Ownership transfer invitation
 */
export interface OwnershipTransferInvitation {
  id: string;
  organizationId: string;
  organizationName: string;
  currentOwnerId: string;
  currentOwnerEmail: string;
  newOwnerId: string;
  newOwnerEmail: string;
  invitedAt: number;
  expiresAt: number;
  status: 'pending' | 'accepted' | 'declined' | 'expired';
  token: string;
}

/**
 * Organization channel
 */
export interface OrganizationChannel {
  channelId: string;
  channelTitle: string;
  thumbnailUrl?: string;
  addedBy: string;
  addedAt: number;
}

/**
 * Organization list (extends SavedList)
 */
export interface OrganizationList {
  id: string;
  name: string;
  videoIds: string[];
  trackDate?: string;
  annotations?: { date: string; title: string }[];
  channelId?: string;
  color: string;
  createdAt: number;
  // Organization-specific fields
  organizationId: string;
  createdBy: string;
  lastModifiedBy: string;
  lastModifiedAt: number;
}

/**
 * Extended user type with organization fields
 */
export interface UserWithOrganizations {
  uid: string;
  email: string | null;
  role: 'admin' | 'pro' | 'free';
  currentOrganizationId?: string;
  organizations: string[];
}

/**
 * Invitation email data
 */
export interface InvitationEmailData {
  to: string;
  organizationName: string;
  inviterEmail: string;
  role: Exclude<OrganizationRole, 'owner'>;
  acceptUrl: string;
}
