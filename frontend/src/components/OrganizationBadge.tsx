import React from 'react';
import { useOrganization } from '../hooks/useOrganization';
import './OrganizationBadge.css';

interface OrganizationBadgeProps {
  className?: string;
  showIcon?: boolean;
}

const OrganizationBadge: React.FC<OrganizationBadgeProps> = ({ 
  className = '', 
  showIcon = true 
}) => {
  const { currentOrganization, isPersonalContext, loading } = useOrganization();

  if (loading) {
    return (
      <div className={`organization-badge organization-badge--loading ${className}`}>
        <div className="organization-badge__skeleton"></div>
      </div>
    );
  }

  const displayName = isPersonalContext ? 'Personal' : currentOrganization?.name || 'Personal';
  const badgeClass = isPersonalContext ? 'organization-badge--personal' : 'organization-badge--organization';

  return (
    <div className={`organization-badge ${badgeClass} ${className}`}>
      {showIcon && (
        <div className="organization-badge__icon">
          {isPersonalContext ? (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M8 8a3 3 0 100-6 3 3 0 000 6zM12.735 14c.618 0 1.093-.561.872-1.139a6.002 6.002 0 00-11.215 0c-.22.578.254 1.139.872 1.139h9.47z" />
            </svg>
          ) : (
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
              <path d="M1.75 2h12.5c.966 0 1.75.784 1.75 1.75v8.5A1.75 1.75 0 0114.25 14H1.75A1.75 1.75 0 010 12.25v-8.5C0 2.784.784 2 1.75 2zm-.25 1.75v8.5c0 .138.112.25.25.25h12.5a.25.25 0 00.25-.25v-8.5a.25.25 0 00-.25-.25H1.75a.25.25 0 00-.25.25z" />
              <path d="M8 4a.75.75 0 01.75.75v3.5h3.5a.75.75 0 010 1.5h-3.5v3.5a.75.75 0 01-1.5 0v-3.5h-3.5a.75.75 0 010-1.5h3.5v-3.5A.75.75 0 018 4z" />
            </svg>
          )}
        </div>
      )}
      <span className="organization-badge__text">{displayName}</span>
    </div>
  );
};

export default OrganizationBadge;