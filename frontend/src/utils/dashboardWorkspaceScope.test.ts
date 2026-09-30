import { describe, expect, it } from 'vitest';
import { getDashboardWorkspaceKey } from './dashboardWorkspaceScope';

describe('getDashboardWorkspaceKey', () => {
  it('returns null without a user id', () => {
    expect(getDashboardWorkspaceKey({ userId: undefined, isPersonalContext: true, organizationId: undefined })).toBeNull();
  });

  it('scopes a personal context by user', () => {
    expect(getDashboardWorkspaceKey({ userId: 'u1', isPersonalContext: true, organizationId: undefined })).toBe('personal:u1');
  });

  it('scopes an org context by organization id', () => {
    expect(getDashboardWorkspaceKey({ userId: 'u1', isPersonalContext: false, organizationId: 'orgA' })).toBe('org:orgA');
  });

  it('scopes an org context without an id to none', () => {
    expect(getDashboardWorkspaceKey({ userId: 'u1', isPersonalContext: false, organizationId: undefined })).toBe('org:none');
  });

  it('distinguishes personal from org contexts for the same user/org', () => {
    const personal = getDashboardWorkspaceKey({ userId: 'u1', isPersonalContext: true, organizationId: 'orgA' });
    const org = getDashboardWorkspaceKey({ userId: 'u1', isPersonalContext: false, organizationId: 'orgA' });
    expect(personal).not.toBe(org);
  });
});
