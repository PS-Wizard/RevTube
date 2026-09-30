import React from 'react';
import { Skeleton } from './Skeleton';
import { Stack } from './ui';
import { ChannelInsightGridSkeleton } from './dashboard/ChannelAnalyticsInsights';
import './SkeletonLoaders.css';

interface SkeletonStatCardProps {
  count?: number;
}

export const SkeletonStatCard: React.FC<SkeletonStatCardProps> = ({ count = 1 }) => (
  <div className="skeleton-stat-grid" style={{ '--grid-count': count } as React.CSSProperties}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-stat-card">
        <Skeleton type="text" width="40%" height="0.75rem" />
        <Skeleton type="title" width="100%" height="2rem" style={{ marginTop: '0.5rem', marginBottom: 0 }} />
        <Skeleton type="text" width="60%" height="0.6rem" style={{ marginTop: '0.5rem' }} />
      </div>
    ))}
  </div>
);

interface SkeletonChartProps {
  height?: number;
}

export const SkeletonChart: React.FC<SkeletonChartProps> = ({ height = 300 }) => (
  <div className="skeleton-chart">
    <Skeleton type="text" width="30%" height="1rem" style={{ marginBottom: '1rem' }} />
    <Skeleton width="100%" height={height} style={{ borderRadius: '8px' }} />
  </div>
);

const PILL_CLASSES = ['pill-views', 'pill-watchTime', 'pill-retention', 'pill-ctr'] as const;

/**
 * Same DOM shell as loaded `seo-widget-pills` + `seo-metric-pill` rows (Video / Playlist analytics).
 */
export const SkeletonSeoMetricPills: React.FC<{ count?: 3 | 4 }> = ({ count = 3 }) => (
  <div className="seo-widget-pills seo-widget-pills--skeleton" aria-busy="true" aria-label="Loading video metrics">
    {Array.from({ length: count }).map((_, i) => {
      const pillClass = PILL_CLASSES[i];
      const isSelected = i === 2;
      return (
        <div
          key={i}
          className={`seo-metric-pill ${pillClass}${isSelected ? ' selected' : ''}`}
        >
          {i === 3 ? (
            <span className="seo-pill-title">
              <Skeleton type="text" width={32} height="0.75rem" style={{ marginBottom: 0 }} />
            </span>
          ) : (
            <span className="seo-pill-title">
              <Skeleton
                type="text"
                width={i === 0 ? 72 : i === 1 ? 108 : 92}
                height="0.75rem"
                style={{ marginBottom: 0 }}
              />
              <Skeleton type="text" width={52} height="0.65rem" style={{ borderRadius: 4 }} />
            </span>
          )}
          {i === 0 ? (
            <div className="seo-pill-body">
              <Skeleton
                type="title"
                width="42%"
                height="1.5rem"
                style={{ marginBottom: '0.375rem', marginTop: 0 }}
              />
              <span className="seo-pill-deltas" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {[0, 1, 2].map((j) => (
                  <Skeleton key={j} type="text" width={58} height="0.75rem" style={{ borderRadius: 4 }} />
                ))}
              </span>
            </div>
          ) : i === 3 ? (
            <>
              <Skeleton type="title" width="22%" height="1.5rem" style={{ marginBottom: '0.375rem' }} />
              <Skeleton type="text" width={32} height="0.75rem" style={{ borderRadius: 4 }} />
            </>
          ) : (
            <>
              <Skeleton
                type="title"
                width="36%"
                height="1.5rem"
                style={{ marginBottom: '0.375rem' }}
              />
              <span className="seo-pill-deltas" style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem' }}>
                {[0, 1, 2].map((j) => (
                  <Skeleton key={j} type="text" width={58} height="0.75rem" style={{ borderRadius: 4 }} />
                ))}
              </span>
            </>
          )}
        </div>
      );
    })}
  </div>
);

/** Fills `chart-wrapper` like Recharts (400px); no extra title bar -- matches `seo-widget-chart`. */
export const SkeletonSeoChart: React.FC<{ height?: number }> = ({ height = 400 }) => (
  <div
    className="seo-chart-skeleton"
    style={{ minHeight: height, height }}
    aria-hidden
  />
);

interface SkeletonTableProps {
  columns?: number;
  rows?: number;
}

