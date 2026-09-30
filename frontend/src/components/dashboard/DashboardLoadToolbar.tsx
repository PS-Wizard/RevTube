import React from 'react';
import { NativeSelect } from '../ui';

export interface DashboardLoadToolbarProps {
  videoTypeFilter: string;
  onVideoTypeChange: (type: string) => void;
  visibilityFilter?: string;
  onVisibilityChange?: (visibility: string) => void;
  loading: boolean;
  activeListCount: number;
  activeTab?: string;
}

/**
 * Fetch controls for dashboard video / playlist tables.
 * Videos always load the full catalog (DB-backed L1/L2 cache) -- there is no
 * per-load limit; the table's client-side pagination handles display.
 */
export const DashboardLoadToolbar: React.FC<DashboardLoadToolbarProps> = ({
  videoTypeFilter,
  onVideoTypeChange,
  visibilityFilter = 'public',
  onVisibilityChange,
  loading,
  activeListCount,
  activeTab,
}) => {
  const isPlaylistTab = activeTab === 'playlistAnalytics';
  const listsActive = activeListCount > 0;

  return (
    <div
      className="dashboard-toolbar__controls"
      aria-label={isPlaylistTab ? 'Playlist load options' : 'Video load options'}
    >
      {listsActive ? (
        <p className="dashboard-toolbar-hint">
          Showing saved lists. Clear list selection to load by limit from YouTube.
        </p>
      ) : (
        <>
          {!isPlaylistTab && (
            <div className="dashboard-toolbar-field">
              <NativeSelect
                id="dashboard-content-type"
                value={videoTypeFilter}
                onChange={(e) => onVideoTypeChange(e.target.value)}
                aria-label="Content type"
              >
                <option value="all">All content</option>
                <option value="shorts">Shorts only</option>
                <option value="long">Videos only</option>
              </NativeSelect>
            </div>
          )}

          {onVisibilityChange && (
            <div className="dashboard-toolbar-field">
              <NativeSelect
                id="dashboard-visibility"
                value={visibilityFilter}
                onChange={(e) => onVisibilityChange(e.target.value)}
                aria-label="Visibility"
                title="Filter to Public only, Private only, Unlisted only, or all items"
              >
                <option value="public">Public only</option>
                <option value="private">Private only</option>
                <option value="unlisted">Unlisted only</option>
                <option value="all">All (incl. private &amp; unlisted)</option>
              </NativeSelect>
            </div>
          )}

          {loading && <span className="dashboard-toolbar-status">Updating…</span>}
        </>
      )}
    </div>
  );
};

/** @deprecated Use DashboardLoadToolbar */
export const VideoFiltersBar = DashboardLoadToolbar;
