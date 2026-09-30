// ─────────────────────────────────────────────────────────────────────────────
// PublicAuditPanel — audit of ANY public YouTube channel.
//
// Thin orchestrator: all state lives in `usePublicAuditPanel`, every section
// renders through `components/*` (shared shadcn primitives + Tailwind only).
// See README.md in this folder for the layout contract.
//
// Data: public channel data through `services/publicAuditService.ts`. Scoring
// reuses the SAME video-audit engine and the SAME admin-managed criteria as
// the user-facing Video Audit, so a public audit is directly comparable to an
// owned-channel audit.
// ─────────────────────────────────────────────────────────────────────────────
import React from 'react';
import { Sparkles } from 'lucide-react';
import { Card, ShadcnTabs, TabsContent, TabsList, TabsTrigger } from '../../ui';
import { usePublicAuditPanel } from './usePublicAuditPanel';
import { ChannelHero } from './components/ChannelHero';
import { ChannelTab } from './components/ChannelTab';
import { HistoryArchive } from './components/HistoryArchive';
import { MetricsGrid } from './components/MetricsGrid';
import { PillarOverview } from './components/PillarOverview';
import { PlaylistsTab } from './components/PlaylistsTab';
import { RunControls } from './components/RunControls';
import { ScoringRubricModal } from './components/ScoringRubricModal';
import { VideoInspectorDialog } from './components/VideoInspectorDialog';
import { VideosTab } from './components/VideosTab';

