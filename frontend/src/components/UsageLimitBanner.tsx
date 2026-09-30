import React from 'react';
import { Link } from 'react-router-dom';
import './UsageLimitBanner.css';

interface UsageLimitBannerProps {
  limit: number;
  used: number;
  message: string;
  /** Page label to show in the heading, e.g. "Videos", "Channel" */
  pageLabel?: string;
  /** When true, the feature is premium-only and the user doesn't have access at all */
  isPremiumOnly?: boolean;
}

export const UsageLimitBanner: React.FC<UsageLimitBannerProps> = ({
  limit,
  used,
  message,
  pageLabel,
  isPremiumOnly = false,
}) => {
  const percentUsed = limit > 0 ? Math.min(100, (used / limit) * 100) : 100;
  const remaining = Math.max(0, limit - used);
  const isAtLimit = used >= limit;
  const isNearLimit = !isAtLimit && percentUsed >= 80;

  const variant = isPremiumOnly ? 'premium' : isAtLimit ? 'danger' : 'warning';

  const heading = isPremiumOnly
    ? `${pageLabel ?? 'This feature'} requires Pro`
    : isAtLimit
      ? `Monthly ${pageLabel ?? 'search'} limit reached`
      : `Approaching your ${pageLabel ?? 'search'} limit`;

  const hint = isPremiumOnly
    ? message || `Upgrade to Pro to unlock ${pageLabel ?? 'this feature'}.`
    : isAtLimit
      ? message || `You've used all ${limit} ${pageLabel?.toLowerCase() ?? 'search'} requests for this month. Resets on the 1st.`
      : `${remaining} of ${limit} ${pageLabel?.toLowerCase() ?? 'search'} requests remaining this month.`;

  return (
    <div className={`usage-limit-banner usage-limit-banner--${variant}`} role="alert">
      <div className="usage-limit-icon" aria-hidden>
        {isPremiumOnly ? (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M11.049 2.927c.3-.921 1.603-.921 1.902 0l1.519 4.674a1 1 0 00.95.69h4.915c.969 0 1.371 1.24.588 1.81l-3.976 2.888a1 1 0 00-.363 1.118l1.518 4.674c.3.922-.755 1.688-1.538 1.118l-3.976-2.888a1 1 0 00-1.176 0l-3.976 2.888c-.783.57-1.838-.197-1.538-1.118l1.518-4.674a1 1 0 00-.363-1.118l-3.976-2.888c-.784-.57-.38-1.81.588-1.81h4.914a1 1 0 00.951-.69l1.519-4.674z" />
          </svg>
        ) : (
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          </svg>
        )}
      </div>
      <div className="usage-limit-content">
        <h4>{heading}</h4>
        <p>{hint}</p>
        {!isPremiumOnly && limit > 0 && (
          <>
            <div className="usage-progress-bar" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit}>
              <div className={`usage-progress-fill usage-progress-fill--${variant}`} style={{ width: `${percentUsed}%` }} />
            </div>
            <p className="usage-stats">
              <strong>{used}</strong> / {limit} used this month
              {isNearLimit && !isAtLimit && (
                <span className="usage-stats-warning"> · resets on the 1st</span>
              )}
            </p>
          </>
        )}
      </div>
      <Link to="/profile" className={`usage-limit-upgrade-btn usage-limit-upgrade-btn--${variant}`}>
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" style={{ width: 13, height: 13 }}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 10l7-7m0 0l7 7m-7-7v18" />
        </svg>
        Upgrade to Pro
      </Link>
    </div>
  );
};
