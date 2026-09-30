// ─────────────────────────────────────────────────────────────────────────────
// VideoSuggestionBody — renders the actionable AI copy for one weak element:
// alt titles, description rewrite, suggested tags/keywords, thumbnail
// concepts, plus copy buttons and per-alternative score pills.
//
// Shared by the Video Audit detailed analysis and the Public Audit video
// inspector so both surfaces show the same "what to do" instead of bare
// uplift numbers. Alternatives scoring below MIN_ALT_SCORE are treated as
// weak filler and hidden.
// ─────────────────────────────────────────────────────────────────────────────
/* eslint-disable react-refresh/only-export-components -- shared renderer + its pure helpers */
import { useState } from 'react';
import { Copy, Check, Lightbulb, Tag } from 'lucide-react';
import toast from 'react-hot-toast';
import { Box, Button, Tooltip } from '../ui';
import type { VideoAuditSuggestion } from '../../types/videoAudit';

export const MIN_ALT_SCORE = 70;

// Whether a suggestion actually carries substantial content for this element.
// Mirrors the exact conditions SuggestionBody uses to render (so callers never
// build a "Recommended Alternative" card that ends up with an empty body).
export function hasSuggestionContent(element: string, suggestion?: VideoAuditSuggestion): boolean {
  if (!suggestion) return false;
  const keep = (sc?: number) => typeof sc !== 'number' || sc >= MIN_ALT_SCORE;
  if (element === 'title') return (suggestion.options ?? []).some((_, i) => keep(suggestion.scores?.[i]));
  if (element === 'description') return !!suggestion.rewrite;
  if (element === 'tags' || element === 'keywords')
    return (suggestion.suggested ?? []).some((_, i) => keep(suggestion.scores?.[i]));
  if (element === 'thumbnail') return (suggestion.concepts ?? []).length > 0;
  return false;
}

export function CopyButton({
  text,
  label = 'Copy',
  toastMsg = 'Copied to clipboard!',
}: {
  text: string;
  label?: string;
  toastMsg?: string;
}) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      toast.success(toastMsg);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error('Failed to copy');
    }
  };

  return (
    <Button
      size="small"
      variant="text"
      onClick={handleCopy}
      startIcon={copied ? <Check size={12} /> : <Copy size={12} />}
      sx={{
        textTransform: 'none',
        fontSize: 'var(--rt-text-2xs)',
        py: 0.25,
        px: 1,
        minHeight: 22,
        borderRadius: 'var(--rt-radius-sm)',
        color: copied ? 'var(--rt-color-success)' : 'var(--rt-color-accent)',
        bgcolor: copied ? 'var(--rt-color-success-surface)' : 'transparent',
        '&:hover': {
          bgcolor: 'var(--rt-color-bg-highlight)',
        },
      }}
    >
      {copied ? 'Copied' : label}
    </Button>
  );
}

export function AltScorePill({ score }: { score: number }) {
  const color = score >= 80 ? 'var(--rt-color-success)' : score >= 50 ? 'var(--rt-color-warning)' : 'var(--rt-color-danger)';
  return (
    <Box
      sx={{
        flexShrink: 0,
        px: 1,
        py: 0.2,
        borderRadius: 'var(--rt-radius-pill)',
        fontSize: 'var(--rt-text-2xs)',
        fontWeight: 'var(--rt-weight-bold)',
        color,
        bgcolor: 'var(--rt-color-bg-subtle)',
        border: '1px solid var(--rt-color-border)',
        minWidth: 34,
        textAlign: 'center',
      }}
    >
      {score}
    </Box>
  );
}

