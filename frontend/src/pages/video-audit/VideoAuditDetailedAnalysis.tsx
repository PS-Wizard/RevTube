// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- Per-video element breakdown (spacious, un-nested layout)
// ─────────────────────────────────────────────────────────────────────────────
import { Box, Button, Progress } from '../../components/ui';
import {
  ArrowUpRight,
  Info,
  Tag,
  Type,
  AlignLeft,
  Image as ImageIcon,
  Subtitles,
  Key,
  Compass,
  FileCheck,
  Eye,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  type LucideIcon,
} from 'lucide-react';
import type {
  VideoAuditVideoResult,
  VideoAuditElementScore,
  VideoAuditRecommendation,
  VideoAuditSuggestion,
} from '../../types/videoAudit';
import type { ThumbnailAudit } from '../../types/thumbnailOptimizer';
import type { OptimizedField, OptimizedFields } from '../../services/optimizedFlagService';
import { OptimizedToggle } from '../../components/audit/OptimizedToggle';
import { useNavigate } from 'react-router-dom';
import { ELEMENT_FIELD_MAP } from './optimizedFields';
import {
  hasSuggestionContent,
  SuggestionBody,
} from '../../components/audit/VideoSuggestionBody';

const ELEMENT_CONFIG: Record<
  string,
  { label: string; icon: LucideIcon }
> = {
  title: { label: 'Title Optimization', icon: Type },
  description: { label: 'Description & Copy', icon: AlignLeft },
  tags: { label: 'Tags & Search Meta', icon: Tag },
  keywords: { label: 'Target Keywords', icon: Key },
  thumbnail: { label: 'Thumbnail & Visual Hook', icon: ImageIcon },
  captions: { label: 'Captions & Accessibility', icon: Subtitles },
};

const CATEGORY_META: readonly { key: string; label: string; icon: LucideIcon }[] = [
  { key: 'discoverability', label: 'Discoverability', icon: Compass },
  { key: 'contentQuality', label: 'Content Quality', icon: FileCheck },
  { key: 'visualHook', label: 'Visual Hook', icon: Eye },
] as const;

function pct(score: number, max: number): number {
  return max > 0 ? Math.min(100, (score / max) * 100) : 0;
}

function getProgressColor(p: number): 'success' | 'warning' | 'error' {
  if (p >= 80) return 'success';
  if (p >= 50) return 'warning';
  return 'error';
}

function RecoCard({
  recommendation,
  suggestion,
}: {
  recommendation: VideoAuditRecommendation;
  suggestion?: VideoAuditSuggestion;
}) {
  // The AI "Recommended Alternative" must carry real copy for this element (actual
  // alt titles, a description rewrite, suggested tags/keywords, thumbnail concepts).
  // If the model didn't produce it (or everything fell below the quality bar), the
  // card is dropped entirely -- never shown with generic "improve this / refresh"
  // copy, and never a bare "+X pts" with an empty body.
  if (!hasSuggestionContent(recommendation.element, suggestion)) return null;

  const body = <SuggestionBody element={recommendation.element} suggestion={suggestion!} />;
  return (
    <Box className="va-flat-reco">
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.5 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5 }}>
          <ArrowUpRight size={13} style={{ color: 'var(--rt-color-accent)' }} />
          <span className="va-flat-reco-title">Recommended Alternative</span>
        </Box>
        <span className="va-uplift-pill">+{recommendation.delta.toFixed(0)} pts</span>
      </Box>

      <Box sx={{ fontSize: 'var(--rt-text-2xs)', color: 'var(--rt-color-text-secondary)', mb: 0.75 }}>
        {recommendation.delta.toFixed(0)} pts potential uplift
      </Box>

      {body}

      {suggestion?.why && (
        <Box className="va-flat-reco-why">
          <Info size={11} style={{ color: 'var(--rt-color-accent)', flexShrink: 0, marginTop: 2 }} />
          <span>{suggestion.why}</span>
        </Box>
      )}
    </Box>
  );
}

function CriterionIcon({ earned, max }: { earned: number; max: number }) {
  const p = max > 0 ? (earned / max) * 100 : 0;
  if (p >= 80) return <CheckCircle2 size={12} style={{ color: 'var(--rt-color-success)', flexShrink: 0 }} />;
  if (p >= 40) return <AlertTriangle size={12} style={{ color: 'var(--rt-color-warning)', flexShrink: 0 }} />;
  return <XCircle size={12} style={{ color: 'var(--rt-color-danger)', flexShrink: 0 }} />;
}

