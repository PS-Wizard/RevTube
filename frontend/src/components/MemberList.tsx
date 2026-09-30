import React, { useState, useRef, useEffect } from 'react';
import type { OrganizationMember, OrganizationRole } from '../types/organization';
import { EmptyState } from './EmptyState';
import { Button } from './ui';
import './MemberList.css';

interface MemberListProps {
  members: OrganizationMember[];
  currentUserId?: string;
  canManageMembers: boolean;
  isOwner: boolean;
  onRoleChange: (userId: string, newRole: Exclude<OrganizationRole, 'owner'>) => void;
  onRemoveMember: (userId: string) => void;
}

const MemberList: React.FC<MemberListProps> = ({
  members,
  currentUserId,
  canManageMembers,
  isOwner,
  onRoleChange,
  onRemoveMember
}) => {
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const formatJoinDate = (timestamp: number) => {
    return new Date(timestamp).toLocaleDateString('en-US', {
      year: 'numeric',
      month: 'short',
      day: 'numeric'
    });
  };

  const getRoleBadgeClass = (role: string) => {
    switch (role) {
      case 'owner': return 'member-role-badge member-role-badge--owner';
      case 'admin': return 'member-role-badge member-role-badge--admin';
      case 'write': return 'member-role-badge member-role-badge--write';
      case 'read': return 'member-role-badge member-role-badge--read';
      default: return 'member-role-badge';
    }
  };

  const getRoleDisplayName = (role: OrganizationRole) => {
    switch (role) {
      case 'owner': return 'Owner';
      case 'admin': return 'Admin';
      case 'write': return 'Write';
      case 'read': return 'Read';
      default: return role;
    }
  };

  const handleRoleChange = (member: OrganizationMember, newRole: string) => {
    const typedNewRole = newRole as Exclude<OrganizationRole, 'owner'>;
    if (typedNewRole === member.role) return;
    onRoleChange(member.userId, typedNewRole);
  };

  if (members.length === 0) {
    return (
      <EmptyState
        variant="zero"
        title="No Members Found"
        description="No members have been added to this organization yet."
      />
    );
  }

  return (
    <div className="member-list">
      {members.map((member) => {
        const canEditMember = canManageMembers && 

          member.role !== 'owner' && 
          member.userId !== currentUserId &&
          (isOwner || member.role !== 'admin');
          
        const canRemoveMember = canManageMembers && 
          member.role !== 'owner' && 
          member.userId !== currentUserId;

        return (
          <div key={member.userId} className="member-item">
            <div className="member-item__avatar">
              <div className="member-avatar">
                {member.email.charAt(0).toUpperCase()}
              </div>
            </div>

            <div className="member-item__info">
              <div className="member-item__name">
                {member.email}
                {member.userId === currentUserId && (
                  <span className="member-item__you">You</span>
                )}
              </div>
              <div className="member-item__meta">
                Joined {formatJoinDate(member.joinedAt)}
              </div>
            </div>

            <div className="member-item__role">
              {canEditMember ? (
                <select
                  value={member.role}
                  onChange={(e) => handleRoleChange(member, e.target.value)}
                  className="member-role-select"
                >
                  {isOwner && <option value="admin">Admin</option>}
                  <option value="write">Write</option>
                  <option value="read">Read</option>
                </select>
              ) : (
                <span className={getRoleBadgeClass(member.role)}>
                  {getRoleDisplayName(member.role)}
                </span>
              )}
            </div>

            <div className="member-item__actions">
              {canRemoveMember ? (
                <div className="member-kebab-container" ref={openMenuId === member.userId ? menuRef : null}>
                  <Button
                    bare
                    className={`member-kebab-btn ${openMenuId === member.userId ? 'member-kebab-btn--active' : ''}`}
                    onClick={(e) => {
                      e.stopPropagation();
                      setOpenMenuId(openMenuId === member.userId ? null : member.userId);
                    }}
                    aria-label="Member options"
                  >
                    <svg viewBox="0 0 16 16" fill="currentColor" width="16" height="16">
                      <path d="M8 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3ZM1.5 9a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm13 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z"/>
                    </svg>
                  </Button>
                  {openMenuId === member.userId && (
                    <div className="member-kebab-menu">
                      <Button variant="danger"
                        bare
                       
                        onClick={() => {
                          onRemoveMember(member.userId);
                          setOpenMenuId(null);
                        }}
                      >
                        <svg viewBox="0 0 16 16" fill="currentColor" width="14" height="14">
                          <path d="M3.72 3.72a.75.75 0 0 1 1.06 0L8 6.94l3.22-3.22a.75.75 0 1 1 1.06 1.06L9.06 8l3.22 3.22a.75.75 0 1 1-1.06 1.06L8 9.06l-3.22 3.22a.75.75 0 0 1-1.06-1.06L6.94 8 3.72 4.78a.75.75 0 0 1 0-1.06Z" />
                        </svg>
                        Remove from organization
                      </Button>
                    </div>
                  )}
                </div>
              ) : (
                <div style={{ width: 28 }} /> /* Maintain spacing */
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default MemberList;