export const PublicAuditPanel: React.FC = () => {
  const {
    report,
    criteria,
    loadingCriteria,
    criteriaHelpOpen,
    setCriteriaHelpOpen,
    channelInput,
    setChannelInput,
    maxVideos,
    setMaxVideos,
    includeAllPlaylists,
    setIncludeAllPlaylists,
    includeThumbnail,
    setIncludeThumbnail,
    includeCaptions,
    setIncludeCaptions,
    busy,
    running,
    jobId,
    jobProgress,
    jobState,
    runError,
    setRunError,
    handleRun,
    handleClear,
    reportRef,
    tone,
    avgProjected,
    potentialUplift,
    exporting,
    exportingPdf,
    exportingImage,
    exportMenuAnchor,
    setExportMenuAnchor,
    handleExport,
    handleExportPdf,
    handleExportImagePdf,
    playlists,
    filteredVideos,
    pagedVideos,
    videoTotalPages,
    currentVideoPage,
    viewMode,
    setViewMode,
    videoSearch,
    setVideoSearch,
    scoreTierFilter,
    setScoreTierFilter,
    formatFilter,
    setFormatFilter,
    sortBy,
    setSortBy,
    videoPageSize,
    setVideoPageSize,
    setVideoPage,
    activeSort,
    handleHeaderSort,
    setInspectedVideo,
    pagedPlaylists,
    playlistTotalPages,
    currentPlaylistPage,
    playlistPageSize,
    setPlaylistPageSize,
    setPlaylistPage,
    playlistCategory,
    playlistIssues,
    playlistsMissingDesc,
    emptyPlaylists,
    channelCategory,
    channelIssues,
    playlistHealthById,
    channelHealth,
    activePlaylistSort,
    handlePlaylistSort,
    identityChecks,
    inspectedVideo,
    downloadingVideo,
    handleVideoDownload,
    fetchHistory,
    openingId,
    historyVersion,
    handleOpen,
    handleRename,
  } = usePublicAuditPanel();

  return (
    <div className="flex flex-col gap-6 w-full min-w-0">
      <ScoringRubricModal
        open={criteriaHelpOpen}
        onClose={() => setCriteriaHelpOpen(false)}
        criteria={criteria}
        loadingCriteria={loadingCriteria}
      />

      <RunControls
        report={report}
        channelInput={channelInput}
        setChannelInput={setChannelInput}
        maxVideos={maxVideos}
        setMaxVideos={setMaxVideos}
        includeAllPlaylists={includeAllPlaylists}
        setIncludeAllPlaylists={setIncludeAllPlaylists}
        includeThumbnail={includeThumbnail}
        setIncludeThumbnail={setIncludeThumbnail}
        includeCaptions={includeCaptions}
        setIncludeCaptions={setIncludeCaptions}
        busy={busy}
        running={running}
        jobId={jobId}
        jobProgress={jobProgress}
        jobState={jobState}
        runError={runError}
        setRunError={setRunError}
        onRun={() => void handleRun()}
        onClear={handleClear}
        onShowRubric={() => setCriteriaHelpOpen(true)}
      />

      {report ? (
        <div ref={reportRef} className="flex flex-col gap-6 w-full min-w-0">
          <ChannelHero
            report={report}
            toneLabel={tone.label}
            avgProjected={avgProjected}
            potentialUplift={potentialUplift}
            exporting={exporting}
            exportingPdf={exportingPdf}
            exportingImage={exportingImage}
            exportMenuAnchor={exportMenuAnchor}
            setExportMenuAnchor={setExportMenuAnchor}
            onExportExcel={() => void handleExport()}
            onExportPdf={handleExportPdf}
            onExportImagePdf={() => void handleExportImagePdf()}
          />

          {report.fullAudit && <PillarOverview fullAudit={report.fullAudit} />}

          <MetricsGrid report={report} playlistCount={playlists.length} />

          {/* ── Main Tabbed Content: Videos, Playlists, Channel ─── */}
          <ShadcnTabs defaultValue="videos" className="w-full min-w-0">
            <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 pb-2 border-b border-[var(--rt-color-border)]">
              <TabsList className="bg-[var(--rt-color-bg-muted)] p-1 rounded-[var(--rt-radius-md)]">
                <TabsTrigger value="videos" className="text-xs font-medium px-3 py-1.5">
                  Audited Videos ({report.results.length})
                </TabsTrigger>
                <TabsTrigger value="playlists" className="text-xs font-medium px-3 py-1.5">
                  Playlists ({playlists.length})
                </TabsTrigger>
                <TabsTrigger value="metadata" className="text-xs font-medium px-3 py-1.5">
                  Channel Audit
                </TabsTrigger>
              </TabsList>
            </div>

            <TabsContent value="videos" className="flex flex-col gap-4 pt-4">
              <VideosTab
                reportVideoCount={report.results.length}
                filteredVideos={filteredVideos}
                pagedVideos={pagedVideos}
                videoTotalPages={videoTotalPages}
                currentVideoPage={currentVideoPage}
                viewMode={viewMode}
                setViewMode={setViewMode}
                videoSearch={videoSearch}
                setVideoSearch={setVideoSearch}
                scoreTierFilter={scoreTierFilter}
                setScoreTierFilter={setScoreTierFilter}
                formatFilter={formatFilter}
                setFormatFilter={setFormatFilter}
                sortBy={sortBy}
                setSortBy={setSortBy}
                videoPageSize={videoPageSize}
                setVideoPageSize={setVideoPageSize}
                setVideoPage={setVideoPage}
                activeSort={activeSort}
                onHeaderSort={handleHeaderSort}
                onInspect={setInspectedVideo}
              />
            </TabsContent>

            <TabsContent value="playlists" className="flex flex-col gap-4 pt-4">
              <PlaylistsTab
                scoredVideos={report.fullAudit?.scoredVideos ?? report.videoCount}
                playlists={playlists}
                pagedPlaylists={pagedPlaylists}
                playlistTotalPages={playlistTotalPages}
                currentPlaylistPage={currentPlaylistPage}
                playlistPageSize={playlistPageSize}
                setPlaylistPageSize={setPlaylistPageSize}
                setPlaylistPage={setPlaylistPage}
                playlistCategory={playlistCategory}
                playlistIssues={playlistIssues}
                playlistsMissingDesc={playlistsMissingDesc}
                emptyPlaylists={emptyPlaylists}
                playlistHealthById={playlistHealthById}
                activePlaylistSort={activePlaylistSort}
                onPlaylistSort={handlePlaylistSort}
              />
            </TabsContent>

            <TabsContent value="metadata" className="flex flex-col gap-4 pt-4">
              <ChannelTab
                report={report}
                channelCategory={channelCategory}
                channelIssues={channelIssues}
                identityChecks={identityChecks}
                channelHealth={channelHealth}
              />
            </TabsContent>
          </ShadcnTabs>
        </div>
      ) : (
        /* Empty State: Explaining how public audit works */
        <Card className="border-[var(--rt-color-border)] bg-[var(--rt-color-bg-elevated)] p-8 text-center">
          <div className="max-w-xl mx-auto flex flex-col items-center">
            <div className="w-12 h-12 rounded-full bg-[var(--rt-color-accent-muted)] text-[var(--rt-color-accent)] flex items-center justify-center mb-3">
              <Sparkles size={24} />
            </div>
            <h3 className="text-lg font-bold text-[var(--rt-color-text)] mb-1">
              Audit Any Public YouTube Channel
            </h3>
            <p className="text-xs text-[var(--rt-color-text-secondary)] mb-6 leading-relaxed">
              Analyze public channel performance, video metadata, playlists, and content optimization scoring — all in one report.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 w-full text-left">
              <div className="p-3 rounded-[var(--rt-radius-md)] bg-[var(--rt-color-bg-subtle)] border border-[var(--rt-color-border)]">
                <span className="text-xs font-bold text-[var(--rt-color-accent)] block mb-1">1. Choose Channel</span>
                <span className="text-[11px] text-[var(--rt-color-text-secondary)]">Enter any @handle, channel URL, or UC ID in the search bar above.</span>
              </div>
              <div className="p-3 rounded-[var(--rt-radius-md)] bg-[var(--rt-color-bg-subtle)] border border-[var(--rt-color-border)]">
                <span className="text-xs font-bold text-[var(--rt-color-accent)] block mb-1">2. Configure Run</span>
                <span className="text-[11px] text-[var(--rt-color-text-secondary)]">Select sample size (10 to 1,000 videos) and optional vision AI analysis.</span>
              </div>
              <div className="p-3 rounded-[var(--rt-radius-md)] bg-[var(--rt-color-bg-subtle)] border border-[var(--rt-color-border)]">
                <span className="text-xs font-bold text-[var(--rt-color-accent)] block mb-1">3. Compare &amp; Export</span>
                <span className="text-[11px] text-[var(--rt-color-text-secondary)]">Inspect per-element scores or download a unified multi-sheet Excel report.</span>
              </div>
            </div>
          </div>
        </Card>
      )}

      <VideoInspectorDialog
        video={inspectedVideo}
        downloadingVideo={downloadingVideo}
        onClose={() => setInspectedVideo(null)}
        onDownload={(format) => void handleVideoDownload(format)}
      />

      <HistoryArchive
        fetchHistory={fetchHistory}
        openingId={openingId}
        historyVersion={historyVersion}
        onOpen={(item) => void handleOpen(item.id)}
        onRename={handleRename}
      />
    </div>
  );
};

export default PublicAuditPanel;
