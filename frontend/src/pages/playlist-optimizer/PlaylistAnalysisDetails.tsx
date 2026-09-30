// ─────────────────────────────────────────────────────────────────────────────
// PlaylistAnalysisDetails -- "Analysis Details" panel showing exactly what data
// was used for this run: channel, mode, data range, playlists included,
// filters, and target strategy. Rendered above the Channel Audit.
// ─────────────────────────────────────────────────────────────────────────────
import { Database, Layers, SlidersHorizontal, Target } from "lucide-react";
import type { AnalysisMeta } from "../../types/playlistOptimizer";

interface PlaylistAnalysisDetailsProps {
  meta?: AnalysisMeta;
  channelName?: string;
}

const RANGE_LABELS: Record<string, string> = {
  "7d": "Last 7 days",
  "30d": "Last 30 days",
  "90d": "Last 90 days",
  all: "All time",
};

function truthy(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return null;
  if (typeof value === "boolean") return value ? "Yes" : null;
  if (typeof value === "number" && value === 0) return null;
  return String(value);
}

function FilterRow({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <span className="pl-detail-chip">
      <strong>{label}:</strong> {value}
    </span>
  );
}

export const PlaylistAnalysisDetails: React.FC<PlaylistAnalysisDetailsProps> = ({
  meta,
  channelName,
}) => {
  if (!meta) return null;

  const filters = meta.filters;
  const mode = meta.mode === "EXISTING" ? "Optimize existing playlists" : "Generate new playlists";
  const range = RANGE_LABELS[meta.dataRange ?? ""] ?? meta.dataRange ?? "All time";

  return (
    <div className="pl-analysis-details">
      <div className="pl-included-videos-head">
        <h3 className="pl-included-videos-title">
          <Database size={16} /> Analysis Details
        </h3>
        <span className="pl-included-videos-count">What data was used for this audit</span>
      </div>

      <div className="pl-detail-grid">
        <div className="pl-detail-item">
          <span className="pl-detail-label">
            <Layers size={13} /> Channel
          </span>
          <span className="pl-detail-value">
            {channelName || meta.channelIdentifier || "Connected channel"}
          </span>
        </div>
        <div className="pl-detail-item">
          <span className="pl-detail-label">Mode</span>
          <span className="pl-detail-value">{mode}</span>
        </div>
        <div className="pl-detail-item">
          <span className="pl-detail-label">Data range</span>
          <span className="pl-detail-value">{range}</span>
        </div>
        <div className="pl-detail-item">
          <span className="pl-detail-label">Videos analyzed</span>
          <span className="pl-detail-value">{meta.videoCount ?? 0}</span>
        </div>
      </div>

      {meta.playlistsIncluded?.length ? (
        <div className="pl-detail-block">
          <div className="pl-detail-block-title">
            <Layers size={13} /> Playlists included
          </div>
          <div className="pl-detail-chips">
            {meta.playlistsIncluded.map((p) => (
              <span key={p.playlistId} className="pl-detail-chip">
                <strong>{p.title || p.playlistId}:</strong> {p.videoCount} video
                {p.videoCount === 1 ? "" : "s"}
              </span>
            ))}
          </div>
        </div>
      ) : null}

      {filters ? (
        <div className="pl-detail-block">
          <div className="pl-detail-block-title">
            <SlidersHorizontal size={13} /> Filters applied
          </div>
          <div className="pl-detail-chips">
            <FilterRow label="Exclude keywords" value={truthy(filters.excludeKeywords)} />
            <FilterRow label="Max playlists" value={truthy(filters.maxPlaylists)} />
            <FilterRow label="Min playlists" value={truthy(filters.minPlaylists)} />
            <FilterRow label="Min videos/playlist" value={truthy(filters.minVideosPerPlaylist)} />
            <FilterRow label="Max videos/playlist" value={truthy(filters.maxVideosPerPlaylist)} />
            <FilterRow label="Max playlists/video" value={truthy(filters.maxPlaylistsPerVideo)} />
            <FilterRow label="Only optimized" value={truthy(filters.onlyOptimized)} />
            <FilterRow label="Time-decay weighting" value={truthy(filters.useTimeDecay)} />
          </div>
        </div>
      ) : null}

      {filters?.enableTargetPlaylist ? (
        <div className="pl-detail-block">
          <div className="pl-detail-block-title">
            <Target size={13} /> Target strategy
          </div>
          <div className="pl-detail-chips">
            <FilterRow label="Target" value={truthy(filters.targetName)} />
            <FilterRow label="Criteria" value={truthy(filters.targetCriteria)} />
          </div>
        </div>
      ) : null}
    </div>
  );
};
