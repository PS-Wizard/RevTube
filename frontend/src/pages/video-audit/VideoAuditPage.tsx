// ─────────────────────────────────────────────────────────────────────────────
// Video Audit -- Main page component
// ─────────────────────────────────────────────────────────────────────────────
import { useState, useEffect, useRef, useMemo } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import {
  Box,
  Accordion,
  AccordionSummary,
  AccordionDetails,
  IconButton,
  Button,
  Tooltip,
  TextField,
  InputAdornment,
  MenuItem,
  Select,
  FormControl,
  Typography,
} from '../../components/ui';
import {
  HelpCircle,
  ChevronRight,
  Search,
  Download,
  Layers,
  Lightbulb,
  ExternalLink,
  ChevronDown,
  ChevronUp,
  Compass,
  FileCheck,
  Eye,
  type LucideIcon,
} from 'lucide-react';
import {
  useVideoAudit,
  useVideoAuditJobStatus,
  useSaveVideoAudit,
  useDeleteVideoAuditHistory,
} from '../../hooks/queries/useVideoAudit';
import { VideoAuditInputForm } from './VideoAuditInputForm';
import { VideoAuditCriteriaList } from './VideoAuditCriteriaList';
import { VideoAuditReportHeader } from './VideoAuditReportHeader';
import { VideoAuditTable } from './VideoAuditTable';
import { VideoAuditDetailedAnalysis } from './VideoAuditDetailedAnalysis';
import { ELEMENT_FIELD_MAP } from './optimizedFields';
import type { OptimizedField, OptimizedFields } from '../../services/optimizedFlagService';
import { VideoAuditHistoryPanel } from './VideoAuditHistoryPanel';
import type { VideoAuditVideoResult, VideoAuditBatchResult } from '../../types/videoAudit';
import { useSessionJobId, useJobContext } from '../../hooks/useSessionJobId';
import { toast } from 'react-hot-toast';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { downloadIndividualPDF } from '../../services/videoAuditExport';
import { getVideoAuditCriteria, type VideoAuditCriterion } from '../../services/videoAuditService';
import { Modal } from '../../components/ui/Modal';
import { useOptimizedFlags } from '../../hooks/useOptimizedFlags';
import { OptimizedToggle } from '../../components/audit/OptimizedToggle';
import { EmptyState } from '../../components/EmptyState';
import { AuditToolShell } from '../../components/audit/AuditToolShell';
import { AuditLoadingState } from '../../components/audit/AuditLoadingState';
import { AuditToolBody } from '../../components/audit/AuditToolBody';
import './VideoAuditPage.css';

type PageView = 'audit' | 'history';
type ScoreFilter = 'all' | 'needs-attention' | 'moderate' | 'optimized';
type SortOption = 'default' | 'score-asc' | 'score-desc' | 'uplift-desc';

const LOADING_MESSAGES = [
  'Analyzing video titles & SEO signals...',
  'Evaluating description structures...',
  'Scoring tags & target keywords...',
  'Assessing thumbnail visual hooks...',
  'Reviewing captions & accessibility...',
  'Synthesizing actionable audit reports...',
];

function getScoreColor(score: number, max: number): { bg: string; text: string } {
  const pct = max > 0 ? (score / max) * 100 : 0;
  if (pct >= 80) return { bg: 'var(--rt-color-success-surface)', text: 'var(--rt-color-success)' };
  if (pct >= 50) return { bg: 'var(--rt-color-warning-surface)', text: 'var(--rt-color-warning)' };
  return { bg: 'var(--rt-color-danger-surface)', text: 'var(--rt-color-danger)' };
}

