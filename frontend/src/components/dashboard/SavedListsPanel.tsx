import React, { useEffect, useId, useRef } from 'react';
import type { SavedList, VideoMetadata } from '../../types/dashboard';
import { Button, DropdownItem, DropdownList, DropdownPanel, DropdownTitle, DropdownTrigger } from '../ui';

interface SavedListsPanelProps {
  selectedVideo: VideoMetadata | null;
  dropdownRef: React.RefObject<HTMLDivElement | null>;
  savedLists: SavedList[];
  selectedChannel: string | null;
  /** Playlist IDs returned for the current channel (playlist tab meta: loaded vs list definition). */
  knownPlaylistIds?: Set<string>;
  activeListIds: Set<string>;
  showListDropdown: boolean;
  setShowListDropdown: (show: boolean) => void;
  listSearchTerm: string;
  setListSearchTerm: (term: string) => void;
  onToggleList: (listId: string) => void;
  isPersonalContext: boolean;
  canEditOrganization: boolean;
  onEditList: (list: SavedList) => void;
  onRemoveList: (e: React.MouseEvent<HTMLButtonElement>, listId: string) => void;
  onClearLists: () => void;
  onAddList: () => void;
  activeTab?: 'videoAnalytics' | 'channelAnalytics' | 'audience' | 'playlistAnalytics' | 'insights';
}

