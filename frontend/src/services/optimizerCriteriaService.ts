// ── OptimizerCriteriaService -- fetches the centralized optimizer criteria. ──
// Consumes the public GET /api/thumbnail-optimizer/criteria endpoint (the SAME
// source of truth the backend uses for the Thumbnail Optimizer pillars, the
// Playlist Optimizer criteria, and the full audit's thumbnail categories). Used
// by the help / guide modals so they always show the current admin-configured
// points.
import { apiUrl } from '../utils/apiBase';
import { getFirebaseAuthHeader } from '../services/authHeaders';

export interface ThumbnailPillarCfg {
  key: string;
  label: string;
  tier: 'Red' | 'Yellow' | 'Grey';
  weight: number;
  instruction: string;
}

export interface PlaylistCriterionCfg {
  key: string;
  label: string;
  weight: number;
  instruction: string;
}

export interface OptimizerCriteriaCfg {
  thumbnail: ThumbnailPillarCfg[];
  playlist: PlaylistCriterionCfg[];
}

// Mirrors backend/config/optimizerCriteria.js defaults (used only as an
// offline fallback; the backend config is the source of truth at runtime).
export const DEFAULT_OPTIMIZER_CRITERIA: OptimizerCriteriaCfg = {
  thumbnail: [
    { key: 'promise_lock', label: 'Promise Lock', tier: 'Red', weight: 10, instruction: 'Truthful communication of core promise.' },
    { key: 'one_idea_rule', label: 'One-Idea Rule', tier: 'Red', weight: 10, instruction: 'One dominant idea/message.' },
    { key: 'scroll_stop_contrast', label: 'Scroll-Stop Contrast', tier: 'Red', weight: 10, instruction: 'Strong subject separation from background.' },
    { key: 'emotional_signal', label: 'Emotional Signal', tier: 'Red', weight: 10, instruction: 'Clear emotional state/transformation.' },
    { key: 'thumb_magnet', label: 'Thumb Magnet', tier: 'Red', weight: 10, instruction: 'Visual emphasis tools (arrows, framing).' },
    { key: 'open_loop', label: 'Open Loop', tier: 'Red', weight: 10, instruction: 'Deliberate withholding of context to compel click.' },
    { key: 'visual_flow', label: 'Visual Flow', tier: 'Yellow', weight: 7, instruction: 'Cohesive colors, typography, and spacing.' },
    { key: 'glance_readability', label: 'Glance Readability', tier: 'Yellow', weight: 7, instruction: 'Mobile-ready text size and contrast.' },
    { key: 'pattern_break', label: 'Pattern Break', tier: 'Yellow', weight: 7, instruction: 'Deviation from generic niche styles.' },
    { key: 'execution_polish', label: 'Execution Polish', tier: 'Yellow', weight: 7, instruction: 'Craftsmanship and intentional design.' },
    { key: 'word_economy', label: 'Word Economy', tier: 'Grey', weight: 5, instruction: 'Text reduced to essential form (3-5 words).' },
    { key: 'platform_compliance', label: 'Platform Compliance', tier: 'Grey', weight: 5, instruction: 'Resolution, aspect ratio, and technical standards.' },
  ],
  playlist: [
    { key: 'title_ctr', label: 'Title CTR Power', weight: 12, instruction: 'Are playlist titles catchy, viral, and curiosity-driven (CTR-optimized per the YouTube Creator Playbook)?' },
    { key: 'seo_description', label: 'SEO Description Quality', weight: 20, instruction: "Is the description at least 700 characters, keyword-rich, search-optimized, and ending with a numbered 'Videos in this Playlist:' list?" },
    { key: 'keywords', label: 'Keyword Coverage', weight: 12, instruction: 'At least 15 high-volume keywords sorted by search volume and relevance (highest first)?' },
    { key: 'tags', label: 'Tag Priority', weight: 8, instruction: 'At least 15 tags sorted by priority?' },
    { key: 'ordering_flow', label: 'Binge Ordering & Flow', weight: 12, instruction: 'Do videos progress logically to maximize session watch time (Creator Playbook / Google Search Central best practices)?' },
    { key: 'theme_coherence', label: 'Thematic Coherence', weight: 8, instruction: 'Does each playlist share one vibe, visual style, or logical progression beyond surface keywords?' },
    { key: 'metadata_health', label: 'Metadata Health', weight: 8, instruction: "Are titles, descriptions, and tags consistent and complete across the playlist's videos?" },
    { key: 'virality_potential', label: 'Virality Potential', weight: 8, instruction: 'Do the playlists target high-demand topics with strong clickability? Consider predicted reach (High/Medium/Low/Niche) and the engagement prediction.' },
    { key: 'video_coverage', label: 'Video Coverage', weight: 4, instruction: 'Is every video accounted for in at least one logical playlist, with minimal orphaned/unassigned videos?' },
    { key: 'audience_targeting', label: 'Audience & Niche Targeting', weight: 8, instruction: 'Do the playlists serve a clear audience persona and primary niche (target audience/goal alignment)?' },
  ],
};

export async function fetchOptimizerCriteria(): Promise<OptimizerCriteriaCfg> {
  const authHeader = await getFirebaseAuthHeader();
  const res = await fetch(apiUrl('/thumbnail-optimizer/criteria'), { headers: { ...authHeader } });
  if (!res.ok) throw new Error('Failed to load optimizer criteria');
  const data = await res.json();
  return {
    thumbnail: Array.isArray(data.thumbnail) ? data.thumbnail : DEFAULT_OPTIMIZER_CRITERIA.thumbnail,
    playlist: Array.isArray(data.playlist) ? data.playlist : DEFAULT_OPTIMIZER_CRITERIA.playlist,
  };
}