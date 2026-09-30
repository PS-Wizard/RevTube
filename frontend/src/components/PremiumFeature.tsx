import React, { type ReactNode } from 'react';
import { useAuth } from '../hooks/useAuth';
import { TUBEKETER_SITE_URL } from '../constants/productUrls';
import './PremiumFeature.css';

interface PremiumFeatureProps {
  children: ReactNode;
  fallbackMessage?: string;
}

export const PremiumFeature: React.FC<PremiumFeatureProps> = ({ 
  children, 
  fallbackMessage = "This feature requires a Pro subscription." 
}) => {
  const { userPackage } = useAuth();

  if (userPackage === 'pro') {
    return <>{children}</>;
  }

  return (
    <div className="premium-lock-container">
      <div className="premium-lock-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
        </svg>
      </div>
      <h3 className="premium-lock-title">Premium Feature</h3>
      <p className="premium-lock-message">{fallbackMessage}</p>
      <a href={TUBEKETER_SITE_URL} target="_blank" rel="noopener noreferrer" className="premium-upgrade-btn">
        Upgrade to Pro
      </a>
    </div>
  );
};
