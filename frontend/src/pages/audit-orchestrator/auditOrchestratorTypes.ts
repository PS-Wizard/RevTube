import type { LucideIcon } from "lucide-react";
import { ListVideo, TrendingUp, Tv, Video } from "lucide-react";
import type { AuditSubRunType } from "../../services/auditOrchestratorService";

export interface ChannelOption {
  id: string;
  title: string;
  thumbnailUrl?: string;
  owner?: { type: string; orgId?: string | null; uid?: string | null };
  _shared?: boolean;
}

export interface SubRunDef {
  key: AuditSubRunType;
  label: string;
  icon: LucideIcon;
  deepLink?: string;
  deepLinkLabel?: string;
}

export const SUB_RUNS: SubRunDef[] = [
  {
    key: "channelIdentity",
    label: "Channel Identity & Branding",
    icon: Tv,
  },
  {
    key: "video",
    label: "Video Optimization & SEO",
    icon: Video,
    deepLink: "/video-audit",
    deepLinkLabel: "Video Audit",
  },
  {
    key: "playlist",
    label: "Playlist Structure & Depth",
    icon: ListVideo,
    deepLink: "/playlist-optimizer",
    deepLinkLabel: "Playlist Optimizer",
  },
  {
    key: "general",
    label: "Cadence & Content Trends",
    icon: TrendingUp,
  },
];

export interface ExecutiveStats {
  projectedMax: number;
  totalPotentialGain: number;
  recCount: number;
  highCount: number;
  auditedVideosCount: number;
}

/** Videos-per-audit caps by plan. Anything above the Pro cap is a Contact-us lead. */
export const FREE_AUDIT_VIDEO_MAX = 15;
export const PRO_AUDIT_VIDEO_MAX = 30;
/** Selectable video-count presets; filtered by plan cap at render. */
export const AUDIT_VIDEO_COUNT_OPTIONS = [5, 10, 15, 20, 25, 30];
