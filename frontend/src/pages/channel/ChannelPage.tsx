import { useState, useCallback, useEffect } from 'react';
import { useSearchParams } from 'react-router-dom';
import { YouTubeService } from '../../services/youtubeService';
import type { ChannelMetadata, VideoMetadata } from '../../types/youtube';
import { AutocompleteInput } from '../../components/AutocompleteInput';
import { useAuth } from '../../hooks/useAuth';
import { useOrganization } from '../../hooks/useOrganization';
import { useUsage } from '../../hooks/useUsage';
import { saveRecentChannel, getRecentChannels, type RecentChannel } from '../../services/recentsService';
import { UsageLimitError } from '../../services/analyticsService';
import { UsageLimitBanner } from '../../components/UsageLimitBanner';
import { Skeleton } from '../../components/Skeleton';
import { EmptyState } from '../../components/EmptyState';
import {
  Baby,
  CalendarDays,
  ExternalLink,
  Eye,
  Link2,
  ListVideo,
  Mail,
  MapPin,
  Search,
  Tag,
  Users,
  Video,
} from 'lucide-react';
import { Button, Form, FormField, FormActions } from '../../components/ui';
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Chip,
  Flex,
  Grid,
  Spinner,
  Stack,
  StatCard,
  Typography,
} from '../../components/ui';
import { DataExplorerShell } from '../../components/shells';

const CACHE_KEY = 'channel_inspector_cache';
const CACHE_DURATION = 24 * 60 * 60 * 1000; // 24 hours

interface CachedChannelData {
  inputValue: string;
  channelDetails: ChannelMetadata;
  timestamp: number;
}

const loadCache = (input?: string, orgId?: string): CachedChannelData | null => {
  try {
    const orgSuffix = orgId ? `::org:${orgId}` : '';
    const key = input ? `${CACHE_KEY}_${input}${orgSuffix}` : `${CACHE_KEY}_last${orgSuffix}`;
    const raw = localStorage.getItem(key);
    if (!raw) return input ? loadCache(undefined, orgId) : null;
    const data: CachedChannelData = JSON.parse(raw);
    if (Date.now() - data.timestamp > CACHE_DURATION) {
      localStorage.removeItem(key);
      return null;
    }
    return data;
  } catch { return null; }
};

const saveCache = (input: string, channelDetails: ChannelMetadata, orgId?: string) => {
  try {
    const orgSuffix = orgId ? `::org:${orgId}` : '';
    const data: CachedChannelData = { inputValue: input, channelDetails, timestamp: Date.now() };
    localStorage.setItem(`${CACHE_KEY}_${input}${orgSuffix}`, JSON.stringify(data));
    localStorage.setItem(`${CACHE_KEY}_last${orgSuffix}`, JSON.stringify(data));
  } catch { /* ignore */ }
};

interface ExtractedLink {
  url: string;
  label: string;
  type: 'social' | 'website' | 'youtube' | 'other';
}

