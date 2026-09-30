// ─────────────────────────────────────────────────────────────────────────────
// RunControls — audit launcher card: channel input, video count, playlist +
// thumbnail toggles, disabled captions toggle (not implemented yet),
// Start button, queued-job progress, hint, and error banner.
// Shared shadcn primitives + Tailwind only.
// ─────────────────────────────────────────────────────────────────────────────
import { AlertTriangle, CircleHelp, FilePlus2, Info, Play, Search, Sparkles, X } from 'lucide-react';
import {
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  IconButton,
  Input,
  NativeSelect,
  Progress,
  Spinner,
  Switch,
  Tooltip,
} from '../../../ui';
import { VIDEO_COUNT_OPTIONS } from '../publicAuditUtils';
import type { PublicAuditReport } from '../../../../services/publicAuditService';

interface RunControlsProps {
  report: PublicAuditReport | null;
  channelInput: string;
  setChannelInput: (v: string) => void;
  maxVideos: number;
  setMaxVideos: (v: number) => void;
  includeAllPlaylists: boolean;
  setIncludeAllPlaylists: (v: boolean) => void;
  includeThumbnail: boolean;
  setIncludeThumbnail: (v: boolean) => void;
  includeCaptions: boolean;
  setIncludeCaptions: (v: boolean) => void;
  busy: boolean;
  running: boolean;
  jobId: string | null;
  jobProgress: number;
  jobState: string | null;
  runError: string | null;
  setRunError: (v: string | null) => void;
  onRun: () => void;
  onClear: () => void;
  onShowRubric: () => void;
}

