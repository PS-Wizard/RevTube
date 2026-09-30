// ─────────────────────────────────────────────────────────────────────────────
// usePublicAuditPanel — all state for the Channel Audit panel.
//
// Owns launcher config, report + filters/pagination (persisted to
// sessionStorage so page changes never lose them), background-job tracking
// (`public-audit` queue via useSessionJobId, polling resumes on remount),
// exports, dialog state, and every derived memo (filtered videos, metrics,
// playlist/channel deep-dives, header-sort state). The panel component itself
// only composes `components/*` from this hook's return value.
// ─────────────────────────────────────────────────────────────────────────────
import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'react-hot-toast';
import { getVideoAuditCriteria } from '../../../services/videoAuditService';
import { useSessionJobId } from '../../../hooks/useSessionJobId';
import {
  downloadPublicAuditExcel,
  downloadPublicAuditPdf,
  downloadPublicAuditVideoExcel,
  downloadPublicAuditVideoPdf,
  exportPublicAuditImagePdf,
} from '../../../services/publicAuditExport';
import {
  enqueuePublicAudit,
  getPublicAudit,
  getPublicAuditJobStatus,
  listPublicAudits,
  renamePublicAudit,
  runPublicAudit,
  type PublicAuditPlaylistHealth,
  type PublicAuditReport,
} from '../../../services/publicAuditService';
import { PAGE_SIZE, PLAYLIST_SORT_CYCLE, SORT_CYCLE, scoreTone, sortPlaylists, type PlaylistSort, type PlaylistSortColumnKey, type SortColumnKey, type VideoSort } from './publicAuditUtils';

export type PublicAuditVideo = PublicAuditReport['results'][number];

type PersistedView = {
  report: PublicAuditReport | null;
  channelInput: string;
  maxVideos: number;
  includeAllPlaylists: boolean;
  includeThumbnail: boolean;
  includeCaptions: boolean;
  viewMode: 'table' | 'cards';
  videoSearch: string;
  scoreTierFilter: 'all' | 'needs-attention' | 'moderate' | 'high';
  formatFilter: 'all' | 'shorts' | 'long';
  sortBy: VideoSort;
  videoPage: number;
  videoPageSize: number;
  playlistSort: PlaylistSort;
  playlistPage: number;
  playlistPageSize: number;
};

