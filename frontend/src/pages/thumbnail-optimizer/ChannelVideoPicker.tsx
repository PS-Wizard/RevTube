// ─────────────────────────────────────────────────────────────────────────────
// ChannelVideoPicker -- Side-by-side layout: browse channel videos (left) and
//                     paste YouTube URLs via dialog (right)
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useCallback } from 'react';
import { Box, Chip, Button, Typography } from '../../components/ui';
import { Tv, Link, Lock } from 'lucide-react';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { getAdminChannels } from '../../services/adminChannelService';
import { getOrganizationChannels } from '../../services/organizationChannelService';
import { VideoSearchDialog } from './VideoSearchDialog';
import { UrlPasteDialog } from './UrlPasteDialog';
import { EmptyState } from '../../components/EmptyState';

// ── Helpers ────────────────────────────────────────────────────────────────

/** Extract a YouTube video ID from a URL or raw ID string */
function extractVideoId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;
  try {
    const u = new URL(trimmed);
    if (u.hostname.includes('youtube.com') && u.pathname === '/watch') return u.searchParams.get('v');
    if (u.hostname === 'youtu.be') { const slug = u.pathname.slice(1).split('/')[0]; return slug || null; }
    if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || null;
    if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || null;
  } catch { /* not a URL */ }
  if (/^[a-zA-Z0-9_-]{11}$/.test(trimmed)) return trimmed;
  return null;
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ChannelOption {
  id: string;
  title: string;
  thumbnailUrl?: string;
}

interface ChannelVideoPickerProps {
  onUrlsChange: (urls: string[]) => void;
  isLoading?: boolean;
  /** When set, the channel is locked (single-channel mode) */
  lockedChannelId?: string | null;
  /** Title of the locked channel to display */
  lockedChannelTitle?: string | null;
  /** When true, all videos must belong to one channel (Playlist Optimizer).
   *  When false (Thumbnail Optimizer), cross-channel selection is allowed. */
  enforceSingleChannel?: boolean;
  /** When true (admin mode), any channel's videos are accepted. URL paste is
   *  not restricted to connected channels and no single-channel lock applies. */
  allowAnyChannel?: boolean;
  /** Bump to clear the locally held browse/paste URL chips (used when the
   *  parent clears its video list). Optional. */
  resetSignal?: number;
  /** Video IDs to tag/filter as already "Optimized" in the browse dialog. */
  optimizedVideoIds?: Set<string>;
}

// ── Component ──────────────────────────────────────────────────────────────

