import type { VideoMetadata, PlaylistMetadata } from '../types/youtube';
import { getVideoType, formatDuration } from './timeUtils';
import { classifyPlaylistActivity, normalizePrivacyStatus } from './dashboardUtils';

interface VideoWithSource extends VideoMetadata {
  sourcePlaylistIds?: string[];
}

export type CsvExportOptions = {
  /** When false, one CSV row per video (playlist columns aggregate like the dashboard table). Default true for legacy playlist-style exports. */
  flattenPlaylistRows?: boolean;
};

export const generateCSVContent = (
  videos: VideoWithSource[],
  showChannelColumn: boolean = true,
  playlists: PlaylistMetadata[] = [],
  showPlaylistColumn: boolean = false,
  selectedMetrics?: Set<string>,
  selectedPlaylistMetas?: Set<string>,
  selectedDimensions?: Set<string>,
  options?: CsvExportOptions
): string => {
  if (videos.length === 0) {
    return '';
  }

  // Use defaults if not provided to maintain backward compatibility
  const effectiveSelectedMetrics = selectedMetrics || new Set(['viewCount', 'publishedAt', 'likeCount', 'commentCount']);
  // Do not emit playlist columns unless export explicitly enables them -- parent may still pass selectedPlaylistMetas with 'title' while showPlaylistColumn is false (e.g. dashboard before playlists are loaded).
  const effectiveSelectedPlaylistMetas = showPlaylistColumn
    ? selectedPlaylistMetas !== undefined
      ? selectedPlaylistMetas
      : new Set(['title'])
    : new Set<string>();
  const effectiveSelectedDimensions = selectedDimensions || new Set(['thumbnail', 'title']);

  const flattenPlaylistRows = options?.flattenPlaylistRows !== false;

  const flattenedVideos: VideoWithSource[] = [];
  if (flattenPlaylistRows) {
    videos.forEach(video => {
      if (video.sourcePlaylistIds && video.sourcePlaylistIds.length > 1) {
        video.sourcePlaylistIds.forEach(playlistId => {
          flattenedVideos.push({
            ...video,
            sourcePlaylistIds: [playlistId],
          });
        });
      } else {
        flattenedVideos.push(video);
      }
    });
  } else {
    flattenedVideos.push(...videos);
  }

  // Helper function to escape CSV fields
  const escapeCSVField = (field: string): string => {
    // Replace any internal quotes with double quotes
    const escaped = String(field).replace(/"/g, '""');
    // Always quote the field to handle commas and newlines
    return `"${escaped}"`;
  };

  // Helper function to get playlist data
  const getPlaylistData = (video: VideoWithSource, type: 'title' | 'id' | 'url' | 'description' | 'keywords' | 'tags' | 'thumbnailUrl'): string => {
    if (!video.sourcePlaylistIds || video.sourcePlaylistIds.length === 0) {
      return '';
    }

    const data = video.sourcePlaylistIds
      .map(id => {
        const playlist = playlists.find(p => p.id === id);
        if (!playlist) return id;

        switch (type) {
          case 'title': return playlist.title;
          case 'id': return playlist.id;
          case 'url': return `https://www.youtube.com/playlist?list=${playlist.id}`;
          case 'description': return playlist.description;
          case 'keywords': return playlist.keywords?.join(', ') || '';
          case 'thumbnailUrl': return playlist.thumbnailUrl;
          default: return '';
        }
      })
      .filter(val => val);

    // Use newline for cleaner layout in spreadsheet cells
    return data.length > 0 ? data.join('\n') : '';
  };

  // Format date for CSV (without commas to avoid splitting)
  const formatDate = (dateString: string): string => {
    const date = new Date(dateString);
    const year = date.getFullYear();
    const month = date.toLocaleDateString('en-US', { month: 'short' });
    const day = date.getDate();
    const minutes = date.getMinutes().toString().padStart(2, '0');
    const period = date.getHours() >= 12 ? 'PM' : 'AM';
    const hour12 = date.getHours() % 12 || 12;

    // Format without commas: "Nov 18 2025 02:30 PM"
    return `${month} ${day} ${year} ${hour12.toString().padStart(2, '0')}:${minutes} ${period}`;
  };

  // Format numbers without commas for CSV to avoid field splitting
  const formatNumber = (num?: number): string => {
    if (num === undefined) return 'N/A';
    return num.toString();
  };

  // Define CSV headers
  const headers = [
    '#',
    ...(effectiveSelectedDimensions.has('thumbnail') ? ['Video Thumbnail URL'] : []),
    ...(effectiveSelectedDimensions.has('title') ? ['Video Title'] : []),
    ...(effectiveSelectedDimensions.has('videoId') ? ['Video ID'] : []),
    'Video URL',
    ...(effectiveSelectedDimensions.has('type') ? ['Video Type'] : []),
    ...(effectiveSelectedDimensions.has('status') ? ['Status'] : []),
    ...(effectiveSelectedDimensions.has('duration') ? ['Duration'] : []),
    ...(effectiveSelectedMetrics.has('publishedAt') ? ['Publish Date'] : []),
    ...(effectiveSelectedMetrics.has('viewCount') ? ['Video Views'] : []),
    ...(effectiveSelectedMetrics.has('likeCount') ? ['Video Likes'] : []),
    ...(effectiveSelectedMetrics.has('commentCount') ? ['Video Comments'] : []),
    ...(effectiveSelectedDimensions.has('description') ? ['Video Description'] : []),
    ...(effectiveSelectedDimensions.has('tags') ? ['Video Tags'] : []),
    ...(effectiveSelectedPlaylistMetas.has('title') ? ['Playlists Title'] : []),
    ...(effectiveSelectedPlaylistMetas.has('id') ? ['Playlist ID'] : []),
    ...(effectiveSelectedPlaylistMetas.has('url') ? ['Playlist URL'] : []),
    ...(effectiveSelectedPlaylistMetas.has('description') ? ['Playlist Description'] : []),
    ...(effectiveSelectedPlaylistMetas.has('keywords') ? ['Playlists Keywords'] : []),
    ...(effectiveSelectedPlaylistMetas.has('thumbnailUrl') ? ['Playlist Thumbnail URL'] : []),
    // Private metrics
    ...(effectiveSelectedMetrics.has('retention') ? ['Retention (%)'] : []),
    ...(showChannelColumn ? ['Channel'] : [])
  ];

  // Convert videos to CSV rows
  const csvRows = flattenedVideos.map((video, index) => {
    const row = [
      String(index + 1),
      ...(effectiveSelectedDimensions.has('thumbnail') ? [escapeCSVField(video.thumbnailUrl)] : []),
      ...(effectiveSelectedDimensions.has('title') ? [escapeCSVField(video.title)] : []),
      ...(effectiveSelectedDimensions.has('videoId') ? [video.videoId] : []),
      `https://www.youtube.com/watch?v=${video.videoId}`,
      ...(effectiveSelectedDimensions.has('type') ? [getVideoType(video.duration)] : []),
      ...(effectiveSelectedDimensions.has('status') ? [normalizePrivacyStatus(video.privacyStatus) || 'unknown'] : []),
      ...(effectiveSelectedDimensions.has('duration') ? [formatDuration(video.duration)] : []),
      ...(effectiveSelectedMetrics.has('publishedAt') ? [formatDate(video.publishedAt)] : []),
      ...(effectiveSelectedMetrics.has('viewCount') ? [formatNumber(video.viewCount)] : []),
      ...(effectiveSelectedMetrics.has('likeCount') ? [formatNumber(video.likeCount)] : []),
      ...(effectiveSelectedMetrics.has('commentCount') ? [formatNumber(video.commentCount)] : []),
      ...(effectiveSelectedDimensions.has('description') ? [escapeCSVField(video.description || '')] : []),
      ...(effectiveSelectedDimensions.has('tags') ? [escapeCSVField(video.tags?.join(', ') || '')] : []),
      ...(effectiveSelectedPlaylistMetas.has('title') ? [escapeCSVField(getPlaylistData(video, 'title'))] : []),
      ...(effectiveSelectedPlaylistMetas.has('id') ? [escapeCSVField(getPlaylistData(video, 'id'))] : []),
      ...(effectiveSelectedPlaylistMetas.has('url') ? [escapeCSVField(getPlaylistData(video, 'url'))] : []),
      ...(effectiveSelectedPlaylistMetas.has('description') ? [escapeCSVField(getPlaylistData(video, 'description'))] : []),
      ...(effectiveSelectedPlaylistMetas.has('keywords') ? [escapeCSVField(getPlaylistData(video, 'keywords'))] : []),
      ...(effectiveSelectedPlaylistMetas.has('thumbnailUrl') ? [escapeCSVField(getPlaylistData(video, 'thumbnailUrl'))] : []),
      // Private metrics
      ...(effectiveSelectedMetrics.has('retention') ? [video.retention !== undefined ? video.retention.toFixed(1) : 'N/A'] : []),
      ...(showChannelColumn ? [escapeCSVField(video.channelTitle)] : [])
    ];
    return row;
  });

  // Combine headers and rows
  return [
    headers.join(','),
    ...csvRows.map((row) => row.join(',')),
  ].join('\n');
};

export const exportToCSV = (
  videos: VideoWithSource[],
  filename: string = 'youtube-videos.csv',
  showChannelColumn: boolean = true,
  playlists: PlaylistMetadata[] = [],
  showPlaylistColumn: boolean = false,
  selectedMetrics?: Set<string>,
  selectedPlaylistMetas?: Set<string>,
  selectedDimensions?: Set<string>,
  options?: CsvExportOptions
) => {
  const csvContent = generateCSVContent(
    videos,
    showChannelColumn,
    playlists,
    showPlaylistColumn,
    selectedMetrics,
    selectedPlaylistMetas,
    selectedDimensions,
    options
  );

  if (!csvContent) return;

  // Generate timestamp YYYY-MM-DD_HH-mm-ss
  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}-${String(now.getSeconds()).padStart(2, '0')}`;

  // Insert timestamp before extension
  let finalFilename = filename;
  if (finalFilename.toLowerCase().endsWith('.csv')) {
    finalFilename = finalFilename.replace(/.csv$/i, `_${timestamp}.csv`);
  } else {
    finalFilename = `${finalFilename}_${timestamp}.csv`;
  }

  // Create blob and download
  // Add Byte Order Mark (BOM) for Excel to recognize UTF-8
  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', finalFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);

  URL.revokeObjectURL(url);
};


export const generatePlaylistCSVContent = (
  playlists: PlaylistMetadata[]
): string => {
  if (playlists.length === 0) return '';

  const escapeCSVField = (field: string): string => {
    const escaped = String(field).replace(/"/g, '""');
    return `"${escaped}"`;
  };

  const headers = [
    '#',
    'Playlist Title',
    'Playlist ID',
    'Playlist URL',
    'Item Count',
    'Views from Playlist (Selected Period)',
    'Video Views (Selected Period)',
    'Published At',
    'Privacy',
    'Last Video Added',
    'Activity',
    'Description'
  ];

  const csvRows = playlists.map((p, index) => {
    const row = [
      String(index + 1),
      escapeCSVField(p.title),
      p.id,
      `https://www.youtube.com/playlist?list=${p.id}`,
      String(p.itemCount),
      String(p.periodViewCount ?? 0),
      p.videoPeriodViewCount !== undefined ? String(p.videoPeriodViewCount) : '',
      p.publishedAt,
      p.privacyStatus || 'public',
      p.lastVideoPublishedAt ?? '',
      classifyPlaylistActivity(p.lastVideoPublishedAt),
      escapeCSVField(p.description || '')
    ];
    return row.join(',');
  });

  return [headers.join(','), ...csvRows].join('\n');
};

export const exportPlaylistsToCSV = (
  playlists: PlaylistMetadata[],
  filename: string = 'youtube-playlists.csv'
) => {
  const csvContent = generatePlaylistCSVContent(playlists);
  if (!csvContent) return;

  const now = new Date();
  const timestamp = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
  
  const finalFilename = filename.replace(/.csv$/i, `_${timestamp}.csv`);

  const blob = new Blob(['\uFEFF' + csvContent], { type: 'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  const url = URL.createObjectURL(blob);

  link.setAttribute('href', url);
  link.setAttribute('download', finalFilename);
  link.style.visibility = 'hidden';

  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
};
