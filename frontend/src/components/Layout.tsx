import { Box, Paper, Button, VisuallyHidden } from "./ui";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import {
  MdAccountCircle,
  MdAddChart,
  MdAdminPanelSettings,
  MdAutoFixHigh,
  MdChat,
  MdClose,
  MdCompareArrows,
  MdDashboardCustomize,
  MdFactCheck,
  MdLogout,
  MdListAlt,
  MdCheckCircle,
  MdOndemandVideo,
  MdPerson,
  MdPlaylistPlay,
  MdPublic,
  MdRule,
  MdSearch,
  MdSettings,
  MdStars,
  MdTrackChanges,
  MdInsights,
  MdTrendingUp,
  MdTune,
  MdWarning,
} from "react-icons/md";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { APP_DISPLAY_VERSION, REVKETER_EXPERT_HELP_URL } from "../constants/productUrls";
import { useAuth } from "../hooks/useAuth";
import { useFeatureConfig } from "../hooks/useFeatureConfig";
import { useOptimizerJobWatcher } from "../hooks/useOptimizerJobWatcher";
import { useOrganization } from "../hooks/useOrganization";
import { useUsage } from "../hooks/useUsage";
import { getOrganizationLists } from "../services/organizationListService";
import {
  deleteRecentItem,
  getRecentChannels,
  getRecentComparisons,
  getRecentPlaylists,
  type RecentChannel,
  type RecentComparison,
  type RecentPlaylist,
} from "../services/recentsService";
import { getUserLists, type SavedList } from "../services/savedListService";
import { useUsageStore } from "../stores/usageStore";
import { CHANNEL_ANALYTICS_QUOTA_KEY } from "../utils/quotaScope";
import { ConfirmModal } from "./ConfirmModal";
import "./Layout.css";
import OrganizationSwitcher from "./OrganizationSwitcher";
import NotificationBell from "./NotificationBell";
import { UsageBar } from "./UsageBar";

/** Keep in sync with `Layout.css` mobile drawer breakpoint. */
const SIDEBAR_DRAWER_MAX_WIDTH_PX = 768;

/** Sidebar rail width when expanded / collapsed -- keep in sync with `.sidebar.open` / `.sidebar.closed` in `Layout.css`. */
const SIDEBAR_RAIL_OPEN_PX = 260;
const SIDEBAR_RAIL_COLLAPSED_PX = 57;

/** Drawer layout uses full overlay width -- default closed on phones/tablets so content isn’t hidden on load. */
function readInitialSidebarOpen(): boolean {
  if (typeof globalThis.window === "undefined") return false;
  return !globalThis.window.matchMedia(
    `(max-width: ${SIDEBAR_DRAWER_MAX_WIDTH_PX}px)`,
  ).matches;
}

function readDrawerBreakpointMatches(): boolean {
  if (typeof globalThis.window === "undefined") return false;
  return globalThis.window.innerWidth <= SIDEBAR_DRAWER_MAX_WIDTH_PX;
}