export const ChannelVideoPicker: React.FC<ChannelVideoPickerProps> = ({
  onUrlsChange,
  isLoading,
  lockedChannelId,
  lockedChannelTitle,
  enforceSingleChannel = false,
  allowAnyChannel = false,
  resetSignal = 0,
  optimizedVideoIds,
}) => {
  // Admin mode (allowAnyChannel) overrides both the single-channel lock and
  // the connected-channel restriction so any channel's videos are accepted.
  const disabled =
    !allowAnyChannel && lockedChannelId !== null && lockedChannelId !== undefined;
  const singleChannel = !allowAnyChannel && enforceSingleChannel;
  const { allTokens } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();

  // ── Channels ────────────────────────────────────────────────────────────
  const [channels, setChannels] = useState<ChannelOption[]>([]);

  useEffect(() => {
    let cancelled = false;
    const loadChannels = async () => {
      if (allowAnyChannel) {
        // Admin mode: every connected channel across the whole system.
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
            .map((t) => ({ id: t.channelId!, title: t.channelTitle || 'Unknown', thumbnailUrl: t.thumbnailUrl })),
        );
      } else if (currentOrganization) {
        try {
          const orgChannels = await getOrganizationChannels(currentOrganization.id);
          setChannels(
            orgChannels
              .filter((c) => c.id && c.channelTitle)
              .map((c) => ({ id: c.id, title: c.channelTitle || 'Unknown', thumbnailUrl: c.thumbnailUrl })),
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

  // ── Browse dialog state ──────────────────────────────────────────────
  const [browseDialogOpen, setBrowseDialogOpen] = useState(false);

  // ── URL paste dialog state ───────────────────────────────────────────
  const [urlDialogOpen, setUrlDialogOpen] = useState(false);

  // ── Combined URL lists from both sources ─────────────────────────────
  const [browseUrls, setBrowseUrls] = useState<string[]>([]);
  const [pasteUrls, setPasteUrls] = useState<string[]>([]);

  // Clear locally held chips when the parent bumps the reset signal (e.g.
  // after it clears its video list) so stale selections are not re-added.
  // Adjusted during render (not in an effect) per React's recommended pattern
  // for resetting state in response to a prop change.
  const [lastReset, setLastReset] = useState(resetSignal);
  if (resetSignal !== lastReset) {
    setLastReset(resetSignal);
    setBrowseUrls([]);
    setPasteUrls([]);
  }

  // Notify parent of combined URLs
  const combinedUrls = useCallback(() => {
    return [...browseUrls, ...pasteUrls];
  }, [browseUrls, pasteUrls]);

  useEffect(() => {
    onUrlsChange(combinedUrls());
  }, [combinedUrls, onUrlsChange]);

  const handleBrowseConfirm = (urls: string[]) => {
    setBrowseUrls(urls);
    setBrowseDialogOpen(false);
  };

  const handlePasteConfirm = (urls: string[]) => {
    setPasteUrls(urls);
    setUrlDialogOpen(false);
  };

  const clearBrowseUrls = () => setBrowseUrls([]);
  const clearPasteUrls = () => setPasteUrls([]);

  return (
    <Box
      sx={{
        display: 'grid',
        gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' },
        gap: 2.5,
      }}
    >
      {/* ════════════ LEFT: Browse Channels ════════════════════════════ */}
      <Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1.5,
            pb: 1,
            borderBottom: '1px solid var(--rt-color-border)',
          }}
        >
          <Tv size={16} style={{ color: 'var(--rt-color-accent)' }} />
          <Typography
            variant="subtitle2"
            sx={{ flex: 1, color: 'var(--rt-color-text)', fontWeight: 'var(--rt-weight-semibold)', fontSize: 'var(--rt-text-xs)' }}
          >
            {allowAnyChannel
              ? 'Choose from Any Connected Channel'
              : 'Choose from Connected Channels'}
          </Typography>
          {disabled && lockedChannelTitle && (
            <Chip
              label={
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
                  <Lock size={10} />
                  <span>{lockedChannelTitle}</span>
                </Box>
              }
              size="small"
              color="primary"
              sx={{ height: 20, fontSize: 'var(--rt-text-2xs)' }}
            />
          )}
          {browseUrls.length > 0 && !disabled && (
            <Chip
              label={`${browseUrls.length} selected`}
              size="small"
              color="primary"
              onDelete={clearBrowseUrls}
              sx={{ height: 20, fontSize: 'var(--rt-text-2xs)' }}
            />
          )}
        </Box>

        {channels.length === 0 ? (
          <EmptyState
            variant="zero"
            title="No Channels Connected"
            description={allowAnyChannel
              ? 'No connected channels to browse. Use "Add URLs Directly" on the right to add videos from any channel.'
              : 'No YouTube channels connected. Connect a channel to browse and pick videos.'}
          />
        ) : disabled ? (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.25,
              py: 3,
              px: 2,
              borderRadius: 'var(--rt-radius-md)',
              bgcolor: 'var(--rt-color-bg-subtle)',
              border: '1px dashed var(--rt-color-border)',
              textAlign: 'center',
            }}
          >
            <Lock size={24} style={{ color: 'var(--rt-color-accent)', opacity: 0.8 }} />
            <Typography
              variant="body2"
              sx={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)', maxWidth: 280, lineHeight: 1.4 }}
            >
              Channel locked to <strong>{lockedChannelTitle}</strong>. All videos must be from the same channel.
            </Typography>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setBrowseDialogOpen(true)}
              startIcon={<Tv size={14} />}
              sx={{
                textTransform: 'none',
                fontSize: 'var(--rt-text-xs)',
                borderColor: 'var(--rt-color-accent)',
                color: 'var(--rt-color-accent)',
              }}
            >
              Browse Videos
            </Button>
          </Box>
        ) : (
          <Box
            sx={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              gap: 1.25,
              py: 3,
              px: 2,
              borderRadius: 'var(--rt-radius-md)',
              bgcolor: 'var(--rt-color-bg-subtle)',
              border: '1px dashed var(--rt-color-border)',
              textAlign: 'center',
            }}
          >
            <Tv size={24} style={{ color: 'var(--rt-color-text-muted)', opacity: 0.5 }} />
            <Typography
              variant="body2"
              sx={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)', maxWidth: 280, lineHeight: 1.4 }}
            >
              {singleChannel
                ? 'Browse your connected channels to pick videos. All videos must be from the same channel.'
                : allowAnyChannel
                  ? 'Browse your connected channels, or paste URLs from any channel on the right.'
                  : 'Browse your connected channels to pick videos across any of them.'}
            </Typography>
            <Button
              variant="outlined"
              size="small"
              onClick={() => setBrowseDialogOpen(true)}
              startIcon={<Tv size={14} />}
              sx={{
                textTransform: 'none',
                fontSize: 'var(--rt-text-xs)',
                borderColor: 'var(--rt-color-accent)',
                color: 'var(--rt-color-accent)',
                '&:hover': { borderColor: 'var(--rt-color-accent-hover)', bgcolor: 'var(--rt-color-accent-soft)' },
              }}
            >
              Browse Video(s) from Channel(s)
            </Button>
          </Box>
        )}

        {browseUrls.length > 0 && !disabled && (
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {browseUrls.map((url) => (
              <Chip
                key={url}
                label={extractVideoId(url) || url}
                size="small"
                variant="outlined"
                onDelete={() => setBrowseUrls((prev) => prev.filter((u) => u !== url))}
                sx={{ height: 20, fontSize: 'var(--rt-text-2xs)', borderColor: 'var(--rt-color-border)', color: 'var(--rt-color-text-secondary)' }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* ════════════ RIGHT: Add URLs via Dialog ════════════════════════ */}
      <Box>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'center',
            gap: 1,
            mb: 1.5,
            pb: 1,
            borderBottom: '1px solid var(--rt-color-border)',
          }}
        >
          <Link size={16} style={{ color: 'var(--rt-color-accent)' }} />
          <Typography
            variant="subtitle2"
            sx={{ flex: 1, color: 'var(--rt-color-text)', fontWeight: 'var(--rt-weight-semibold)', fontSize: 'var(--rt-text-xs)' }}
          >
            {allowAnyChannel
              ? 'Add Videos Manually From Any Channel'
              : 'Add Videos Manually From Your Channel'}
          </Typography>
          {pasteUrls.length > 0 && (
            <Chip
              label={`${pasteUrls.length} added`}
              size="small"
              color="primary"
              onDelete={clearPasteUrls}
              sx={{ height: 20, fontSize: 'var(--rt-text-2xs)' }}
            />
          )}
        </Box>

        <Box
          sx={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            gap: 1.25,
            py: 3,
            px: 2,
            borderRadius: 'var(--rt-radius-md)',
            bgcolor: 'var(--rt-color-bg-subtle)',
            border: '1px dashed var(--rt-color-border)',
            textAlign: 'center',
          }}
        >
          <Link size={24} style={{ color: 'var(--rt-color-text-muted)', opacity: 0.5 }} />
          <Typography
            variant="body2"
            sx={{ color: 'var(--rt-color-text-secondary)', fontSize: 'var(--rt-text-xs)', maxWidth: 280, lineHeight: 1.4 }}
          >
            {disabled
              ? 'Channel is locked. Add URLs from the same channel only.'
              : singleChannel
                ? 'Paste YouTube URLs directly. Only videos from your connected channels can be added, and all must be from the same channel.'
                : allowAnyChannel
                  ? 'Paste YouTube URLs directly. Videos from any channel are accepted.'
                  : 'Paste YouTube URLs directly. Only videos from your connected channels can be added.'}
          </Typography>
          <Button
            variant="outlined"
            size="small"
            onClick={() => setUrlDialogOpen(true)}
            startIcon={<Link size={14} />}
            sx={{
              textTransform: 'none',
              fontSize: 'var(--rt-text-xs)',
              borderColor: 'var(--rt-color-accent)',
              color: 'var(--rt-color-accent)',
              '&:hover': { borderColor: 'var(--rt-color-accent-hover)', bgcolor: 'var(--rt-color-accent-soft)' },
            }}
          >
            Add URLs Directly
          </Button>
        </Box>

        {pasteUrls.length > 0 && (
          <Box sx={{ mt: 1, display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
            {pasteUrls.map((url) => (
              <Chip
                key={url}
                label={extractVideoId(url) || url}
                size="small"
                variant="outlined"
                onDelete={() => setPasteUrls((prev) => prev.filter((u) => u !== url))}
                sx={{ height: 20, fontSize: 'var(--rt-text-2xs)', borderColor: 'var(--rt-color-border)', color: 'var(--rt-color-text-secondary)' }}
              />
            ))}
          </Box>
        )}
      </Box>

      {/* ── Browse dialog ──────────────────────────────────────────── */}
      <VideoSearchDialog
        open={browseDialogOpen}
        channels={channels}
        initialChannelId={disabled ? lockedChannelId || undefined : undefined}
        lockedChannelId={lockedChannelId || null}
        enforceSingleChannel={singleChannel}
        initialSelectedIds={[...browseUrls, ...pasteUrls]
          .map((u) => extractVideoId(u))
          .filter((id): id is string => id !== null)}
        onClose={() => setBrowseDialogOpen(false)}
        onConfirm={handleBrowseConfirm}
        isLoading={isLoading}
        optimizedVideoIds={optimizedVideoIds}
      />

      {/* ── URL paste dialog ────────────────────────────────────────── */}
      <UrlPasteDialog
        open={urlDialogOpen}
        onClose={() => setUrlDialogOpen(false)}
        onConfirm={handlePasteConfirm}
        isLoading={isLoading}
        lockedChannelId={lockedChannelId || null}
        lockedChannelTitle={lockedChannelTitle || null}
        enforceSingleChannel={singleChannel}
        allowedChannelIds={allowAnyChannel ? undefined : channels.map((c) => c.id)}
      />
    </Box>
  );
};