export const SkeletonTable: React.FC<SkeletonTableProps> = ({ columns = 5, rows = 5 }) => (
  <div className="skeleton-table">
    {/* Header */}
    <div className="skeleton-table-header">
      {Array.from({ length: columns }).map((_, i) => (
        <div key={i} className="skeleton-table-cell">
          <Skeleton type="text" width="80%" />
        </div>
      ))}
    </div>
    {/* Rows */}
    {Array.from({ length: rows }).map((_, rowIdx) => (
      <div key={rowIdx} className="skeleton-table-row">
        {Array.from({ length: columns }).map((_, colIdx) => (
          <div key={colIdx} className="skeleton-table-cell">
            <Skeleton 
              type="text" 
              width={colIdx === 0 ? '90%' : `${60 + Math.random() * 40}%`}
            />
          </div>
        ))}
      </div>
    ))}
  </div>
);

interface SkeletonListProps {
  items?: number;
}

export const SkeletonList: React.FC<SkeletonListProps> = ({ items = 5 }) => (
  <div className="skeleton-list">
    {Array.from({ length: items }).map((_, i) => (
      <div key={i} className="skeleton-list-item">
        <Skeleton type="avatar" />
        <div className="skeleton-list-item-content">
          <Skeleton type="text" width="60%" />
          <Skeleton type="text" width="40%" style={{ marginTop: '0.5rem' }} />
        </div>
      </div>
    ))}
  </div>
);

interface SkeletonCardGridProps {
  columns?: number;
  count?: number;
}

export const SkeletonCardGrid: React.FC<SkeletonCardGridProps> = ({ columns = 3, count = 6 }) => (
  <div className="skeleton-card-grid" style={{ '--grid-columns': columns } as React.CSSProperties}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-card-item">
        <Skeleton type="card" style={{ height: '200px', marginBottom: '1rem' }} />
        <Skeleton type="text" width="80%" />
        <Skeleton type="text" width="60%" style={{ marginTop: '0.5rem' }} />
      </div>
    ))}
  </div>
);

interface SkeletonDimensionsPanelProps {
  count?: number;
}

export const SkeletonDimensionsPanel: React.FC<SkeletonDimensionsPanelProps> = ({ count = 2 }) => (
  <div className="skeleton-dimensions-grid" style={{ '--dim-count': count } as React.CSSProperties}>
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-dimension-card">
        <div className="skeleton-dimension-header">
          <Skeleton type="avatar" style={{ width: '20px', height: '20px', borderRadius: '4px' }} />
          <Skeleton type="text" width="50%" style={{ marginLeft: '0.75rem' }} />
        </div>
        <div className="skeleton-dimension-chart" style={{ marginTop: '1rem' }}>
          {Array.from({ length: 4 }).map((_, barIdx) => (
            <div key={barIdx} style={{ marginBottom: '0.75rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '0.25rem' }}>
                <Skeleton type="text" width="40%" />
                <Skeleton type="text" width="15%" />
              </div>
              <Skeleton width="100%" height="24px" style={{ borderRadius: '4px' }} />
            </div>
          ))}
        </div>
      </div>
    ))}
  </div>
);

interface SkeletonVideoTableProps {
  rows?: number;
}

export const SkeletonVideoTable: React.FC<SkeletonVideoTableProps> = ({ rows = 8 }) => (
  <div className="skeleton-video-table">
    <div className="skeleton-table-header">
      {Array.from({ length: 6 }).map((_, i) => (
        <div key={i} className="skeleton-table-cell">
          <Skeleton type="text" width="80%" />
        </div>
      ))}
    </div>
    {Array.from({ length: rows }).map((_, rowIdx) => (
      <div key={rowIdx} className="skeleton-table-row">
        {/* Checkbox */}
        <div className="skeleton-table-cell">
          <Skeleton type="avatar" style={{ width: '18px', height: '18px', borderRadius: '2px' }} />
        </div>
        {/* Thumbnail + Title */}
        <div className="skeleton-table-cell">
          <div style={{ display: 'flex', gap: '0.75rem', alignItems: 'center' }}>
            <Skeleton style={{ width: '48px', height: '27px', borderRadius: '4px', flexShrink: 0 }} />
            <Skeleton type="text" width="70%" />
          </div>
        </div>
        {/* Channel */}
        <div className="skeleton-table-cell">
          <Skeleton type="text" width="60%" />
        </div>
        {/* Views */}
        <div className="skeleton-table-cell">
          <Skeleton type="text" width="50%" />
        </div>
        {/* Date */}
        <div className="skeleton-table-cell">
          <Skeleton type="text" width="70%" />
        </div>
        {/* Duration */}
        <div className="skeleton-table-cell">
          <Skeleton type="text" width="40%" />
        </div>
      </div>
    ))}
  </div>
);