export function SuggestionBody({
  element,
  suggestion,
}: {
  element: string;
  suggestion: VideoAuditSuggestion;
}) {
  if (element === 'title' && suggestion.options?.length) {
    // Only show alternatives that scored >= MIN_ALT_SCORE; the model is told to
    // produce strong ones, but this is the safety net against weak filler.
    const pairs = suggestion.options
      .map((opt, i) => ({ opt, sc: suggestion.scores?.[i] }))
      .filter((p) => typeof p.sc !== 'number' || p.sc >= MIN_ALT_SCORE);
    if (pairs.length === 0) return null;
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
        {pairs.map(({ opt, sc }, i) => (
          <Box
            key={i}
            sx={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              gap: 1.5,
              py: 0.75,
              px: 1.25,
              borderRadius: 'var(--rt-radius-sm)',
              bgcolor: 'var(--rt-color-bg-elevated)',
              border: '1px solid var(--rt-color-border)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'baseline', gap: 1, flex: 1, minWidth: 0 }}>
              <span
                style={{
                  fontSize: 'var(--rt-text-2xs)',
                  fontWeight: 'var(--rt-weight-bold)',
                  color: 'var(--rt-color-accent)',
                }}
              >
                {i + 1}.
              </span>
              <span
                style={{
                  fontSize: 'var(--rt-text-xs)',
                  color: 'var(--rt-color-text)',
                  lineHeight: 1.4,
                  wordBreak: 'break-word',
                }}
              >
                {opt}
              </span>
            </Box>
            {typeof sc === 'number' && (
              <AltScorePill score={sc} />
            )}
            <CopyButton text={opt} label="Copy" toastMsg="Title copied!" />
          </Box>
        ))}
      </Box>
    );
  }

  if (element === 'description' && suggestion.rewrite) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
        <Box
          sx={{
            p: 1.5,
            borderRadius: 'var(--rt-radius-sm)',
            bgcolor: 'var(--rt-color-bg-elevated)',
            border: '1px solid var(--rt-color-border)',
            fontSize: 'var(--rt-text-xs)',
            color: 'var(--rt-color-text)',
            lineHeight: 1.5,
            whiteSpace: 'pre-wrap',
            maxHeight: 140,
            overflowY: 'auto',
          }}
        >
          {suggestion.rewrite}
        </Box>
        {typeof suggestion.score === 'number' && <AltScorePill score={suggestion.score} />}
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <CopyButton text={suggestion.rewrite} label="Copy Description" toastMsg="Description copied!" />
        </Box>
      </Box>
    );
  }

  if ((element === 'tags' || element === 'keywords') && suggestion.suggested?.length) {
    // Keep only the genuinely strong tags/keywords (score >= MIN_ALT_SCORE).
    const pairs = suggestion.suggested
      .map((t, i) => ({ t, sc: suggestion.scores?.[i] }))
      .filter((p) => typeof p.sc !== 'number' || p.sc >= MIN_ALT_SCORE);
    if (pairs.length === 0) return null;
    const allTagsString = pairs.map((p) => p.t).join(', ');
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1, mt: 1 }}>
        <Box sx={{ display: 'flex', flexWrap: 'wrap', gap: 0.75 }}>
          {pairs.map(({ t, sc }, i) => (
            <Tooltip key={i} title="Click to copy tag" arrow>
              <Box
                onClick={async () => {
                  await navigator.clipboard.writeText(t);
                  toast.success(`Tag "${t}" copied!`);
                }}
                sx={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 0.5,
                  fontSize: 'var(--rt-text-xs)',
                  px: 1,
                  py: 0.25,
                  borderRadius: 'var(--rt-radius-pill)',
                  bgcolor: 'var(--rt-color-bg-elevated)',
                  border: '1px solid var(--rt-color-border)',
                  color: 'var(--rt-color-text)',
                  cursor: 'pointer',
                  '&:hover': {
                    borderColor: 'var(--rt-color-accent)',
                    color: 'var(--rt-color-accent)',
                  },
                }}
              >
                <Tag size={10} style={{ opacity: 0.6 }} />
                <span>{t}</span>
                {typeof sc === 'number' && (
                  <span
                    style={{
                      marginLeft: 4,
                      fontSize: 'var(--rt-text-2xs)',
                      fontWeight: 'var(--rt-weight-bold)',
                      color: sc >= 80 ? 'var(--rt-color-success)' : sc >= 50 ? 'var(--rt-color-warning)' : 'var(--rt-color-danger)',
                    }}
                  >
                    {sc}
                  </span>
                )}
              </Box>
            </Tooltip>
          ))}
        </Box>
        <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
          <CopyButton text={allTagsString} label="Copy All (Comma Separated)" toastMsg="All tags copied!" />
        </Box>
      </Box>
    );
  }

  if (element === 'thumbnail' && suggestion.concepts?.length) {
    return (
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 0.75, mt: 1 }}>
        {suggestion.concepts.map((c, i) => (
          <Box
            key={i}
            sx={{
              display: 'flex',
              alignItems: 'flex-start',
              justifyContent: 'space-between',
              gap: 1,
              py: 0.5,
              px: 1,
              borderRadius: 'var(--rt-radius-sm)',
              bgcolor: 'var(--rt-color-bg-elevated)',
              border: '1px solid var(--rt-color-border)',
            }}
          >
            <Box sx={{ display: 'flex', alignItems: 'flex-start', gap: 0.75, flex: 1 }}>
              <Lightbulb size={12} style={{ color: 'var(--rt-color-accent)', marginTop: 3, flexShrink: 0 }} />
              <span style={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text)', lineHeight: 1.4 }}>
                {c}
              </span>
            </Box>
            <CopyButton text={c} label="Copy" toastMsg="Concept copied!" />
          </Box>
        ))}
      </Box>
    );
  }

  return null;
}
