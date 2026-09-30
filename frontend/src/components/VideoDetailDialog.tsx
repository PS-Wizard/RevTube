import { useState, useEffect, useCallback, useMemo } from 'react';
import { Dialog, DialogTitle, DialogBody, IconButton, Button } from './ui';
import {
  Eye,
  ThumbsUp,
  MessageSquare,
  Clock,
  Calendar,
  ExternalLink,
  Copy,
  Check,
  Subtitles,
  TrendingUp,
  Percent,
  X,
  Search,
  Tag,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import type { VideoMetadata } from '../types/youtube';
import { parseDuration, getVideoType } from '../utils/timeUtils';
import { getCaptions } from '../utils/captions';
import { useFeatureConfig } from '../hooks/useFeatureConfig';
import { useAuth } from '../hooks/useAuth';
import './VideoDetailDialog.css';

interface CaptionSegment {
  text: string;
  start: number;
  duration: number;
}

interface VideoDetailDialogProps {
  video: VideoMetadata | null;
  open: boolean;
  onClose: () => void;
  accessToken?: string | null;
}

export function VideoDetailDialog({ video, open, onClose, accessToken }: VideoDetailDialogProps) {
  const { isPageEnabled, getSearchLimit } = useFeatureConfig();
  const { userPackage, getValidToken } = useAuth();
  const isCaptionsEnabled = isPageEnabled('captions');
  const captionsLimit = getSearchLimit('captions', userPackage === 'pro' ? 'pro' : 'free');
  // local quota counter (mirrors other pages freeLimit/proLimit) — no backend API call
  const CAPTIONS_USAGE_KEY = 'revtube:captions:usage';
  const getCaptionsUsage = () => {
    try { return parseInt(localStorage.getItem(CAPTIONS_USAGE_KEY) || '0', 10) || 0; } catch { return 0; }
  };

  const [captions, setCaptions] = useState<CaptionSegment[] | null>(null);
  const [captionsLoading, setCaptionsLoading] = useState(false);
  const [captionsError, setCaptionsError] = useState<string | null>(null);
  const [showCaptions, setShowCaptions] = useState(false);
  const [captionsSearch, setCaptionsSearch] = useState('');
  const [copiedId, setCopiedId] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);

  // Reset state when dialog opens with a new video
  useEffect(() => {
    if (open) {
      setCaptions(null);
      setCaptionsError(null);
      setShowCaptions(false);
      setCaptionsLoading(false);
      setCaptionsSearch('');
      setCopiedId(false);
      setCopiedLink(false);
      setDescExpanded(false);
    }
  }, [open, video?.videoId]);

  const handleFetchCaptions = useCallback(async () => {
    if (!video) return;
    if (!isCaptionsEnabled) {
      setCaptionsError('Captions are disabled by admin.');
      return;
    }
    if (captionsLimit !== -1 && getCaptionsUsage() >= captionsLimit) {
      setCaptionsError(`Caption quota reached (${captionsLimit}). Upgrade for more.`);
      return;
    }
    if (captions) {
      setShowCaptions((s) => !s);
      return;
    }

    setCaptionsLoading(true);
    setCaptionsError(null);

    try {
      // Client-side only via YouTube Data API v3 captions (no backend proxy)
      // Requires OAuth youtube.force-ssl — use passed accessToken or fresh YouTube token
      let ytToken: string | null = accessToken ?? null;
      if (!ytToken && video) {
        // try per-video channel token (if available on video) else generic
        const channelId = (video as unknown as { channelId?: string }).channelId;
        if (channelId) {
          try { ytToken = await getValidToken(channelId); } catch { /* ignore */ }
        }
      }
      if (!ytToken) throw new Error('Missing YouTube authorization — please re-connect YouTube.');
      // strip Bearer prefix if caller passed it
      const cleanToken = ytToken.replace(/^Bearer\s+/i, '');
      const segs = await getCaptions(video.videoId, cleanToken);
      if (segs && segs.length > 0) {
        setCaptions(segs);
        setShowCaptions(true);
        try {
          localStorage.setItem(CAPTIONS_USAGE_KEY, String(getCaptionsUsage() + 1));
        } catch { /* ignore */ }
      } else {
        setCaptionsError('No captions available for this video.');
      }
    } catch (err) {
      setCaptionsError(err instanceof Error ? err.message : 'Failed to load captions');
    } finally {
      setCaptionsLoading(false);
    }
  }, [video, captions, isCaptionsEnabled, captionsLimit, accessToken, getValidToken]);

  const handleCopyId = useCallback(() => {
    if (!video) return;
    navigator.clipboard.writeText(video.videoId);
    setCopiedId(true);
    setTimeout(() => setCopiedId(false), 2000);
  }, [video]);

  const handleCopyLink = useCallback(() => {
    if (!video) return;
    navigator.clipboard.writeText(`https://www.youtube.com/watch?v=${video.videoId}`);
    setCopiedLink(true);
    setTimeout(() => setCopiedLink(false), 2000);
  }, [video]);

  const filteredCaptions = useMemo(() => {
    if (!captions) return [];
    if (!captionsSearch.trim()) return captions;
    const query = captionsSearch.toLowerCase();
    return captions.filter((c) => c.text.toLowerCase().includes(query));
  }, [captions, captionsSearch]);

  if (!video) return null;

  const videoType = getVideoType(video.duration);
  const youtubeUrl = `https://www.youtube.com/watch?v=${video.videoId}`;
  const isLongDescription = Boolean(video.description && video.description.length > 300);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      fullWidth
      maxWidth="xl"
      aria-label="Video details"
      slotProps={{
        paper: {
          className: 'vdd-paper',
        },
      }}
    >
      {/* Dialog Header */}
      <DialogTitle className="vdd-header">
        <div className="vdd-header-left">
          <span className="vdd-title-text">Video Details & Analytics</span>
          <span className={`vdd-type-badge ${videoType.toLowerCase()}`}>{videoType}</span>
        </div>
        <div className="vdd-header-actions">
          <a
            href={youtubeUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="rt-btn rt-btn--secondary rt-btn--sm vdd-youtube-btn"
          >
            <ExternalLink size={14} />
            <span>Open YouTube</span>
          </a>
          <IconButton onClick={onClose} size="small" aria-label="Close">
            <X size={18} />
          </IconButton>
        </div>
      </DialogTitle>

      {/* Dialog Body - 2 Column Grid */}
      <DialogBody dividers className="vdd-content">
        <div className="vdd-grid">
          {/* Left Column: Embed Player & Info */}
          <div className="vdd-main-column">
            {/* Embed Container */}
            <div className="vdd-embed-container">
              <div className="vdd-embed">
                <iframe
                  src={`https://www.youtube.com/embed/${video.videoId}?autoplay=0&rel=0`}
                  title={video.title}
                  allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                  allowFullScreen
                />
              </div>
            </div>

            {/* Title & Channel Header */}
            <div className="vdd-title-block">
              <h2 className="vdd-video-title">
                <a href={youtubeUrl} target="_blank" rel="noopener noreferrer">
                  {video.title}
                </a>
              </h2>
            </div>

            {/* Description Card */}
            {video.description && (
              <div className="vdd-card vdd-description-card">
                <h3 className="vdd-card-title">Description</h3>
                <p className={`vdd-description ${descExpanded ? 'is-expanded' : ''}`}>{video.description}</p>
                {isLongDescription && (
                  <Button variant="ghost" size="sm"
                    onClick={() => setDescExpanded((prev) => !prev)}
                  >
                    {descExpanded ? (
                      <>
                        <span>Show Less</span>
                        <ChevronUp size={14} />
                      </>
                    ) : (
                      <>
                        <span>Show More</span>
                        <ChevronDown size={14} />
                      </>
                    )}
                  </Button>
                )}
              </div>
            )}

          </div>

          {/* Right Column: Key Analytics & Captions */}
          <div className="vdd-side-column">
            {/* KPI Cards Grid */}
            <div className="vdd-section-heading">Key Metrics</div>
            <div className="vdd-metrics-grid">
              <div className="vdd-kpi-card">
                <div className="vdd-kpi-header">
                  <span className="vdd-kpi-label">Views</span>
                  <div className="vdd-kpi-icon-wrapper views">
                    <Eye size={15} />
                  </div>
                </div>
                <div className="vdd-kpi-value">{fmtNumber(video.viewCount)}</div>
              </div>

              <div className="vdd-kpi-card">
                <div className="vdd-kpi-header">
                  <span className="vdd-kpi-label">Likes</span>
                  <div className="vdd-kpi-icon-wrapper likes">
                    <ThumbsUp size={15} />
                  </div>
                </div>
                <div className="vdd-kpi-value">{video.likeCount != null ? fmtNumber(video.likeCount) : 'N/A'}</div>
              </div>

              <div className="vdd-kpi-card">
                <div className="vdd-kpi-header">
                  <span className="vdd-kpi-label">Comments</span>
                  <div className="vdd-kpi-icon-wrapper comments">
                    <MessageSquare size={15} />
                  </div>
                </div>
                <div className="vdd-kpi-value">
                  {video.commentCount != null ? fmtNumber(video.commentCount) : 'N/A'}
                </div>
              </div>

              <div className="vdd-kpi-card">
                <div className="vdd-kpi-header">
                  <span className="vdd-kpi-label">Duration</span>
                  <div className="vdd-kpi-icon-wrapper duration">
                    <Clock size={15} />
                  </div>
                </div>
                <div className="vdd-kpi-value">
                  {video.duration ? formatDuration(video.duration) : 'N/A'}
                </div>
              </div>

              <div className="vdd-kpi-card">
                <div className="vdd-kpi-header">
                  <span className="vdd-kpi-label">Published</span>
                  <div className="vdd-kpi-icon-wrapper published">
                    <Calendar size={15} />
                  </div>
                </div>
                <div className="vdd-kpi-value">{fmtDate(video.publishedAt)}</div>
              </div>

              {video.retention != null && (
                <div className="vdd-kpi-card">
                  <div className="vdd-kpi-header">
                    <span className="vdd-kpi-label">Retention</span>
                    <div className="vdd-kpi-icon-wrapper retention">
                      <TrendingUp size={15} />
                    </div>
                  </div>
                  <div className="vdd-kpi-value">{video.retention.toFixed(1)}%</div>
                </div>
              )}

              {video.ctr != null && (
                <div className="vdd-kpi-card">
                  <div className="vdd-kpi-header">
                    <span className="vdd-kpi-label">CTR</span>
                    <div className="vdd-kpi-icon-wrapper ctr">
                      <Percent size={15} />
                    </div>
                  </div>
                  <div className="vdd-kpi-value">{(video.ctr * 100).toFixed(2)}%</div>
                </div>
              )}
            </div>

            {/* Quick Metadata & Actions Card */}
            <div className="vdd-card vdd-meta-card">
              <div className="vdd-meta-row">
                <span className="vdd-meta-label">Video ID</span>
                <div className="vdd-id-badge-wrap">
                  <code className="vdd-video-id">{video.videoId}</code>
                  <Button variant="ghost" size="icon"
                    onClick={handleCopyId}
                    title="Copy Video ID"
                  >
                    {copiedId ? <Check size={14} className="copied" /> : <Copy size={14} />}
                  </Button>
                </div>
              </div>
              <div className="vdd-meta-row">
                <span className="vdd-meta-label">Direct Link</span>
                <Button variant="ghost" size="sm"
                  onClick={handleCopyLink}
                >
                  {copiedLink ? <Check size={14} /> : <Copy size={14} />}
                  <span>{copiedLink ? 'Copied Link!' : 'Copy Link'}</span>
                </Button>
              </div>
            </div>

            {/* Tags Card — shifted to right side */}
            {video.tags && video.tags.length > 0 && (
              <div className="vdd-card vdd-tags-card">
                <div className="vdd-card-header">
                  <Tag size={15} className="vdd-card-icon" />
                  <h3 className="vdd-card-title">Tags ({video.tags.length})</h3>
                </div>
                <div className="vdd-tags-list">
                  {video.tags.map((tag, i) => (
                    <span key={i} className="vdd-tag">
                      #{tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Captions & Transcript Section — featureConfig captions, client-side only */}
            {isCaptionsEnabled ? (
              <div className="vdd-card vdd-captions-card">
                <div className="vdd-captions-header">
                  <div className="vdd-captions-title">
                    <Subtitles size={16} />
                    <span>Captions Transcript</span>
                    {captionsLimit !== -1 && (
                      <span className="vdd-captions-quota">({getCaptionsUsage()}/{captionsLimit})</span>
                    )}
                  </div>
                  <Button variant="secondary" size="sm"
                    onClick={handleFetchCaptions}
                    disabled={captionsLoading}
                  >
                    {captionsLoading ? (
                      <>Loading...</>
                    ) : showCaptions && captions ? (
                      <>Hide Captions</>
                    ) : (
                      <>View Captions</>
                    )}
                </Button>
              </div>

              {captionsLoading && (
                <div className="vdd-captions-loading">
                  <div className="spinner-small" /> Fetching captions...
                </div>
              )}

              {captionsError && <p className="vdd-captions-error">{captionsError}</p>}

              {showCaptions && captions && captions.length > 0 && (
                <div className="vdd-captions-body">
                  <div className="vdd-captions-search-box">
                    <Search size={14} className="search-icon" />
                    <input
                      type="text"
                      placeholder="Search in transcript..."
                      value={captionsSearch}
                      onChange={(e) => setCaptionsSearch(e.target.value)}
                    />
                    {captionsSearch && (
                      <Button variant="ghost" size="icon"
                        onClick={() => setCaptionsSearch('')}
                      >
                        <X size={12} />
                      </Button>
                    )}
                  </div>

                  <div className="vdd-captions-list">
                    {filteredCaptions.length > 0 ? (
                      filteredCaptions.map((seg, i) => (
                        <div key={i} className="vdd-caption-line">
                          <span className="vdd-caption-time">{formatTime(seg.start)}</span>
                          <span className="vdd-caption-text">{seg.text}</span>
                        </div>
                      ))
                    ) : (
                      <div className="vdd-captions-empty">No matching lines found.</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            ) : null}
          </div>
        </div>
      </DialogBody>
    </Dialog>
  );
}

/** Format numbers to standard compact display */
function fmtNumber(n?: number): string {
  if (n == null) return 'N/A';
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toLocaleString();
}

/** Format dates to readable format */
function fmtDate(d: string): string {
  try {
    return new Date(d).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  } catch {
    return d;
  }
}

/** Format seconds to mm:ss */
function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}

/** Format ISO 8601 duration to readable string */
function formatDuration(iso: string): string {
  const secs = parseDuration(iso);
  if (!secs) return 'N/A';
  const h = Math.floor(secs / 3600);
  const m = Math.floor((secs % 3600) / 60);
  const s = Math.floor(secs % 60);
  if (h > 0) return `${h}h ${m}m`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

