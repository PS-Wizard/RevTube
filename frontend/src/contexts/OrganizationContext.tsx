/* eslint-disable react-refresh/only-export-components */
import React, { createContext, useContext, useState, useEffect, useRef } from 'react';
import type { ReactNode } from 'react';
import type { User } from 'firebase/auth';
import { useAuth } from '../hooks/useAuth';
import type { Organization, OrganizationMember } from '../types/organization';
import {
  getUserOrganizations,
  getOrganizationMember,
  switchOrganization
} from '../services/organizationService';
import { canAccessOrganizationSettings } from '../services/permissionService';
import { devLog } from '../utils/devLog';

/** Firebase `User` extended with an optional org-context property persisted
 * on the auth user record (mirrors `UserWithOrganizations.currentOrganizationId`). */
type UserWithOrgContext = User & { currentOrganizationId?: string };

const ORG_CONTEXT_CACHE_TTL_MS = 12 * 60 * 60 * 1000;

type CachedOrgContext = {
  currentOrganization: Organization | null;
  currentMember: OrganizationMember | null;
  cachedAt: number;
};

const orgContextCacheKey = (uid: string) => `revtube:org-context:${uid}`;

const readCachedOrgContext = (uid: string): CachedOrgContext | null => {
  try {
    const raw = localStorage.getItem(orgContextCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedOrgContext;
    if (!parsed || Date.now() - parsed.cachedAt > ORG_CONTEXT_CACHE_TTL_MS) return null;
    return parsed;
  } catch {
    return null;
  }
};

const writeCachedOrgContext = (uid: string, currentOrganization: Organization | null, currentMember: OrganizationMember | null) => {
  try {
    const payload: CachedOrgContext = {
      currentOrganization,
      currentMember,
      cachedAt: Date.now(),
    };
    localStorage.setItem(orgContextCacheKey(uid), JSON.stringify(payload));
  } catch {
    // ignore storage failures
  }
};

interface OrganizationContextType {
  // Current organization state
  currentOrganization: Organization | null;
  currentMember: OrganizationMember | null;
  organizations: Organization[];
  
  // Loading states
  loading: boolean;
  
  // Actions
  setCurrentOrganization: (orgId: string | null) => Promise<void>;
  refreshOrganizations: () => Promise<void>;
  
  // Computed permissions
  isOwner: boolean;
  isAdmin: boolean;
  canEdit: boolean;
  canInvite: boolean;
  canManageMembers: boolean;
  canAccessSettings: boolean;
  /** True when the user is a member of the current organization (any role). */
  canAccessOrganization: boolean;
  /** False for read-only members inside an org -- they cannot run/modify audits. */
  canRunAudits: boolean;
  
  // Context type
  isPersonalContext: boolean;
}

const OrganizationContext = createContext<OrganizationContextType | undefined>(undefined);

export const OrganizationProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const { user, initialData } = useAuth();
  const [currentOrganization, setCurrentOrganizationState] = useState<Organization | null>(null);
  const [currentMember, setCurrentMember] = useState<OrganizationMember | null>(null);
  const [organizations, setOrganizations] = useState<Organization[]>([]);
  const [loading, setLoading] = useState(true);
  /** Hydrate from initialData only once -- subsequent calls always fetch fresh data. */
  const hydratedFromInitial = useRef(false);

  // Load user's organizations
  const loadOrganizations = async () => {
    if (!user) {
      hydratedFromInitial.current = false;
      setOrganizations([]);
      setCurrentOrganizationState(null);
      setCurrentMember(null);
      setLoading(false);
      return;
    }

    try {
      // ── First-ever hydration: use initialData for instant render ──
      if (initialData && !hydratedFromInitial.current) {
        hydratedFromInitial.current = true;
        devLog('[OrgContext] Hydrating from initialData');
        const orgs = initialData.organizations || [];
        setOrganizations(orgs);

        const cachedOrgId = localStorage.getItem(`lastOrgContext_${user.uid}`);
        const currentOrgId = (user as UserWithOrgContext).currentOrganizationId || cachedOrgId;

        if (currentOrgId) {
          const currentOrg = orgs.find((org: Organization) => org.id === currentOrgId);
          if (currentOrg) {
            setCurrentOrganizationState(currentOrg);
            setCurrentMember(initialData.memberships[currentOrgId] || null);
            writeCachedOrgContext(user.uid, currentOrg, initialData.memberships[currentOrgId] || null);
          }
        }
        setLoading(false);
        return; // initialData is enough for the first pass
      }

      // ── Subsequent calls -- always fetch fresh data ──
      setLoading(true);

      const cached = readCachedOrgContext(user.uid);
      if (cached) {
        setCurrentOrganizationState(cached.currentOrganization);
        setCurrentMember(cached.currentMember);
      }

      const orgs = await getUserOrganizations(user.uid);
      setOrganizations(orgs);
      setLoading(false);

      const cachedOrgId = localStorage.getItem(`lastOrgContext_${user.uid}`);
      const currentOrgId = (user as UserWithOrgContext).currentOrganizationId || cachedOrgId;

      if (currentOrgId) {
        const currentOrg = orgs.find((org: Organization) => org.id === currentOrgId);
        if (currentOrg) {
          setCurrentOrganizationState(currentOrg);
          const member = await getOrganizationMember(currentOrgId, user.uid);
          setCurrentMember(member);
          localStorage.setItem(`lastOrgContext_${user.uid}`, currentOrgId);
          writeCachedOrgContext(user.uid, currentOrg, member);
        } else {
          await switchOrganization(user.uid, null);
          setCurrentOrganizationState(null);
          setCurrentMember(null);
          localStorage.removeItem(`lastOrgContext_${user.uid}`);
          writeCachedOrgContext(user.uid, null, null);
        }
      } else {
        setCurrentOrganizationState(null);
        setCurrentMember(null);
        writeCachedOrgContext(user.uid, null, null);
      }
    } catch (error) {
      console.error('Error loading organizations:', error);
      setLoading(false);
    }
  };

  // Load organizations on mount and when user changes
  useEffect(() => {
    loadOrganizations();
  }, [user?.uid, initialData]);

  // Switch organization context
  const setCurrentOrganization = async (orgId: string | null) => {
    if (!user) return;

    try {
      setLoading(true);
      await switchOrganization(user.uid, orgId);

      if (orgId) {
        let org = organizations.find(o => o.id === orgId);
        if (!org) {
          const freshOrgs = await getUserOrganizations(user.uid);
          org = freshOrgs.find(o => o.id === orgId);
          if (org) setOrganizations(freshOrgs);
        }
        setCurrentOrganizationState(org || null);
        
        if (org) {
          const member = await getOrganizationMember(orgId, user.uid);
          setCurrentMember(member);
          writeCachedOrgContext(user.uid, org, member);
        } else {
          writeCachedOrgContext(user.uid, null, null);
        }
        // Cache the selection
        localStorage.setItem(`lastOrgContext_${user.uid}`, orgId);
      } else {
        setCurrentOrganizationState(null);
        setCurrentMember(null);
        // Remove cache when switching to personal
        localStorage.removeItem(`lastOrgContext_${user.uid}`);
        writeCachedOrgContext(user.uid, null, null);
      }
    } catch (error) {
      console.error('Error switching organization:', error);
      throw error;
    } finally {
      setLoading(false);
    }
  };

  // Refresh organizations list
  const refreshOrganizations = async () => {
    await loadOrganizations();
  };

  // Computed permissions
  const isPersonalContext = !currentOrganization;
  const isOwner = currentMember?.role === 'owner';
  const isAdmin = currentMember?.role === 'admin';
  // In personal mode the user is the implicit owner of their own channel data.
  const canEdit = isPersonalContext || currentMember?.role === 'owner' || currentMember?.role === 'admin' || currentMember?.role === 'write';
  const canInvite = isOwner || isAdmin;
  const canManageMembers = isOwner || isAdmin;
  const canAccessSettings = canAccessOrganizationSettings(currentMember);
  const canAccessOrganization = !!currentMember;
  // Read-only members cannot run/modify audits inside an org; in personal mode
  // any user may run audits on their own connected channels.
  const canRunAudits = isPersonalContext || currentMember?.role !== 'read';

  const value: OrganizationContextType = {
    currentOrganization,
    currentMember,
    organizations,
    loading,
    setCurrentOrganization,
    refreshOrganizations,
    isOwner,
    isAdmin,
    canEdit,
    canInvite,
    canManageMembers,
    canAccessSettings,
    canAccessOrganization,
    canRunAudits,
    isPersonalContext
  };

  return (
    <OrganizationContext.Provider value={value}>
      {children}
    </OrganizationContext.Provider>
  );
};

export const useOrganization = () => {
  const context = useContext(OrganizationContext);
  if (context === undefined) {
    throw new Error('useOrganization must be used within an OrganizationProvider');
  }
  return context;
};
