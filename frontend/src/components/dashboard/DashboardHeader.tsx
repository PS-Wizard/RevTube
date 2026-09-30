import dayjs from "dayjs";
import React from "react";
import type { DashboardTab } from "../../types/dashboard";
import { Button } from "../ui";
import { getStatCardSurfaceForTab } from "../../config/statCardRegistry";
import { ChannelSelector } from "./ChannelSelector";
import { DateRangeSelector } from "./DateRangeSelector";
import { StatCardsCustomizer } from "./StatCardsCustomizer";

export interface DashboardHeaderProps {
  // Channel scope (mirrors ChannelSelector's channel list type)
  channels: React.ComponentProps<typeof ChannelSelector>["channels"];
  selectedChannel: string | null;
  onSelectChannel: (channelId: string) => void;
  onMoveChannel: (channelId: string) => void;
  onDeleteChannel: (channelId: string) => void;
  onOpenFocus?: (channelId: string) => void;
  onConnectChannel: () => Promise<void>;
  isPersonalContext: boolean;
  isOwner: boolean;
  isAdmin: boolean;
  currentOrganizationName?: string;
  isConnectingChannel: boolean;
  // Reporting period (ISO strings; converted to dayjs internally)
  customStartDate: string | null;
  customEndDate: string | null;
  latestDataDate: string | null;
  onRangeChange: (start: string | null, end: string | null) => void;
  onClearRange: () => void;
  // Tabs
  activeTab: DashboardTab;
  onTabChange: (tab: DashboardTab) => void;
}

const TABS: Array<{ key: DashboardTab; label: string }> = [
  { key: "channelAnalytics", label: "Channel" },
  { key: "playlistAnalytics", label: "Playlists" },
  { key: "videoAnalytics", label: "Videos" },
  { key: "audience", label: "Audience" },
  { key: "insights", label: "Insights" },
];

/**
 * Sticky dashboard header: channel-scope row + reporting-period row + tab rail.
 * Extracted from DashboardPage — pure presentational, all state lives in the
 * page/store. Keeps the existing `.dashboard-header-*` classes so
 * `page-chrome.css` + `DashboardPage.css` still apply (visual parity).
 */
export const DashboardHeader: React.FC<DashboardHeaderProps> = ({
  channels,
  selectedChannel,
  onSelectChannel,
  onMoveChannel,
  onDeleteChannel,
  onOpenFocus,
  onConnectChannel,
  isPersonalContext,
  isOwner,
  isAdmin,
  currentOrganizationName,
  isConnectingChannel,
  customStartDate,
  customEndDate,
  latestDataDate,
  onRangeChange,
  onClearRange,
  activeTab,
  onTabChange,
}) => {
  /** Tabs with a customizable stat-card surface get the customizer trigger. */
  const cardSurface = getStatCardSurfaceForTab(activeTab);

  return (
    <div className="dashboard-header-container">
      <div className="dashboard-header-row dashboard-header-row--context">
        <div className="dashboard-header-context">
          <div className="channel-selector-container">
            <ChannelSelector
              channels={channels}
              selectedChannel={selectedChannel}
              onSelectChannel={onSelectChannel}
              onMoveChannel={onMoveChannel}
              onDeleteChannel={onDeleteChannel}
              onOpenFocus={onOpenFocus}
              onConnectChannel={onConnectChannel}
              isPersonalContext={isPersonalContext}
              isOwner={isOwner}
              isAdmin={isAdmin}
              currentOrganizationName={currentOrganizationName}
              isConnectingChannel={isConnectingChannel}
            />
          </div>
        </div>

        <div className="dashboard-header-period">
          <div className="dashboard-time-controls unified-timeframe-pill">
            <DateRangeSelector
              startDate={customStartDate ? dayjs(customStartDate) : null}
              endDate={customEndDate ? dayjs(customEndDate) : null}
              latestDataDate={latestDataDate ? dayjs(latestDataDate) : null}
              onRangeChange={(start, end) =>
                onRangeChange(
                  start ? start.toISOString() : null,
                  end ? end.toISOString() : null,
                )
              }
              onClear={onClearRange}
            />
          </div>
        </div>
      </div>

      <nav
        className="dashboard-header-row dashboard-header-row--tabs analytics-tabs"
        aria-label="Analytics views"
      >
        <div className="analytics-tabs__scroller">
          <div className="analytics-tabs__list" role="tablist">
            {TABS.map(({ key, label }) => (
              <Button
                key={key}
                bare
                role="tab"
                aria-selected={activeTab === key}
                className={`analytics-tab${activeTab === key ? " active" : ""}`}
                onClick={() => onTabChange(key)}
              >
                {label}
              </Button>
            ))}
          </div>
        </div>

        {cardSurface && (
          <div className="analytics-tabs__actions">
            <StatCardsCustomizer surface={cardSurface} />
          </div>
        )}
      </nav>
    </div>
  );
};

export default DashboardHeader;
