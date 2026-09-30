import React, { useRef, useId, useState } from 'react';
import { ChannelChooserDialog, type ChooserChannel } from './ChannelChooserDialog';

export type { ChooserChannel as Channel };

const CHANNEL_NAME_MAX_CHARS = 20;

function truncateChannelTitle(title: string, maxChars = CHANNEL_NAME_MAX_CHARS): string {
  if (title.length <= maxChars) return title;
  return `${title.slice(0, maxChars)}…`;
}

interface ChannelSelectorProps {
  channels: ChooserChannel[];
  selectedChannel: string | null;
  onSelectChannel: (channelId: string) => void;
  onMoveChannel: (channelId: string) => void;
  onDeleteChannel: (channelId: string) => void;
  /** When set, each channel row shows a "Focus & knowledge" action (context menu entry). */
  onOpenFocus?: (channelId: string) => void;
  onConnectChannel: () => Promise<void>;
  isPersonalContext: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  currentOrganizationName?: string;
  isConnectingChannel?: boolean;
}

export const ChannelSelector: React.FC<ChannelSelectorProps> = ({
  channels,
  selectedChannel,
  onSelectChannel,
  onMoveChannel,
  onDeleteChannel,
  onOpenFocus,
  onConnectChannel,
  isPersonalContext,
  isOwner,
  isAdmin,
  currentOrganizationName,
  isConnectingChannel = false,
}) => {
  const triggerRef = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const [chooserOpen, setChooserOpen] = useState(false);
  const selected = channels.find(ch => ch.id === selectedChannel);

  const openChooser = () => setChooserOpen(true);

  const onTriggerKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      openChooser();
    }
  };

  const triggerLabel = selected?.snippet.title
    ? `Channel ${selected.snippet.title}. Open menu to switch or manage channels`
    : 'Select channel';

  return (
    <>
      <div className="form-field-main">
        <div className="channel-select-wrapper">
          <div
            ref={triggerRef}
            className="custom-channel-selector"
            onClick={openChooser}
            onKeyDown={onTriggerKeyDown}
            role="button"
            tabIndex={0}
            aria-haspopup="dialog"
            aria-expanded={chooserOpen}
            aria-controls={menuId}
            aria-label={triggerLabel}
          >
            <div className="channel-selector-inner">
              {selected?.snippet.thumbnails?.default?.url ? (
                <img src={selected.snippet.thumbnails.default.url} alt="" className="channel-selector-icon" referrerPolicy="no-referrer" />
              ) : (
                <div className="channel-selector-icon fallback"></div>
              )}
              <span className="channel-selector-text" title={selected?.snippet.title || undefined}>
                {selected?.snippet.title ? truncateChannelTitle(selected.snippet.title) : 'Select Channel'}
              </span>
            </div>
            <span className="material-symbols-outlined channel-selector-arrow" aria-hidden>
              arrow_drop_down
            </span>
          </div>
        </div>
      </div>

      <ChannelChooserDialog
        open={chooserOpen}
        onClose={() => setChooserOpen(false)}
        channels={channels}
        selectedChannel={selectedChannel}
        onSelectChannel={onSelectChannel}
        onMoveChannel={onMoveChannel}
        onDeleteChannel={onDeleteChannel}
        onOpenFocus={onOpenFocus}
        onConnectChannel={onConnectChannel}
        isPersonalContext={isPersonalContext}
        isOwner={isOwner}
        isAdmin={isAdmin}
        currentOrganizationName={currentOrganizationName}
        isConnectingChannel={isConnectingChannel}
      />
    </>
  );
};