export function usePublicAuditPanel() {
  // Criteria come from the same store the admin Audit Criteria editor writes.
  const { data: criteriaData, isLoading: loadingCriteria } = useQuery({
    queryKey: ['video-audit-criteria'],
    queryFn: getVideoAuditCriteria,
    staleTime: 5 * 60 * 1000,
  });
  const criteria = criteriaData?.criteria ?? null;

  // ── Persisted UI state (survives page navigation within the tab) ──────────
  // Large audits run for minutes; the report + filters live in sessionStorage
  // so leaving the page (or a refresh) never loses the visible state. The
  // in-flight jobId is tracked separately via `useSessionJobId`, which resumes
  // polling on remount. Writes are best-effort (huge reports can exceed quota).
  const loadPersisted = (): Partial<PersistedView> => {
    try {
      const raw = sessionStorage.getItem('rt:public-audit:state');
      return raw ? (JSON.parse(raw) as Partial<PersistedView>) : {};
    } catch {
      return {};
    }
  };
  // Single-shot initial snapshot (useState initializer runs once per mount).
  const [initial] = useState<Partial<PersistedView>>(loadPersisted);
  const persisted = initial;

  const [channelInput, setChannelInput] = useState(persisted.channelInput ?? '');
  const [maxVideos, setMaxVideos] = useState(persisted.maxVideos ?? 50);
  const [includeAllPlaylists, setIncludeAllPlaylists] = useState(persisted.includeAllPlaylists ?? false);
  const [includeThumbnail, setIncludeThumbnail] = useState(persisted.includeThumbnail ?? false);
  // Caption-track fetching is not implemented yet: the toggle stays disabled
  // (always false) and the backend excludes caption criteria from scoring.
  const [includeCaptions, setIncludeCaptions] = useState(persisted.includeCaptions ?? false);
  const [running, setRunning] = useState(false);
  const [runError, setRunError] = useState<string | null>(null);
  const [report, setReport] = useState<PublicAuditReport | null>(persisted.report ?? null);
  const [openingId, setOpeningId] = useState<number | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportingPdf, setExportingPdf] = useState(false);
  const [exportingImage, setExportingImage] = useState(false);
  const [exportMenuAnchor, setExportMenuAnchor] = useState<HTMLElement | null>(null);
  const [historyVersion, setHistoryVersion] = useState(0);
  const [criteriaHelpOpen, setCriteriaHelpOpen] = useState(false);
  // Printable report area (hero + pillars + metrics) for the image-PDF path.
  const reportRef = useRef<HTMLDivElement | null>(null);

  // Results interactive filters & view mode
  const [viewMode, setViewMode] = useState<'table' | 'cards'>(persisted.viewMode ?? 'table');
  const [videoSearch, setVideoSearch] = useState(persisted.videoSearch ?? '');
  const [scoreTierFilter, setScoreTierFilter] = useState<'all' | 'needs-attention' | 'moderate' | 'high'>(persisted.scoreTierFilter ?? 'all');
  const [formatFilter, setFormatFilter] = useState<'all' | 'shorts' | 'long'>(persisted.formatFilter ?? 'all');
  const [sortBy, setSortBy] = useState<VideoSort>(persisted.sortBy ?? 'default');
  const [playlistSort, setPlaylistSort] = useState<PlaylistSort>(persisted.playlistSort ?? 'default');
  const [videoPage, setVideoPage] = useState(persisted.videoPage ?? 1);
  const [videoPageSize, setVideoPageSize] = useState(persisted.videoPageSize ?? 25);
  const [playlistPage, setPlaylistPage] = useState(persisted.playlistPage ?? 1);
  const [playlistPageSize, setPlaylistPageSize] = useState(persisted.playlistPageSize ?? 25);

  // Video Inspection Dialog state
  const [inspectedVideo, setInspectedVideo] = useState<PublicAuditVideo | null>(null);
  const [downloadingVideo, setDownloadingVideo] = useState<'pdf' | 'excel' | null>(null);

  const handleVideoDownload = useCallback(async (format: 'pdf' | 'excel') => {
    if (!inspectedVideo || downloadingVideo) return;
    setDownloadingVideo(format);
    try {
      if (format === 'pdf') {
        downloadPublicAuditVideoPdf(inspectedVideo, report?.channelTitle || '');
      } else {
        await downloadPublicAuditVideoExcel(
          inspectedVideo,
          report?.channelTitle || '',
          report ? { channelId: report.channelId } : null,
        );
      }
      toast.success(format === 'pdf' ? 'Video PDF downloaded.' : 'Video Excel file downloaded.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Video download failed.');
    } finally {
      setDownloadingVideo(null);
    }
  }, [inspectedVideo, downloadingVideo, report]);

  // History fetcher
  const fetchHistory = useCallback(
    ({ page, search }: { page: number; search?: string }) =>
      listPublicAudits({ page, search, limit: PAGE_SIZE }),
    [],
  );

  // Background job tracking: large audits run on the `public-audit` BullMQ
  // queue. The jobId survives page navigation (sessionStorage) and polling
  // resumes on remount, so leaving the page never loses an in-flight audit.
  const [jobId, setJobId] = useSessionJobId('public-audit');
  const jobStatusQuery = useQuery({
    queryKey: ['public-audit-job', jobId],
    queryFn: () => getPublicAuditJobStatus(jobId!),
    enabled: jobId != null,
    refetchInterval: (q) =>
      q.state.data && ['waiting', 'active', 'delayed'].includes(q.state.data.state) ? 3000 : false,
    retry: false,
  });
  const jobProgress = jobStatusQuery.data?.progress ?? 0;
  const jobState = jobStatusQuery.data?.state ?? null;
  // Busy = synchronous run in flight OR a queued job being tracked.
  const busy = running || jobId != null;

  // Persist the visible state so a page change/refresh restores the report,
  // filters, and pagination exactly as left.
  React.useEffect(() => {
    try {
      const snapshot: PersistedView = {
        report,
        channelInput,
        maxVideos,
        includeAllPlaylists,
        includeThumbnail,
        includeCaptions,
        viewMode,
        videoSearch,
        scoreTierFilter,
        formatFilter,
        sortBy,
        videoPage,
        videoPageSize,
        playlistSort,
        playlistPage,
        playlistPageSize,
      };
      sessionStorage.setItem('rt:public-audit:state', JSON.stringify(snapshot));
    } catch {
      /* quota exceeded or storage unavailable — non-fatal */
    }
  }, [report, channelInput, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions, viewMode, videoSearch, scoreTierFilter, formatFilter, sortBy, videoPage, videoPageSize, playlistSort, playlistPage, playlistPageSize]);

  // Job completion / failure transitions. setState-in-effect is intentional:
  // the polled job status arrives outside any event handler, and each
  // transition clears the jobId so it runs exactly once per job.
  /* eslint-disable react-hooks/set-state-in-effect */
  React.useEffect(() => {
    const status = jobStatusQuery.data;
    if (!status || jobId == null) return;
    if (status.state === 'completed' && status.result) {
      setReport(status.result);
      setVideoPage(1);
      setPlaylistPage(1);
      setHistoryVersion((v) => v + 1);
      setJobId(null);
      toast.success(`Channel audit completed for ${status.result.channelTitle || 'channel'}`);
    } else if (status.state === 'failed') {
      const message = status.error || 'Channel audit job failed.';
      setRunError(message);
      setJobId(null);
      toast.error(message);
    }
  }, [jobStatusQuery.data, jobId, setJobId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const applyReport = useCallback((result: PublicAuditReport, input: string) => {
    setReport(result);
    setVideoPage(1);
    setPlaylistPage(1);
    setHistoryVersion((v) => v + 1);
    toast.success(`Channel audit completed for ${result.channelTitle || input}`);
  }, []);

  const handleRun = useCallback(async (targetInput?: string) => {
    const input = (targetInput ?? channelInput).trim();
    if (!input) {
      toast.error('Enter a channel handle, ID, or URL first.');
      return;
    }
    setRunning(true);
    setRunError(null);
    try {
      // Preferred path: background queue (survives page changes, shows progress).
      const enqueued = await enqueuePublicAudit({ channelInput: input, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions });
      if (enqueued.jobId) {
        setJobId(enqueued.jobId);
        toast.success('Channel audit queued — you can leave this page; the report will be here when it finishes.');
        return;
      }
      // Queue disabled on the server: the run completed inline.
      if (enqueued.direct || enqueued.id) {
        applyReport(enqueued as unknown as PublicAuditReport, input);
        return;
      }
      // Ultimate fallback (older servers without /jobs): synchronous run.
      const result = await runPublicAudit({ channelInput: input, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions });
      applyReport(result, input);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Channel audit failed.';
      setRunError(message);
      toast.error(message);
    } finally {
      setRunning(false);
    }
  }, [channelInput, maxVideos, includeAllPlaylists, includeThumbnail, includeCaptions, applyReport, setJobId]);

  const handleOpen = useCallback(async (id: number) => {
    setOpeningId(id);
    try {
      const savedReport = await getPublicAudit(id);
      setReport(savedReport);
      setChannelInput(savedReport.channelTitle || savedReport.channelInput || '');
      toast.success(`Loaded saved audit for ${savedReport.channelTitle || 'channel'}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to open that audit.');
    } finally {
      setOpeningId(null);
    }
  }, []);

  // Clear the screen for a fresh audit: drops the open report + result
  // filters/pages but keeps the launcher config (input, video count, toggles)
  // so the next run is one click away. An in-flight queued job keeps tracking
  // in the background and will repopulate when it finishes.
  const handleClear = useCallback(() => {
    setReport(null);
    setInspectedVideo(null);
    setRunError(null);
    setViewMode('table');
    setVideoSearch('');
    setScoreTierFilter('all');
    setFormatFilter('all');
    setSortBy('default');
    setVideoPage(1);
    setPlaylistPage(1);
    toast.success('Cleared — ready for a new audit.');
  }, []);

  const handleRename = useCallback(async (id: string | number, name: string) => {
    const saved = await renamePublicAudit(Number(id), name);
    setReport((prev) => (prev && prev.id === Number(id) ? { ...prev, channelTitle: saved.channelTitle } : prev));
    toast.success('Audit renamed.');
  }, []);

  const handleExport = useCallback(async () => {
    if (!report || exporting) return;
    setExporting(true);
    try {
      await downloadPublicAuditExcel(report);
      toast.success('Full Excel report downloaded successfully.');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Excel export failed.';
      toast.error(message);
    } finally {
      setExporting(false);
    }
  }, [report, exporting]);

  const handleExportPdf = useCallback(() => {
    if (!report || exportingPdf) return;
    setExportingPdf(true);
    try {
      downloadPublicAuditPdf(report);
      toast.success('Full PDF report downloaded successfully.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'PDF export failed.');
    } finally {
      setExportingPdf(false);
    }
  }, [report, exportingPdf]);

  const handleExportImagePdf = useCallback(async () => {
    if (!report || exportingImage) return;
    const el = reportRef.current;
    if (!el) {
      toast.error('Report area is not ready yet.');
      return;
    }
    setExportingImage(true);
    try {
      await exportPublicAuditImagePdf(el, report);
      toast.success('Image PDF downloaded successfully.');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Image PDF export failed.');
    } finally {
      setExportingImage(false);
    }
  }, [report, exportingImage]);

  // Filtered & sorted videos
  const filteredVideos = useMemo(() => {
    if (!report?.results) return [];
    let list = [...report.results];

    // Search query
    if (videoSearch.trim()) {
      const query = videoSearch.trim().toLowerCase();
      list = list.filter(
        (v) =>
          v.videoTitle?.toLowerCase().includes(query) ||
          v.videoId.toLowerCase().includes(query),
      );
    }

    // Score tier filter
    if (scoreTierFilter === 'needs-attention') {
      list = list.filter((v) => (v.total ?? 0) < 50);
    } else if (scoreTierFilter === 'moderate') {
      list = list.filter((v) => (v.total ?? 0) >= 50 && (v.total ?? 0) < 80);
    } else if (scoreTierFilter === 'high') {
      list = list.filter((v) => (v.total ?? 0) >= 80);
    }

    // Format filter
    if (formatFilter === 'shorts') {
      list = list.filter((v) => (v.durationSeconds != null && v.durationSeconds <= 60) || v.durationLabel?.includes('Short'));
    } else if (formatFilter === 'long') {
      list = list.filter((v) => (v.durationSeconds != null ? v.durationSeconds > 60 : true));
    }

    // Sorting
    if (sortBy === 'score-desc') {
      list.sort((a, b) => (b.total ?? 0) - (a.total ?? 0));
    } else if (sortBy === 'score-asc') {
      list.sort((a, b) => (a.total ?? 0) - (b.total ?? 0));
    } else if (sortBy === 'views-desc') {
      list.sort((a, b) => Number(b.statistics?.viewCount || 0) - Number(a.statistics?.viewCount || 0));
    } else if (sortBy === 'views-asc') {
      list.sort((a, b) => Number(a.statistics?.viewCount || 0) - Number(b.statistics?.viewCount || 0));
    } else if (sortBy === 'likes-desc') {
      list.sort((a, b) => Number(b.statistics?.likeCount || 0) - Number(a.statistics?.likeCount || 0));
    } else if (sortBy === 'engagement-desc' || sortBy === 'engagement-asc') {
      const rate = (v: (typeof list)[number]) => {
        const views = Number(v.statistics?.viewCount || 0);
        if (!views) return -1;
        return (Number(v.statistics?.likeCount || 0) + Number(v.statistics?.commentCount || 0)) / views;
      };
      list.sort((a, b) => (sortBy === 'engagement-desc' ? rate(b) - rate(a) : rate(a) - rate(b)));
    } else {
      // Individual audit-score columns (<element>-desc / <element>-asc).
      // Unscored elements (max 0 / missing) sort last in both directions.
      const elMatch = /^(title|description|tags|keywords|thumbnail|captions)-(desc|asc)$/.exec(sortBy);
      if (elMatch) {
        const [, el, dir] = elMatch;
        const val = (v: (typeof list)[number]) => {
          const found = (v.elements || []).find((e) => e.element === el);
          return found && (found.max ?? 0) > 0 ? found.score : -1;
        };
        list.sort((a, b) => (dir === 'desc' ? val(b) - val(a) : val(a) - val(b)));
      }
    }

    return list;
  }, [report, videoSearch, scoreTierFilter, formatFilter, sortBy]);

  // Header-click sorting: each sortable column cycles biggest → lowest → normal.
  // Derived inline (3-entry loop — no memo needed).
  const activeSort: { key: SortColumnKey | null; dir: 'asc' | 'desc' | null } = (() => {
    for (const [key, [desc, asc]] of Object.entries(SORT_CYCLE) as [SortColumnKey, readonly string[]][]) {
      if (sortBy === desc) return { key, dir: 'desc' };
      if (sortBy === asc) return { key, dir: 'asc' };
    }
    return { key: null, dir: null };
  })();
  const handleHeaderSort = useCallback((key: string) => {
    const cycle = (SORT_CYCLE as Record<string, readonly string[]>)[key];
    if (!cycle) return;
    const [desc, asc] = cycle;
    setSortBy((prev) => (prev === desc ? (asc as typeof prev) : prev === asc ? 'default' : (desc as typeof prev)));
    setVideoPage(1);
  }, []);

  const videoTotalPages = Math.max(1, Math.ceil(filteredVideos.length / videoPageSize));
  const currentVideoPage = Math.min(videoPage, videoTotalPages);
  const pagedVideos = filteredVideos.slice(
    (currentVideoPage - 1) * videoPageSize,
    currentVideoPage * videoPageSize,
  );

  // Derived audit metrics
  const snap = report?.snapshot;
  const stats = snap?.statistics || {};
  const lifetime = report?.channelLifetime ?? null;
  const playlists = useMemo(() => report?.playlists ?? [], [report]);
  const playlistTotalPages = Math.max(1, Math.ceil(playlists.length / playlistPageSize));
  const currentPlaylistPage = Math.min(playlistPage, playlistTotalPages);
  const tone = scoreTone(report?.overall);

  const avgProjected = useMemo(() => {
    if (!report?.results || report.results.length === 0) return report?.overall ?? 0;
    const sum = report.results.reduce((acc, r) => acc + (r.projectedTotal || r.total || 0), 0);
    return Math.round(sum / report.results.length);
  }, [report]);

  const potentialUplift = Math.max(0, avgProjected - (report?.overall ?? 0));

  // Per-item audits from the deterministic engine (persisted on fullAudit.health;
  // absent on old reports — tabs degrade to aggregate-only). Map keyed by
  // playlistId so table rows join without index-order assumptions.
  const playlistHealthById = useMemo(() => {
    const map = new Map<string, PublicAuditPlaylistHealth>();
    for (const p of report?.fullAudit?.health?.playlists ?? []) {
      if (p?.playlistId) map.set(p.playlistId, p);
    }
    return map;
  }, [report]);
  const channelHealth = report?.fullAudit?.health?.channel ?? null;

  // Playlist header-click sorting (same biggest → lowest → normal cycling as
  // the Videos tab). Sorted before pagination so pages stay consistent.
  const activePlaylistSort: { key: PlaylistSortColumnKey | null; dir: 'asc' | 'desc' | null } = (() => {
    for (const [key, [first, second]] of Object.entries(PLAYLIST_SORT_CYCLE) as [PlaylistSortColumnKey, readonly string[]][]) {
      if (playlistSort === first) return { key, dir: first.endsWith('-desc') ? 'desc' : 'asc' };
      if (playlistSort === second) return { key, dir: second.endsWith('-desc') ? 'desc' : 'asc' };
    }
    return { key: null, dir: null };
  })();
  const handlePlaylistSort = useCallback((key: string) => {
    const cycle = (PLAYLIST_SORT_CYCLE as Record<string, readonly string[]>)[key];
    if (!cycle) return;
    const [first, second] = cycle;
    setPlaylistSort((prev) => (prev === first ? (second as typeof prev) : prev === second ? 'default' : (first as typeof prev)));
    setPlaylistPage(1);
  }, []);
  const sortedPlaylists = useMemo(
    () => sortPlaylists(playlists, playlistSort, playlistHealthById),
    [playlists, playlistSort, playlistHealthById],
  );
  const pagedPlaylists = sortedPlaylists.slice(
    (currentPlaylistPage - 1) * playlistPageSize,
    currentPlaylistPage * playlistPageSize,
  );

  // Playlist + Channel audit deep-dives (from the Full Audit engine output)
  const categories = report?.fullAudit?.categories ?? [];
  const playlistCategory = categories.find((c) => c.key === 'playlist');
  const channelCategory = categories.find((c) => c.key === 'channel');
  const allIssues = report?.fullAudit?.issues ?? [];
  const playlistIssues = allIssues.filter((i) => (i.affected || []).some((a) => a.type === 'playlist'));
  const channelIssues = allIssues.filter((i) => (i.affected || []).some((a) => a.type === 'channel'));
  const identityChecks = [
    { label: 'Avatar', present: Boolean(snap?.avatarUrl) },
    { label: 'Banner', present: Boolean(snap?.bannerUrl) },
    { label: 'Description', present: Boolean(snap?.description?.trim()) },
    { label: 'Keywords', present: Boolean(snap?.channelKeywords?.trim()) },
    { label: 'Handle', present: Boolean(snap?.handle || snap?.customUrl) },
    { label: 'Topics', present: (snap?.topics?.length ?? 0) > 0 },
  ];
  const playlistsMissingDesc = playlists.filter((p) => !p.description?.trim()).length;
  const emptyPlaylists = playlists.filter((p) => (p.itemCount ?? 0) <= 0).length;

  return {
    criteria, loadingCriteria,
    channelInput, setChannelInput, maxVideos, setMaxVideos,
    includeAllPlaylists, setIncludeAllPlaylists, includeThumbnail, setIncludeThumbnail,
    includeCaptions, setIncludeCaptions,
    running, busy, runError, setRunError, report,
    openingId, exporting, exportingPdf, exportingImage,
    exportMenuAnchor, setExportMenuAnchor, historyVersion,
    criteriaHelpOpen, setCriteriaHelpOpen, reportRef,
    viewMode, setViewMode, videoSearch, setVideoSearch,
    scoreTierFilter, setScoreTierFilter, formatFilter, setFormatFilter,
    sortBy, setSortBy, videoPage, setVideoPage, videoPageSize, setVideoPageSize,
    playlistPage, setPlaylistPage, playlistPageSize, setPlaylistPageSize,
    playlistSort, activePlaylistSort, handlePlaylistSort,
    inspectedVideo, setInspectedVideo, downloadingVideo, handleVideoDownload,
    fetchHistory, jobId, jobProgress, jobState,
    handleRun, handleOpen, handleClear, handleRename,
    handleExport, handleExportPdf, handleExportImagePdf,
    filteredVideos, pagedVideos, videoTotalPages, currentVideoPage,
    snap, stats, lifetime, playlists, pagedPlaylists,
    playlistTotalPages, currentPlaylistPage,
    tone, avgProjected, potentialUplift,
    playlistCategory, channelCategory, playlistIssues, channelIssues,
    playlistHealthById, channelHealth,
    identityChecks, playlistsMissingDesc, emptyPlaylists,
    activeSort, handleHeaderSort,
  };
}

export type PublicAuditPanelState = ReturnType<typeof usePublicAuditPanel>;
