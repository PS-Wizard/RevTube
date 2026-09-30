import React from 'react';
import { CheckCircle2, SearchX, AlertCircle } from 'lucide-react';
import './EmptyState.css';

interface EmptyStateProps {
  /** Override the default icon for this variant */
  icon?: React.ReactNode;
  title: string;
  description: string;
  /** Optional CTA button / link rendered below the description */
  action?: React.ReactNode;
  /** Controls icon wrap colour and default icon. Default: 'zero' */
  variant?: 'zero' | 'no-results' | 'error';
}

/** Default icons per variant — mirrors opt-empty-card's CheckCircle2 for zero */
function DefaultIcon({ variant }: { variant: NonNullable<EmptyStateProps['variant']> }) {
  if (variant === 'no-results') return <SearchX size={28} aria-hidden />;
  if (variant === 'error') return <AlertCircle size={28} aria-hidden />;
  return <CheckCircle2 size={28} aria-hidden />;
}

export const EmptyState: React.FC<EmptyStateProps> = ({
  icon,
  title,
  description,
  action,
  variant = 'zero',
}) => (
  <div className={`empty-state empty-state--${variant}`}>
    <div className="empty-state-icon-wrap">
      {icon ?? <DefaultIcon variant={variant} />}
    </div>
    <h3 className="empty-state-title">{title}</h3>
    <p className="empty-state-description">{description}</p>
    {action && <div className="empty-state-action">{action}</div>}
  </div>
);
