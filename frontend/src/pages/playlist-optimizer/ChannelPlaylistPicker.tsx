// ─────────────────────────────────────────────────────────────────────────────
// ChannelPlaylistPicker -- Single "Select Playlists" button. Channel and
//                       playlist selection both happen inside the dialog.
// ─────────────────────────────────────────────────────────────────────────────
import { Box, Button, Chip, Typography } from "../../components/ui";
import { Play } from "lucide-react";
import { useEffect, useState } from "react";
import { useAuth } from "../../hooks/useAuth";
import { useOrganization } from "../../hooks/useOrganization";
import { getAdminChannels } from "../../services/adminChannelService";
import { getOrganizationChannels } from "../../services/organizationChannelService";
import type { Video } from "../../types/playlistOptimizer";
import { PlaylistPickerDialog } from "./PlaylistPickerDialog";

interface ChannelOption {
  id: string;
  title: string;
  thumbnailUrl?: string;
}

interface ChannelPlaylistPickerProps {
  onPlaylistsConfirm: (videos: Video[]) => void;
  isLoading?: boolean;
  selectedPlaylistCount?: number;
  videoCount?: number;
  /** When true (admin mode), any channel's playlists can be selected by
   *  entering a channel ID, not just the connected channels. */
  allowAnyChannel?: boolean;
  /** Playlist IDs already added to the Optimized list (green tick + filters). */
  optimizedPlaylistIds?: Set<string>;
}

export const ChannelPlaylistPicker: React.FC<ChannelPlaylistPickerProps> = ({
  onPlaylistsConfirm,
  isLoading,
  selectedPlaylistCount,
  videoCount,
  allowAnyChannel = false,
  optimizedPlaylistIds,
}) => {
  const { allTokens } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();

  const [channels, setChannels] = useState<ChannelOption[]>([]);
  const [dialogOpen, setDialogOpen] = useState(false);

  // Build the channel list from the user's connected tokens or org channels.
  // In admin mode (allowAnyChannel) use every connected channel system-wide.
  useEffect(() => {
    let cancelled = false;
    const loadChannels = async () => {
      if (allowAnyChannel) {
        try {
          const list = await getAdminChannels();
          if (cancelled) return;
          setChannels(
            list.map((c) => ({
              id: c.channelId,
              title: c.ownerName
                ? `${c.channelTitle} (${c.ownerName})`
                : c.channelTitle,
              thumbnailUrl: c.thumbnailUrl,
            })),
          );
        } catch {
          if (!cancelled) setChannels([]);
        }
        return;
      }
      if (isPersonalContext) {
        setChannels(
          allTokens
            .filter((t) => t.channelId && t.channelTitle)
            .map((t) => ({
              id: t.channelId!,
              title: t.channelTitle || "Unknown Channel",
              thumbnailUrl: t.thumbnailUrl,
            })),
        );
      } else if (currentOrganization) {
        try {
          const orgChannels = await getOrganizationChannels(
            currentOrganization.id,
          );
          setChannels(
            orgChannels
              .filter((c) => c.id && c.channelTitle)
              .map((c) => ({
                id: c.id,
                title: c.channelTitle || "Unknown Channel",
                thumbnailUrl: c.thumbnailUrl,
              })),
          );
        } catch {
          if (!cancelled) setChannels([]);
        }
      }
    };
    loadChannels();
    return () => {
      cancelled = true;
    };
  }, [allowAnyChannel, isPersonalContext, currentOrganization, allTokens]);

  const handleDialogConfirm = (videos: Video[]) => {
    onPlaylistsConfirm(videos);
    setDialogOpen(false);
  };

  return (
    <Box>
      {/* Dashed entry box - channel and playlist selection happen in the dialog */}
      <Box
        sx={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 1.25,
          py: 3,
          px: 2,
          borderRadius: "var(--rt-radius-md)",
          bgcolor: "var(--rt-color-bg-subtle)",
          border: "1px dashed var(--rt-color-border)",
          textAlign: "center",
        }}
      >
        <Play
          size={24}
          style={{ color: "var(--rt-color-text-muted)", opacity: 0.5 }}
        />
        <Typography
          variant="body2"
          sx={{
            color: "var(--rt-color-text-secondary)",
            fontSize: "var(--rt-text-xs)",
            maxWidth: 280,
            lineHeight: 1.4,
          }}
        >
          {channels.length === 0
            ? allowAnyChannel
              ? "No connected channels found in the system. Enter any channel ID inside the dialog to load its playlists."
              : "No YouTube channels connected. Connect a channel to select playlists for optimization."
            : "Select the playlists to optimize. You can switch channels inside the dialog."}
        </Typography>
        <Button
          variant="outlined"
          size="small"
          onClick={() => setDialogOpen(true)}
          disabled={(channels.length === 0 && !allowAnyChannel) || isLoading}
          startIcon={<Play size={14} />}
          sx={{
            textTransform: "none",
            fontSize: "var(--rt-text-xs)",
            borderColor: "var(--rt-color-accent)",
            color: "var(--rt-color-accent)",
            "&:hover": {
              borderColor: "var(--rt-color-accent-hover)",
              bgcolor: "var(--rt-color-accent-soft)",
            },
          }}
        >
          Select Playlist(s) from Connected Channel(s)
        </Button>
      </Box>

      {/* Selected count */}
      <Box sx={{ display: "flex", alignItems: "center", gap: 1, mt: 1, minHeight: 24 }}>
        {selectedPlaylistCount && selectedPlaylistCount > 0 ? (
          <Chip
            label={`${selectedPlaylistCount} playlist${selectedPlaylistCount !== 1 ? "s" : ""} · ${videoCount || 0} video${videoCount !== 1 ? "s" : ""} selected for optimization`}
            size="small"
            color="primary"
            onDelete={() => onPlaylistsConfirm([])}
            sx={{ height: 24, fontSize: "var(--rt-text-xs)" }}
          />
        ) : (
          <Typography
            variant="body2"
            sx={{
              color: "var(--rt-color-text-muted)",
              fontSize: "var(--rt-text-xs)",
              fontStyle: "italic",
            }}
          >
            None selected
          </Typography>
        )}
      </Box>

      {/* Playlist picker dialog (channel selected inside) */}
      <PlaylistPickerDialog
        open={dialogOpen}
        channels={channels}
        onClose={() => setDialogOpen(false)}
        onConfirm={handleDialogConfirm}
        isLoading={isLoading}
        allowAnyChannel={allowAnyChannel}
        optimizedPlaylistIds={optimizedPlaylistIds}
      />
    </Box>
  );
};
