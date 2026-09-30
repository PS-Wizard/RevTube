// ─────────────────────────────────────────────────────────────────────────────
// Thumbnail Optimizer -- Main page component
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef } from 'react';
import {
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  Menu,
  Modal,
  IconButton,
  Tooltip,
  ListItemIcon,
  ListItemText,
} from '../../components/ui';
import { MenuItem } from '../../components/ui/Menu';
import { Download, HelpCircle, Eye, Palette, CheckCircle2, Image, BookOpen, Lock, Zap, Magnet, Layers, Search, Heart, Minus, Lightbulb, ChevronRight, FileText, FileSpreadsheet, Table2 } from 'lucide-react';
import { useSessionJobId } from '../../hooks/useSessionJobId';
import { useSearchParams } from 'react-router-dom';
import { useOrganization } from '../../hooks/useOrganization';
import { AuditInputForm } from './AuditInputForm';
import { AuditTable } from './AuditTable';
import { AuditReportHeader } from './AuditReportHeader';
import { AverageScoringSummary } from './AverageScoringSummary';
import { HistoryPanel } from './HistoryPanel';
import { downloadIndividualPDF, downloadExcel, downloadCSV } from '../../services/thumbnailOptimizerExport';
import { ThumbnailOptimizerService } from '../../services/thumbnailOptimizerService';
import type { ThumbnailAudit, AuditRequest, SavedAudit } from '../../types/thumbnailOptimizer';

import { useOptimizedFlags } from '../../hooks/useOptimizedFlags';
import { OptimizedToggle } from '../../components/audit/OptimizedToggle';
import { fetchOptimizerCriteria, DEFAULT_OPTIMIZER_CRITERIA, type ThumbnailPillarCfg } from '../../services/optimizerCriteriaService';
import { EmptyState } from '../../components/EmptyState';
import { AuditToolShell } from '../../components/audit/AuditToolShell';
import { AuditLoadingState } from '../../components/audit/AuditLoadingState';
import { ThumbnailDeepDive } from './ThumbnailDeepDive';
import { AuditToolBody } from '../../components/audit/AuditToolBody';
import './ThumbnailOptimizerPage.css';


export interface AuditResponseData {
  results: ThumbnailAudit[];
  errors?: Array<{ url: string; error: string }>;
}

type PageView = 'audit' | 'history';

const LOADING_MESSAGES = [
  'Analyzing visual hierarchy...',
  'Evaluating color contrasts...',
  'Scanning emotional triggers...',
  'Measuring text readability...',
  'Synthesizing optimization reports...',
];

function extractVideoId(url: string): string {
  try {
    const u = new URL(url);
    if (u.hostname.includes('youtube.com') && u.pathname === '/watch') return u.searchParams.get('v') || '';
    if (u.hostname === 'youtu.be') return u.pathname.slice(1).split('/')[0] || '';
    if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/embed/')) return u.pathname.split('/')[2] || '';
    if (u.hostname.includes('youtube.com') && u.pathname.startsWith('/shorts/')) return u.pathname.split('/')[2] || '';
  } catch { /* not a URL */ }
  return url.replace(/^.*[\\/]/, '').slice(0, 11);
}

// Icon + tier color lookups for the Rating Guide's centralized pillar list.
const PILLAR_ICONS: Record<string, React.ReactNode> = {
  promise_lock: <Lock size={15} />,
  one_idea_rule: <Lightbulb size={15} />,
  scroll_stop_contrast: <Eye size={15} />,
  emotional_signal: <Heart size={15} />,
  thumb_magnet: <Magnet size={15} />,
  open_loop: <Search size={15} />,
  visual_flow: <Palette size={15} />,
  glance_readability: <Layers size={15} />,
  pattern_break: <Zap size={15} />,
  execution_polish: <CheckCircle2 size={15} />,
  word_economy: <Minus size={15} />,
  platform_compliance: <Image size={15} />,
};
const PILLAR_TIER_COLOR: Record<string, string> = {
  Red: 'var(--rt-color-danger)',
  Yellow: 'var(--rt-color-warning)',
  Grey: 'var(--rt-color-text-tertiary)',
};

