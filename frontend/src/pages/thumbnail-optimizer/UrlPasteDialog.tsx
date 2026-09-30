// ─────────────────────────────────────────────────────────────────────────────
// UrlPasteDialog -- Dialog for pasting YouTube URLs, showing chips with ability
//                 to remove unwanted ones before confirming
// ─────────────────────────────────────────────────────────────────────────────
import { useState } from 'react';
import { Box, DialogTitle, DialogBody, DialogActions, Button, TextField, Chip } from '../../components/ui';
import { OptimizerDialog } from './OptimizerDialog';
import { Link, Globe, X, AlertCircle } from 'lucide-react';
import { YouTubeService } from '../../services/youtubeService';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';

// ── Helpers ────────────────────────────────────────────────────────────────

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

function shortLabel(url: string, title?: string): string {
  if (title) return title.length > 35 ? title.slice(0, 32) + '…' : title;
  const vid = extractVideoId(url);
  return vid || (url.length > 30 ? url.slice(0, 27) + '…' : url);
}

// ── Types ──────────────────────────────────────────────────────────────────

interface ChipData {
  url: string;
  videoId: string;
}

interface UrlPasteDialogProps {
  open: boolean;
  onClose: () => void;
  onConfirm: (urls: string[]) => void;
  isLoading?: boolean;
  /** Locked channel ID for single-channel mode (optional) */
  lockedChannelId?: string | null;
  /** Title of the locked channel, used in validation messages (optional) */
  lockedChannelTitle?: string | null;
  /** When true, pasted URLs are validated to belong to a single channel
   *  even before a channel is locked. False keeps the original behavior. */
  enforceSingleChannel?: boolean;
  /** Connected channel IDs the user owns. When enforceSingleChannel is true,
   *  pasted videos outside this set are rejected with a red
   *  "not from your channel" message. Omit/empty to skip that check. */
  allowedChannelIds?: string[];
}

// ── Component ──────────────────────────────────────────────────────────────