function ElementRow({
  element,
  recommendation,
  suggestion,
  thumbnailAnalysis,
  videoId,
  niche,
  savedAuditId,
  optimizedFields,
  onToggleField,
}: {
  element: VideoAuditElementScore;
  recommendation?: VideoAuditRecommendation;
  suggestion?: VideoAuditSuggestion;
  thumbnailAnalysis?: ThumbnailAudit;
  videoId?: string;
  niche?: string;
  savedAuditId?: number;
  /** Per-field optimization status for this element's video. */
  optimizedFields?: OptimizedFields;
  /** Toggle the "optimized" flag for one field of this element's video. */
  onToggleField?: (field: OptimizedField) => void;
}) {
  const navigate = useNavigate();
  const config = ELEMENT_CONFIG[element.element] ?? { label: element.element, icon: FileCheck };
  const IconComponent = config.icon;
  // A no-data element (e.g. captions never fetched) has no score to show and
  // must NOT read as a scored zero. Render it as N/A with a neutral bar.
  const hasNoData = element.breakdown.every((b) => b.note === 'no data');
  const p = hasNoData ? 0 : pct(element.score, element.max);
  const colorType = hasNoData ? 'inherit' : getProgressColor(p);
  const isThumbnail = element.element === 'thumbnail';
  // The optimized-list field this element maps to (undefined -> not tracked).
  const optField = ELEMENT_FIELD_MAP[element.element];

  const openDetailedThumbnail = () => {
    if (!videoId) return;
    if (savedAuditId) {
      // Preferred path: this run already persisted its child analyses as the
      // "Video Audit -- <date>" entry in the Thumbnail Optimizer history.
      // Open that saved entry and let the page scroll to this video --
      // identical data, zero extra AI cost.
      const params = new URLSearchParams({ audit: String(savedAuditId), scroll: videoId });
      navigate(`/thumbnail-optimizer?${params.toString()}`);
      return;
    }
    // Fallback (runs persisted before saving existed / save skipped): kick off
    // a fresh full child audit via the auto-run handoff params.
    const params = new URLSearchParams({
      video: videoId,
      niche: niche || 'General',
      auto: '1',
    });
    navigate(`/thumbnail-optimizer?${params.toString()}`);
  };

  return (
    <Box className="va-flat-element-row">
      {/* Element Header & Score Bar */}
      <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', mb: 0.75 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
          <IconComponent size={14} />
          <span className="va-flat-element-name">{config.label}</span>
        </Box>
        {hasNoData ? (
          <span className="va-flat-element-score" style={{ color: 'var(--rt-color-text-tertiary)' }}>
            N/A
          </span>
        ) : (
          <span className="va-flat-element-score" style={{ color: `var(--rt-color-${colorType})` }}>
            {element.score.toFixed(0)} <span className="va-flat-element-max">/{element.max.toFixed(0)} pts</span>
          </span>
        )}
        {optField && onToggleField && (
          <OptimizedToggle
            compact
            kindLabel="Video Audit"
            optimized={!!optimizedFields?.[optField]}
            labelOff="Mark Optimize"
            onClick={() => onToggleField(optField)}
          />
        )}
      </Box>

      <Progress
        variant="determinate"
        value={p}
        color={colorType}
        sx={{
          height: 3,
          borderRadius: 'var(--rt-radius-pill)',
          bgcolor: 'var(--rt-color-bg-subtle)',
          mb: 1.5,
          ...(hasNoData ? { '& .MuiLinearProgress-bar': { bgcolor: 'var(--rt-color-border)' } } : {}),
        }}
      />

      {/* Clean, open criteria list (skipped for no-data elements: the italic
          "No data available" note below replaces a redundant list of N/A rows) */}
      {element.breakdown.length > 0 && !hasNoData && (
        <Box className="va-flat-criteria-list">
          {element.breakdown.map((b, i) => {
            const isNoDataRow = b.max === 0;
            const rowPct = b.max > 0 ? (b.earned / b.max) * 100 : 0;
            const rowColor = rowPct >= 80 ? 'var(--rt-color-success)' : rowPct >= 40 ? 'var(--rt-color-warning)' : 'var(--rt-color-danger)';
            return (
              <Box key={i} className="va-flat-criterion-item">
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75, minWidth: 0 }}>
                  <CriterionIcon earned={b.earned} max={b.max} />
                  <span className="va-flat-criterion-name">{b.criterion}</span>
                  {b.note && <span className="va-flat-criterion-note">({b.note})</span>}
                </Box>
                <span
                  className="va-flat-criterion-score"
                  style={{ color: isNoDataRow ? 'var(--rt-color-text-tertiary)' : rowColor }}
                >
                  {isNoDataRow ? 'N/A' : `${b.earned.toFixed(0)}/${b.max.toFixed(0)}`}
                </span>
              </Box>
            );
          })}
        </Box>
      )}

      {hasNoData && (
        <Box sx={{ fontSize: 'var(--rt-text-2xs)', color: 'var(--rt-color-text-tertiary)', fontStyle: 'italic', py: 0.5 }}>
          No data available for this element in YouTube metadata.
        </Box>
      )}

      {/* Thumbnail element: show the general-knowledge summary from the 12-pillar
          Thumbnail Optimizer audit. The full per-pillar "child audit" runs on the
          Thumbnail Optimizer page via the detailed button below. */}
      {isThumbnail && thumbnailAnalysis && (
        <Box
          sx={{
            mt: 1,
            p: 1.25,
            borderRadius: 'var(--rt-radius-sm)',
            bgcolor: 'var(--rt-color-bg-elevated)',
            border: '1px solid var(--rt-color-border)',
          }}
        >
          <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.5, mb: 0.5 }}>
            <Info size={12} style={{ color: 'var(--rt-color-accent)', flexShrink: 0 }} />
            <span style={{ fontSize: 'var(--rt-text-2xs)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text)' }}>
              General Knowledge
            </span>
          </Box>
          <Box
            sx={{
              fontSize: 'var(--rt-text-xs)',
              color: 'var(--rt-color-text-secondary)',
              lineHeight: 1.5,
            }}
          >
            {thumbnailAnalysis.reviewSummary}
          </Box>

          <Box sx={{ display: 'flex', justifyContent: 'flex-end', mt: 0.75 }}>
            <Button
              size="small"
              variant="outlined"
              onClick={openDetailedThumbnail}
              disabled={!videoId}
              startIcon={<ArrowUpRight size={12} />}
              sx={{
                textTransform: 'none',
                fontSize: 'var(--rt-text-2xs)',
                py: 0.25,
                px: 1,
                minHeight: 24,
                borderRadius: 'var(--rt-radius-sm)',
                color: 'var(--rt-color-accent)',
                borderColor: 'var(--rt-color-accent)',
                '&:hover': {
                  bgcolor: 'var(--rt-color-accent-surface)',
                  borderColor: 'var(--rt-color-accent)',
                },
              }}
            >
              Detailed Thumbnail Analysis
            </Button>
          </Box>
        </Box>
      )}

      {/* Surface a recommendation card whenever the audit computed a real uplift
          (+X pts) for this element. The AI "Recommended Alternative" copy is
          shown only when it was generated (a separate LLM call that can fail or
          be unavailable); without it we still show the numeric uplift + a
          helpful fallback so the user never sees nothing on an improvable
          element. The thumbnail element is handled separately above (General
          Knowledge summary + "Detailed Thumbnail Analysis" button) since it
          reuses the Thumbnail Optimizer's 12-pillar audit, not text-style
          alternatives. */}
      {recommendation && !isThumbnail && (
        <RecoCard recommendation={recommendation} suggestion={suggestion} />
      )}
    </Box>
  );
}

