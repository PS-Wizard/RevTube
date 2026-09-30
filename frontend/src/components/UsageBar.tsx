import React, { useState } from 'react';
import { Link } from 'react-router-dom';
import { Button, Tooltip } from './ui';
import { Modal } from './ui/Modal';
import { HelpCircle, Activity, Layers, Zap, Calendar } from 'lucide-react';
import './UsageBar.css';

interface UsageBarProps {
  label: string;
  used: number;
  limit: number;
}

export const UsageBar: React.FC<UsageBarProps> = ({ label, used, limit }) => {
  const [quotaDialogOpen, setQuotaDialogOpen] = useState(false);
  const isUnlimited = limit === -1;
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  const remaining = isUnlimited ? Infinity : Math.max(0, limit - used);
  const isNearLimit = !isUnlimited && pct >= 80;
  const isAtLimit = !isUnlimited && used >= limit;

  const barClass = isAtLimit
    ? 'usage-bar-fill danger'
    : isNearLimit
      ? 'usage-bar-fill warning'
      : 'usage-bar-fill ok';

  return (
    <>
      <div className="usage-bar">
        <div className="usage-bar-header">
          <div className="usage-bar-title-group">
            <span className="usage-bar-label">{label}</span>
            <Tooltip
              title={
                isUnlimited
                  ? "Unlimited quota · How quota is calculated"
                  : `${remaining.toLocaleString()} request${remaining !== 1 ? 's' : ''} for ${label} left this month · Click for details`
              }
              arrow
              placement="top"
            >
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setQuotaDialogOpen(true)}
                aria-label="Explain Quota System"
              >
                <HelpCircle size={13} />
              </Button>
            </Tooltip>
          </div>
          <span className={`usage-bar-count${isAtLimit ? ' danger' : isNearLimit ? ' warning' : ''}`}>
            {isUnlimited ? 'Unlimited' : `${used.toLocaleString()} / ${limit.toLocaleString()}`}
          </span>
        </div>
        {!isUnlimited && (
          <div className="usage-bar-track" role="progressbar" aria-valuenow={used} aria-valuemin={0} aria-valuemax={limit} aria-label={`${label} usage`}>
            <div className={barClass} style={{ width: `${pct}%` }} />
          </div>
        )}
        {isAtLimit && (
          <div className="usage-bar-footer">
            <span className="usage-bar-hint danger">Limit reached · resets on the 1st</span>
          </div>
        )}
        {!isUnlimited && isAtLimit && (
          <Link to="/profile" className="usage-bar-upgrade">
            ↑ Upgrade to Pro
          </Link>
        )}
      </div>

      {/* Quota Explanation Dialog */}
      <Modal
        open={quotaDialogOpen}
        onClose={() => setQuotaDialogOpen(false)}
        title="RevTube Quota & API Usage System"
        icon={<Activity size={20} style={{ color: 'var(--rt-color-accent)' }} />}
        guide
        secondaryAction={{
          label: 'Got It',
          onClick: () => setQuotaDialogOpen(false),
        }}
      >
        <div className="quota-dialog-content">
          {/* Current Quota Status Banner */}
          <div className="quota-status-card">
            <div className="quota-status-card__header">
              <div className="quota-status-card__title">
                <Activity size={18} style={{ color: 'var(--rt-color-accent)' }} />
                <span>{label} Quota Status</span>
              </div>
              <span
                className={`quota-status-card__badge ${
                  isAtLimit ? 'danger' : isNearLimit ? 'warning' : 'ok'
                }`}
              >
                {isUnlimited ? 'Unlimited' : `${remaining.toLocaleString()} left this month`}
              </span>
            </div>
            <div className="quota-status-card__desc">
              {isUnlimited
                ? `You have unlimited monthly requests for ${label}.`
                : `You have ${remaining.toLocaleString()} request${remaining !== 1 ? 's' : ''} for ${label} remaining this month (${used.toLocaleString()} of ${limit.toLocaleString()} used). Resets automatically on the 1st of every month.`}
            </div>
            {!isUnlimited && (
              <div className="usage-bar-track" style={{ height: 8, marginTop: 4, borderRadius: 4 }}>
                <div className={barClass} style={{ width: `${pct}%`, borderRadius: 4 }} />
              </div>
            )}
          </div>

          {/* 4 Explanation Boxes - 2-column grid */}
          <div className="quota-grid">
            {/* Box 1: Request-Based Counting */}
            <div className="quota-info-card">
              <div className="quota-info-card__title" style={{ color: 'var(--rt-color-accent)' }}>
                <Zap size={18} />
                <span>1 API Request = 1 Quota Unit</span>
              </div>
              <div className="quota-info-card__desc">
                Quota is counted <strong>per request call that goes to the server</strong>. Whenever you switch tabs, load channel analytics, search specific videos, run comparisons, or analyze thumbnails, each distinct backend request deducts 1 unit from your monthly feature limit.
              </div>
            </div>

            {/* Box 2: Quota Buckets & Pools */}
            <div className="quota-info-card">
              <div className="quota-info-card__title">
                <Layers size={18} style={{ color: 'var(--rt-color-accent)' }} />
                <span>Quota Scope &amp; Feature Pools</span>
              </div>
              <div className="quota-info-card__desc">
                <ul className="quota-info-card__list">
                  <li>
                    <strong>Channel Analytics Pool:</strong> Shared across Dashboard Overview, Playlists tab, Videos tab, and Insights.
                  </li>
                  <li>
                    <strong>Compare Channels:</strong> Tracks each channel comparison batch request separately.
                  </li>
                  <li>
                    <strong>Thumbnail Optimizer:</strong> Counts per batch thumbnail AI visual audit request.
                  </li>
                </ul>
              </div>
            </div>

            {/* Box 3: Caching & Deduplication */}
            <div className="quota-info-card">
              <div className="quota-info-card__title">
                <Activity size={18} style={{ color: 'var(--rt-color-success)' }} />
                <span>Browser Caching &amp; Backend Counting</span>
              </div>
              <div className="quota-info-card__desc">
                Only requests prevented by local browser caching consume 0 quota units. <strong>Every request call sent to the backend server is counted against your feature quota.</strong>
              </div>
            </div>

            {/* Box 4: Reset Schedule */}
            <div className="quota-info-card">
              <div className="quota-info-card__title">
                <Calendar size={18} style={{ color: 'var(--rt-color-warning)' }} />
                <span>Monthly Reset &amp; Tier Limits</span>
              </div>
              <div className="quota-info-card__desc">
                All quotas reset automatically on the <strong>1st day of every calendar month</strong> at 00:00 UTC. Free, Pro, and Organization tiers have configured quota allocations that reset monthly, and administrative rate limits or quota caps may be enforced across any tier.
              </div>
            </div>
          </div>
        </div>
      </Modal>
    </>
  );
};