export function RunControls({
  report,
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
  onRun,
  onClear,
  onShowRubric,
}: RunControlsProps) {
  return (
    <Card className="border-[var(--rt-color-border)] shadow-sm bg-[var(--rt-color-bg-elevated)]">
      <CardHeader className="pb-3 border-b border-[var(--rt-color-border)]">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 min-w-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <Sparkles size={18} className="text-[var(--rt-color-accent)] shrink-0" />
              <CardTitle className="text-base font-semibold text-[var(--rt-color-text)] truncate">
                Run Channel Audit
              </CardTitle>
            </div>
            <CardDescription className="text-xs text-[var(--rt-color-text-secondary)] mt-1">
              Audit any public creator, competitor, or prospect channel — just paste a channel link, handle, or ID.
            </CardDescription>
          </div>
          <div className="flex shrink-0 items-center gap-2 self-start sm:self-auto">
            {report && (
              <Button
                variant="secondary"
                size="sm"
                onClick={onClear}
                startIcon={<FilePlus2 size={14} />}
                className="text-xs"
                title="Clear this report and start a new audit"
              >
                New Audit
              </Button>
            )}
            <Button
              variant="ghost"
              size="sm"
              onClick={onShowRubric}
              className="text-xs text-[var(--rt-color-text-secondary)] hover:text-[var(--rt-color-accent)] shrink-0"
              startIcon={<CircleHelp size={14} />}
            >
              Scoring Rubric
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="flex flex-col gap-4">
          {/* Input Row */}
          <div className="flex flex-col lg:flex-row items-stretch lg:items-center gap-3">
            <div className="flex-1 min-w-0">
              <Input
                value={channelInput}
                onChange={(e) => setChannelInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') onRun();
                }}
                placeholder="Enter @handle, UC… channel ID, or youtube.com/@handle URL"
                aria-label="Channel handle, ID, or URL"
                startAdornment={<Search size={16} aria-hidden />}
                className="h-10 text-sm bg-[var(--rt-color-bg-app)] border-[var(--rt-color-border-strong)]"
                clearable
                onClear={() => setChannelInput('')}
                disabled={busy}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2.5 shrink-0">
              <div className="flex items-center gap-1.5 text-xs text-[var(--rt-color-text-secondary)]">
                <span>Audit</span>
                <NativeSelect
                  value={String(maxVideos)}
                  onChange={(e) => setMaxVideos(Number(e.target.value))}
                  aria-label="Videos to audit"
                  disabled={busy}
                  className="h-10 text-xs font-medium bg-[var(--rt-color-bg-app)] border-[var(--rt-color-border-strong)]"
                >
                  {VIDEO_COUNT_OPTIONS.map((n) => (
                    <option key={n} value={n}>{`${n} videos`}</option>
                  ))}
                </NativeSelect>
              </div>

              <Tooltip title="Fetches and analyzes all public playlists created by the channel">
                <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-app)]">
                  <Switch
                    checked={includeAllPlaylists}
                    onCheckedChange={setIncludeAllPlaylists}
                    disabled={busy}
                    size="sm"
                    id="toggle-all-playlists"
                  />
                  <label htmlFor="toggle-all-playlists" className="text-xs font-medium text-[var(--rt-color-text)] cursor-pointer">
                    All Playlists
                  </label>
                </div>
              </Tooltip>

              <Tooltip title="Runs vision AI evaluation on video thumbnails (adds ~1 vision pass per video)">
                <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-app)]">
                  <Switch
                    checked={includeThumbnail}
                    onCheckedChange={setIncludeThumbnail}
                    disabled={busy}
                    size="sm"
                    id="toggle-thumbnail-ai"
                  />
                  <label htmlFor="toggle-thumbnail-ai" className="text-xs font-medium text-[var(--rt-color-text)] cursor-pointer">
                    Thumbnail AI
                  </label>
                </div>
              </Tooltip>

              <Tooltip title="Captions aren't fetched yet — audits exclude caption scoring until caption support ships">
                <div className="flex items-center gap-2 px-3 py-2 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-app)] opacity-60">
                  <Switch
                    checked={includeCaptions}
                    onCheckedChange={setIncludeCaptions}
                    disabled
                    size="sm"
                    id="toggle-captions"
                  />
                  <label htmlFor="toggle-captions" className="text-xs font-medium text-[var(--rt-color-text)] cursor-not-allowed">
                    Captions (soon)
                  </label>
                </div>
              </Tooltip>

              <Button
                variant="primary"
                size="md"
                onClick={onRun}
                disabled={busy || !channelInput.trim()}
                startIcon={busy ? <Spinner size="xs" /> : <Play size={14} className="fill-current" />}
                className="h-10 px-5 shadow-sm"
              >
                {jobId != null ? `Auditing… ${jobProgress}%` : running ? 'Auditing…' : 'Start Audit'}
              </Button>
            </div>
          </div>

          {/* Queued-job progress */}
          {jobId != null && (
            <div className="flex min-w-0 flex-col gap-1.5 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-border)] bg-[var(--rt-color-bg-subtle)] p-3">
              <div className="flex min-w-0 items-center justify-between gap-2 text-xs">
                <span className="min-w-0 truncate font-medium text-[var(--rt-color-text-secondary)]">
                  Audit running in the background{jobState ? ` — ${jobState}` : ''}…
                </span>
                <span className="shrink-0 font-bold tabular-nums text-[var(--rt-color-accent)]">{jobProgress}%</span>
              </div>
              <Progress value={jobProgress} className="h-1.5 bg-[var(--rt-color-bg-muted)]" />
              <span className="text-[11px] text-[var(--rt-color-text-tertiary)]">
                You can leave this page — the report will be here when it finishes.
              </span>
            </div>
          )}

          {/* Run hint */}
          <div className="flex flex-wrap items-center gap-1.5 border-t border-[var(--rt-color-border)] pt-3 text-xs text-[var(--rt-color-text-tertiary)]">
            <Info size={13} className="shrink-0 text-[var(--rt-color-accent)]" />
            <span className="min-w-0">Larger audits take longer — you can leave this page and come back; your report is saved to the history below.</span>
          </div>

          {runError && (
            <div className="flex items-start gap-2.5 rounded-[var(--rt-radius-md)] border border-[var(--rt-color-danger)]/20 bg-[var(--rt-color-danger-surface)] p-3 text-xs text-[var(--rt-color-danger)]">
              <AlertTriangle size={16} className="mt-0.5 shrink-0" />
              <div className="min-w-0 flex-1">{runError}</div>
              <IconButton
                size="xs"
                variant="ghost"
                onClick={() => setRunError(null)}
                aria-label="Dismiss error"
                className="shrink-0 text-[var(--rt-color-danger)] hover:opacity-80"
              >
                <X size={14} />
              </IconButton>
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
