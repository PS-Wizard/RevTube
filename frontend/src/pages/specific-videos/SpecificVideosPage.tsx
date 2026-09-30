import { useState, useRef } from 'react';
import { YouTubeService } from '../../services/youtubeService';
import type { VideoMetadata } from '../../types/youtube';
import { VideoTable } from '../../components/VideoTable';
import { VideoDetailDialog } from '../../components/VideoDetailDialog';
import { exportToCSV, generateCSVContent } from '../../utils/csvExport';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { parseDuration } from '../../utils/timeUtils';
import { toast } from 'react-hot-toast';
import { ArrowDownToLine, Search, Upload, Trash2 } from 'lucide-react';
import { Button, Form, FormField, FormActions, FormHint, Alert, AlertDescription, AlertTitle, Box, Spinner, Stack, TextField, Typography } from '../../components/ui';
import { DataExplorerShell } from '../../components/shells';
import { EmptyState } from '../../components/EmptyState';

export const SpecificVideosPage = () => {
  const { user, accessToken } = useAuth();
  const { currentOrganization } = useOrganization();
  const [inputText, setInputText] = useState('');
  const [videos, setVideos] = useState<VideoMetadata[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [filterByVideos, setFilterByVideos] = useState(false);
  const [selectedVideos, setSelectedVideos] = useState<Set<string>>(new Set());
  const [videoTypeFilter] = useState<'all' | 'shorts' | 'long'>('all');
  const [detailVideo, setDetailVideo] = useState<VideoMetadata | null>(null);

  const extractVideoId = (input: string): string | null => {
    const trimmed = input.trim();
    if (!trimmed) return null;

    // Regular expressions for various YouTube URL formats
    const patterns = [
      /(?:v=|\/v\/|embed\/|shorts\/|youtu\.be\/|\/v=|\/watch\?v=|\/watch\?.+&v=|)([0-9A-Za-z_-]{11})(?:[&?]|$)/,
      /^[0-9A-Za-z_-]{11}$/ // Raw 11-character ID
    ];

    for (const pattern of patterns) {
      const match = trimmed.match(pattern);
      if (match && match[1]) return match[1];
    }

    // Try to find a 11-character ID anywhere in the string if it contains youtube.com or youtu.be
    if (trimmed.includes('youtube.com') || trimmed.includes('youtu.be')) {
      const match = trimmed.match(/([0-9A-Za-z_-]{11})/);
      if (match) return match[1];
    }

    return null;
  };

  const handleFetchVideos = async () => {
    if (!inputText.trim()) {
      setError('Please enter at least one video link or ID');
      return;
    }

    const MAX_VIDEO_IDS = 50;
    const lines = inputText.split(/[\n,;]+/).filter(Boolean);
    const ids = Array.from(new Set(lines.map(extractVideoId).filter((id): id is string => !!id)));

    if (ids.length === 0) {
      setError('No valid video IDs or links found');
      return;
    }

    if (ids.length > MAX_VIDEO_IDS) {
      setError(`Maximum of ${MAX_VIDEO_IDS} video IDs per request (got ${ids.length}). Please reduce the number of videos.`);
      return;
    }

    setLoading(true);
    setError(null);
    setVideos([]);

    try {
      const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
      const fetchedVideos = await service.fetchVideosByIds(ids);
      setVideos(fetchedVideos);
      setSelectedVideos(new Set(fetchedVideos.map(v => v.videoId)));

      if (fetchedVideos.length === 0) {
        setError('No videos found for the provided IDs');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'An unknown error occurred');
    } finally {
      setLoading(false);
    }
  };

  const getFilteredVideos = () => {
    let filtered = videos;
    if (filterByVideos) {
      if (selectedVideos.size > 0) {
        filtered = filtered.filter(v => selectedVideos.has(v.videoId));
      } else {
        filtered = [];
      }
    }
    if (videoTypeFilter !== 'all') {
      filtered = filtered.filter(v => {
        if (!v.duration) return false;
        const seconds = parseDuration(v.duration);
        if (videoTypeFilter === 'shorts') {
          return seconds <= 60;
        } else {
          return seconds > 60;
        }
      });
    }
    return filtered;
  };

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      if (!content) return;

      // Robust extraction: find any URL or 11-char ID in any cell
      const lines = content.split(/\r?\n/).filter(Boolean);
      const allExtractedIds: string[] = [];
      
      lines.forEach(line => {
        // Split by common delimiters (comma, tab, semicolon, space)
        const cells = line.split(/[,\t;]/);
        cells.forEach(cell => {
          const id = extractVideoId(cell);
          if (id) allExtractedIds.push(id);
        });
      });

      const uniqueIds = Array.from(new Set(allExtractedIds));

      if (uniqueIds.length > 0) {
        setInputText(prev => {
          const combined = prev + (prev.trim() ? '\n' : '') + uniqueIds.join('\n');
          return combined;
        });
      } else {
        setError('No valid video IDs or YouTube links found in the file');
      }
    };
    reader.onerror = () => setError('Failed to read the file');
    reader.readAsText(file);

    // Reset file input so same file can be uploaded again
    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleExportCSV = () => {
    if (videos.length === 0) return;
    const filename = `TubeKeter_Specific_Videos_${new Date().toISOString().split('T')[0]}.csv`;
    exportToCSV(videos, filename, false);
  };

  const handleShare = async () => {
    try {
      const shareData: ShareData = {
        title: 'YouTube Video Metadata',
        text: `Check out these ${videos.length} videos I analyzed with TubeKeter Analytics`,
        url: window.location.href
      };

      const csvContent = generateCSVContent(videos, false);
      let file: File | undefined;
      if (csvContent) {
        const filename = `TubeKeter_Specific_Videos.csv`;
        file = new File([csvContent], filename, { type: 'text/csv' });
      }

      if (file && navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ ...shareData, files: [file] });
      } else if (navigator.share) {
        await navigator.share(shareData);
      } else {
        await navigator.clipboard.writeText(window.location.href);
        toast.success('Link copied to clipboard!');
      }
    } catch (err) {
      console.error('Error sharing:', err);
    }
  };

  return (
    <DataExplorerShell
      title="Specific videos"
      description="Fetch metadata for individual videos by URL, ID, or CSV import."
      icon={<Search size={20} />}
      alerts={
        error ? (
          <Box sx={{ mb: 2 }}>
            <Alert severity="error">
              <AlertTitle>Error</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          </Box>
        ) : null
      }
      toolbar={
        <>
          <Form layout="toolbar">
            <FormField variant="main">
              <TextField
                multiline
                rows={5}
                fullWidth
                id="videoInput"
                aria-label="Video links or IDs"
                placeholder="Paste YouTube links or Video IDs here (one per line, or comma separated)"
                value={inputText}
                onChange={(e) => setInputText((e.target as HTMLTextAreaElement).value)}
                disabled={loading}
              />
              <FormHint>Max 50 video IDs per request</FormHint>
            </FormField>

            <FormActions>
              <Button
                variant="primary"
                onClick={handleFetchVideos}
                disabled={loading || !inputText.trim()}
              >
                {loading ? (
                  <>
                    <Spinner size="xs" />
                    Fetching...
                  </>
                ) : (
                  <>
                    <ArrowDownToLine size={14} />
                    Fetch Metadata
                  </>
                )}
              </Button>
              <Button
                variant="secondary"
                onClick={() => fileInputRef.current?.click()}
                disabled={loading}
              >
                <Upload size={14} />
                Import CSV
              </Button>
              {inputText ? (
                <Button variant="ghost" onClick={() => setInputText('')} disabled={loading}>
                <Trash2 size={14} />
                Clear
                </Button>
              ) : null}
              <input
                type="file"
                id="csvUpload"
                accept=".csv,.txt"
                hidden
                onChange={handleFileUpload}
                ref={fileInputRef}
                tabIndex={-1}
                aria-hidden
              />
            </FormActions>
          </Form>
          <FormHint>
            Tip: You can paste multiple links/IDs or upload a CSV file containing them.
          </FormHint>
        </>
      }
    >

      {loading && (
        <Stack alignItems="center" justifyContent="center" gap={1.5} sx={{ py: 12, textAlign: 'center' }}>
          <Spinner size={32} />
          <Typography variant="subtitle2">Fetching video details...</Typography>
        </Stack>
      )}

      {videos.length > 0 && !loading && (
        <div className="table-section">
          <VideoTable 
            videos={getFilteredVideos()} 
            showChannelColumn={true} 
            onExportCSV={handleExportCSV}
            onShare={handleShare}
            sourceType="videos"
            sourceName={`${videos.length} Specific Videos`}
            allVideos={videos}
            filterByVideos={filterByVideos}
            onFilterByVideosChange={setFilterByVideos}
            selectedVideos={selectedVideos}
            onSelectedVideosChange={setSelectedVideos}
            onVideoClick={(v) => setDetailVideo(v)}
          />
        </div>
      )}

      {!loading && videos.length === 0 && !error && (
        <EmptyState
          title="No Data Fetched"
          description="Enter video links or IDs above to see their metadata"
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" />
            </svg>
          }
        />
      )}

      <VideoDetailDialog
        video={detailVideo}
        open={!!detailVideo}
        onClose={() => setDetailVideo(null)}
        accessToken={accessToken}
      />
    </DataExplorerShell>
  );
};