const extractAllLinks = (text: string): ExtractedLink[] => {
  if (!text) return [];
  // Match http/https URLs -- case-insensitive for the protocol (some channels write "Https://")
  const urlRegex = /https?:\/\/[^\s]+/gi;
  const matches = Array.from(text.matchAll(urlRegex));
  if (!matches.length) return [];

  const socialPlatforms = [
    { name: 'Instagram', pattern: /instagram\.com/i },
    { name: 'Twitter / X', pattern: /(twitter\.com|x\.com)/i },
    { name: 'Facebook', pattern: /facebook\.com/i },
    { name: 'LinkedIn', pattern: /linkedin\.com/i },
    { name: 'TikTok', pattern: /tiktok\.com/i },
    { name: 'Twitch', pattern: /twitch\.tv/i },
    { name: 'Discord', pattern: /discord\.(gg|com)/i },
    { name: 'GitHub', pattern: /github\.com/i },
    { name: 'Snapchat', pattern: /snapchat\.com/i },
    { name: 'Telegram', pattern: /t\.me|telegram\./i },
    { name: 'WhatsApp', pattern: /wa\.me|whatsapp\.com/i },
  ];

  const links: ExtractedLink[] = [];
  const seen = new Set<string>();

  for (const match of matches) {
    const url = match[0].replace(/[.,;)]+$/, '');
    // Normalize for dedup: lowercase hostname, strip www.
    const normalized = url.replace(/^https?:\/\//i, '').replace(/^www\./i, '').toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);

    // Determine type
    if (/youtube\.com|youtu\.be/i.test(url)) {
      links.push({ url, label: 'YouTube', type: 'youtube' });
    } else {
      const social = socialPlatforms.find(p => p.pattern.test(url));
      if (social) {
        links.push({ url, label: social.name, type: 'social' });
      } else if (/^https?:\/\//i.test(url)) {
        const hostname = new URL(url).hostname.replace(/^www\./, '');
        links.push({ url, label: hostname, type: 'website' });
      } else {
        links.push({ url, label: url, type: 'other' });
      }
    }
  }

  return links;
};

/** Extract email addresses from text. */
const extractEmail = (text: string): string | null => {
  if (!text) return null;
  const match = text.match(/[\w.+-]+@[\w-]+\.[\w.-]+/i);
  return match ? match[0] : null;
};

/**
 * YouTube banner URLs (bannerExternalUrl) are served by Google's image CDN
 * which accepts a size suffix. Strip any existing size token and request the
 * 2560px wide version -- the highest quality YouTube serves.
 */
const getHighQualityBannerUrl = (url: string | undefined): string | undefined => {
  if (!url) return url;
  // Strip trailing Google CDN size directives like =s640 or =w640-fcrop64=1,...
  const cleaned = url.replace(/=[swh]\d[^=]*$/, '');
  return `${cleaned}=w2560`;
};

/** Parse channel keywords (handles both space-separated and comma-separated formats). */
const parseKeywords = (keywordsStr: string): string[] => {
  if (!keywordsStr) return [];
  // If the keywords string contains commas, assume it's comma-separated
  if (keywordsStr.includes(',')) {
    return keywordsStr
      .split(',')
      .map(k => k.trim())
      .filter(Boolean);
  }
  // Otherwise, split by space while keeping quoted phrases intact
  const matches = keywordsStr.match(/"[^"]+"|[^\s]+/g);
  if (!matches) return [];
  return matches
    .map(k => k.replace(/"/g, '').trim())
    .filter(Boolean);
};

const getPlatformIcon = (platform: string) => {
  const size = 14;
  switch (platform) {
    case 'Instagram':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
          <rect x="2" y="2" width="20" height="20" rx="5" ry="5"></rect>
          <path d="M16 11.37A4 4 0 1 1 12.63 8 4 4 0 0 1 16 11.37z"></path>
          <line x1="17.5" y1="6.5" x2="17.51" y2="6.5"></line>
        </svg>
      );
    case 'Twitter / X':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
          <path d="M4 4l11.733 16h4.267l-11.733 -16z" />
          <path d="M4 20l6.768 -6.768m2.46 -2.46l6.772 -6.772" />
        </svg>
      );
    case 'Facebook':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
          <path d="M18 2h-3a5 5 0 0 0-5 5v3H7v4h3v8h4v-8h3l1-4h-4V7a1 1 0 0 1 1-1h3z"></path>
        </svg>
      );
    case 'LinkedIn':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
          <path d="M16 8a6 6 0 0 1 6 6v7h-4v-7a2 2 0 0 0-2-2 2 2 0 0 0-2 2v7h-4v-7a6 6 0 0 1 6-6z"></path>
          <rect x="2" y="9" width="4" height="12"></rect>
          <circle cx="4" cy="4" r="2"></circle>
        </svg>
      );
    case 'GitHub':
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
          <path d="M9 19c-5 1.5-5-2.5-7-3m14 6v-3.87a3.37 3.37 0 0 0-.94-2.61c3.14-.35 6.44-1.54 6.44-7A5.44 5.44 0 0 0 20 4.77 5.07 5.07 0 0 0 19.91 1S18.73.65 16 2.48a13.38 13.38 0 0 0-7 0C6.27.65 5.09 1 5.09 1A5.07 5.07 0 0 0 5 4.77a5.44 5.44 0 0 0-1.5 3.78c0 5.42 3.3 6.61 6.44 7A3.37 3.37 0 0 0 9 18.13V22"></path>
        </svg>
      );
    default:
      return (
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width={size} height={size}>
          <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
          <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
        </svg>
      );
  }
};