export function VideoAuditDetailedAnalysis({
  result,
  savedAuditId,
  optimizedFields,
  onToggleField,
}: {
  result: VideoAuditVideoResult;
  /** thumbnail_audits row id persisted for this run (enables history deep-link). */
  savedAuditId?: number;
  /** Per-field optimization status for this video. */
  optimizedFields?: OptimizedFields;
  /** Toggle the "optimized" flag for one field of this video. */
  onToggleField?: (field: OptimizedField) => void;
}) {
  const recoByElement = new Map((result.recommendations ?? []).map((r) => [r.element, r]));
  const suggestions = result.suggestions ?? {};

  const categoryOf = new Map<string, string>();
  for (const cat of result.categories ?? []) {
    for (const el of cat.elements) categoryOf.set(el, cat.key);
  }

  // The channel niche is surfaced by the audit request; we don't echo it on the
  // result today, so default to "General". The Thumbnail Optimizer page reuses
  // its own niche selector; this only seeds the auto-run URL.
  const niche = 'General';

  return (
    <Box sx={{ display: 'flex', flexDirection: 'column', gap: 4, py: 1 }}>
      {CATEGORY_META.map((cat) => {
        const els = result.elements.filter(
          (el) => (categoryOf.get(el.element) ?? 'discoverability') === cat.key,
        );
        if (els.length === 0) return null;
        const CatIcon = cat.icon;

        return (
          <Box key={cat.key} className="va-flat-category-block">
            <Box className="va-flat-category-header">
              <Box sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                <CatIcon size={15} style={{ color: 'var(--rt-color-accent)' }} />
                <span className="va-flat-category-title">{cat.label}</span>
              </Box>
            </Box>

            <Box className="va-flat-elements-grid">
              {els.map((el) => (
                <ElementRow
                  key={el.element}
                  element={el}
                  recommendation={recoByElement.get(el.element)}
                  suggestion={suggestions[el.element]}
                  thumbnailAnalysis={el.thumbnailAnalysis}
                  videoId={result.videoId}
                  niche={niche}
                  savedAuditId={savedAuditId}
                  optimizedFields={optimizedFields}
                  onToggleField={onToggleField}
                />
              ))}
            </Box>
          </Box>
        );
      })}
    </Box>
  );
}
