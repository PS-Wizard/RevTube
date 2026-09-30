import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOrganization } from '../hooks/useOrganization';
import { useAuth } from '../hooks/useAuth';
import CreateOrganizationModal from './CreateOrganizationModal';
import { Button } from './ui';
import './OrganizationSwitcher.css';

interface OrganizationSwitcherProps {
  className?: string;
}

const OrganizationSwitcher: React.FC<OrganizationSwitcherProps> = ({ className }) => {
  const { user, userPackage, role } = useAuth();
  const {
    currentOrganization,
    organizations,
    loading,
    setCurrentOrganization,
    isPersonalContext
  } = useOrganization();

  const [isOpen, setIsOpen] = useState(false);
  const [showCreateModal, setShowCreateModal] = useState(false);
  const navigate = useNavigate();

  if (!user || loading) {
    return (
      <div className={`organization-switcher ${className || ''}`}>
        <div className="organization-switcher__current">
          <div className="organization-switcher__skeleton"></div>
        </div>
      </div>
    );
  }

  const handleSelect = async (orgId: string | null) => {
    try {
      await setCurrentOrganization(orgId);
      setIsOpen(false);
      window.location.reload();
    } catch (error) {
      console.error('Error switching organization:', error);
    }
  };

  const handleCreateOrganization = () => {
    setShowCreateModal(true);
    setIsOpen(false);
  };

  const handleCreateSuccess = (orgId: string) => {
    // Auto-select the newly created org, then close the dropdown
    setCurrentOrganization(orgId).then(() => setIsOpen(false));
  };

  const handleManageOrganization = () => {
    setIsOpen(false);
    navigate('/organization');
  };

  const currentName = currentOrganization?.name || 'Personal';
  return (
    <>
      <div className={`organization-switcher ${className || ''}`}>
        <Button
          bare
          className="organization-switcher__toggle"
          onClick={() => setIsOpen(!isOpen)}
          aria-label="Switch organization"
        >
          <span className="organization-switcher__current-name">
            {currentName}
          </span>
          <svg
            className={`organization-switcher__chevron ${isOpen ? 'open' : ''}`}
            width="16"
            height="16"
            viewBox="0 0 16 16"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
          >
            <path d="M4 6l4 4 4-4" />
          </svg>
        </Button>

        {isOpen && (
          <div className="organization-switcher__dropdown">
            <div className="organization-switcher__dropdown-header">
              <span className="organization-switcher__dropdown-title">Workspace</span>
            </div>

            <div className="organization-switcher__options">
              {/* Personal option */}
              <Button
                bare
                className={`organization-switcher__option ${isPersonalContext ? 'selected' : ''}`}
                onClick={() => handleSelect(null)}
              >
                <div className="organization-switcher__option-content">
                  <span className="organization-switcher__option-name">Personal</span>
                  <span className="organization-switcher__option-description">
                    Your personal workspace
                  </span>
                </div>
                {isPersonalContext && (
                  <svg
                    className="organization-switcher__check"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                  </svg>
                )}
              </Button>

              {/* Organization options */}
              {organizations.map((org) => (
                <Button
                  bare
                  key={org.id}
                  className={`organization-switcher__option ${currentOrganization?.id === org.id ? 'selected' : ''}`}
                  onClick={() => handleSelect(org.id)}
                >
                  <div className="organization-switcher__option-content">
                    <span className="organization-switcher__option-name">{org.name}</span>
                    <span className="organization-switcher__option-description">
                      {org.plan === 'pro' ? 'PRO Team' : 'Team workspace'}
                    </span>
                  </div>
                  {currentOrganization?.id === org.id && (
                    <svg
                      className="organization-switcher__check"
                      width="16"
                      height="16"
                      viewBox="0 0 16 16"
                      fill="currentColor"
                    >
                      <path d="M13.78 4.22a.75.75 0 010 1.06l-7.25 7.25a.75.75 0 01-1.06 0L2.22 9.28a.75.75 0 011.06-1.06L6 10.94l6.72-6.72a.75.75 0 011.06 0z" />
                    </svg>
                  )}
                </Button>
              ))}

              {/* Create organization option (PRO or admin only) */}
              {(userPackage === 'pro' || role === 'admin') && (
                <Button variant="primary"
                  bare
                 
                  onClick={handleCreateOrganization}
                >
                  <svg
                    className="organization-switcher__create-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 2a.75.75 0 01.75.75v4.5h4.5a.75.75 0 010 1.5h-4.5v4.5a.75.75 0 01-1.5 0v-4.5h-4.5a.75.75 0 010-1.5h4.5v-4.5A.75.75 0 018 2z" />
                  </svg>
                  <span>Create Organization</span>
                </Button>
              )}

              {/* Manage organization option (when in org context) */}
              {!isPersonalContext && currentOrganization && (
                <Button variant="secondary"
                  bare
                 
                  onClick={handleManageOrganization}
                >
                  <svg
                    className="organization-switcher__manage-icon"
                    width="16"
                    height="16"
                    viewBox="0 0 16 16"
                    fill="currentColor"
                  >
                    <path d="M8 9.5a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM1.5 8a1.5 1.5 0 100-3 1.5 1.5 0 000 3zM14.5 8a1.5 1.5 0 100-3 1.5 1.5 0 000 3z" />
                  </svg>
                  <span>Manage Organization</span>
                </Button>
              )}
            </div>

            {userPackage !== 'pro' && role !== 'admin' && organizations.length === 0 && (
              <div className="organization-switcher__upgrade">
                <span className="organization-switcher__upgrade-text">
                  Upgrade to PRO to create teams
                </span>
              </div>
            )}
          </div>
        )}
      </div>

      <CreateOrganizationModal
        isOpen={showCreateModal}
        onClose={() => setShowCreateModal(false)}
        onSuccess={handleCreateSuccess}
      />
    </>
  );
};
export default OrganizationSwitcher;