export function VideoAuditPage() {
  const { accessToken } = useAuth();
  const { currentOrganization } = useOrganization();

  // Page state
  const [audits, setAudits] = useState<VideoAuditVideoResult[]>([]);
  const [batchResult, setBatchResult] = useState<VideoAuditBatchResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadingText, setLoadingText] = useState('Initializing audit engine...');
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [pageView, setPageView] = useState<PageView>('audit');
  const [guideDialogOpen, setGuideDialogOpen] = useState(false);
  // Centralized scoring criteria shown in the guide so displayed points always
  // match the config admins control (config/auditCriteria).
  const [guideCriteria, setGuideCriteria] = useState<VideoAuditCriterion[]>([]);
  const [loadingSaved, setLoadingSaved] = useState<number | null>(null);

  // Filters and search
  const [searchQuery, setSearchQuery] = useState('');
  const [scoreFilter, setScoreFilter] = useState<ScoreFilter>('all');
  const [sortOption, setSortOption] = useState<SortOption>('default');
  const [expandedVideos, setExpandedVideos] = useState<Record<string, boolean>>({});

  // Default "Optimized" list for video audit items
  const { optimizedIds, meta, toggle: toggleOptimized, setField: setOptimizedField, setFields: setOptimizedFields } = useOptimizedFlags('video');

  // Channel selection state
  const [channelId, setChannelId] = useState('');
  const [channelTitle, setChannelTitle] = useState('');

  // Job state -- persisted in sessionStorage
  const [jobId, setJobId] = useSessionJobId('video-audit', currentOrganization?.id);
  const [jobCtx, setJobCtx] = useJobContext<{ channelId: string; channelTitle: string | null; saved: boolean }>(
    'video-audit',
    currentOrganization?.id,
  );

  // ── Mutations & queries ──────────────────────────────────────────────────
  const auditMutation = useVideoAudit({
    onSuccess: (data) => {
      setJobId(data.jobId);
    },
    onError: (err) => {
      setError(err.message || 'Failed to enqueue video audit.');
      clearLoadingInterval();
    },
  });

  const jobStatusQuery = useVideoAuditJobStatus(jobId, jobId !== null);
  const queryClient = useQueryClient();

  const saveAuditMutation = useSaveVideoAudit();
  const deleteAuditMutation = useDeleteVideoAuditHistory();
  const [historyRefreshKey, setHistoryRefreshKey] = useState(0);

  const alreadySaved = jobCtx?.saved === true;

  // Fetch admin-configured Video Audit criteria whenever the guide opens, so
  // displayed labels/points always match what admins control.
  useEffect(() => {
    if (!guideDialogOpen) return;
    let cancelled = false;
    getVideoAuditCriteria()
      .then((res) => {
        if (!cancelled && Array.isArray(res.criteria)) setGuideCriteria(res.criteria);
      })
      .catch(() => {
        if (!cancelled) setGuideCriteria([]);
      });
    return () => {
      cancelled = true;
    };
  }, [guideDialogOpen]);

  useEffect(() => {
    const state = jobStatusQuery.data?.state;
    if (state === 'completed' && jobStatusQuery.data?.result) {
      const result = jobStatusQuery.data.result;
      setAudits(result.results || []);
      setBatchResult(result);
      clearLoadingInterval();

      // Automatically expand first video if small batch
      if (result.results && result.results.length > 0) {
        setExpandedVideos({ [result.results[0].videoId]: true });
      }

      if (!alreadySaved) {
        saveAuditMutation.mutate(
          {
            name: `Video Audit -- ${new Date().toLocaleDateString()}`,
            channelId: jobCtx?.channelId ?? channelId,
            channelTitle: jobCtx?.channelTitle ?? (channelTitle || undefined),
            results: result,
          },
          {
            onSuccess: () => {
              setHistoryRefreshKey((k) => k + 1);
              queryClient.invalidateQueries({ queryKey: ['notifications'] });
            },
          },
        );
        setJobCtx({
          channelId: jobCtx?.channelId ?? channelId,
          channelTitle: jobCtx?.channelTitle ?? channelTitle ?? null,
          saved: true,
        });
      }
      setJobId(null);
    } else if (state === 'failed') {
      setError(jobStatusQuery.data?.error || 'Video audit job failed.');
      clearLoadingInterval();
      setJobId(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobStatusQuery.data]);

  function clearLoadingInterval() {
    if (intervalRef.current) {
      clearInterval(intervalRef.current);
      intervalRef.current = null;
    }
  }

  useEffect(() => {
    if (
      auditMutation.isPending ||
      (jobId && ['waiting', 'active', 'delayed'].includes(jobStatusQuery.data?.state ?? ''))
    ) {
      let idx = 0;
      setLoadingText(LOADING_MESSAGES[0]);
      intervalRef.current = setInterval(() => {
        idx = (idx + 1) % LOADING_MESSAGES.length;
        setLoadingText(LOADING_MESSAGES[idx]);
      }, 2500);
    }
    return clearLoadingInterval;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auditMutation.isPending, jobStatusQuery.data?.state]);

  // ── Submit ───────────────────────────────────────────────────────────────
  const handleSubmit = (params: { channelId: string; videoIds: string[]; channelTitle?: string; includeThumbnail?: boolean }) => {
    setError(null);
    setAudits([]);
    setBatchResult(null);
    setSearchQuery('');
    setScoreFilter('all');
    setSortOption('default');
    setExpandedVideos({});
    setChannelId(params.channelId);
    if (params.channelTitle) setChannelTitle(params.channelTitle);
    setJobCtx({ channelId: params.channelId, channelTitle: params.channelTitle ?? null, saved: false });
    auditMutation.mutate({
      channelId: params.channelId,
      videoIds: params.videoIds,
      includeThumbnail: params.includeThumbnail,
      accessToken,
      orgId: currentOrganization?.id,
    });
  };

  // ── Load saved audit ─────────────────────────────────────────────────────
  const handleLoadAudit = async (id: number) => {
    setLoadingSaved(id);
    setError(null);
    try {
      const { getVideoAuditHistoryItem } = await import('../../services/videoAuditService');
      const saved = await getVideoAuditHistoryItem(id);
      const results = saved.results?.results || [];
      setAudits(results);
      setBatchResult(saved.results || null);
      setChannelId(saved.channelId || '');
      setChannelTitle(saved.channelTitle || '');
      if (results.length > 0) {
        setExpandedVideos({ [results[0].videoId]: true });
      }
      setPageView('audit');
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to load saved audit.');
    } finally {
      setLoadingSaved(null);
    }
  };

  // ── Deep-link handoff from Optimized Content ────────────────────────────
  // ?audit=<historyId>&scroll=<videoId> opens that saved entry directly via
  // handleLoadAudit (no AI re-run), then expands and smooth-scrolls to the
  // clicked video once its accordion renders.
  const [searchParams, setSearchParams] = useSearchParams();
  const scrollToRef = useRef<string | null>(null);
  useEffect(() => {
    const auditParam = searchParams.get('audit');
    if (!auditParam) return;
    const auditId = Number(auditParam);
    if (!Number.isFinite(auditId) || auditId <= 0) return;
    scrollToRef.current = searchParams.get('scroll');
    // A still-running earlier session would keep its loading card above the
    // loaded results and could overwrite them when it completes; stop polling.
    if (jobId) {
      clearLoadingInterval();
      setJobId(null);
    }
    void handleLoadAudit(auditId);
    searchParams.delete('audit');
    searchParams.delete('scroll');
    setSearchParams(searchParams, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const target = scrollToRef.current;
    if (!target || audits.length === 0 || pageView !== 'audit') return;
    scrollToRef.current = null;
    setExpandedVideos((prev) => ({ ...prev, [target]: true }));
    const timer = setTimeout(() => {
      document.getElementById(`video-deepdive-${target}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }, 400);
    return () => clearTimeout(timer);
  }, [audits, pageView]);

  const handleDeleteAudit = async (id: number) => {
    try {
      await deleteAuditMutation.mutateAsync(id);
      toast.success('Audit deleted.');
    } catch (err: unknown) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete audit.');
    }
  };

  // Filtered and Sorted Audits
  const filteredAudits = useMemo(() => {
    let list = [...audits];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase().trim();
      list = list.filter(
        (a) => a.videoTitle.toLowerCase().includes(q) || a.videoId.toLowerCase().includes(q),
      );
    }

    if (scoreFilter === 'needs-attention') {
      list = list.filter((a) => a.total < 50);
    } else if (scoreFilter === 'moderate') {
      list = list.filter((a) => a.total >= 50 && a.total < 80);
    } else if (scoreFilter === 'optimized') {
      list = list.filter((a) => a.total >= 80);
    }

    if (sortOption === 'score-asc') {
      list.sort((a, b) => a.total - b.total);
    } else if (sortOption === 'score-desc') {
      list.sort((a, b) => b.total - a.total);
    } else if (sortOption === 'uplift-desc') {
      list.sort((a, b) => (b.projectedTotal - b.total) - (a.projectedTotal - a.total));
    }

    return list;
  }, [audits, searchQuery, scoreFilter, sortOption]);

  const handleToggleExpandAll = () => {
    const allExpanded = filteredAudits.every((a) => expandedVideos[a.videoId]);
    if (allExpanded) {
      setExpandedVideos({});
    } else {
      const next: Record<string, boolean> = {};
      filteredAudits.forEach((a) => {
        next[a.videoId] = true;
      });
      setExpandedVideos(next);
    }
  };

  const handleInspectVideo = (videoId: string) => {
    setExpandedVideos((prev) => ({ ...prev, [videoId]: true }));
    const element = document.getElementById(`video-deepdive-${videoId}`);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  const isProcessing =
    auditMutation.isPending ||
    (jobId !== null && ['waiting', 'active', 'delayed'].includes(jobStatusQuery.data?.state ?? ''));

  return (
    <AuditToolShell
      title="Video Audit Studio"
      description="Comprehensive multi-dimensional evaluation across Discoverability, Content Quality & Visual Hook"
      icon={<FileCheck size={20} />}
      actions={
        <Tooltip title="How Video Audit works" arrow placement="top">
          <IconButton
            size="small"
            onClick={() => setGuideDialogOpen(true)}
            aria-label="Video Audit details and guide"
            sx={{ color: 'var(--rt-color-text-secondary)' }}
          >
            <HelpCircle size={18} />
          </IconButton>
        </Tooltip>
      }
      tabs={{
        items: [
          { value: 'audit', label: 'New Video Audit' },
          { value: 'history', label: 'Audit History' },
        ],
        value: pageView,
        onChange: (value) => setPageView(value as PageView),
      }}
    >
      <AuditToolBody>
        {pageView === 'audit' ? (
          <>
            {/* Input form */}
            <VideoAuditInputForm
              onSubmit={handleSubmit}
              isLoading={isProcessing}
              error={error}
              optimizedVideoIds={optimizedIds}
            />

            {/* Loading state */}
            {isProcessing && (
              <AuditLoadingState
                title={loadingText}
                subtitle="AI Multi-dimensional Video Analysis in Progress"
              />
            )}

            {/* Success state */}
            {!isProcessing && batchResult && audits.length > 0 && (
              <>
                {/* Executive Report Header */}
                <VideoAuditReportHeader batchResult={batchResult} />

                {/* Summary Table */}
                <Box sx={{ mb: 4 }}>
                  <Box className="va-section-header-bar">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Layers size={16} style={{ color: 'var(--rt-color-accent)' }} />
                      <Box className="va-section-heading">Video Score Matrix</Box>
                    </Box>
                    <Typography variant="caption" sx={{ color: 'var(--rt-color-text-tertiary)' }}>
                      Click any row to jump to its deep-dive analysis
                    </Typography>
                  </Box>

                  <VideoAuditTable
                    results={filteredAudits}
                    onInspectVideo={handleInspectVideo}
                    optimizedIds={optimizedIds}
                    onToggleOptimized={toggleOptimized}
                  />
                </Box>

                {/* Filter and Search Bar for Deep Dives */}
                <Box sx={{ mt: 5, mb: 3 }}>
                  <Box className="va-section-header-bar">
                    <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                      <Lightbulb size={16} style={{ color: 'var(--rt-color-accent)' }} />
                      <Box className="va-section-heading">Detailed Deep Dives &amp; AI Suggestions</Box>
                    </Box>
                    <Button
                      size="small"
                      variant="text"
                      onClick={handleToggleExpandAll}
                      startIcon={
                        filteredAudits.every((a) => expandedVideos[a.videoId]) ? (
                          <ChevronUp size={14} />
                        ) : (
                          <ChevronDown size={14} />
                        )
                      }
                      sx={{
                        textTransform: 'none',
                        fontSize: 'var(--rt-text-xs)',
                        color: 'var(--rt-color-text-secondary)',
                      }}
                    >
                      {filteredAudits.every((a) => expandedVideos[a.videoId])
                        ? 'Collapse All'
                        : 'Expand All'}
                    </Button>
                  </Box>

                  {/* Filter Toolbar */}
                  <Box className="va-filter-toolbar">
                    <TextField
                      size="small"
                      placeholder="Filter videos by title or ID..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      slotProps={{
                        input: {
                          startAdornment: (
                            <InputAdornment position="start">
                              <Search size={14} style={{ color: 'var(--rt-color-text-tertiary)' }} />
                            </InputAdornment>
                          ),
                        },
                      }}
                      sx={{
                        flex: 1,
                        minWidth: 220,
                        '& .MuiOutlinedInput-root': {
                          fontSize: 'var(--rt-text-xs)',
                          bgcolor: 'var(--rt-color-bg-elevated)',
                        },
                      }}
                    />

                    {/* Filter chips */}
                    <Box className="va-filter-chips">
                      <Box
                        className={`va-filter-chip ${scoreFilter === 'all' ? 'active' : ''}`}
                        onClick={() => setScoreFilter('all')}
                      >
                        All ({audits.length})
                      </Box>
                      <Box
                        className={`va-filter-chip ${scoreFilter === 'needs-attention' ? 'active' : ''}`}
                        onClick={() => setScoreFilter('needs-attention')}
                      >
                        Needs Work ({audits.filter((a) => a.total < 50).length})
                      </Box>
                      <Box
                        className={`va-filter-chip ${scoreFilter === 'moderate' ? 'active' : ''}`}
                        onClick={() => setScoreFilter('moderate')}
                      >
                        Moderate ({audits.filter((a) => a.total >= 50 && a.total < 80).length})
                      </Box>
                      <Box
                        className={`va-filter-chip ${scoreFilter === 'optimized' ? 'active' : ''}`}
                        onClick={() => setScoreFilter('optimized')}
                      >
                        Optimized ({audits.filter((a) => a.total >= 80).length})
                      </Box>
                    </Box>

                    {/* Sort Dropdown */}
                    <FormControl size="small" sx={{ minWidth: 180 }}>
                      <Select
                        value={sortOption}
                        onChange={(e) => setSortOption(e.target.value as SortOption)}
                        displayEmpty
                        sx={{
                          fontSize: 'var(--rt-text-xs)',
                          bgcolor: 'var(--rt-color-bg-elevated)',
                          height: 36,
                        }}
                      >
                        <MenuItem value="default" sx={{ fontSize: 'var(--rt-text-xs)' }}>
                          Original Order
                        </MenuItem>
                        <MenuItem value="score-asc" sx={{ fontSize: 'var(--rt-text-xs)' }}>
                          Score: Needs Attention First
                        </MenuItem>
                        <MenuItem value="score-desc" sx={{ fontSize: 'var(--rt-text-xs)' }}>
                          Score: Highest First
                        </MenuItem>
                        <MenuItem value="uplift-desc" sx={{ fontSize: 'var(--rt-text-xs)' }}>
                          Uplift: Highest Gain First
                        </MenuItem>
                      </Select>
                    </FormControl>
                  </Box>

                  {/* Video Deep Dive Accordions */}
                  {filteredAudits.length === 0 ? (
                    <EmptyState
                      variant="no-results"
                      title="No Videos Match Filters"
                      description="No audited videos match your active filter criteria."
                    />
                  ) : (
                    filteredAudits.map((result, index) => {
                      const c = getScoreColor(result.total, 100);
                      const isExpanded = Boolean(expandedVideos[result.videoId]);
                      const thumbUrl = `https://i.ytimg.com/vi/${result.videoId}/hqdefault.jpg`;
                      const hasUplift = result.projectedTotal > result.total;
                      const delta = result.projectedTotal - result.total;
                      // Per-criterion optimization state for this video (the same
                      // per-field flags the Optimized List page toggles).
                      const videoFields = meta[result.videoId]?.fields ?? {};
                      const mappedFields = (result.elements ?? [])
                        .map((el) => ELEMENT_FIELD_MAP[el.element])
                        .filter((f): f is OptimizedField => Boolean(f));
                      const allFieldsOptimized =
                        mappedFields.length > 0 && mappedFields.every((f) => videoFields[f]);
                      const toggleVideoField = (field: OptimizedField) =>
                        setOptimizedField(result.videoId, field, !videoFields[field], result.videoTitle, thumbUrl);
                      const handleToggleAllElements = () => {
                        const target = !allFieldsOptimized;
                        const fields = Object.fromEntries(
                          mappedFields.map((f) => [f, target]),
                        ) as OptimizedFields;
                        setOptimizedFields(result.videoId, fields, result.videoTitle, thumbUrl);
                      };

                      return (
                        <Accordion
                          key={result.videoId || index}
                          id={`video-deepdive-${result.videoId}`}
                          expanded={isExpanded}
                          onChange={(_, exp) =>
                            setExpandedVideos((prev) => ({ ...prev, [result.videoId]: exp }))
                          }
                          className="va-video-accordion"
                          disableGutters
                        >
                          <AccordionSummary
                            expandIcon={<ChevronRight size={18} style={{ color: 'var(--rt-color-text-tertiary)' }} />}
                            sx={{
                              px: 2,
                              py: 0.75,
                              minHeight: 56,
                              '&.Mui-expanded': { minHeight: 56 },
                              '& .MuiAccordionSummary-content': { my: 0.5, alignItems: 'center' },
                              '& .MuiAccordionSummary-expandIconWrapper.Mui-expanded': {
                                transform: 'rotate(90deg)',
                              },
                            }}
                          >
                            <Box sx={{ display: 'flex', alignItems: 'center', gap: 1.5, flex: 1, minWidth: 0, mr: 1 }}>
                              {/* S.N. badge -- matches the score-matrix table row number */}
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

                              {/* Thumbnail preview */}
                              <Box
                                component="img"
                                src={thumbUrl}
                                alt={result.videoTitle}
                                onError={(e: React.SyntheticEvent<HTMLImageElement>) => {
                                  e.currentTarget.style.display = 'none';
                                }}
                                sx={{
                                  width: 48,
                                  height: 32,
                                  borderRadius: 'var(--rt-radius-sm)',
                                  objectFit: 'cover',
                                  bgcolor: 'var(--rt-color-bg-subtle)',
                                  border: '1px solid var(--rt-color-border)',
                                  flexShrink: 0,
                                }}
                              />

                              {/* Title and ID */}
                              <Box sx={{ display: 'flex', flexDirection: 'column', flex: 1, minWidth: 0 }}>
                                <Box
                                  sx={{
                                    fontSize: 'var(--rt-text-sm)',
                                    fontWeight: 'var(--rt-weight-semibold)',
                                    color: 'var(--rt-color-text)',
                                    whiteSpace: 'nowrap',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                  }}
                                  title={result.videoTitle}
                                >
                                  {result.videoTitle}
                                </Box>
                                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
                                  <span style={{ fontSize: 'var(--rt-text-2xs)', color: 'var(--rt-color-text-tertiary)' }}>
                                    ID: {result.videoId}
                                  </span>
                                  <a
                                    href={`https://www.youtube.com/watch?v=${result.videoId}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    onClick={(e) => e.stopPropagation()}
                                    style={{
                                      display: 'inline-flex',
                                      alignItems: 'center',
                                      gap: '2px',
                                      fontSize: 'var(--rt-text-2xs)',
                                      color: 'var(--rt-color-accent)',
                                      textDecoration: 'none',
                                    }}
                                  >
                                    <span>Watch</span>
                                    <ExternalLink size={9} />
                                  </a>
                                </Box>
                              </Box>

                              {/* Score Pill */}
                              <Box
                                sx={{
                                  fontSize: 'var(--rt-text-sm)',
                                  fontWeight: 'var(--rt-weight-bold)',
                                  color: c.text,
                                  bgcolor: c.bg,
                                  px: 1.25,
                                  py: 0.35,
                                  borderRadius: 'var(--rt-radius-pill)',
                                  flexShrink: 0,
                                }}
                              >
                                {result.total.toFixed(0)}
                                <span style={{ fontSize: 'var(--rt-text-2xs)', opacity: 0.75, fontWeight: 'normal' }}>
                                  /100
                                </span>
                              </Box>

                              {/* Projected Uplift Chip */}
                              {hasUplift && (
                                <Box
                                  className="va-projected-chip"
                                  sx={{
                                    fontSize: 'var(--rt-text-2xs)',
                                    fontWeight: 'var(--rt-weight-semibold)',
                                    flexShrink: 0,
                                    display: { xs: 'none', sm: 'flex' },
                                    alignItems: 'center',
                                    gap: 0.25,
                                    px: 1,
                                    py: 0.35,
                                    borderRadius: 'var(--rt-radius-pill)',
                                    bgcolor: 'var(--rt-color-accent-muted, var(--rt-color-bg-highlight))',
                                    color: 'var(--rt-color-accent)',
                                    border: '1px solid var(--rt-color-border)',
                                    whiteSpace: 'nowrap',
                                  }}
                                  title="Projected overall score if suggested improvements are implemented"
                                >
                                  → {result.projectedTotal.toFixed(0)} <span style={{ opacity: 0.75 }}>(+{delta.toFixed(0)})</span>
                                </Box>
                              )}

                              {/* Mark all criteria optimized for this video */}
                              {mappedFields.length > 0 && (
                                <OptimizedToggle
                                  compact
                                  kindLabel="Video Audit"
                                  optimized={allFieldsOptimized}
                                  labelOff="Mark All"
                                  labelOn="All Done"
                                  onClick={handleToggleAllElements}
                                />
                              )}

                              {/* Quick PDF export */}
                              <Tooltip title="Export single PDF" arrow>
                                <IconButton
                                  size="small"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    downloadIndividualPDF(result);
                                  }}
                                  sx={{
                                    color: 'var(--rt-color-text-tertiary)',
                                    '&:hover': { color: 'var(--rt-color-accent)' },
                                    display: { xs: 'none', md: 'inline-flex' },
                                  }}
                                >
                                  <Download size={15} />
                                </IconButton>
                              </Tooltip>
                            </Box>
                          </AccordionSummary>

                          <AccordionDetails sx={{ px: { xs: 2.5, md: 4 }, pb: 4, pt: 2, borderTop: '1px solid var(--rt-color-border)' }}>
                            <VideoAuditDetailedAnalysis
                              result={result}
                              savedAuditId={batchResult?.thumbnailAuditSavedId}
                              optimizedFields={videoFields}
                              onToggleField={toggleVideoField}
                            />
                          </AccordionDetails>
                        </Accordion>
                      );
                    })
                  )}
                </Box>
              </>
            )}
          </>
        ) : (
          <VideoAuditHistoryPanel
            onLoad={handleLoadAudit}
            onDelete={handleDeleteAudit}
            loadingSaved={loadingSaved}
            refreshKey={historyRefreshKey}
          />
        )}

        {/* Guide dialog */}
        <GuideDialog open={guideDialogOpen} onClose={() => setGuideDialogOpen(false)} criteria={guideCriteria} />
      </AuditToolBody>
    </AuditToolShell>
  );
}

// Focus-area icons for the guide display.
const FOCUS_ICONS: Record<string, LucideIcon> = {
  discoverability: Compass,
  contentQuality: FileCheck,
  visualHook: Eye,
};

// ── Guide dialog ────────────────────────────────────────────────────────────
function GuideDialog({ open, onClose, criteria }: { open: boolean; onClose: () => void; criteria: VideoAuditCriterion[] }) {
  const FOCUS_AREAS = [
    {
      key: 'discoverability',
      title: 'Discoverability',
      desc: 'Analyzes title search keywords, tag clouds, metadata relevance, and description search-index signals.',
    },
    {
      key: 'contentQuality',
      title: 'Content Quality',
      desc: 'Evaluates description formatting, chapter marker timestamps, accessibility, and caption coverage.',
    },
    {
      key: 'visualHook',
      title: 'Visual Hook',
      desc: 'Assesses thumbnail contrast, focus subject clarity, curiosity gap triggers, and CTR optimization.',
    },
  ];

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="How Video Audit Works"
      description="Multi-dimensional algorithmic evaluation and actionable AI suggestions for your YouTube videos."
      icon={<HelpCircle size={20} style={{ color: 'var(--rt-color-accent)' }} />}
      guide
      secondaryAction={{ label: 'Close', onClick: onClose }}
    >
      <Box sx={{ display: 'flex', flexDirection: 'column', gap: 3, py: 1 }}>
        {/* Overview */}
        <Typography sx={{ fontSize: 'var(--rt-text-sm)', color: 'var(--rt-color-text-secondary)', lineHeight: 1.6 }}>
          Video Audit evaluates each video across <strong>3 strategic focus areas</strong> spanning <strong>6 core elements</strong>: Title, Description, Tags, Keywords, Thumbnail, and Captions.
        </Typography>

        {/* Focus Areas - 3 column grid with icons */}
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr 1fr' }, gap: 2 }}>
          {FOCUS_AREAS.map((area) => {
            const Icon = FOCUS_ICONS[area.key] || HelpCircle;
            return (
              <Box
                key={area.key}
                sx={{
                  p: 2.5,
                  borderRadius: 'var(--rt-radius-md)',
                  bgcolor: 'var(--rt-color-bg-subtle)',
                  border: '1px solid var(--rt-color-border)',
                  transition: 'border-color var(--rt-transition-fast)',
                  '&:hover': { borderColor: 'var(--rt-color-accent)' },
                }}
              >
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, mb: 1 }}>
                  <Icon size={16} style={{ color: 'var(--rt-color-accent)' }} />
                  <Typography sx={{ fontSize: 'var(--rt-text-sm)', fontWeight: 'var(--rt-weight-bold)', color: 'var(--rt-color-text)' }}>
                    {area.title}
                  </Typography>
                </Box>
                <Typography sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-secondary)', lineHeight: 1.5 }}>
                  {area.desc}
                </Typography>
              </Box>
            );
          })}
        </Box>

        {/* Scoring Criteria (config-driven, shared with the input-form help modal) */}
        <VideoAuditCriteriaList criteria={criteria} />

        {/* Bottom note */}
        <Typography sx={{ fontSize: 'var(--rt-text-xs)', color: 'var(--rt-color-text-tertiary)', lineHeight: 1.5 }}>
          For any weak element, the engine generates ready-to-use AI optimization copy (rewritten titles, hook descriptions, tag clouds, thumbnail visual cues) with 1-click clipboard copying.
        </Typography>
      </Box>
    </Modal>
  );
}
