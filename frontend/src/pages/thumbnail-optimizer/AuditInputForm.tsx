// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Input form with ChannelVideoPicker + context fields
// ─────────────────────────────────────────────────────────────────────────────
import React, { useState } from 'react';
import {
  Box,
  TextField,
  Button,
  Spinner,
  Grid,
  IconButton,
  Flex,
  Typography,
  ShadcnPopover as Popover,
  PopoverTrigger,
  PopoverContent,
} from '../../components/ui';
import {
  AlertCircle,
  Tag,
  Users,
  Volume2,
  Lightbulb,
  Play,
  HelpCircle,
  Settings2,
} from 'lucide-react';
import { ChannelVideoPicker } from './ChannelVideoPicker';
import type { AuditRequest } from '../../types/thumbnailOptimizer';

interface FieldHelpPopoverProps {
  title: string;
  icon: React.ReactNode;
  accentColor: string;
  description: string;
  examples: string;
}

const FieldHelpPopover: React.FC<FieldHelpPopoverProps> = ({
  title,
  icon,
  accentColor,
  description,
  examples,
}) => (
  <Popover>
    <PopoverTrigger asChild>
      <IconButton
        size="xs"
        type="button"
        aria-label={`${title} details`}
        title="Click for details"
        style={{ width: 22, height: 22, minWidth: 22, padding: 0 }}
      >
        <HelpCircle size={14} />
      </IconButton>
    </PopoverTrigger>
    <PopoverContent
      align="end"
      side="top"
      sideOffset={6}
      style={{ width: '20rem', padding: 12, gap: 8 }}
    >
      <Flex gap={0.75}>
        {icon}
        <span style={{ fontSize: 12, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', color: accentColor }}>{title}</span>
      </Flex>
      <Typography variant="caption" style={{ lineHeight: 1.625 }}>
        {description}
      </Typography>
      <Box sx={{ pt: 1 }} style={{ borderTop: '1px solid var(--border)', fontSize: 11, color: 'var(--muted-foreground)' }}>
        <strong style={{ color: 'var(--foreground)' }}>Examples:</strong>{' '}
        <span style={{ fontStyle: 'italic' }}>{examples}</span>
      </Box>
    </PopoverContent>
  </Popover>
);

interface AuditInputFormProps {
  onSubmit: (params: AuditRequest) => void;
  isLoading: boolean;
  error: string | null;
  /** Where video URLs come from: 'channel' (own connected channels) or 'manual' (paste URLs) */
  videoSource?: 'channel' | 'manual';
  /** Video IDs already flagged "Optimized" (tagged/filtered in the picker). */
  optimizedVideoIds?: Set<string>;
  /** When true, disable the submit action (read-only org members). */
  disabled?: boolean;
}

export const AuditInputForm: React.FC<AuditInputFormProps> = ({
  onSubmit,
  isLoading,
  error,
  videoSource = 'channel',
  optimizedVideoIds,
  disabled = false,
}) => {
  const [selectedUrls, setSelectedUrls] = useState<string[]>([]);
  const [niche, setNiche] = useState('');
  const [targetAudience, setTargetAudience] = useState('');
  const [brandVoice, setBrandVoice] = useState('');
  const [showContext, setShowContext] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setValidationError(null);

    const urls = selectedUrls;

    if (urls.length === 0 && !niche && !targetAudience && !brandVoice) {
      setValidationError(
        'Please provide at least one YouTube URL or fill in the context details.',
      );
      return;
    }

    onSubmit({ urls, niche, targetAudience, brandVoice });
  };

  return (
    <form onSubmit={handleSubmit} className="rtis-input-card">
      {/* Video source picker -- either channel selection or manual URL entry */}
      <Box sx={{ mb: 3 }}>
        {videoSource === 'channel' ? (
          <>
            <div className="rtis-form-label">Choose Videos from Your Connected Channels</div>
            <div className="rtis-form-hint">
              Select a connected channel to fetch recent videos, then pick which thumbnails to audit.
            </div>
          </>
        ) : (
          <>
            <div className="rtis-form-label">Video URLs</div>
            <div className="rtis-form-hint">
              Paste YouTube video links below to run an automated visual CTR audit.
            </div>
          </>
        )}
        <ChannelVideoPicker
          onUrlsChange={setSelectedUrls}
          isLoading={isLoading}
          optimizedVideoIds={optimizedVideoIds}
        />
        {selectedUrls.length > 0 && (
          <Box
            sx={{
              mt: 1.5,
              px: 2,
              py: 1,
              bgcolor: 'var(--rt-color-bg-subtle)',
              borderRadius: 'var(--rt-radius-md)',
              border: '1px solid var(--rt-color-border)',
              fontSize: 'var(--rt-text-xs)',
              color: 'var(--rt-color-text)',
            }}
          >
            <strong>{selectedUrls.length}</strong> video(s) selected for audit
          </Box>
        )}
      </Box>

      {/* Strategic Context Parameters Section */}
      <Box
        sx={{
          mb: 3,
          p: 2.5,
          borderRadius: 'var(--rt-radius-lg)',
          bgcolor: 'var(--rt-color-bg-subtle)',
          border: '1px solid var(--rt-color-border)',
        }}
      >
        <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, flexWrap: 'wrap' }}>
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Lightbulb size={16} style={{ color: 'var(--rt-color-accent)' }} />
            <span style={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text)' }}>
              Strategic Context Parameters (Optional but Recommended)
            </span>
          </Box>
          <Button variant="ghost" bare onClick={() => setShowContext(!showContext)}>
            <Settings2 size={14} /> {showContext ? 'Hide' : 'Show'}{' '}
            Advanced Settings
          </Button>
        </Box>
        {showContext && (
          <Box sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', mb: 2.5, lineHeight: 1.5 }}>
            Providing your channel niche, audience demographic, and brand voice enables the AI engine to evaluate thumbnail positioning against your specific market expectations.
          </Box>
        )}

        {showContext && (
        <Grid container spacing={2.5}>
          {/* Field 1: Channel Niche */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box
                  component="label"
                  htmlFor="audit-niche-input"
                  sx={{
                    fontSize: 'var(--rt-text-xs)',
                    fontWeight: 'var(--rt-weight-medium)',
                    color: 'var(--rt-color-text)',
                  }}
                >
                  Channel Niche &amp; Category
                </Box>
                <FieldHelpPopover
                  title="Channel Niche & Category"
                  icon={<Tag size={13} />}
                  accentColor="var(--rt-color-accent)"
                  description="Defines your primary content category. Allows AI to benchmark color contrast and subject pop against niche standards."
                  examples="Software Dev, Personal Finance, Mobile Gaming, Fitness"
                />
              </Box>
              <TextField
                id="audit-niche-input"
                fullWidth
                multiline
                minRows={2}
                maxRows={3}
                placeholder="e.g. Personal Finance, Tech Reviews, Fitness..."
                value={niche}
                onChange={(e) => setNiche(e.target.value)}
                disabled={isLoading}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontSize: 'var(--rt-text-sm)',
                    borderRadius: 'var(--rt-radius-md)',
                    backgroundColor: 'var(--rt-color-bg-elevated)',
                  },
                }}
              />
            </Box>
          </Grid>

          {/* Field 2: Target Audience */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box
                  component="label"
                  htmlFor="audit-audience-input"
                  sx={{
                    fontSize: 'var(--rt-text-xs)',
                    fontWeight: 'var(--rt-weight-medium)',
                    color: 'var(--rt-color-text)',
                  }}
                >
                  Target Audience Persona
                </Box>
                <FieldHelpPopover
                  title="Target Audience Persona"
                  icon={<Users size={13} />}
                  accentColor="var(--rt-color-warning)"
                  description="Specifies your prospective viewer profile. The AI verifies whether text legibility, emotion, and hooks match viewer expectations."
                  examples="Gen Z Coders, Retail Investors, Busy Parents, Hardcore Gamers"
                />
              </Box>
              <TextField
                id="audit-audience-input"
                fullWidth
                multiline
                minRows={2}
                maxRows={3}
                placeholder="e.g. Gen Z Tech Enthusiasts, Beginners..."
                value={targetAudience}
                onChange={(e) => setTargetAudience(e.target.value)}
                disabled={isLoading}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontSize: 'var(--rt-text-sm)',
                    borderRadius: 'var(--rt-radius-md)',
                    backgroundColor: 'var(--rt-color-bg-elevated)',
                  },
                }}
              />
            </Box>
          </Grid>

          {/* Field 3: Brand Voice */}
          <Grid size={{ xs: 12, md: 4 }}>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box
                  component="label"
                  htmlFor="audit-brand-voice-input"
                  sx={{
                    fontSize: 'var(--rt-text-xs)',
                    fontWeight: 'var(--rt-weight-medium)',
                    color: 'var(--rt-color-text)',
                  }}
                >
                  Brand Voice &amp; Aesthetic Tone
                </Box>
                <FieldHelpPopover
                  title="Brand Voice & Aesthetic Tone"
                  icon={<Volume2 size={13} />}
                  accentColor="var(--rt-color-success)"
                  description="Sets your brand's visual identity. The AI checks if contrast, subject facial expressions, and clutter match your aesthetic tone."
                  examples="Minimalist & Sleek, High-Energy, Cinematic, Friendly & Warm"
                />
              </Box>
              <TextField
                id="audit-brand-voice-input"
                fullWidth
                multiline
                minRows={2}
                maxRows={3}
                placeholder="e.g. Minimalist, High Energy, Bold..."
                value={brandVoice}
                onChange={(e) => setBrandVoice(e.target.value)}
                disabled={isLoading}
                size="small"
                sx={{
                  '& .MuiOutlinedInput-root': {
                    fontSize: 'var(--rt-text-sm)',
                    borderRadius: 'var(--rt-radius-md)',
                    backgroundColor: 'var(--rt-color-bg-elevated)',
                  },
                }}
              />
            </Box>
          </Grid>
        </Grid>
        )}
      </Box>

      {/* Action Submit Button */}
      <Button
        type="submit"
        variant="contained"
        fullWidth
        disabled={isLoading || disabled || selectedUrls.length === 0}
        startIcon={!isLoading ? <Play size={16} /> : null}
        sx={{
          py: 1.25,
          fontWeight: 'var(--rt-weight-bold)',
          fontSize: 'var(--rt-text-md)',
          backgroundColor: 'var(--rt-color-btn-primary)',
          color: 'var(--rt-color-on-primary)',
          borderRadius: 'var(--rt-radius-md)',
          textTransform: 'none',
          boxShadow: 'none',
          '&:hover': {
            backgroundColor: 'var(--rt-color-btn-primary-hover)',
            boxShadow: 'none',
          },
          '&.Mui-disabled': {
            backgroundColor: 'var(--rt-color-bg-muted)',
            color: 'var(--rt-color-text-disabled)',
          },
        }}
      >
        {isLoading ? (
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
            <Spinner size={18} color="inherit" />
            <span>Initializing Audit Engine...</span>
          </Box>
        ) : (
          'Initialize Batch Audit'
        )}
      </Button>

      {/* Validation / Server Error Banner */}
      {(validationError || error) && (
        <div className="rtis-error-banner">
          <AlertCircle size={16} style={{ color: 'var(--rt-color-danger)', flexShrink: 0, marginTop: 2 }} />
          <span>{validationError || error}</span>
        </div>
      )}
    </form>
  );
};