export const SavedListsPanel: React.FC<SavedListsPanelProps> = ({
  selectedVideo,
  dropdownRef,
  savedLists,
  selectedChannel,
  knownPlaylistIds,
  activeListIds,
  showListDropdown,
  setShowListDropdown,
  listSearchTerm,
  setListSearchTerm,
  onToggleList,
  isPersonalContext,
  canEditOrganization,
  onEditList,
  onRemoveList,
  onClearLists,
  onAddList,
  activeTab = 'videoAnalytics',
}) => {
  const loadListsTriggerRef = useRef<HTMLButtonElement>(null);
  const listsMenuId = useId();

  useEffect(() => {
    if (!showListDropdown) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      e.preventDefault();
      e.stopPropagation();
      setShowListDropdown(false);
      loadListsTriggerRef.current?.focus();
    };
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [showListDropdown, setShowListDropdown]);

  if (selectedVideo) return null;

  const channelLists = savedLists.filter(l => {
    if (l.channelId !== selectedChannel) return false;
    const isPlaylistList = l.listType === 'playlist';
    if (activeTab === 'playlistAnalytics' && !isPlaylistList) return false;
    if (activeTab !== 'playlistAnalytics' && isPlaylistList) return false;
    return true;
  });
  const filteredLists = channelLists.filter(l => l.name.toLowerCase().includes(listSearchTerm.toLowerCase()));

  const defaultLabel = activeTab === 'playlistAnalytics' ? 'Saved playlist lists' : 'Saved video lists';
  const loadButtonLabel =
    activeListIds.size === 0
      ? defaultLabel
      : activeListIds.size === 1
        ? savedLists.find(l => activeListIds.has(l.id))?.name || defaultLabel
        : `${activeListIds.size} lists`;
  const matchingListCount = filteredLists.length;

  return (
    <div className="dashboard-toolbar__lists saved-lists-panel">
      <div className="filter-buttons">
        <div className="rt-dropdown-anchor custom-dropdown-wrapper" ref={dropdownRef}>
          <DropdownTrigger
            ref={loadListsTriggerRef}
            toolbar
            active={activeListIds.size > 0}
            className="filter-btn"
            onClick={() => setShowListDropdown(!showListDropdown)}
            disabled={channelLists.length === 0}
            aria-haspopup="true"
            aria-expanded={showListDropdown}
            aria-controls={listsMenuId}
            aria-label={channelLists.length === 0 ? (activeTab === 'playlistAnalytics' ? 'Load playlist lists (no lists for this channel)' : 'Load video lists (no lists for this channel)') : undefined}
          >
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
              <path d="M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z" />
            </svg>
            <span className="btn-text">{loadButtonLabel}</span>
            <svg
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              width="10"
              height="10"
              className="chevron-icon"
              aria-hidden
            >
              <path d="M6 9l6 6 6-6" />
            </svg>
          </DropdownTrigger>

          {showListDropdown && (
            <DropdownPanel
              id={listsMenuId}
              className="custom-dropdown-menu"
              role="region"
              aria-label="Choose saved lists"
             align="menu">
              <div className="saved-lists-panel__header">
                <div className="saved-lists-panel__heading">
                  <DropdownTitle>{defaultLabel}</DropdownTitle>
                  <span className="saved-lists-panel__subtitle">
                    {matchingListCount} available · {activeListIds.size} selected
                  </span>
                </div>
                <span className="saved-lists-panel__count">{activeListIds.size > 0 ? `${activeListIds.size} active` : 'Ready'}</span>
              </div>
              <div className="rt-dropdown-search saved-lists-panel__search">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden>
                  <circle cx="11" cy="11" r="8" />
                  <path d="M21 21l-4.35-4.35" />
                </svg>
                <input
                  type="text"
                  placeholder="Search lists"
                  value={listSearchTerm}
                  onChange={(e) => setListSearchTerm(e.target.value)}
                  onClick={(e) => e.stopPropagation()}
                  autoFocus
                  aria-label="Search saved lists"
                />
              </div>
              <DropdownList>
                {filteredLists.map(list => {
                  const isSelected = activeListIds.has(list.id);
                  return (
                    <DropdownItem
                      key={list.id}
                      className="custom-dropdown-item"
                      onClick={() => onToggleList(list.id)}
                     selected={isSelected}>
                      <div className="item-content">
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="list-checkbox"
                          tabIndex={-1}
                          aria-label={`Select ${list.name}`}
                        />
                        <div className="item-text">
                          <span className="item-label-row">
                            <span className="item-label">{list.name}</span>
                          </span>
                          <span className="item-meta">
                            {(() => {
                              const plIds = list.playlistIds || [];
                              if (list.listType === 'playlist' && knownPlaylistIds && plIds.length > 0) {
                                const onChannel = plIds.filter(id => knownPlaylistIds.has(id)).length;
                                return `${onChannel}/${plIds.length} on channel`;
                              }
                              return `${list.videoIds?.length || plIds.length || 0} items`;
                            })()}
                          </span>
                        </div>
                      </div>
                      {(isPersonalContext || canEditOrganization) && (
                        <div className="item-actions">
                          <Button variant="secondary" bare
                            type="button"
                           
                            onClick={(e) => {
                              e.stopPropagation();
                              onEditList(list);
                            }}
                            title="Edit List and Annotations"
                            aria-label={`Edit list ${list.name}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden>
                              <path d="M11 4H4a2 2 0 00-2 2v14a2 2 0 002 2h14a2 2 0 002-2v-7" />
                              <path d="M18.5 2.5a2.121 2.121 0 013 3L12 15l-4 1 1-4 9.5-9.5z" />
                            </svg>
                          </Button>
                          <Button variant="danger" bare
                            type="button"
                           
                            onClick={(e) => onRemoveList(e, list.id)}
                            title="Delete List"
                            aria-label={`Delete list ${list.name}`}
                          >
                            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12" aria-hidden>
                              <path d="M3 6h18M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2" />
                            </svg>
                          </Button>
                        </div>
                      )}
                    </DropdownItem>
                  );
                })}
                {channelLists.length > 0 && filteredLists.length === 0 && (
                  <div className="dropdown-empty">
                    <div>No lists found</div>
                    <span>Try a different search or clear the filter.</span>
                  </div>
                )}
                {channelLists.length === 0 && (
                  <div className="dropdown-empty">
                    <div>No saved lists yet</div>
                    <span>Create a list to reuse it here later.</span>
                  </div>
                )}
              </DropdownList>
            </DropdownPanel>
          )}
        </div>

        {activeListIds.size > 0 && (
          <Button variant="secondary" size="sm" onClick={onClearLists} title="Clear Selection">
            <span style={{ fontSize: '1.1rem', lineHeight: 1, fontWeight: 'bold' }} aria-hidden>
              &times;
            </span>
            Clear
          </Button>
        )}

        {(isPersonalContext || canEditOrganization) && (
          <Button variant="secondary" size="sm" onClick={onAddList}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden>
              <path d="M12 5v14M5 12h14" />
            </svg>
            Add List
          </Button>
        )}
      </div>
    </div>
  );
};