/** Mirrors DashboardPage layout: sticky header row, analytics tabs (Playlist first), timeframe pill, widgets. */
export const SkeletonDashboardShell: React.FC = () => (
  <div className="page-container skeleton-dashboard-shell" aria-busy="true" aria-label="Loading dashboard">
    <header className="dashboard-header-container">
      <div className="dashboard-header-row dashboard-header-row--context">
        <div className="dashboard-header-context">
          <div className="channel-selector-container">
            <div className="skeleton-dashboard-channel">
              <Skeleton type="avatar" style={{ width: 40, height: 40, borderRadius: 8, flexShrink: 0 }} />
              <div className="skeleton-dashboard-channel-text">
                <Skeleton type="text" width="72%" height="0.85rem" />
                <Skeleton type="text" width="48%" height="0.7rem" style={{ marginTop: 8 }} />
              </div>
              <Skeleton type="text" width={18} height={18} style={{ borderRadius: 4, marginLeft: 'auto', flexShrink: 0 }} />
            </div>
          </div>
        </div>

        <div className="dashboard-header-period">
          <div className="seo-period-pill unified-timeframe-pill skeleton-dashboard-timeframe" aria-hidden>
            <div className="seo-shortcuts-group">
              {['7d', '30d', '90d'].map((d) => (
                <Skeleton key={d} type="text" width={36} height={28} style={{ borderRadius: 17 }} />
              ))}
            </div>
            <div className="seo-toolbar-separator" />
            <Skeleton type="text" width={148} height={30} style={{ borderRadius: 8 }} />
          </div>
        </div>
      </div>

      <nav className="dashboard-header-row dashboard-header-row--tabs analytics-tabs skeleton-dashboard-tabs" aria-hidden>
        {['Channel', 'Playlists', 'Videos', 'Audience'].map((label, i) => (
          <div
            key={label}
            className={`skeleton-dashboard-tab-pill${i === 0 ? ' skeleton-dashboard-tab-pill--active' : ''}`}
          >
            <Skeleton type="text" width={`${Math.min(label.length * 9, 72)}px`} height="0.8125rem" />
          </div>
        ))}
      </nav>
    </header>

    <Stack gap={2} style={{ overflowX: 'hidden' }}>
      <div className="seo-widget skeleton-dashboard-channel-widget">
        <div className="seo-widget-header">
          <div className="seo-widget-title-area">
            <Skeleton type="title" width={168} height={20} style={{ borderRadius: 4, margin: 0 }} />
            <div className="seo-widget-subtitle-row" style={{ marginTop: 10 }}>
              <Skeleton type="text" width="40%" height="0.8125rem" />
              <Skeleton type="text" width="28%" height="0.75rem" />
            </div>
          </div>
          <div className="seo-header-controls" style={{ display: 'flex', alignItems: 'center', gap: '0.75rem' }}>
            <Skeleton type="text" width={88} height={32} style={{ borderRadius: 8 }} />
            <Skeleton type="text" width={52} height={32} style={{ borderRadius: 8 }} />
          </div>
        </div>

        <div className="channel-insight-grid">
          <ChannelInsightGridSkeleton />
        </div>
      </div>
    </Stack>
  </div>
);

export const SkeletonDashboardPage = SkeletonDashboardShell;

export const SkeletonComparePage: React.FC = () => (
  <div className="skeleton-compare-page">
    <Skeleton type="title" width="30%" style={{ marginBottom: '2rem' }} />
    <SkeletonCardGrid columns={2} count={4} />
  </div>
);

export const SkeletonDeltaPill: React.FC<{ count?: number }> = ({ count = 1 }) => (
  <div className="skeleton-delta-pills">
    {Array.from({ length: count }).map((_, i) => (
      <div key={i} className="skeleton-delta-pill">
        <div style={{ marginBottom: '0.5rem' }}>
          <Skeleton type="text" width="60%" height="0.75rem" />
        </div>
        <Skeleton type="title" width="80%" height="1.5rem" style={{ marginBottom: '0.5rem' }} />
        <div style={{ display: 'flex', gap: '0.5rem' }}>
          {[1, 2, 3].map((j) => (
            <Skeleton key={j} type="text" width="40px" height="0.6rem" />
          ))}
        </div>
      </div>
    ))}
  </div>
);