export const UrlPasteDialog: React.FC<UrlPasteDialogProps> = ({
  open,
  onClose,
  onConfirm,
  isLoading,
  lockedChannelId,
  lockedChannelTitle,
  enforceSingleChannel = false,
  allowedChannelIds,
}) => {
  const { user, accessToken } = useAuth();
  const { currentOrganization } = useOrganization();
  const [urlInput, setUrlInput] = useState('');
  const [chips, setChips] = useState<ChipData[]>([]);
  const [resolving, setResolving] = useState(false);
  const [channelError, setChannelError] = useState<string | null>(null);

  const hasAllowed =
    Array.isArray(allowedChannelIds) && allowedChannelIds.length > 0;

  // Reset when dialog opens
  const handleOpen = () => {
    setUrlInput('');
    setChips([]);
  };

  const handleAddUrls = async () => {
    const raw = urlInput
      .split('\n')
      .map((u) => u.trim())
      .filter((u) => u.length > 0 && extractVideoId(u) !== null);
    const deduped = [...new Set(raw)];
    if (deduped.length === 0) return;

    const existing = new Set(chips.map((c) => c.url));
    const newUrls = deduped.filter((u) => !existing.has(u));
    if (newUrls.length === 0) return;

    setUrlInput('');
    setChannelError(null);

    // If no connected-channel restriction is requested, add all pasted URLs
    // as chips without validating ownership.
    const hasAllowed = Array.isArray(allowedChannelIds) && allowedChannelIds.length > 0;
    if (!enforceSingleChannel && !hasAllowed) {
      const newChips: ChipData[] = newUrls.map((url) => ({
        url,
        videoId: extractVideoId(url) || '',
      }));
      setChips((prev) => [...prev, ...newChips]);
      return;
    }

    // Validate ownership: pasted videos must belong to the user's connected
    // channels. When enforceSingleChannel (Playlist Optimizer) they must also
    // all be from one locked channel; otherwise (Thumbnail Optimizer) any
    // connected channel is allowed.
    setResolving(true);
    try {
      const ytService = new YouTubeService(
        user?.email || '',
        accessToken,
        currentOrganization?.id || null,
      );

      const allowed = hasAllowed ? new Set(allowedChannelIds) : null;

      // Resolve every pasted URL's owning channel (covers locked and unlocked).
      const results = await Promise.allSettled(
        newUrls.map((url) => {
          const vidId = extractVideoId(url);
          if (!vidId)
            return Promise.resolve({ channelId: null, channelTitle: null });
          return ytService.getChannelIdFromVideo(vidId);
        }),
      );

      // Single-channel target: the already-locked channel, else the first pasted
      // video that belongs to one of the user's connected channels.
      let targetId: string | null = lockedChannelId || null;
      let targetTitle: string | null = lockedChannelTitle || null;
      if (!targetId) {
        const firstValid = results.find(
          (r) =>
            r.status === 'fulfilled' &&
            r.value.channelId &&
            (!allowed || allowed.has(r.value.channelId)),
        );
        if (firstValid?.status === 'fulfilled') {
          targetId = firstValid.value.channelId;
          targetTitle = firstValid.value.channelTitle || null;
        }
      }

      const validUrls: string[] = [];
      const foreignUrls: string[] = [];
      const crossChannelUrls: string[] = [];

      for (let i = 0; i < results.length; i++) {
        const r = results[i];
        const url = newUrls[i];
        const channelId = r.status === 'fulfilled' ? r.value.channelId : null;
        if (!channelId) {
          crossChannelUrls.push(url);
          continue;
        }
        if (allowed && !allowed.has(channelId)) {
          foreignUrls.push(url);
        } else if (enforceSingleChannel && targetId && channelId !== targetId) {
          crossChannelUrls.push(url);
        } else {
          validUrls.push(url);
        }
      }

      if (validUrls.length > 0) {
        const newChips: ChipData[] = validUrls.map((url) => ({
          url,
          videoId: extractVideoId(url) || '',
        }));
        setChips((prev) => [...prev, ...newChips]);
      }

      const messages: string[] = [];
      if (foreignUrls.length > 0) {
        messages.push(
          `${foreignUrls.length} video(s) are not from your channel. Only videos from your connected channels can be added.`,
        );
      }
      if (crossChannelUrls.length > 0) {
        messages.push(
          enforceSingleChannel
            ? `${crossChannelUrls.length} video(s) from a different channel were skipped. All videos must be from "${targetTitle || targetId || 'your channel'}".`
            : `${crossChannelUrls.length} video(s) could not be verified and were skipped.`,
        );
      }
      setChannelError(messages.length > 0 ? messages.join(' ') : null);
    } catch (err) {
      setChannelError(
        err instanceof Error
          ? err.message
          : 'Failed to verify video. Please try again.',
      );
    } finally {
      setResolving(false);
    }
  };

  const handleRemoveChip = (url: string) => {
    setChips((prev) => prev.filter((c) => c.url !== url));
  };

  const handleConfirm = () => {
    onConfirm(chips.map((c) => c.url));
  };

  const handleClose = () => {
    if (!isLoading) onClose();
  };

  return (
    <OptimizerDialog
      open={open}
      onClose={handleClose}
      TransitionProps={{ onEnter: handleOpen }}
      maxWidth="sm"
      fullWidth
      PaperProps={{ sx: { minHeight: 320, maxHeight: 560, display: 'flex', flexDirection: 'column' } }}
    >
      {/* ── Header ───────────────────────────────────────────────────── */}
      <DialogTitle
        sx={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          px: 2.5,
          py: 1.5,
          fontSize: 'var(--rt-text-md)',
          fontWeight: 'var(--rt-weight-bold)',
          color: 'var(--rt-color-text)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          <Link size={18} style={{ color: 'var(--rt-color-accent)' }} />
          <span>Paste Video URLs</span>
        </Box>
        <Box
          component="button"
          onClick={handleClose}
          aria-label="Close"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            color: 'var(--rt-color-text-tertiary)', padding: 4, display: 'flex',
          }}
        >
          <X size={18} />
        </Box>
      </DialogTitle>

      {/* ── Info banner ──────────────────────────────────────────────── */}
      <Box sx={{ px: 2.5, pb: 1 }}>
        <Box
          sx={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 0.75,
            p: 1.25,
            borderRadius: 'var(--rt-radius-md)',
            bgcolor: 'var(--rt-color-bg-subtle)',
            border: '1px solid var(--rt-color-border)',
            fontSize: 'var(--rt-text-2xs)',
            color: 'var(--rt-color-text-secondary)',
            lineHeight: 1.4,
          }}
        >
          <Globe size={12} style={{ flexShrink: 0, marginTop: 1, color: 'var(--rt-color-accent)' }} />
          <span>
            {lockedChannelId
              ? 'Channel is locked. Only videos from the same channel will be accepted.'
              : hasAllowed
                ? enforceSingleChannel
                  ? 'Paste YouTube video URLs. Only videos from your connected channels can be added, and all must be from the same channel.'
                  : 'Paste YouTube video URLs. Only videos from your connected channels can be added.'
                : 'Paste YouTube video URLs below. Validation against your channels happens when you submit.'}
          </span>
        </Box>
        {channelError && (
          <Box
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 0.75,
              mt: 1,
              p: 1.25,
              borderRadius: 'var(--rt-radius-md)',
              bgcolor: 'var(--rt-color-danger-soft, #fef2f2)',
              border: '1px solid var(--rt-color-danger, #ef4444)',
              fontSize: 'var(--rt-text-2xs)',
              color: 'var(--rt-color-danger, #ef4444)',
              lineHeight: 1.4,
            }}
          >
            <AlertCircle size={12} style={{ flexShrink: 0, marginTop: 1 }} />
            <span>{channelError}</span>
          </Box>
        )}
      </Box>

      {/* ── Textarea ─────────────────────────────────────────────────── */}
      <DialogBody sx={{ px: 2.5, py: 1, flex: 1, overflow: 'auto' }}>
        <TextField
          fullWidth
          multiline
          minRows={3}
          maxRows={5}
          placeholder={`https://www.youtube.com/watch?v=...\nhttps://youtu.be/...`}
          value={urlInput}
          onChange={(e) => setUrlInput(e.target.value)}
          disabled={isLoading}
          sx={{
            mb: 0.75,
            fontFamily: 'monospace',
            fontSize: 'var(--rt-text-xs)',
          }}
        />

        <Box sx={{ display: 'flex', justifyContent: 'flex-end', mb: 1.5 }}>
          <Button
            size="sm"
            variant="outline"
            onClick={handleAddUrls}
            disabled={isLoading || resolving || !urlInput.trim()}
            startIcon={resolving ? undefined : <Link size={12} />}
          >
            {resolving ? 'Verifying...' : 'Add URLs'}
          </Button>
        </Box>

        {/* ── Chips ──────────────────────────────────────────────────── */}
        {chips.length > 0 && (
          <Box
            sx={{
              p: 1.25,
              borderRadius: 'var(--rt-radius-md)',
              bgcolor: 'var(--rt-color-bg-subtle)',
              border: '1px solid var(--rt-color-border)',
              maxHeight: 180,
              overflow: 'auto',
            }}
          >
            <Box
              sx={{
                fontSize: 'var(--rt-text-2xs)',
                fontWeight: 'var(--rt-weight-bold)',
                color: 'var(--rt-color-text-tertiary)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
                mb: 0.75,
              }}
            >
              {chips.length} URL{chips.length !== 1 ? 's' : ''} added
            </Box>
            <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.5 }}>
              {chips.map((chip) => (
                <Chip
                  key={chip.url}
                  label={shortLabel(chip.url)}
                  onDelete={() => handleRemoveChip(chip.url)}
                  size="small"
                  variant="outlined"
                  sx={{
                    maxWidth: 200,
                    fontSize: 'var(--rt-text-2xs)',
                  }}
                />
              ))}
            </Box>
          </Box>
        )}
      </DialogBody>

      {/* ── Actions ─────────────────────────────────────────────────── */}
      <DialogActions sx={{ px: 2.5, py: 1.5, borderTop: '1px solid var(--rt-color-border)' }}>
        <Button onClick={handleClose} disabled={isLoading} variant="ghost">
          Cancel
        </Button>
        <Button
          onClick={handleConfirm}
          variant="contained"
          disabled={chips.length === 0 || isLoading}
        >
          Confirm ({chips.length})
        </Button>
      </DialogActions>
    </OptimizerDialog>
  );
};
