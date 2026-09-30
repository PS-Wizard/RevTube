import type { OrganizationMember } from "../types/organization";
import type { SavedList } from "./savedListService";

type ListPermissionTarget = Partial<SavedList> & {
  organizationId?: string | null;
  createdBy?: string | null;
};

/**
 * Check if a list is an organization list
 */
export const isOrganizationList = (
  list?: ListPermissionTarget | null,
): boolean => {
  return !!list && "organizationId" in list && !!list.organizationId;
};

/**
 * Check if user can edit a list
 */
export const canEditList = (
  userId: string,
  list?: ListPermissionTarget | null,
  orgMember?: OrganizationMember | null,
): boolean => {
  // Personal list - only creator can edit
  if (!isOrganizationList(list)) {
    const createdBy = list?.createdBy;
    return createdBy === userId || !createdBy; // Backward compatibility
  }

  // Organization list - need write, admin, or owner permission
  if (!orgMember) return false;
  return (
    orgMember.role === "owner" ||
    orgMember.role === "admin" ||
    orgMember.role === "write"
  );
};

/**
 * Check if user can delete a list
 */
export const canDeleteList = (
  userId: string,
  list?: ListPermissionTarget | null,
  orgMember?: OrganizationMember | null,
): boolean => {
  // Personal list - only creator can delete
  if (!isOrganizationList(list)) {
    const createdBy = list?.createdBy;
    return createdBy === userId || !createdBy; // Backward compatibility
  }

  // Organization list - owner, admin, or creator can delete
  if (!orgMember) return false;
  return (
    orgMember.role === "owner" ||
    orgMember.role === "admin" ||
    list?.createdBy === userId
  );
};

/**
 * Check if user can create lists in organization
 */
export const canCreateList = (
  orgMember?: OrganizationMember | null,
): boolean => {
  if (!orgMember) return false;
  return (
    orgMember.role === "owner" ||
    orgMember.role === "admin" ||
    orgMember.role === "write"
  );
};

/**
 * Check if user can invite members
 */
export const canInviteMembers = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return orgMember?.role === "owner" || orgMember?.role === "admin";
};

/**
 * Check if user can manage members (change roles, remove)
 */
export const canManageMembers = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return orgMember?.role === "owner" || orgMember?.role === "admin";
};

/**
 * Check if user can delete organization
 */
export const canDeleteOrganization = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return orgMember?.role === "owner";
};

/**
 * Check if user can update organization settings
 */
export const canUpdateOrganization = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return orgMember?.role === "owner" || orgMember?.role === "admin";
};

/**
 * Check if user can access organization settings
 */
/**
 * Check if user can access organization settings page.
 * ALL members (including read-only viewers) can open the page so they can
 * view shared members/channels and leave the organization. Destructive
 * management actions on the page are gated by canManageMembers / canUpdateOrganization.
 */
export const canAccessOrganizationSettings = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return !!orgMember;
};

/**
 * Check if user can add channels to organization.
 * Only organization owners and admins can connect new channels.
 */
export const canAddChannel = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return orgMember?.role === "owner" || orgMember?.role === "admin";
};

/**
 * Check if user can remove channels from organization
 */
export const canRemoveChannel = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return orgMember?.role === "owner" || orgMember?.role === "admin";
};

/**
 * Check if user is organization owner
 */
export const isOwner = (orgMember?: OrganizationMember | null): boolean => {
  return orgMember?.role === "owner";
};

/**
 * Check if user is organization admin
 */
export const isAdmin = (orgMember?: OrganizationMember | null): boolean => {
  return orgMember?.role === "admin";
};

/**
 * Check if user has write access
 */
export const hasWriteAccess = (
  orgMember?: OrganizationMember | null,
): boolean => {
  if (!orgMember) return false;
  return (
    orgMember.role === "owner" ||
    orgMember.role === "admin" ||
    orgMember.role === "write"
  );
};

/**
 * Check if user has read access
 */
export const hasReadAccess = (
  orgMember?: OrganizationMember | null,
): boolean => {
  return !!orgMember;
};

/**
 * Get permission level description
 */
export const getPermissionDescription = (
  orgMember?: OrganizationMember | null,
): string => {
  if (!orgMember) return "No access";

  switch (orgMember.role) {
    case "owner":
      return "Full access - Can manage members and all resources";
    case "admin":
      return "Admin access - Can manage members, channels, and organization settings";
    case "write":
      return "Can view and edit lists";
    case "read":
      return "Can view lists and channels only";
    default:
      return "Unknown permission level";
  }
};
