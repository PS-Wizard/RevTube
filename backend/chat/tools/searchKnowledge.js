/**
 * Tool: searchKnowledge
 * Search the RevTube knowledge base and documentation.
 *
 * Currently a placeholder -- returns static documentation about the platform.
 * In the future, this will use vector search (pgvector / embeddings) for
 * semantic retrieval over ingested documentation, transcripts, and FAQs.
 */
module.exports = {
  name: 'searchKnowledge',
  description: 'Search the RevTube documentation and knowledge base for information about using the platform, feature details, and troubleshooting tips.',
  parameters: {
    type: 'object',
    properties: {
      query: {
        type: 'string',
        description: 'What you want to know about (e.g. "How to connect a channel", "What is the compare feature", "Usage limits")',
      },
      maxResults: {
        type: 'number',
        description: 'Maximum number of results (1-10)',
        default: 5,
      },
    },
    required: ['query'],
  },

  execute: async (args) => {
    const { query, maxResults = 5 } = args;

    // Static knowledge base about the platform
    const knowledgeBase = [
      {
        topic: 'Connecting a YouTube channel',
        content: 'To connect a YouTube channel: Go to the Channel page, click "Connect Channel", and authorize with your Google/YouTube account. You can connect both personal channels and organization-owned channels. Personal channels use your own YouTube OAuth token; organization channels use tokens stored in the organization.',
        keywords: ['connect', 'channel', 'authorize', 'oauth', 'token'],
      },
      {
        topic: 'Dashboard overview',
        content: 'The Dashboard shows your channel\'s key metrics including views, watch time, subscribers, and engagement for 7, 30, and 90-day periods. You can filter by date range, compare periods, and switch between channels. The Overview tab gives a high-level summary, the Engagement tab shows interaction metrics, the Audience tab shows viewer demographics, and the Video List tab shows individual video performance.',
        keywords: ['dashboard', 'metrics', 'overview', 'engagement', 'audience'],
      },
      {
        topic: 'Comparing channels',
        content: 'The Compare feature lets you select 2 or more channels and view their metrics side-by-side. Navigate to the Compare page, add the channels you want to compare, and see their views, subscribers, engagement, and other key metrics in a unified table. You can save comparisons for quick access later.',
        keywords: ['compare', 'comparison', 'side-by-side', 'multiple channels'],
      },
      {
        topic: 'Usage limits and plans',
        content: 'RevTube has usage limits based on your plan. Free accounts have monthly limits per page (dashboard, videos, channel, etc.). The current limits are shown in the sidebar Usage bar. Pro accounts have higher limits. When you approach your limit, a warning will appear. You can check your usage on the Profile page.',
        keywords: ['limits', 'usage', 'quota', 'plan', 'free', 'pro', 'rate limit'],
      },
      {
        topic: 'Exporting data (PDF/CSV)',
        content: 'You can export data to CSV or PDF from most pages. Look for the download/export button (usually a download icon) in the toolbar. CSV exports raw data for spreadsheet analysis. PDF exports a formatted report suitable for sharing or presenting.',
        keywords: ['export', 'download', 'csv', 'pdf', 'report'],
      },
      {
        topic: 'Filtering videos',
        content: 'Use the Video Filters bar to search and filter your videos. You can filter by: date range, search terms in the title, sort by views/likes/comments/date, and filter by specific playlists. Filters can be combined for precise results.',
        keywords: ['filter', 'search', 'sort', 'video', 'playlist'],
      },
      {
        topic: 'Organization / Team accounts',
        content: 'Organizations let teams share YouTube channel access. An organization owner can add members and manage shared channel tokens. Members inherit Pro-level access if the org has it. Switch between personal and org mode using the Organization Switcher in the sidebar. Organization admins can manage channels and members from the Organization Settings page.',
        keywords: ['organization', 'team', 'org', 'member', 'admin'],
      },
      {
        topic: 'Playlist analytics',
        content: 'The Playlist page shows all your playlists with metadata. You can view playlist-specific analytics by selecting a playlist as a filter on the Dashboard. This shows aggregate views and watch time for all videos in that playlist together.',
        keywords: ['playlist', 'analytics', 'playlist analytics', 'playlist views'],
      },
      {
        topic: 'Best time to post',
        content: 'The Insights panel shows your channel\'s best times to post based on historical audience activity data. It analyzes views by day of week and hour to recommend optimal publishing times. This data is updated with each analytics sync.',
        keywords: ['best time', 'posting', 'schedule', 'optimal', 'insights', 'audience activity'],
      },
      {
        topic: 'Analytics data freshness',
        content: 'Analytics data is automatically synced from YouTube every 6 hours via background jobs. The most recent data point is typically 1-2 days behind real-time due to YouTube Analytics API latency. You can check when a channel was last synced on the Channel page.',
        keywords: ['freshness', 'sync', 'update', 'latency', 'real-time', 'data age'],
      },
      {
        topic: 'Admin features',
        content: 'Admin users have access to additional features: viewing all users, managing feature flags and usage limits, accessing the Bull Board queue monitoring UI, triggering manual data refreshes, and viewing system-wide cache metrics.',
        keywords: ['admin', 'administrator', 'user management', 'feature flags', 'queue'],
      },
    ];

    // Simple keyword matching -- will be replaced with vector search
    const queryLower = query.toLowerCase();
    const results = knowledgeBase
      .map((item) => {
        const keywordScore = item.keywords.some((kw) => queryLower.includes(kw))
          ? 1
          : 0;
        const contentScore = item.content.toLowerCase().includes(queryLower) ? 0.5 : 0;
        const topicScore = item.topic.toLowerCase().includes(queryLower) ? 2 : 0;
        return { ...item, score: keywordScore + contentScore + topicScore };
      })
      .filter((item) => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, Math.min(Math.max(1, Number(maxResults) || 5), 10))
      .map(({ topic, content }) => ({ topic, content }));

    if (results.length === 0) {
      return {
        message: 'No documentation found matching your query. Try different keywords.',
        results: [],
      };
    }

    return { results };
  },
};