export const Layout = () => {
  const { handleSignOut, user, role, userPackage } = useAuth();
  const {
    currentOrganization,
    canAccessSettings,
    isPersonalContext,
    canAccessOrganization,
  } = useOrganization();
  // Keep polling thumbnail/playlist optimizer jobs even when their page unmounts.
  useOptimizerJobWatcher(currentOrganization?.id);
  const [sidebarOpen, setSidebarOpen] = useState(readInitialSidebarOpen);
  const [showLogoutConfirm, setShowLogoutConfirm] = useState(false);
  const [drawerBreakpointMatches, setDrawerBreakpointMatches] = useState(
    readDrawerBreakpointMatches,
  );
  const prevDrawerBreakpointRef = useRef(drawerBreakpointMatches);
  const location = useLocation();
  const navigate = useNavigate();
  const [recentChannels, setRecentChannels] = useState<RecentChannel[]>([]);
  const [recentPlaylists, setRecentPlaylists] = useState<RecentPlaylist[]>([]);
  const [recentComparisons, setRecentComparisons] = useState<
    RecentComparison[]
  >([]);
  const [savedLists, setSavedLists] = useState<SavedList[]>([]);
  const [loadingRecents, setLoadingRecents] = useState(false);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(
    () => {
      try {
        return localStorage.getItem("selectedChannel_last");
      } catch {
        return null;
      }
    },
  );
  const stickyTopRef = useRef<HTMLDivElement>(null);
  const sidebarRef = useRef<HTMLDivElement>(null);
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    try {
      const saved = localStorage.getItem("sidebarWidth");
      if (saved) {
        const parsed = parseInt(saved, 10);
        if (parsed >= 180 && parsed <= 600) return parsed;
      }
    } catch {
      /* ignore */
    }
    return SIDEBAR_RAIL_OPEN_PX;
  });
  const isResizingRef = useRef(false);

  const handleResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    isResizingRef.current = true;
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";

    const onMouseMove = (moveEvent: MouseEvent) => {
      if (!isResizingRef.current) return;
      const newWidth = Math.max(180, Math.min(600, moveEvent.clientX));
      setSidebarWidth(newWidth);
    };

    const onMouseUp = () => {
      isResizingRef.current = false;
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      document.removeEventListener("mousemove", onMouseMove);
      document.removeEventListener("mouseup", onMouseUp);
      // Persist width from ref to avoid stale closure
      try {
        localStorage.setItem("sidebarWidth", String(sidebarWidthRef.current));
      } catch {
        /* ignore */
      }
    };

    document.addEventListener("mousemove", onMouseMove);
    document.addEventListener("mouseup", onMouseUp);
  }, []);

  // Persist width after resize ends (using a ref to avoid stale closure)
  const sidebarWidthRef = useRef(sidebarWidth);
  sidebarWidthRef.current = sidebarWidth;

  const handleResizeStartRef = useRef(handleResizeStart);
  handleResizeStartRef.current = handleResizeStart;

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "b") {
        e.preventDefault();
        setSidebarOpen((open) => !open);
        return;
      }
      if (e.key === "Escape" && drawerBreakpointMatches && sidebarOpen) {
        e.preventDefault();
        setSidebarOpen(false);
      }
    };
    globalThis.window.addEventListener("keydown", onKeyDown);
    return () => globalThis.window.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen, drawerBreakpointMatches]);

  // Keep --sticky-top-height CSS variable in sync with actual element height
  useEffect(() => {
    if (!stickyTopRef.current) return;

    const updateHeight = () => {
      if (!stickyTopRef.current) return;
      const h = stickyTopRef.current.offsetHeight;
      document.documentElement.style.setProperty(
        "--sticky-top-height",
        `${h}px`,
      );
    };

    // Use ResizeObserver for accurate tracking of height changes (including reflows)
    const resizeObserver = new ResizeObserver(() => {
      updateHeight();
    });

    resizeObserver.observe(stickyTopRef.current);

    // Initial update
    updateHeight();

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  useEffect(() => {
    const mq = globalThis.window.matchMedia(
      `(max-width: ${SIDEBAR_DRAWER_MAX_WIDTH_PX}px)`,
    );
    const onChange = () => setDrawerBreakpointMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  useEffect(() => {
    const prev = prevDrawerBreakpointRef.current;
    if (!prev && drawerBreakpointMatches) {
      setSidebarOpen(false);
    }
    prevDrawerBreakpointRef.current = drawerBreakpointMatches;
  }, [drawerBreakpointMatches]);

  const sidebarRailOffsetPx = drawerBreakpointMatches
    ? 0
    : sidebarOpen
      ? sidebarWidth
      : SIDEBAR_RAIL_COLLAPSED_PX;

  // Determine current page
  const currentPage = location.pathname.split("/")[1] || "dashboard";
  const pageKeyMap: Record<string, string> = {
    dashboard: "dashboard",
    anomalies: "anomalies",
    "my-dashboard": "customDashboard",
    videos: "videos",
    channel: "channel",
    playlist: "playlists",
    compare: "compare",
    "specific-videos": "specificVideos",
    chat: "chat",
    "thumbnail-optimizer": "thumbnailOptimizer",
    "playlist-optimizer": "playlistOptimizer",
    "audit-orchestrator": "audit",
    "video-audit": "videoAudit",
  };
  const usagePageKey =
    currentPage === "dashboard"
      ? CHANNEL_ANALYTICS_QUOTA_KEY
      : pageKeyMap[currentPage] || "dashboard";

  const { usageData, usageLimits, loading: usageLoading } = useUsage();
  const storeUsage = useUsageStore((s) => s.usage[usagePageKey]);
  const { getSearchLimit, config } = useFeatureConfig();
  const pageLimit = getSearchLimit(
    usagePageKey,
    (userPackage ?? "free") as "free" | "pro",
  );
  // Take the highest value across both sources to prevent
  // temporary dips when a deduped response lands after /usage/me.
  const currentUsage = Math.max(
    storeUsage?.used ?? 0,
    usageData.usage[usagePageKey] ?? 0,
  );
  const usedLimit =
    storeUsage?.limit ?? usageLimits?.[usagePageKey] ?? pageLimit;
  const isFreeUser = userPackage === "free" && role !== "admin";
  const isUsageExhausted =
    role !== "admin" &&
    isPersonalContext &&
    usedLimit > 0 &&
    currentUsage >= usedLimit;

  // Whether a nav item should be visible in the sidebar.
  // Admins always see everything; non-admin users only see enabled features.
  const isNavItemVisible = (pageKey: string): boolean => {
    if (role === "admin") return true;
    const pageCfg = config.pages[pageKey];
    if (!pageCfg) return true; // show if unknown (e.g. admin-only pages)
    return pageCfg.enabled !== false;
  };

  // Whether a sidebar category header should render: at least one item inside
  // must be visible. Prevents orphan headers (e.g. "Tubeketer Audits" with
  // every audit feature disabled). Admins always see everything, so headers
  // are unchanged for them.
  const isNavSectionVisible = (...pageKeys: string[]): boolean =>
    pageKeys.some((k) => isNavItemVisible(k));

  // Derive per-page badge label for sidebar nav items.
  // No badge is shown when sidebar is collapsed (no room for text).
  // In org mode, every member inherits org Pro access -- no per-page chips needed.
  const getNavBadge = (
    pageKey: string,
  ): { label: string; variant: string } | null => {
    if (!sidebarOpen) return null; // collapsed -- no room for text badges
    if (!isPersonalContext) return null; // org mode: all members share access, no chips

    // For free users only -- show "Pro" badge only when page is explicitly locked
    if (!isFreeUser) return null;

    const pageCfg = config.pages[pageKey];
    if (!pageCfg) return null;

    // Only show badge when admin has set premiumOnly (locked page → upgrade prompt)
    if (pageCfg.premiumOnly) return { label: "Pro", variant: "locked" };

    return null;
  };

  // Header plan badge: small pill next to avatar
  const headerPlanLabel = !isPersonalContext
    ? "Org"
    : role === "admin"
      ? "Admin"
      : userPackage === "pro"
        ? "Pro"
        : "Free";
  const headerPlanVariant = !isPersonalContext
    ? "org"
    : role === "admin"
      ? "admin"
      : userPackage === "pro"
        ? "pro"
        : "free";

  // Cache for the last loaded category to avoid redundant fetches on page transitions
  const lastLoadedRef = useRef<{
    uid: string;
    category: string;
    isPersonal: boolean;
    orgId: string | null;
  } | null>(null);

  // Load recents when user changes or page category changes
  useEffect(() => {
    if (!user) return;

    // Map pages to categories to avoid refetching when switching between related pages
    const pageCategory =
      currentPage === "videos" || currentPage === "channel"
        ? "channels"
        : currentPage === "playlist"
          ? "playlists"
          : currentPage === "compare"
            ? "compare"
            : currentPage === "dashboard"
              ? "dashboard"
              : "other";

    // Skip if we already loaded this category for this user/context
    if (
      lastLoadedRef.current?.uid === user.uid &&
      lastLoadedRef.current?.category === pageCategory &&
      lastLoadedRef.current?.isPersonal === isPersonalContext &&
      lastLoadedRef.current?.orgId === (currentOrganization?.id || null)
    ) {
      return;
    }

    const loadRecents = async () => {
      // Don't show loading spinner if we already have some data (smoother transition)
      const hasExistingData =
        (pageCategory === "channels" && recentChannels.length > 0) ||
        (pageCategory === "playlists" && recentPlaylists.length > 0) ||
        (pageCategory === "compare" && recentComparisons.length > 0) ||
        (pageCategory === "dashboard" && savedLists.length > 0);

      if (!hasExistingData) setLoadingRecents(true);

      try {
        if (pageCategory === "channels") {
          const recents = await getRecentChannels(user.uid);
          setRecentChannels(recents);
        } else if (pageCategory === "playlists") {
          const recents = await getRecentPlaylists(user.uid);
          setRecentPlaylists(recents);
        } else if (pageCategory === "compare") {
          const comparisons = await getRecentComparisons(user.uid);
          setRecentComparisons(comparisons);
        } else if (pageCategory === "dashboard") {
          let lists: SavedList[] = [];
          if (isPersonalContext) {
            lists = await getUserLists(user.uid);
          } else if (currentOrganization) {
            lists = await getOrganizationLists(currentOrganization.id);
          }
          setSavedLists(lists.sort((a, b) => b.createdAt - a.createdAt));
        }

        lastLoadedRef.current = {
          uid: user.uid,
          category: pageCategory,
          isPersonal: isPersonalContext,
          orgId: currentOrganization?.id || null,
        };
      } catch (error) {
        console.error("[Layout] Error loading recents:", error);
      } finally {
        setLoadingRecents(false);
      }
    };

    loadRecents();

    // Listen for refresh events from child pages
    const handleRefreshRecents = () => {
      lastLoadedRef.current = null; // Force reload
      loadRecents();
    };

    window.addEventListener("refreshRecents", handleRefreshRecents);
    return () =>
      window.removeEventListener("refreshRecents", handleRefreshRecents);
  }, [
    user,
    currentPage,
    isPersonalContext,
    currentOrganization?.id,
    currentOrganization,
    recentChannels.length,
    recentPlaylists.length,
    recentComparisons.length,
    savedLists.length,
  ]); // Still depend on currentPage but we use pageCategory to filter

  useEffect(() => {
    const handleChannelChange = () => {
      try {
        setSelectedChannelId(localStorage.getItem("selectedChannel_last"));
      } catch {
        /* ignore */
      }
    };
    const handleStorage = (e: StorageEvent) => {
      if (e.key === "selectedChannel_last") {
        setSelectedChannelId(e.newValue);
      }
    };
    window.addEventListener("channelChanged", handleChannelChange);
    window.addEventListener("storage", handleStorage);
    return () => {
      window.removeEventListener("channelChanged", handleChannelChange);
      window.removeEventListener("storage", handleStorage);
    };
  }, []);

  const handleRecentChannelItemClick = (channel: RecentChannel) => {
    if (isUsageExhausted) return;
    const path = currentPage === "videos" ? "/videos" : "/channel";
    navigate(`${path}?channel=${encodeURIComponent(channel.channelInput)}`);
  };

  const handleRecentPlaylistClick = (playlist: RecentPlaylist) => {
    if (isUsageExhausted) return;
    navigate(`/playlist?playlist=${encodeURIComponent(playlist.playlistId)}`);
  };

  const handleRecentComparisonClick = (comparison: RecentComparison) => {
    if (isUsageExhausted) return;
    const channelsParam = comparison.channels.join(",");
    navigate(
      `/compare?channels=${encodeURIComponent(channelsParam)}&timePeriod=${comparison.timePeriod}`,
    );
  };

  const handleDeleteRecent = async (e: React.MouseEvent, itemId: string) => {
    e.stopPropagation();
    if (!user) return;

    try {
      // Determine the type based on current page
      const type =
        currentPage === "videos" || currentPage === "channel"
          ? "channels"
          : currentPage === "playlist"
            ? "playlists"
            : "comparisons";

      await deleteRecentItem(user.uid, type, itemId);

      // Refresh the list
      if (currentPage === "videos" || currentPage === "channel") {
        setRecentChannels((prev) => prev.filter((item) => item.id !== itemId));
      } else if (currentPage === "playlist") {
        setRecentPlaylists((prev) => prev.filter((item) => item.id !== itemId));
      } else if (currentPage === "compare") {
        setRecentComparisons((prev) =>
          prev.filter((item) => item.id !== itemId),
        );
      }
    } catch (error) {
      console.error("Error deleting recent:", error);
    }
  };

  const formatTimeAgo = (date: Date) => {
    const seconds = Math.floor((new Date().getTime() - date.getTime()) / 1000);

    if (seconds < 60) return "just now";
    const minutes = Math.floor(seconds / 60);
    if (minutes < 60) return `${minutes}m ago`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours}h ago`;
    const days = Math.floor(hours / 24);
    if (days < 7) return `${days}d ago`;
    const weeks = Math.floor(days / 7);
    if (weeks < 4) return `${weeks}w ago`;
    const months = Math.floor(days / 30);
    return `${months}mo ago`;
  };

  const filteredLists = useMemo(() => {
    if (!selectedChannelId || currentPage !== "dashboard") return savedLists;
    // Show all lists if they don't have a channelId (legacy) or if they match the current channel
    return savedLists.filter(
      (list) => !list.channelId || list.channelId === selectedChannelId,
    );
  }, [savedLists, selectedChannelId, currentPage]);

  return (
    <Box
      className="dashboard"
      style={
        {
          "--sidebar-rail-offset": `${sidebarRailOffsetPx}px`,
        } as CSSProperties
      }
    >
      {/* Sticky top: header + CTA banner */}
      <div className="sticky-top" ref={stickyTopRef}>
        <header className="app-header">
          <div className="gb_Sd gb_rd gb_sd">
            <div
              className="gb_1c sidebar-toggle-icon"
              aria-expanded={sidebarOpen}
              aria-label="Main menu"
              role="button"
              tabIndex={0}
              onClick={() => setSidebarOpen(!sidebarOpen)}
            >
              <svg
                focusable="false"
                viewBox="0 0 24 24"
                className="sidebar-svg"
              >
                <path d="M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z"></path>
              </svg>
            </div>
            <div className="gb_Tc logo">
              <div className="gb_Uc">
                <a
                  className="gb_de gb_Vc gb_he"
                  aria-label="TubeKeter Analytics"
                  href="/"
                >
                  <img
                    src="/TubeKeter.svg"
                    alt="TubeKeter Logo"
                    aria-hidden="true"
                    role="presentation"
                    className="logo-image"
                  />
                </a>
              </div>
            </div>
          </div>
          <div className="header-spacer"></div>
          {user && (
            <div
              className={`header-right-actions${!isPersonalContext ? " org-mode" : ""}`}
            >
              <Button
                variant="primary"
                className="header-expert-btn"
                component="a"
                href={REVKETER_EXPERT_HELP_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                Get Expert Help
              </Button>
              <OrganizationSwitcher className="header-org-switcher" />
              <NotificationBell />
              <NavLink
                to="/profile"
                className="header-profile-btn"
                title={`Profile${headerPlanLabel ? ` · ${headerPlanLabel}` : ""}`}
              >
                <span
                  className={`header-profile-avatar header-profile-avatar--tier-${headerPlanVariant}`}
                  aria-hidden
                >
                  {(
                    user.displayName?.trim()?.charAt(0) ||
                    user.email?.charAt(0) ||
                    "U"
                  ).toUpperCase()}
                </span>
                {headerPlanLabel ? (
                  <span
                    className={`header-plan-pill header-plan-pill--${headerPlanVariant}`}
                    aria-label={`Plan: ${headerPlanLabel}`}
                  >
                    {headerPlanLabel}
                  </span>
                ) : null}
                <VisuallyHidden>
                  Profile{headerPlanLabel ? ` · ${headerPlanLabel}` : ""}
                </VisuallyHidden>
              </NavLink>
            </div>
          )}
        </header>
      </div>

      {/* Sidebar */}
      <Paper
        elevation={0}
        component="aside"
        ref={sidebarRef}
        className={`sidebar ${sidebarOpen ? "open" : "closed"}`}
        style={
          sidebarOpen && !drawerBreakpointMatches
            ? ({ width: sidebarWidth } as CSSProperties)
            : undefined
        }
      >
        {!drawerBreakpointMatches && (
          <div
            className="sidebar-resize-handle"
            onMouseDown={handleResizeStart}
            title="Drag to resize sidebar"
            aria-label="Resize sidebar"
          />
        )}
        <div className="sidebar-inner">
          <nav
            className="sidebar-nav"
            aria-label="Primary"
            onClick={(e) => {
              // Mobile drawer: tapping a destination opens that page and
              // auto-dismisses the drawer. Delete buttons stop propagation
              // in their own handlers, so only real navigation lands here.
              if (!drawerBreakpointMatches) return;
              const el = e.target as HTMLElement | null;
              if (el?.closest?.("a[href], .recent-item-main"))
                setSidebarOpen(false);
            }}
          >
            <div className="nav-group">
              {/* ── DASHBOARD ─────────────────────────────────── */}
              {sidebarOpen &&
                isNavSectionVisible("dashboard", "goals", "anomalies", "optimized", "chat") && (
                <div className="nav-section-header">
                  <span className="nav-section-header__label">Dashboard</span>
                  <span className="nav-section-header__line" aria-hidden />
                </div>
              )}
              {isNavItemVisible("dashboard") && (
                <NavLink
                  to="/dashboard"
                  end
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Channel Analytics"
                >
                  <MdTrendingUp className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Channel Analytics
                      {getNavBadge("dashboard") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("dashboard")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("dashboard")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("goals") && (
                <NavLink
                  to="/goals"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Goals & Pacing"
                >
                  <MdTrackChanges className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Goals & Pacing
                      {getNavBadge("goals") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("goals")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("goals")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("customDashboard") && (
                <NavLink
                  to="/my-dashboard"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="My Dashboard"
                >
                  <MdDashboardCustomize className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      My Dashboard
                      {getNavBadge("customDashboard") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("customDashboard")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("customDashboard")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("anomalies") && (
                <NavLink
                  to="/anomalies"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Anomaly Detection"
                >
                  <MdAddChart className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Anomaly Detection
                      {getNavBadge("anomalies") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("anomalies")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("anomalies")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("optimized") && (
                <NavLink
                  to="/optimized"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Optimized Content"
                >
                  <MdCheckCircle className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Optimized Content
                      {getNavBadge("optimized") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("optimized")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("optimized")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("chat") && (
                <NavLink
                  to="/chat"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="AI Chat"
                >
                  <MdChat className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Tubeketer Chat
                      {getNavBadge("chat") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("chat")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("chat")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {sidebarOpen &&
                isNavSectionVisible(
                  "thumbnailOptimizer",
                  "playlistOptimizer",
                  "videoAudit",
                  "audit",
                ) && (
                <div className="nav-section-header">
                  <span className="nav-section-header__label">
                    Tubeketer Audits
                  </span>
                  <span className="nav-section-header__line" aria-hidden />
                </div>
              )}

              {isNavItemVisible("thumbnailOptimizer") && (
                <NavLink
                  to="/thumbnail-optimizer"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Thumbnail Optimizer"
                >
                  <MdAutoFixHigh className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Thumbnail Optimizer
                      {getNavBadge("thumbnailOptimizer") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("thumbnailOptimizer")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("thumbnailOptimizer")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("playlistOptimizer") && (
                <NavLink
                  to="/playlist-optimizer"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Playlist Optimizer"
                >
                  <MdPlaylistPlay className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Playlist Optimizer
                      {getNavBadge("playlistOptimizer") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("playlistOptimizer")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("playlistOptimizer")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("videoAudit") && (
                <NavLink
                  to="/video-audit"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Video Audit"
                >
                  <MdListAlt className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Video Audit
                      {getNavBadge("videoAudit") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("videoAudit")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("videoAudit")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("audit") && (
                <NavLink
                  to="/audit-orchestrator"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Full Channel Audit"
                >
                  <MdFactCheck className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Full Audit
                      {getNavBadge("audit") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("audit")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("audit")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {/* ── EXTRA TOOLS ───────────────────────────────── */}
              {sidebarOpen &&
                isNavSectionVisible(
                  "channel",
                  "videos",
                  "playlists",
                  "specificVideos",
                  "compare",
                ) && (
                <div className="nav-section-header">
                  <span className="nav-section-header__label">Extra Tools</span>
                  <span className="nav-section-header__line" aria-hidden />
                </div>
              )}
              {isNavItemVisible("channel") && (
                <NavLink
                  to="/channel"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Channel Info"
                >
                  <MdAccountCircle className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Channel
                      {getNavBadge("channel") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("channel")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("channel")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("videos") && (
                <NavLink
                  to="/videos"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Videos"
                >
                  <MdOndemandVideo className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Videos
                      {getNavBadge("videos") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("videos")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("videos")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("playlists") && (
                <NavLink
                  to="/playlist"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Playlist"
                >
                  <MdPlaylistPlay className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Playlist
                      {getNavBadge("playlists") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("playlists")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("playlists")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("specificVideos") && (
                <NavLink
                  to="/specific-videos"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Specific Videos"
                >
                  <MdSearch className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Specific Videos
                      {getNavBadge("specificVideos") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("specificVideos")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("specificVideos")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {isNavItemVisible("compare") && (
                <NavLink
                  to="/compare"
                  className={({ isActive }) =>
                    `nav-item ${isActive ? "active" : ""}`
                  }
                  title="Compare Channels"
                >
                  <MdCompareArrows className="nav-icon" />
                  {sidebarOpen && (
                    <span className="premium-label-wrapper">
                      Compare Channels
                      {getNavBadge("compare") && (
                        <span
                          className={`premium-badge premium-badge--${getNavBadge("compare")!.variant}`}
                        >
                          <MdStars size={11} />
                          {getNavBadge("compare")!.label}
                        </span>
                      )}
                    </span>
                  )}
                </NavLink>
              )}

              {/* ── ORGANIZATION ──────────────────────────────── */}
              {!isPersonalContext &&
                currentOrganization &&
                (canAccessSettings || canAccessOrganization) && (
                  <>
                    {sidebarOpen && (
                      <div className="nav-section-header">
                        <span className="nav-section-header__label">
                          Organization
                        </span>
                        <span
                          className="nav-section-header__line"
                          aria-hidden
                        />
                      </div>
                    )}
                    {/* Cross-channel analytics across all connected org channels */}
                    {canAccessOrganization && (
                      <NavLink
                        to="/organization/analytics"
                        className={({ isActive }) =>
                          `nav-item ${isActive ? "active" : ""}`
                        }
                        title="Organization Analytics"
                      >
                        <MdInsights className="nav-icon" />
                        {sidebarOpen && (
                          <span className="premium-label-wrapper">
                            Org Analytics
                          </span>
                        )}
                      </NavLink>
                    )}
                    {canAccessSettings && (
                      <NavLink
                        to="/organization"
                        end
                        className={({ isActive }) =>
                          `nav-item ${isActive ? "active" : ""}`
                        }
                        title="Organization Settings"
                      >
                        <MdSettings className="nav-icon" />
                        {sidebarOpen && <span>Organization Settings</span>}
                      </NavLink>
                    )}
                  </>
                )}

              {/* ── ADMIN ─────────────────────────────────────── */}
              {role === "admin" && (
                <>
                  {sidebarOpen && (
                    <div className="nav-section-header nav-section-header--admin">
                      <span className="nav-section-header__label">Admin</span>
                      <span className="nav-section-header__line" aria-hidden />
                    </div>
                  )}
                  <NavLink
                    to="/admin/users"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin Users"
                  >
                    <MdAdminPanelSettings className="nav-icon" />
                    {sidebarOpen && <span>Users</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/features"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin Features"
                  >
                    <MdTune className="nav-icon" />
                    {sidebarOpen && <span>Features</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/system"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin System"
                  >
                    <MdWarning className="nav-icon" />
                    {sidebarOpen && <span>System</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/ai-chat"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin AI Chat"
                  >
                    <MdChat className="nav-icon" />
                    {sidebarOpen && <span>Tubeketer Chat</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/thumbnail-optimizer"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin Thumbnail Optimizer"
                  >
                    <MdAutoFixHigh className="nav-icon" />
                    {sidebarOpen && <span>Thumbnail Optimizer</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/playlist-optimizer"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin Playlist Optimizer"
                  >
                    <MdPlaylistPlay className="nav-icon" />
                    {sidebarOpen && <span>Playlist Optimizer</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/audit-criteria"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin Audit Criteria Engine (all audit + optimizer scoring)"
                  >
                    <MdRule className="nav-icon" />
                    {sidebarOpen && <span>Audit Criteria</span>}
                  </NavLink>
                  <NavLink
                    to="/admin/public-audit"
                    className={({ isActive }) =>
                      `nav-item admin-item ${isActive ? "active" : ""}`
                    }
                    title="Admin Public Audit (audit any public channel without a connected account)"
                  >
                    <MdPublic className="nav-icon" />
                    {sidebarOpen && <span>Public Audit</span>}
                  </NavLink>
                </>
              )}
            </div>

            {/* Sidebar contextual recent/list section */}
            {sidebarOpen &&
              user &&
              [
                "videos",
                "channel",
                "playlist",
                "compare",
                "dashboard",
              ].includes(currentPage) && (
                <div className="recent-section">
                  <h3 className="recent-section-title">
                    {currentPage === "dashboard"
                      ? "Saved Lists"
                      : currentPage === "channel" || currentPage === "videos"
                        ? "Recent Channels"
                        : `Recent ${currentPage === "playlist" ? "Playlists" : "Comparisons"}`}
                  </h3>

                  {loadingRecents ? (
                    <div className="recent-loading">
                      <div className="spinner-small"></div>
                      <span>Loading...</span>
                    </div>
                  ) : (
                    <div className="recent-list">
                      {/* Recent Channels (Videos and Channel pages) */}
                      {(currentPage === "videos" ||
                        currentPage === "channel") &&
                        recentChannels.length > 0 &&
                        recentChannels.slice(0, 5).map((channel) => (
                          <div key={channel.id} className="recent-item">
                            <Button
                              bare
                              type="button"
                              className={`recent-item-main${isUsageExhausted ? " recent-item-main--disabled" : ""}`}
                              onClick={() =>
                                handleRecentChannelItemClick(channel)
                              }
                              title={
                                isUsageExhausted
                                  ? "Monthly usage limit reached"
                                  : channel.channelName
                              }
                              aria-label={
                                isUsageExhausted
                                  ? `Usage limit reached -- ${channel.channelName}`
                                  : `Open recent channel ${channel.channelName}`
                              }
                              disabled={isUsageExhausted}
                            >
                              <div className="recent-item-content">
                                {channel.thumbnailUrl && (
                                  <img
                                    src={channel.thumbnailUrl}
                                    alt=""
                                    className="recent-item-thumb"
                                    referrerPolicy="no-referrer"
                                  />
                                )}
                                <div className="recent-item-text">
                                  <span className="recent-item-name">
                                    {channel.channelName}
                                  </span>
                                  <span className="recent-item-time">
                                    {formatTimeAgo(channel.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) =>
                                handleDeleteRecent(e, channel.id!)
                              }
                              title="Remove from recent"
                              aria-label={`Remove ${channel.channelName} from recent`}
                            >
                              <MdClose size={16} aria-hidden />
                            </Button>
                          </div>
                        ))}

                      {/* Recent Playlists */}
                      {currentPage === "playlist" &&
                        recentPlaylists.length > 0 &&
                        recentPlaylists.slice(0, 5).map((playlist) => (
                          <div key={playlist.id} className="recent-item">
                            <Button
                              bare
                              type="button"
                              className={`recent-item-main${isUsageExhausted ? " recent-item-main--disabled" : ""}`}
                              onClick={() =>
                                handleRecentPlaylistClick(playlist)
                              }
                              title={
                                isUsageExhausted
                                  ? "Monthly usage limit reached"
                                  : playlist.playlistName
                              }
                              aria-label={
                                isUsageExhausted
                                  ? `Usage limit reached -- ${playlist.playlistName}`
                                  : `Open recent playlist ${playlist.playlistName}`
                              }
                              disabled={isUsageExhausted}
                            >
                              <div className="recent-item-content">
                                <div className="recent-item-text">
                                  <span className="recent-item-name">
                                    {playlist.playlistName}
                                  </span>
                                  <span className="recent-item-time">
                                    {formatTimeAgo(playlist.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) =>
                                handleDeleteRecent(e, playlist.id!)
                              }
                              title="Remove from recent"
                              aria-label={`Remove ${playlist.playlistName} from recent`}
                            >
                              <MdClose size={16} aria-hidden />
                            </Button>
                          </div>
                        ))}

                      {/* Recent Comparisons */}
                      {currentPage === "compare" &&
                        recentComparisons.length > 0 &&
                        recentComparisons.slice(0, 5).map((comparison) => (
                          <div key={comparison.id} className="recent-item">
                            <Button
                              bare
                              type="button"
                              className={`recent-item-main${isUsageExhausted ? " recent-item-main--disabled" : ""}`}
                              onClick={() =>
                                handleRecentComparisonClick(comparison)
                              }
                              title={
                                isUsageExhausted
                                  ? "Monthly usage limit reached"
                                  : comparison.channelNames?.join(" vs ") ||
                                    comparison.channels.join(" vs ")
                              }
                              aria-label={
                                isUsageExhausted
                                  ? `Usage limit reached`
                                  : `Open recent comparison ${comparison.channelNames?.slice(0, 2).join(" vs ") || comparison.channels.slice(0, 2).join(" vs ")}`
                              }
                              disabled={isUsageExhausted}
                            >
                              <div className="recent-item-content">
                                <div className="recent-item-text">
                                  <span className="recent-item-name">
                                    {comparison.channelNames
                                      ?.slice(0, 2)
                                      .join(" vs ") ||
                                      comparison.channels
                                        .slice(0, 2)
                                        .join(" vs ")}
                                    {comparison.channels.length > 2 &&
                                      ` +${comparison.channels.length - 2}`}
                                  </span>
                                  <span className="recent-item-time">
                                    {comparison.timePeriod !== "lifetime"
                                      ? `${comparison.timePeriod}d`
                                      : "All time"}{" "}
                                    · {formatTimeAgo(comparison.timestamp)}
                                  </span>
                                </div>
                              </div>
                            </Button>
                            <Button
                              variant="ghost"
                              size="icon"
                              onClick={(e) =>
                                handleDeleteRecent(e, comparison.id!)
                              }
                              title="Remove from recent"
                              aria-label="Remove comparison from recent"
                            >
                              <MdClose size={16} aria-hidden />
                            </Button>
                          </div>
                        ))}

                      {/* Saved Lists on Dashboard */}
                      {currentPage === "dashboard" &&
                        filteredLists.length > 0 &&
                        filteredLists.slice(0, 8).map((list: SavedList) => (
                          <div
                            key={list.id}
                            className="recent-item recent-item--single-action"
                          >
                            <Button
                              variant="ghost"
                              bare
                              type="button"
                              title={list.name}
                              aria-label={`Open saved list ${list.name}`}
                              onClick={() => {
                                const listTab =
                                  list.listType === "playlist"
                                    ? "playlistAnalytics"
                                    : "videoAnalytics";
                                navigate(
                                  `/dashboard?list=${encodeURIComponent(list.id)}&tab=${listTab}`,
                                );
                              }}
                            >
                              <div className="recent-item-content">
                                <div className="recent-item-text">
                                  <span className="recent-item-name with-type">
                                    <span>{list.name}</span>
                                    <span
                                      className={`recent-item-type-badge ${list.listType === "playlist" ? "playlist" : "video"}`}
                                    >
                                      {list.listType === "playlist"
                                        ? "Playlist"
                                        : "Video"}
                                    </span>
                                  </span>
                                  <span className="recent-item-time">
                                    {list.listType === "playlist"
                                      ? `${list.playlistIds?.length || 0} playlist${(list.playlistIds?.length || 0) !== 1 ? "s" : ""}`
                                      : `${list.videoIds.length} video${list.videoIds.length !== 1 ? "s" : ""}`}
                                  </span>
                                </div>
                              </div>
                            </Button>
                          </div>
                        ))}

                      {/* Empty states */}
                      {currentPage === "videos" &&
                        recentChannels.length === 0 && (
                          <div className="recent-empty">
                            <p>
                              No recents yet. Open a channel from the Videos
                              page to populate this list.
                            </p>
                          </div>
                        )}
                      {currentPage === "channel" &&
                        recentChannels.length === 0 && (
                          <div className="recent-empty">
                            <p>
                              No recents yet. Open a channel to populate this
                              list.
                            </p>
                          </div>
                        )}
                      {currentPage === "playlist" &&
                        recentPlaylists.length === 0 && (
                          <div className="recent-empty">
                            <p>
                              No recents yet. Open a playlist to populate this
                              list.
                            </p>
                          </div>
                        )}
                      {currentPage === "compare" &&
                        recentComparisons.length === 0 && (
                          <div className="recent-empty">
                            <p>
                              No recents yet. Run a comparison to populate this
                              list.
                            </p>
                          </div>
                        )}
                      {currentPage === "dashboard" &&
                        filteredLists.length === 0 && (
                          <div className="recent-empty">
                            <p>No saved lists yet</p>
                          </div>
                        )}
                    </div>
                  )}
                </div>
              )}
          </nav>
        </div>

        <div className="sidebar-footer">
          {sidebarOpen &&
            isPersonalContext &&
            !usageLoading &&
            usedLimit > 0 &&
            pageKeyMap[currentPage] &&
            (!config.pages[usagePageKey]?.premiumOnly ||
              userPackage === "pro") && (
              <UsageBar
                label={
                  currentPage === "dashboard"
                    ? "Channel Analytics"
                    : config.pages[usagePageKey]?.label || "Dashboard"
                }
                used={currentUsage}
                limit={usedLimit}
              />
            )}
          {sidebarOpen ? (
            <>
              <NavLink
                to="/profile"
                className={({ isActive }) =>
                  `nav-item footer-profile ${isActive ? "active" : ""}`
                }
                title="Profile"
              >
                <MdPerson />
                <span>Profile</span>
              </NavLink>
              <Button
                variant="ghost"
                onClick={() => setShowLogoutConfirm(true)}
                title="Sign Out"
              >
                <MdLogout />
                <span>Sign Out</span>
              </Button>
              {/* footer-info removed per UI preference (no copyright/product line) */}
              <span
                className="sidebar-version"
                title={`App version ${APP_DISPLAY_VERSION}`}
              >
                v{APP_DISPLAY_VERSION}
              </span>
            </>
          ) : (
            <div className="footer-icon-row">
              <NavLink
                to="/profile"
                className="footer-profile-icon"
                title="Profile"
                aria-label="Profile"
              >
                <MdPerson aria-hidden />
              </NavLink>
              <Button
                variant="ghost"
                size="icon"
                onClick={() => setShowLogoutConfirm(true)}
                title="Sign Out"
                aria-label="Sign out"
              >
                <MdLogout aria-hidden />
              </Button>
            </div>
          )}
        </div>
      </Paper>

      {/* Logout Confirmation */}
      <ConfirmModal
        isOpen={showLogoutConfirm}
        title="Sign Out"
        message="Are you sure you want to sign out?"
        confirmLabel="Sign Out"
        onConfirm={() => {
          setShowLogoutConfirm(false);
          handleSignOut();
        }}
        onCancel={() => setShowLogoutConfirm(false)}
      />

      {/* Mobile Overlay */}
      {sidebarOpen && (
        <div
          className="sidebar-overlay"
          onClick={() => setSidebarOpen(false)}
        ></div>
      )}

      {/* Main Content */}
      <Box
        component="main"
        className="main-content"
        onClick={() => {
          if (window.innerWidth <= SIDEBAR_DRAWER_MAX_WIDTH_PX && sidebarOpen) {
            setSidebarOpen(false);
          }
        }}
      >
        <Box className="content-area">
          <Outlet />
        </Box>
      </Box>
    </Box>
  );
};