const renderDescriptionWithLinks = (text: string) => {
  if (!text) return '';

  const urlRegex = /(https?:\/\/[^\s]+|www\.[^\s]+)/g;
  const parts = text.split(urlRegex);
  if (parts.length === 1) return text;

  return parts.map((part, i) => {
    if (part.match(urlRegex)) {
      const href = part.startsWith('http') ? part : `https://${part}`;
      return (
          <a
            key={i}
            href={href}
            target="_blank"
            rel="noopener noreferrer"
            className="text-[var(--rt-color-accent)] hover:underline"
          >
            {part}
          </a>
      );
    }
    return part;
  });
};

export const ChannelPage = () => {
  const { user, accessToken } = useAuth();
  const { invalidateUsage } = useUsage();
  const [searchParams] = useSearchParams();

  const { currentOrganization } = useOrganization();
  const cachedData = loadCache(undefined, currentOrganization?.id);
  const [inputValue, setInputValue] = useState(cachedData?.inputValue || '');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [usageError, setUsageError] = useState<{limit: number, used: number, message: string, pageKey?: string} | null>(null);
  const [channelDetails, setChannelDetails] = useState<ChannelMetadata | null>(cachedData?.channelDetails || null);
  const [featuredVideo, setFeaturedVideo] = useState<VideoMetadata | null>(null);
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [isDescriptionExpanded, setIsDescriptionExpanded] = useState(false);
  const [isFeaturedDescExpanded, setIsFeaturedDescExpanded] = useState(false);
  const [isKeywordsExpanded, setIsKeywordsExpanded] = useState(false);

  const loadRecentChannels = useCallback(async () => {
    if (user) {
      const recents = await getRecentChannels(user.uid);
      setRecentChannels(recents);
    }
  }, [user]);

  useEffect(() => {
    loadRecentChannels();
  }, [loadRecentChannels]);

  const extractIdFromUrl = (input: string): string => {
    const trimmedInput = input.trim();
    const channelPatterns = [
      /youtube\.com\/channel\/([^/?&]+)/i,
      /youtube\.com\/c\/([^/?&]+)/i,
      /youtube\.com\/@([^/?&]+)/i,
      /youtube\.com\/user\/([^/?&]+)/i,
    ];
    for (const pattern of channelPatterns) {
      const match = trimmedInput.match(pattern);
      if (match && match[1]) {
        const value = match[1];
        if (pattern.source.includes('@') || trimmedInput.includes('/@')) {
          return value.startsWith('@') ? value : `@${value}`;
        }
        return value;
      }
    }
    return trimmedInput;
  };

  const handleFetchChannel = useCallback(async (forcedId?: string, useCache = false) => {
    const channelInput = forcedId || inputValue;
    if (!channelInput.trim()) {
      setError('Please enter a channel handle, ID, or URL');
      return;
    }

    // Only use cache for URL param auto-loads (sidebar navigation), not explicit button clicks
    if (useCache) {
      const cached = loadCache(channelInput, currentOrganization?.id);
      if (cached) {
        setChannelDetails(cached.channelDetails);
        setInputValue(channelInput);
        setError(null);
        // Also fetch the trailer video in background
        const trailerId = cached.channelDetails?.brandingSettings?.channel?.unsubscribedTrailer;
        if (trailerId) {
          try {
            const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
            const videos = await service.fetchVideosByIds([trailerId]);
            if (videos.length > 0) setFeaturedVideo(videos[0]);
          } catch { /* trailer fetch is best-effort */ }
        }
        return;
      }
    }

    setLoading(true);
    setError(null);
    setUsageError(null);
    setIsDescriptionExpanded(false);
    setIsFeaturedDescExpanded(false);
    setIsKeywordsExpanded(false);
    setFeaturedVideo(null);

    try {
      const service = new YouTubeService(user?.email || '', accessToken, currentOrganization?.id || null);
      const extracted = extractIdFromUrl(channelInput);
      // Single API call -- fetches channel + trailer video together
      const result = await service.getChannelWithTrailer(extracted);
      if (!result.channel) {
        throw new Error(`Could not find channel. Please check the username, handle, channel ID, or URL.`);
      }
      setChannelDetails(result.channel);
      setFeaturedVideo(result.trailerVideo);
      saveCache(channelInput, result.channel, currentOrganization?.id);

      if (user) {
        const avatar = result.channel.snippet.thumbnails?.default?.url || result.channel.snippet.thumbnails?.medium?.url;
        await saveRecentChannel(user.uid, channelInput, result.channel.snippet.title, avatar);
        await loadRecentChannels();
        window.dispatchEvent(new Event('refreshRecents'));
      }
      // Refresh the sidebar usage bar now that a channel quota has been spent
      invalidateUsage();
    } catch (err) {
      if (err instanceof UsageLimitError) {
        setUsageError({ limit: err.limit, used: err.used, message: err.message, pageKey: err.pageKey });
      } else {
        setError(err instanceof Error ? err.message : 'An unknown error occurred');
      }
    } finally {
      setLoading(false);
    }
  }, [inputValue, user, accessToken, loadRecentChannels, currentOrganization?.id, invalidateUsage]);

  // Featured video is now fetched inside handleFetchChannel via getChannelWithTrailer
  // This effect resets featuredVideo when channel details are cleared (org switch)
  useEffect(() => {
    if (!channelDetails) {
      setFeaturedVideo(null);
      setIsFeaturedDescExpanded(false);
    }
  }, [channelDetails]);

  // Handle ?channel= URL param (from sidebar clicks) -- uses cache
  useEffect(() => {
    const channelParam = searchParams.get('channel');
    if (!channelParam) return;
    setInputValue(channelParam);
    handleFetchChannel(channelParam, true); // use cache for auto-loads
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchParams]);

  // Reload from correct cache when org context changes
  useEffect(() => {
    const cached = loadCache(undefined, currentOrganization?.id);
    setInputValue(cached?.inputValue || '');
    setChannelDetails(cached?.channelDetails || null);
    setIsDescriptionExpanded(false);
    setIsKeywordsExpanded(false);
    setFeaturedVideo(null);
    setError(null);
    setUsageError(null);
  }, [currentOrganization?.id]);

  const formatNumber = (numStr?: string | number) => {
    if (!numStr) return '0';
    const num = typeof numStr === 'string' ? parseInt(numStr, 10) : numStr;
    if (isNaN(num)) return '0';
    return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 1 }).format(num);
  };

  const suggestions = recentChannels.map(r => ({
    id: r.id || r.channelInput,
    label: r.channelName || r.channelInput,
    value: r.channelInput,
  }));

  const bannerUrl = getHighQualityBannerUrl(channelDetails?.brandingSettings?.image?.bannerExternalUrl);
  const avatarUrl =
    channelDetails?.snippet?.thumbnails?.high?.url ||
    channelDetails?.snippet?.thumbnails?.medium?.url ||
    channelDetails?.snippet?.thumbnails?.default?.url;

  const allLinks = channelDetails?.snippet?.description ? extractAllLinks(channelDetails.snippet.description) : [];
  const socialLinks = allLinks.filter(l => l.type === 'social');
  // All non-social links for the channel details section
  const otherLinks = allLinks.filter(l => l.type !== 'social');
  const channelEmail = channelDetails?.snippet?.description ? extractEmail(channelDetails.snippet.description) : null;
  const channelCountry = channelDetails?.snippet?.country || channelDetails?.brandingSettings?.channel?.country || null;
  const channelKeywords = channelDetails?.brandingSettings?.channel?.keywords || null;
  const parsedKeywords = channelKeywords ? parseKeywords(channelKeywords) : [];

  const channelStatus = channelDetails?.status;
  const madeForKids = channelStatus?.madeForKids || channelStatus?.selfDeclaredMadeForKids || null;

  const uploadsPlaylistId = channelDetails?.contentDetails?.relatedPlaylists?.uploads || null;
  const likesPlaylistId = channelDetails?.contentDetails?.relatedPlaylists?.likes || null;

  // Country name map for ISO codes
  const countryNames: Record<string, string> = {
    US: 'United States', GB: 'United Kingdom', CA: 'Canada', AU: 'Australia',
    DE: 'Germany', FR: 'France', JP: 'Japan', KR: 'South Korea',
    IN: 'India', BR: 'Brazil', MX: 'Mexico', ES: 'Spain', IT: 'Italy',
    NL: 'Netherlands', SE: 'Sweden', NO: 'Norway', DK: 'Denmark', FI: 'Finland',
    RU: 'Russia', CN: 'China', TW: 'Taiwan', HK: 'Hong Kong', SG: 'Singapore',
    NZ: 'New Zealand', ZA: 'South Africa', AR: 'Argentina', CO: 'Colombia',
    CL: 'Chile', PE: 'Peru', IE: 'Ireland', PT: 'Portugal', BE: 'Belgium',
    CH: 'Switzerland', AT: 'Austria', PL: 'Poland', CZ: 'Czech Republic',
    GR: 'Greece', HU: 'Hungary', RO: 'Romania', UA: 'Ukraine', IL: 'Israel',
    AE: 'United Arab Emirates', SA: 'Saudi Arabia', TR: 'Turkey', TH: 'Thailand',
    VN: 'Vietnam', PH: 'Philippines', ID: 'Indonesia', MY: 'Malaysia', PK: 'Pakistan',
    BD: 'Bangladesh', EG: 'Egypt', NG: 'Nigeria', KE: 'Kenya',
  };
  const displayCountry = channelCountry
    ? (countryNames[channelCountry.toUpperCase()] || channelCountry)
    : null;

  return (
    <DataExplorerShell
      title="Channel"
      description="Look up a channel profile, stats, and recent uploads."
      icon={<Users size={20} />}
      alerts={
        error ? (
          <div className="alert alert-error">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="15" y1="9" x2="9" y2="15"></line>
              <line x1="9" y1="9" x2="15" y2="15"></line>
            </svg>
            <div className="alert-content">
              <h4>Error</h4>
              <p>{error}</p>
            </div>
          </div>
        ) : null
      }
      usageLimit={
        usageError ? (
          <UsageLimitBanner
            limit={usageError.limit}
            used={usageError.used}
            message={usageError.message}
            pageLabel={usageError.pageKey || "Channel"}
          />
        ) : null
      }
      toolbar={
        <Form layout="toolbar">
          <FormField variant="main">
            <AutocompleteInput
              id="channelInput"
              aria-label="YouTube handle, ID, or URL"
              value={inputValue}
              onChange={(value) => setInputValue(value)}
              onSelect={(item) => handleFetchChannel(item.value)}
              placeholder="@username, channel ID, or YouTube URL"
              suggestions={suggestions}
              disabled={loading}
            />
          </FormField>
          <FormActions>
            <Button
              variant="primary"
              onClick={() => handleFetchChannel()}
              disabled={loading}
            >
              {loading ? (
                <>
                  <Spinner size="xs" />
                  Fetching...
                </>
              ) : (
                <>
                  <Search size={16} />
                  Channel Overview
                </>
              )}
            </Button>
          </FormActions>
        </Form>
      }
    >

      {loading && !channelDetails && (
        <Card size="sm">
          <CardContent>
          <Stack gap={2}>
            <Typography variant="body2">Fetching channel information…</Typography>
            <Flex alignItems="center" gap={3}>
              <Stack gap={1.5} sx={{ flex: 1, minWidth: 0 }}>
                <Skeleton type="text" width="50%" height="0.75rem" />
                <Skeleton type="title" width="80%" height="1.5rem" />
                <Skeleton type="text" width="60%" height="0.75rem" />
                <Skeleton type="title" width="70%" height="1.5rem" />
              </Stack>
              <Skeleton style={{ width: '96px', height: '96px', borderRadius: '50%', flexShrink: 0 }} />
            </Flex>
          </Stack>
          </CardContent>
        </Card>
      )}

      {!loading && !channelDetails && !error && (
        <EmptyState
          title="No Channel Selected"
          description="Enter a YouTube channel handle, ID, or URL above to inspect it."
          icon={
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
              <circle cx="11" cy="11" r="8"></circle>
              <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
            </svg>
          }
        />
      )}

      {channelDetails && !loading && (
        <>
          {/* Channel Header: banner, avatar, and identity */}
          <Card>
            {bannerUrl ? (
              <img
                src={bannerUrl}
                alt=""
                aria-hidden
                referrerPolicy="no-referrer"
                loading="eager"
                className="h-36 w-full object-cover sm:h-48"
              />
            ) : (
              <div className="h-24 w-full bg-[var(--rt-color-bg-muted)]" aria-hidden />
            )}

            <div className="px-4 pb-4 sm:px-6 sm:pb-6">
              <Flex alignItems="flex-end" gap={1.5} wrap>
                {avatarUrl && (
                  <Avatar
                    src={avatarUrl}
                    alt={channelDetails.snippet.title}
                    className="-mt-10 h-20 w-20 shrink-0 ring-2 ring-[var(--rt-card-bg)]"
                  >
                    {channelDetails.snippet.title.charAt(0).toUpperCase()}
                  </Avatar>
                )}

                <Box sx={{ flex: 1, minWidth: 0 }}>
                  <Typography variant="h4" component="h2" noWrap>
                    {channelDetails.snippet.title}
                  </Typography>
                  {channelDetails.snippet.customUrl && (
                    <Typography variant="caption">
                      {channelDetails.snippet.customUrl}
                    </Typography>
                  )}
                </Box>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => window.open(`https://youtube.com/channel/${channelDetails.id}`, '_blank', 'noopener,noreferrer')}
                >
                  <ExternalLink size={14} />
                  View on YouTube
                </Button>
              </Flex>

              {socialLinks.length > 0 && (
                <Flex wrap gap={1.5} sx={{ mt: 2 }}>
                  {socialLinks.map((link, idx) => (
                    <a
                      key={idx}
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="no-underline"
                    >
                      <Chip size="sm" icon={getPlatformIcon(link.label)} label={link.label} clickable />
                    </a>
                  ))}
                </Flex>
              )}

              {channelDetails.snippet.description && (
                <Stack gap={1} sx={{ mt: 2 }}>
                  <Typography
                    variant="body2"
                    className={isDescriptionExpanded ? undefined : 'line-clamp-3'}
                  >
                    {renderDescriptionWithLinks(channelDetails.snippet.description)}
                  </Typography>
                  {channelDetails.snippet.description.length > 240 && (
                    <Box>
                      <Button
                        variant="ghost"
                        size="sm"
                        type="button"
                        onClick={() => setIsDescriptionExpanded(!isDescriptionExpanded)}
                      >
                        {isDescriptionExpanded ? 'Show less' : 'Show more'}
                      </Button>
                    </Box>
                  )}
                </Stack>
              )}
            </div>
          </Card>

          {/* Stats KPI Grid */}
          <Grid container spacing={1.5}>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                tone="info"
                label="Subscribers"
                value={
                  channelDetails.statistics.hiddenSubscriberCount
                    ? 'Hidden'
                    : formatNumber(channelDetails.statistics.subscriberCount)
                }
                icon={<Users size={16} />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                tone="success"
                label="Total Views"
                value={formatNumber(channelDetails.statistics.viewCount)}
                icon={<Eye size={16} />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Videos"
                value={formatNumber(channelDetails.statistics.videoCount)}
                icon={<Video size={16} />}
              />
            </Grid>
            <Grid size={{ xs: 6, sm: 3 }}>
              <StatCard
                label="Joined"
                value={new Date(channelDetails.snippet.publishedAt).toLocaleDateString('en-US', {
                  year: 'numeric',
                  month: 'short',
                  day: 'numeric',
                })}
                icon={<CalendarDays size={16} />}
              />
            </Grid>
          </Grid>

          {/* Channel Details: Country, Email, Website, Status, Playlists, Keywords */}
          {(displayCountry || channelEmail || otherLinks.length > 0 || madeForKids != null || uploadsPlaylistId || parsedKeywords.length > 0) && (
            <Card size="sm">
              <CardContent>
              <Stack gap={2}>
                <Typography variant="h6" component="h3">Channel Details</Typography>

                <Grid container spacing={1.5}>
                  {displayCountry && (
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Flex alignItems="center" gap={1.5}>
                        <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
                          <MapPin size={16} />
                        </Box>
                        <Stack gap={0} sx={{ minWidth: 0 }}>
                          <Typography variant="caption">Country</Typography>
                          <Typography variant="body2" component="span" style={{ fontWeight: 600 }}>{displayCountry}</Typography>
                        </Stack>
                      </Flex>
                    </Grid>
                  )}
                  {madeForKids != null && (
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Flex alignItems="center" gap={1.5}>
                        <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
                          <Baby size={16} />
                        </Box>
                        <Stack gap={0} sx={{ minWidth: 0 }}>
                          <Typography variant="caption">Made for Kids</Typography>
                          <Typography variant="body2" component="span" style={{ fontWeight: 600 }}>{madeForKids ? 'Yes' : 'No'}</Typography>
                        </Stack>
                      </Flex>
                    </Grid>
                  )}
                  {channelEmail && (
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Flex alignItems="center" gap={1.5}>
                        <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
                          <Mail size={16} />
                        </Box>
                        <Stack gap={0} sx={{ minWidth: 0 }}>
                          <Typography variant="caption">Email</Typography>
                          <a
                            href={`mailto:${channelEmail}`}
                            className="truncate text-sm font-semibold text-[var(--rt-color-accent)] hover:underline"
                          >
                            {channelEmail}
                          </a>
                        </Stack>
                      </Flex>
                    </Grid>
                  )}
                  {uploadsPlaylistId && (
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Flex alignItems="center" gap={1.5}>
                        <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
                          <ListVideo size={16} />
                        </Box>
                        <Stack gap={0} sx={{ minWidth: 0 }}>
                          <Typography variant="caption">Uploads Playlist</Typography>
                          <a
                            href={`https://youtube.com/playlist?list=${uploadsPlaylistId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-[var(--rt-color-accent)] hover:underline"
                          >
                            View uploads
                          </a>
                        </Stack>
                      </Flex>
                    </Grid>
                  )}
                  {likesPlaylistId && (
                    <Grid size={{ xs: 12, sm: 6 }}>
                      <Flex alignItems="center" gap={1.5}>
                        <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex', flexShrink: 0 }}>
                          <ListVideo size={16} />
                        </Box>
                        <Stack gap={0} sx={{ minWidth: 0 }}>
                          <Typography variant="caption">Liked Videos</Typography>
                          <a
                            href={`https://youtube.com/playlist?list=${likesPlaylistId}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-sm font-semibold text-[var(--rt-color-accent)] hover:underline"
                          >
                            View playlist
                          </a>
                        </Stack>
                      </Flex>
                    </Grid>
                  )}
                </Grid>

                {otherLinks.length > 0 && (
                  <Stack gap={1}>
                    <Flex alignItems="center" gap={1}>
                      <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex' }}>
                        <Link2 size={16} />
                      </Box>
                      <Typography variant="subtitle2">External Links</Typography>
                    </Flex>
                    <Flex wrap gap={1}>
                      {otherLinks.map((link, idx) => (
                        <a
                          key={idx}
                          href={link.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="no-underline"
                        >
                          <Chip size="sm" label={link.label} clickable />
                        </a>
                      ))}
                    </Flex>
                  </Stack>
                )}

                {parsedKeywords.length > 0 && (
                  <Stack gap={1}>
                    <Flex alignItems="center" gap={1}>
                      <Box sx={{ color: 'var(--rt-color-text-tertiary)', display: 'inline-flex' }}>
                        <Tag size={16} />
                      </Box>
                      <Typography variant="subtitle2">Channel Keywords</Typography>
                    </Flex>
                    <Flex wrap gap={1} alignItems="center">
                      {(isKeywordsExpanded ? parsedKeywords : parsedKeywords.slice(0, 12)).map((kw, i) => (
                        <Chip key={i} size="sm" label={kw} />
                      ))}
                      {parsedKeywords.length > 12 && (
                        <Button variant="ghost" size="sm" type="button" onClick={() => setIsKeywordsExpanded(!isKeywordsExpanded)}>
                          {isKeywordsExpanded ? 'Show less' : `+${parsedKeywords.length - 12} more`}
                        </Button>
                      )}
                    </Flex>
                  </Stack>
                )}
              </Stack>
              </CardContent>
            </Card>
          )}

          <Card size="sm">
            <CardContent>
            <Stack gap={1.5}>
              <Typography variant="h6" component="h3">Channel Trailer</Typography>
              {featuredVideo ? (
                <Grid container spacing={1.5}>
                  <Grid size={{ xs: 12, md: 8 }}>
                    <div className="aspect-video w-full overflow-hidden rounded-[var(--rt-radius-md)] bg-[var(--rt-color-bg-muted)]">
                      <iframe
                        src={`https://www.youtube.com/embed/${featuredVideo.videoId}`}
                        title={featuredVideo.title}
                        className="h-full w-full border-0"
                        allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
                        allowFullScreen
                      />
                    </div>
                  </Grid>
                  <Grid size={{ xs: 12, md: 4 }}>
                    <Stack gap={1} sx={{ minWidth: 0 }}>
                      <a
                        href={`https://youtube.com/watch?v=${featuredVideo.videoId}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="no-underline"
                      >
                        <Typography variant="h5" component="h4">
                          {featuredVideo.title}
                        </Typography>
                      </a>
                      {featuredVideo.description && (
                        <>
                          <Typography
                            variant="body2"
                            className={isFeaturedDescExpanded ? undefined : 'line-clamp-6'}
                          >
                            {featuredVideo.description}
                          </Typography>
                          {featuredVideo.description.length > 240 && (
                            <Box>
                              <Button
                                variant="ghost"
                                size="sm"
                                type="button"
                                onClick={() => setIsFeaturedDescExpanded(!isFeaturedDescExpanded)}
                              >
                                {isFeaturedDescExpanded ? 'Show less' : 'Show more'}
                              </Button>
                            </Box>
                          )}
                        </>
                      )}
                    </Stack>
                  </Grid>
                </Grid>
              ) : (
                <Flex alignItems="center" justifyContent="center" gap={1}>
                  <Video size={20} />
                  <Typography variant="body2">
                    No intro video set for this channel
                  </Typography>
                </Flex>
              )}
            </Stack>
            </CardContent>
          </Card>

        </>
      )}
    </DataExplorerShell>
  );
};