export function ThumbnailOptimizerPage() {
  const { currentOrganization, canRunAudits } = useOrganization();
  const [searchParams, setSearchParams] = useSearchParams();

  // Default "Optimized" list for thumbnail-audited videos
  const { optimizedIds, toggle: toggleOptimized } = useOptimizedFlags('thumbnail');

  // Wrap the thumbnail-list toggle so the mirrored Video Management entry
  // carries title + artwork (the service syncs the Thumbnail checkbox, and
  // the Optimized Content page needs the image to render the row).
  const handleToggleThumbnailOptimized = (videoId: string, label?: string) => {
    const thumbnailUrl = videoId ? `https://i.ytimg.com/vi/${videoId}/hqdefault.jpg` : undefined;
    toggleOptimized(videoId, label, thumbnailUrl);
  };

  // Job id persisted in sessionStorage so a running analysis survives page
  // navigation / tab close; the Layout-level watcher keeps polling meanwhile.
  const [jobId, setJobId] = useSessionJobId('thumbnail-optimizer', currentOrganization?.id);

  const [audits, setAudits] = useState<ThumbnailAudit[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState('Initializing audit engine...');
  const [hasRun, setHasRun] = useState(false);
  const [isRunning, setIsRunning] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Export dropdown anchor, keyed by audit index
  const [exportMenuAnchor, setExportMenuAnchor] = useState<{ el: HTMLElement; index: number } | null>(null);

  // Persistence & Dialog state
  const [pageView, setPageView] = useState<PageView>('audit');
  const [guideDialogOpen, setGuideDialogOpen] = useState(false);
  const [loadingSaved, setLoadingSaved] = useState<number | null>(null);
  // Centralized thumbnail pillars loaded for the Rating Guide dialog (so the
  // displayed criteria + points always match the config admins control).
  const [guidePillars, setGuidePillars] = useState<ThumbnailPillarCfg[]>([]);

  useEffect(() => {
    if (!guideDialogOpen) return;
    let cancelled = false;
    fetchOptimizerCriteria()
      .then((cfg) => {
        if (!cancelled) setGuidePillars(cfg.thumbnail.length ? cfg.thumbnail : DEFAULT_OPTIMIZER_CRITERIA.thumbnail);
      })
      .catch(() => {
        if (!cancelled) setGuidePillars(DEFAULT_OPTIMIZER_CRITERIA.thumbnail);
      });
    return () => {
      cancelled = true;
    };
  }, [guideDialogOpen]);

  function clearLoadingInterval() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  // Resume polling when returning to the page with an in-flight sessionStorage job.
  useEffect(() => {
    if (jobId) setIsRunning(true);
  }, [jobId]);

  // Poll the background job while it is active. Completion clears the jobId;
  // the worker already persisted the result to history.
  useEffect(() => {
    if (!jobId || !isRunning) return;
    let cancelled = false;
    let pollTimer: ReturnType<typeof setInterval> | null = null;

    const applyResult = (status: {
      state: string;
      result?: { savedId?: number; kind?: string; result?: AuditResponseData };
    }) => {
      if (cancelled) return;
      if (status.state === 'completed' && status.result?.result) {
        const { results, errors } = status.result.result;
        setAudits(results);
        setHasRun(true);
        setPageView('audit');
        setIsRunning(false);
        setJobId(null);
        clearLoadingInterval();
        if (errors && errors.length > 0) {
          setError(`Some videos failed to analyze:\n${errors.map((e) => `${e.url}: ${e.error}`).join('\n').slice(0, 1000)}`);
        }
      } else if (status.state === 'failed') {
        setIsRunning(false);
        setJobId(null);
        clearLoadingInterval();
        setHasRun(true);
        setError('Thumbnail analysis job failed. Please try again.');
      }
    };

    const poll = async () => {
      try {
        applyResult(await ThumbnailOptimizerService.getJobStatus(jobId));
      } catch (err) {
        if (!cancelled) {
          setIsRunning(false);
          setJobId(null);
          clearLoadingInterval();
          setError(err instanceof Error ? err.message : 'Failed to check analysis status.');
        }
      }
    };

    pollTimer = setInterval(poll, 4000);
    void poll();

    // Rotate loading messages while running.
    let idx = 0;
    setLoadingText(LOADING_MESSAGES[0]);
    intervalRef.current = setInterval(() => {
      idx = (idx + 1) % LOADING_MESSAGES.length;
      setLoadingText(LOADING_MESSAGES[idx]);
    }, 2500);

    return () => {
      cancelled = true;
      if (pollTimer) clearInterval(pollTimer);
      clearLoadingInterval();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId, isRunning]);

  // Child audit handoff: when the Video Audit page links here with
  // ?video=<id>&niche=<niche>&auto=1, kick off the full 12-pillar audit for
  // that one video automatically on mount. Fires once per distinct URL.
  useEffect(() => {
    const auto = searchParams.get('auto');
    const videoId = searchParams.get('video');
    if (auto !== '1' || !videoId) return;
    if (jobId || isRunning) return;
    const niche = searchParams.get('niche') || 'General';
    const watchUrl = `https://www.youtube.com/watch?v=${videoId}`;
    void handleSubmit({ urls: [watchUrl], niche, targetAudience: '', brandVoice: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // History handoff from the Video Audit deep-dive: ?audit=<id>&scroll=<videoId>
  // opens the persisted "Video Audit -- <date>" entry directly in the results
  // view (reusing handleLoadAudit -- no AI re-run) and scrolls/expands the row
  // of the video that was clicked.
  const scrollToRef = useRef<string | null>(null);
  useEffect(() => {
    const auditParam = searchParams.get('audit');
    if (!auditParam) return;
    const auditId = Number(auditParam);
    if (!Number.isFinite(auditId) || auditId <= 0) return;
    scrollToRef.current = searchParams.get('scroll');
    // A still-running earlier session would keep its loading card above the
    // loaded results; stop it like the failed-job path does.
    if (isRunning) {
      setIsRunning(false);
      clearLoadingInterval();
      setJobId(null);
    }
    void handleLoadAudit(auditId);
    searchParams.delete('audit');
    searchParams.delete('scroll');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Once the saved audits render, smooth-scroll to the deep-linked video.
  useEffect(() => {
    const target = scrollToRef.current;
    if (!target || audits.length === 0 || pageView !== 'audit' || isRunning) return;
    scrollToRef.current = null;
    const timer = setTimeout(() => {
      document.getElementById(`thumb-audit-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
    return () => clearTimeout(timer);
  }, [audits, pageView, isRunning]);

  const handleSubmit = async (params: AuditRequest) => {
    setError(null);
    setAudits([]);
    setHasRun(true);
    setPageView('audit');
    try {
      const { jobId: newJobId } = await ThumbnailOptimizerService.enqueueJob(params, currentOrganization?.id);
      setJobId(newJobId);
      setIsRunning(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start thumbnail analysis.');
      setHasRun(true);
    }
  };

  const handleExportSingle = (audit: ThumbnailAudit) => {
    downloadIndividualPDF(audit);
  };

  // Cross-video table row click -- expand + smooth-scroll to the video's
  // deep-dive accordion below. The deep-dive accordions are uncontrolled
  // (defaultExpanded for the deep-link handoff), so a collapsed one is expanded
  // by dispatching a bubbling click on its summary; S.N. in the table matches
  // the accordion badge numbers (both iterate `audits` in the same order).
  const handleInspectVideo = (videoId: string) => {
    if (!videoId) return;
    const el = document.getElementById(`thumb-audit-${videoId}`);
    if (!el) return;
    if (el.getAttribute('aria-expanded') !== 'true') {
      el.querySelector<HTMLElement>('.MuiAccordionSummary-root')
        ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  // ── Load saved audit ─────────────────────────────────────────────────────

  const handleLoadAudit = async (id: number) => {
    setLoadingSaved(id);
    setError(null);
    try {
      const saved: SavedAudit = await ThumbnailOptimizerService.getHistory(id);
      setAudits(saved.audits);
      setHasRun(true);
      setPageView('audit');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load saved audit.');
    } finally {
      setLoadingSaved(null);
    }
  };

  return (
    <AuditToolShell
      title="Thumbnail Optimizer"
      description="Maximize YouTube Visibility & Click-Through Rate (CTR) using AI visual audit & strategic recommendations"
      icon={<Image size={20} />}
      actions={
        <Tooltip title="View Optimization Engine & Rating Guide" arrow placement="top">
          <IconButton
            size="small"
            onClick={() => setGuideDialogOpen(true)}
            aria-label="Thumbnail Optimizer details and guide"
            sx={{ color: "var(--rt-color-text-secondary)" }}
          >
            <HelpCircle size={20} />
          </IconButton>
        </Tooltip>
      }
      tabs={{
        items: [
          { value: 'audit', label: 'New Audit' },
          { value: 'history', label: 'Saved Audits' },
        ],
        value: pageView,
        onChange: (value) => setPageView(value as PageView),
      }}
    >
      <AuditToolBody>

        {pageView === 'audit' ? (
          <>
            {/* Input form */}
            <AuditInputForm
              onSubmit={handleSubmit}
              isLoading={isRunning}
              error={error}
              optimizedVideoIds={optimizedIds}
              disabled={!canRunAudits}
            />

            {/* Loading state */}
            {isRunning && (
              <AuditLoadingState
                title={loadingText}
                subtitle="AI Multi-dimensional Visual Analysis in Progress"
              />
            )}

            {/* Success state */}
            {!isRunning && audits.length > 0 && (
              <>
                <AuditReportHeader audits={audits} />

                <AuditTable audits={audits} optimizedIds={optimizedIds} onToggleOptimized={handleToggleThumbnailOptimized} onInspectVideo={handleInspectVideo} />

                <AverageScoringSummary audits={audits} />

                <Box sx={{ mt: 6 }}>
                  <div className="rtis-section-header-bar">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Layers size={16} style={{ color: 'var(--rt-color-accent)' }} />
                      <span className="rtis-section-heading">Individual Deep Dives</span>
                    </Box>
                  </div>

                  {audits.map((audit, index) => {
                    const videoId = extractVideoId(audit.url);
                    return (
                      <Accordion
                        key={index}
                        id={`thumb-audit-${videoId}`}
                        defaultExpanded={index === 0 || scrollToRef.current === videoId}
                        className="rtis-video-accordion"
                        disableGutters
                      >
                        {/* ── Collapsed summary: #, video ID, title, avg score ── */}
                        <AccordionSummary
                          expandIcon={<ChevronRight size={18} style={{ color: 'var(--rt-color-text-tertiary)' }} />}
                          sx={{
                            px: 2,
                            py: 0.5,
                            minHeight: 48,
                            '&.Mui-expanded': { minHeight: 48 },
                            '& .MuiAccordionSummary-content': { my: 1, alignItems: 'center' },
                            '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': { transform: 'rotate(90deg)' },
                          }}
                        >
                          <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0 }}>
                            {/* Item number badge */}
                            <Box
                              sx={{
                                width: 28,
                                height: 28,
                                borderRadius: 'var(--rt-radius-sm)',
                                bgcolor: 'var(--rt-color-bg-subtle)',
                                border: '1px solid var(--rt-color-border)',
                                display: 'flex',
                                alignItems: 'center',
                                justifyContent: 'center',
                                fontSize: 'var(--rt-text-xs)',
                                fontWeight: 'var(--rt-weight-bold)',
                                color: 'var(--rt-color-text-secondary)',
                                flexShrink: 0,
                              }}
                            >
                              {index + 1}
                            </Box>

                            {/* Video ID */}
                            <Box
                              sx={{
                                fontSize: 'var(--rt-text-2xs)',
                                fontFamily: 'monospace',
                                color: 'var(--rt-color-text-tertiary)',
                                bgcolor: 'var(--rt-color-bg-subtle)',
                                px: 0.75,
                                py: 0.25,
                                borderRadius: 'var(--rt-radius-sm)',
                                flexShrink: 0,
                              }}
                            >
                              {videoId}
                            </Box>

                            {/* Video title */}
                            <Box
                              sx={{
                                fontSize: 'var(--rt-text-sm)',
                                fontWeight: 'var(--rt-weight-semibold)',
                                color: 'var(--rt-color-text)',
                                whiteSpace: 'nowrap',
                                overflow: 'hidden',
                                textOverflow: 'ellipsis',
                                flex: 1,
                                minWidth: 0,
                              }}
                            >
                              {audit.videoTitle}
                            </Box>

                            {/* Overall score pill */}
                            <Box
                              sx={{
                                px: 1.25,
                                py: 0.35,
                                borderRadius: 'var(--rt-radius-pill)',
                                fontSize: 'var(--rt-text-xs)',
                                fontWeight: 'var(--rt-weight-bold)',
                                flexShrink: 0,
                                bgcolor: audit.currentScore >= 8 ? 'var(--rt-color-success-surface)' : audit.currentScore >= 5 ? 'var(--rt-color-warning-surface)' : 'var(--rt-color-danger-surface)',
                                color: audit.currentScore >= 8 ? 'var(--rt-color-success)' : audit.currentScore >= 5 ? 'var(--rt-color-warning)' : 'var(--rt-color-danger)',
                              }}
                            >
                              {audit.currentScore}/10
                            </Box>

                            {/* Mark as optimized in the thumbnail-audit list */}
                            {videoId && (
                              <Box sx={{ flexShrink: 0 }}>
                                <OptimizedToggle
                                  compact
                                  optimized={optimizedIds.has(videoId)}
                                  kindLabel="Thumbnail Audit"
                                  onClick={() => handleToggleThumbnailOptimized(videoId, audit.videoTitle)}
                                />
                              </Box>
                            )}

                            {/* Quick download dropdown */}
                            <IconButton
                              size="small"
                              onClick={(e) => {
                                e.stopPropagation();
                                setExportMenuAnchor({ el: e.currentTarget, index });
                              }}
                              sx={{
                                flexShrink: 0,
                                color: 'var(--rt-color-text-tertiary)',
                                p: 0.5,
                                '&:hover': { color: 'var(--rt-color-text)' },
                              }}
                            >
                              <Download size={15} />
                            </IconButton>

                            <Menu
                              anchorEl={exportMenuAnchor?.el ?? null}
                              open={exportMenuAnchor?.index === index}
                              onClose={() => setExportMenuAnchor(null)}
                              onClick={() => setExportMenuAnchor(null)}
                              anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                              transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                              slotProps={{
                                paper: {
                                  sx: {
                                    minWidth: 140,
                                    borderRadius: 'var(--rt-radius-md)',
                                    border: '1px solid var(--rt-color-border)',
                                    boxShadow: 'var(--rt-shadow-lg)',
                                  },
                                },
                              }}
                            >
                              <MenuItem onClick={() => { downloadIndividualPDF(audit); }} sx={{ fontSize: 'var(--rt-text-xs)', py: 0.75 }}>
                                <ListItemIcon sx={{ minWidth: 28 }}><FileText size={15} /></ListItemIcon>
                                <ListItemText>PDF</ListItemText>
                              </MenuItem>
                              <MenuItem onClick={() => { downloadExcel([audit]); }} sx={{ fontSize: 'var(--rt-text-xs)', py: 0.75 }}>
                                <ListItemIcon sx={{ minWidth: 28 }}><FileSpreadsheet size={15} /></ListItemIcon>
                                <ListItemText>Excel</ListItemText>
                              </MenuItem>
                              <MenuItem onClick={() => { downloadCSV([audit]); }} sx={{ fontSize: 'var(--rt-text-xs)', py: 0.75 }}>
                                <ListItemIcon sx={{ minWidth: 28 }}><Table2 size={15} /></ListItemIcon>
                                <ListItemText>CSV</ListItemText>
                              </MenuItem>
                            </Menu>
                          </Box>
                        </AccordionSummary>

                        {/* ── Expanded details: full analysis — shared ThumbnailDeepDive (score card removed) ── */}
                        <AccordionDetails sx={{ px: 2.5, pb: 2.5, pt: 0 }}>
                          <ThumbnailDeepDive audit={audit} index={index} onDownload={handleExportSingle} />
                        </AccordionDetails>
                      </Accordion>
                    );
                  })}
                </Box>
              </>
            )}

            {/* IDLE state hint */}
            {!hasRun && !isRunning && (
              <EmptyState
                icon={<Image size={36} />}
                title="Ready for AI Visual Audit"
                description="Enter one or more YouTube video URLs above and click 'Initialize Batch Audit' to analyze thumbnails, contrast, visual hierarchy, and CTR potential."
              />
            )}
          </>
        ) : (
          <Box className="rtis-input-card" sx={{ p: 2 }}>
            <div className="rtis-form-label" style={{ marginBottom: 8 }}>
              Saved Audit History
            </div>
            <div className="rtis-form-hint" style={{ marginBottom: 16 }}>
              Browse, load, and manage your past thumbnail audits.
            </div>
            <HistoryPanel onLoadAudit={handleLoadAudit} loadingId={loadingSaved} readOnly={!canRunAudits} />
          </Box>
        )}
      </AuditToolBody>


      {/* Thumbnail Optimizer Guide & Details Dialog */}
      <Modal
        open={guideDialogOpen}
        onClose={() => setGuideDialogOpen(false)}
        title="Thumbnail Optimizer Engine & Rating Guide"
        icon={<BookOpen size={20} style={{ color: 'var(--rt-color-accent)' }} />}
        secondaryAction={{ label: 'Close Guide', onClick: () => setGuideDialogOpen(false) }}
        guide
      >
        <div style={{ display: 'flex', flexDirection: 'column', gap: '24px' }}>
          {/* Overview Card */}
          <Box
            sx={{
              p: 2.5,
              borderRadius: 'var(--rt-radius-md)',
              bgcolor: 'var(--rt-color-bg-subtle)',
              border: '1px solid var(--rt-color-border)',
            }}
          >
            <Box sx={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-accent)', mb: 0.75 }}>
              AI Multi-Dimensional Visual Audit Engine
            </Box>
            <Box sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', lineHeight: 1.6 }}>
              The RevTube Thumbnail Optimizer uses advanced visual AI models to scan YouTube video thumbnails from multiple strategic perspectives. It evaluates visual clarity, color harmony, typography contrast, emotional expression, and contextual alignment to give you actionable feedback that boosts impressions-to-click conversion rates.
            </Box>
          </Box>

          {/* Scoring Criteria (centralized, from admin config) */}
          <Box>
            <Box sx={{ fontSize: 'var(--rt-text-xs)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1.5 }}>
              The {guidePillars.length || 12} Scoring Criteria
            </Box>
            <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
              {(guidePillars.length ? guidePillars : DEFAULT_OPTIMIZER_CRITERIA.thumbnail).map((criterion) => (
                <Box
                  key={criterion.key}
                  sx={{
                    p: 1.75,
                    borderRadius: 'var(--rt-radius-md)',
                    bgcolor: 'var(--rt-color-bg-subtle)',
                    border: '1px solid var(--rt-color-border)',
                  }}
                >
                  <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 1, mb: 0.5 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, fontWeight: 'var(--rt-weight-bold)', fontSize: 'var(--rt-text-sm)', color: 'var(--rt-color-text)' }}>
                      <Box sx={{ color: 'var(--rt-color-accent)', display: 'flex', flexShrink: 0 }}>{PILLAR_ICONS[criterion.key] || <HelpCircle size={15} />}</Box>
                      <span>{criterion.label}</span>
                    </Box>
                    <Box sx={{ flexShrink: 0, fontWeight: 'var(--rt-weight-bold)', fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-accent)' }}>
                      {criterion.weight} pts
                    </Box>
                  </Box>
                  <Box sx={{ fontSize: 'var(--rt-text-xs)', color: PILLAR_TIER_COLOR[criterion.tier] || 'var(--rt-color-text-tertiary)', fontWeight: 'var(--rt-weight-semibold)', mb: 0.25 }}>
                    {criterion.tier} Tier
                  </Box>
                  <Box sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', lineHeight: 1.5 }}>
                    {criterion.instruction}
                  </Box>
                </Box>
              ))}
            </Box>
            <Box sx={{ display: 'flex', justifyContent: 'flex-end', fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text)', mt: 1.5 }}>
              Total {(guidePillars.length ? guidePillars : DEFAULT_OPTIMIZER_CRITERIA.thumbnail).reduce((s, c) => s + (Number(c.weight) || 0), 0)} pts
            </Box>
            <Box sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)', lineHeight: 1.5, mt: 0.5 }}>
              How scoring works: each pillar scores 0–10 and weights are points of the live total above.
            </Box>
          </Box>

          {/* Scoring Scale Guide */}
          <Box
            sx={{
              p: 2.5,
              borderRadius: 'var(--rt-radius-md)',
              bgcolor: 'var(--rt-color-bg-subtle)',
              border: '1px solid var(--rt-color-border)',
            }}
          >
            <Box sx={{ fontSize: 'var(--rt-text-xs)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text-tertiary)', textTransform: 'uppercase', letterSpacing: '0.05em', mb: 1.5 }}>
              CTR Score Rating Breakdown
            </Box>
            <Box sx={{ display: 'flex', flexDirection: 'column', gap: 1 }}>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--rt-text-xs)' }}>
                <span style={{ fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-success)' }}>
                  8.0 – 10.0 (Outstanding)
                </span>
                <span style={{ color: 'var(--rt-color-text-secondary)' }}>
                  Top tier CTR potential -- optimized visual hierarchy, contrast, and emotion.
                </span>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--rt-text-xs)' }}>
                <span style={{ fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-warning)' }}>
                  5.0 – 7.9 (Moderate)
                </span>
                <span style={{ color: 'var(--rt-color-text-secondary)' }}>
                  Good baseline -- small tweaks in contrast or text legibility can unlock higher CTR.
                </span>
              </Box>
              <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', fontSize: 'var(--rt-text-xs)' }}>
                <span style={{ fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-danger)' }}>
                  1.0 – 4.9 (Needs Work)
                </span>
                <span style={{ color: 'var(--rt-color-text-secondary)' }}>
                  High risk of low click conversion -- focus on fixing critical flaws flagged in red.
                </span>
              </Box>
            </Box>
          </Box>
        </div>
      </Modal>
    </AuditToolShell>
  );
}
