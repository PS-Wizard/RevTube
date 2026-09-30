import {
  ArrowRightLeft,
  Crosshair,
  EllipsisVertical,
  Plus,
  Search,
  Trash2,
  Tv,
} from "lucide-react";
import React, { useMemo, useState } from "react";
import { Button, Input, Modal } from "../ui";

export interface ChooserChannel {
  id: string;
  isOrganizationChannel?: boolean;
  snippet: {
    title: string;
    thumbnails?: {
      default?: { url?: string };
    };
  };
}

interface ChannelChooserDialogProps {
  open: boolean;
  onClose: () => void;
  channels: ChooserChannel[];
  selectedChannel: string | null;
  onSelectChannel: (channelId: string) => void;
  onMoveChannel: (channelId: string) => void;
  onDeleteChannel: (channelId: string) => void;
  /** When set, each channel row shows a "Focus & knowledge" action. */
  onOpenFocus?: (channelId: string) => void;
  onConnectChannel: () => Promise<void>;
  isPersonalContext: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  currentOrganizationName?: string;
  isConnectingChannel?: boolean;
}

/**
 * Dialog-based channel chooser, modeled on the chat channel modal: single-line
 * rows (avatar + truncated title + badge, tap = select). Management actions
 * live behind a per-row expander and render in normal flow, so nothing can
 * push past the viewport on mobile. Tailwind + shared primitives only.
 */
export const ChannelChooserDialog: React.FC<ChannelChooserDialogProps> = ({
  open,
  onClose,
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
  const [search, setSearch] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);

  const handleClose = () => {
    setExpandedId(null);
    onClose();
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return channels;
    return channels.filter((ch) => ch.snippet.title.toLowerCase().includes(q));
  }, [channels, search]);

  const canAdd = isPersonalContext || isOwner || isAdmin;

  const handleSelect = (channelId: string) => {
    onSelectChannel(channelId);
    handleClose();
  };

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Select channel"
      description={`${channels.length} connected channel${channels.length !== 1 ? "s" : ""} `}
      icon={<Tv size={18} />}
      maxWidth="sm"
    >
      <div className="flex min-w-0 flex-col gap-3">
        <Input
          placeholder="Search channels..."
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          compact
          startAdornment={<Search size={15} aria-hidden />}
          aria-label="Search channels"
        />

        <div className="max-h-[340px] min-w-0 overflow-y-auto rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)]">
          {filtered.length === 0 ? (
            <p className="m-0 px-3 py-8 text-center text-[length:var(--rt-text-sm)] text-[var(--rt-color-text-tertiary)]">
              {channels.length === 0
                ? "No channels connected yet."
                : "No channels match your search."}
            </p>
          ) : (
            filtered.map((channel) => {
              const isSelected = selectedChannel === channel.id;
              const canMoveToOrg =
                isPersonalContext &&
                !channel.isOrganizationChannel &&
                currentOrganizationName &&
                (isOwner || isAdmin);
              const canDelete = isPersonalContext || isOwner || isAdmin;
              const thumb = channel.snippet.thumbnails?.default?.url;
              const canManage = Boolean(
                onOpenFocus || canMoveToOrg || canDelete,
              );
              const isExpanded = expandedId === channel.id;

              return (
                <div
                  key={channel.id}
                  className={`min-w-0 border-b border-[var(--rt-color-border)] px-3 py-2 last:border-b-0 ${
                    isSelected ? "bg-[var(--rt-color-accent-muted)]" : ""
                  }`}
                >
                  <div className="flex min-w-0 items-center gap-1.5">
                    <button
                      type="button"
                      onClick={() => handleSelect(channel.id)}
                      aria-label={`Select ${channel.snippet.title}`}
                      className="flex min-w-0 flex-1 cursor-pointer items-center gap-2.5 border-0 bg-transparent p-0 text-left"
                    >
                      {thumb ? (
                        <img
                          src={thumb}
                          alt=""
                          referrerPolicy="no-referrer"
                          className="h-9 w-9 shrink-0 rounded-full object-cover"
                        />
                      ) : (
                        <span
                          aria-hidden
                          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-[var(--rt-color-accent-muted)] text-sm font-bold text-[var(--rt-color-accent)]"
                        >
                          {channel.snippet.title.slice(0, 1).toUpperCase()}
                        </span>
                      )}
                      <span className="min-w-0 flex-1 truncate text-[length:var(--rt-text-sm)] font-medium text-[var(--rt-color-text)]">
                        {channel.snippet.title}
                      </span>
                      {channel.isOrganizationChannel && (
                        <span className="shrink-0 rounded-[var(--rt-radius-pill)] bg-[var(--rt-color-accent)] px-2 py-0.5 text-[length:var(--rt-text-2xs)] font-semibold text-[var(--rt-color-on-primary)]">
                          ORG
                        </span>
                      )}
                      {isSelected && (
                        <span
                          aria-hidden
                          className="material-symbols-outlined shrink-0 text-xl text-[var(--rt-color-accent)]"
                        >
                          check
                        </span>
                      )}
                    </button>
                    {canManage && (
                      <Button
                        variant="ghost"
                        size="icon"
                        type="button"
                        aria-expanded={isExpanded}
                        aria-label={`Manage ${channel.snippet.title}`}
                        onClick={() =>
                          setExpandedId(isExpanded ? null : channel.id)
                        }
                        className="shrink-0"
                      >
                        <EllipsisVertical size={16} aria-hidden />
                      </Button>
                    )}
                  </div>

                  {canManage && isExpanded && (
                    <div className="flex min-w-0 flex-wrap gap-1.5 pb-1 pl-11 pt-1.5">
                      {onOpenFocus && (
                        <Button
                          variant="ghost"
                          size="xs"
                          type="button"
                          onClick={() => {
                            onOpenFocus(channel.id);
                            handleClose();
                          }}
                          aria-label={`Open focus and knowledge for ${channel.snippet.title}`}
                        >
                          <Crosshair size={13} aria-hidden />
                          Focus
                        </Button>
                      )}
                      {canMoveToOrg && (
                        <Button
                          variant="ghost"
                          size="xs"
                          type="button"
                          onClick={() => {
                            onMoveChannel(channel.id);
                            handleClose();
                          }}
                          aria-label={`Move ${channel.snippet.title} to ${currentOrganizationName}`}
                        >
                          <ArrowRightLeft size={13} aria-hidden />
                          <span className="min-w-0 truncate">
                            Move to {currentOrganizationName}
                          </span>
                        </Button>
                      )}
                      {canDelete && (
                        <Button
                          variant="danger"
                          size="xs"
                          type="button"
                          onClick={() => {
                            handleClose();
                            onDeleteChannel(channel.id);
                          }}
                          aria-label={`Remove ${channel.snippet.title} from account`}
                        >
                          <Trash2 size={13} aria-hidden />
                          Remove
                        </Button>
                      )}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>

        <div className="flex min-w-0 items-center justify-end gap-2">
          {canAdd && (
            <Button
              variant="primary"
              size="xs"
              type="button"
              disabled={isConnectingChannel}
              onClick={async () => {
                await onConnectChannel();
                handleClose();
              }}
            >
              {isConnectingChannel ? (
                "Connecting…"
              ) : (
                <>
                  <Plus size={15} aria-hidden />
                  Add another channel
                </>
              )}
            </Button>
          )}
        </div>
      </div>
    </Modal>
  );
};

export default ChannelChooserDialog;
