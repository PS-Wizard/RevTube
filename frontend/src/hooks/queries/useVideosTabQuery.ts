/**
 * Videos tab -- single combined endpoint.
 * Replaces useVideosQuery + useAnalyticsQuery.
 * 1 endpoint = 1 quota unit.
 */

import { useQuery, useQueryClient } from "@tanstack/react-query";
import dayjs from "dayjs";
import { useEffect } from "react";
import { UsageLimitError } from "../../services/analyticsService";
import { getFirebaseAuthHeader } from "../../services/authHeaders";
import { useDashboardStore } from "../../stores/dashboardStore";
import { useUsageStore } from "../../stores/usageStore";
import type { VideoMetadata } from "../../types/youtube";
import { getResolvedApiBaseUrl } from "../../utils/apiBase";
import {
  DASHBOARD_WS_KEY_PENDING,
  REVTUBE_DASHBOARD_WS_ROOT,
  getDashboardWorkspaceKey,
} from "../../utils/dashboardWorkspaceScope";
import { useAuth } from "../useAuth";
import { useOrganization } from "../useOrganization";

type CustomDateInput = string | dayjs.Dayjs | null;

interface UseVideosTabQueryOptions {
  channelId: string | null;
  period: number | null;
  customStartDate: CustomDateInput;
  customEndDate: CustomDateInput;
  compareEnabled: boolean;
  trueDeltaEnabled: boolean;
  latestDataDate: string | null;
  videoLimit: number | "all" | "custom";
  customLimit: number;
  getEffectiveToken: (channelId: string) => Promise<string | null>;
  onPersistLatestDate?: (channelId: string, date: string) => void;
  enabled?: boolean;
}

export const useVideosTabQuery = ({
  channelId,
  period,
  customStartDate,
  customEndDate,
  compareEnabled,
  trueDeltaEnabled,
  latestDataDate,
  videoLimit,
  customLimit,
  getEffectiveToken,
  onPersistLatestDate,
  enabled = true,
}: UseVideosTabQueryOptions) => {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const channels = useDashboardStore((state) => state.channel.channels);
  const workspaceKey =
    getDashboardWorkspaceKey({
      userId: user?.uid,
      isPersonalContext,
      organizationId: currentOrganization?.id,
    }) ?? DASHBOARD_WS_KEY_PENDING;
  const setAnalyticsData = useDashboardStore((state) => state.setAnalyticsData);
  const setAnalyticsLoading = useDashboardStore(
    (state) => state.setAnalyticsLoading,
  );
  const setAnalyticsError = useDashboardStore(
    (state) => state.setAnalyticsError,
  );
  const setVideos = useDashboardStore((state) => state.setVideos);
  const visibility = useDashboardStore((state) => state.filters.visibility);
  const privacy =
    visibility === "public" ||
    visibility === "private" ||
    visibility === "unlisted"
      ? visibility
      : "all";

  const startD = customStartDate ? dayjs(customStartDate) : null;
  const endD = customEndDate ? dayjs(customEndDate) : null;
  const hasCustomRange = !!(startD?.isValid() && endD?.isValid());
  const resolvedEmail = user?.email || "";

  // Calculate maxResults
  const maxResults = (() => {
    if (videoLimit === "all") return undefined;
    if (videoLimit === "custom") return Math.max(1, customLimit);
    if (typeof videoLimit === "number") return Math.max(1, videoLimit);
    return 50;
  })();

  const query = useQuery({
    queryKey: [
      REVTUBE_DASHBOARD_WS_ROOT,
      workspaceKey,
      "videosTab",
      channelId,
      resolvedEmail,
      videoLimit,
      customLimit,
      period,
      startD?.format("YYYY-MM-DD") ?? "",
      endD?.format("YYYY-MM-DD") ?? "",
      compareEnabled,
      trueDeltaEnabled,
      latestDataDate ?? "",
      privacy,
    ],
    queryFn: async () => {
      if (!channelId || !user?.email) {
        throw new Error("Missing channel or user");
      }

      const token = await getEffectiveToken(channelId);
      if (!token) {
        throw new Error("No access token available");
      }

      const baseUrl = getResolvedApiBaseUrl();
      const headers: Record<string, string> = {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
        ...(await getFirebaseAuthHeader()),
      };
      if (currentOrganization?.id) headers["X-Org-Id"] = currentOrganization.id;

      const body: Record<string, unknown> = {
        channelId,
        period: hasCustomRange ? undefined : (period ?? 30),
        compare: compareEnabled,
        trueDelta: trueDeltaEnabled,
        latestDate: latestDataDate || undefined,
        maxResults,
        privacy,
      };
      if (hasCustomRange) {
        body.startDate = startD!.format("YYYY-MM-DD");
        body.endDate = endD!.format("YYYY-MM-DD");
      }

      const response = await fetch(`${baseUrl}/dashboard/tab/videos`, {
        method: "POST",
        headers,
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorData = (await response.json().catch(() => ({}))) as {
          error?: {
            message?: string;
            code?: string;
            limit?: number;
            used?: number;
            pageKey?: string;
          };
        };
        if (
          response.status === 429 &&
          errorData.error?.code === "LIMIT_EXCEEDED"
        ) {
          const e = errorData.error;
          throw new UsageLimitError(
            e.message || "Usage limit exceeded",
            e.limit ?? 0,
            e.used ?? 0,
            e.pageKey || "dashboard",
          );
        }
        throw new Error(
          errorData.error?.message ||
            `Videos tab request failed: ${response.status}`,
        );
      }

      const data = (await response.json()) as {
        items: VideoMetadata[];
        bundle: {
          current: any;
          previous: any;
          channelCurrent: any;
          channelPrevious: any;
          channelTotals: any;
          prevChannelTotals: any;
          d7: any;
          d30: any;
          d90: any;
          latestDate: string;
        };
        _usage?: { used: number; limit: number; pageKey: string };
      };

      if (data._usage) {
        useUsageStore
          .getState()
          .updateUsage(
            data._usage.pageKey,
            data._usage.used,
            data._usage.limit,
          );
      }

      return data;
    },
    enabled:
      enabled &&
      !!channelId &&
      !!user?.email &&
      !(isPersonalContext && channels.length === 0),
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    retry: 2,
    meta: { suppressGlobalErrorToast: true },
  });

  useEffect(() => {
    setAnalyticsLoading(query.isLoading);
  }, [query.isLoading, setAnalyticsLoading]);

  useEffect(() => {
    if (!query.data) return;

    const { items, bundle } = query.data;

    // Set videos in the store
    setVideos(items);

    // Set analytics bundle data
    setAnalyticsData({
      reportData: bundle.current,
      prevReportData: bundle.previous,
      channelMetrics: bundle.channelCurrent,
      prevChannelMetrics: bundle.channelPrevious,
      bundleChannelTotals: bundle.channelTotals,
      bundlePrevChannelTotals: bundle.prevChannelTotals,
      multiPeriodStats: {
        d7: { current: bundle.d7?.current, previous: bundle.d7?.previous },
        d30: { current: bundle.d30?.current, previous: bundle.d30?.previous },
        d90: { current: bundle.d90?.current, previous: bundle.d90?.previous },
      },
      hasLoadedOnce: true,
      loadingMultiPeriod: false,
      error: null,
      usageError: null,
    } as never);

    if (bundle.latestDate && channelId && onPersistLatestDate) {
      const currentLatest =
        useDashboardStore.getState().dateRange.latestDataDate;
      if (bundle.latestDate !== currentLatest) {
        onPersistLatestDate(channelId, bundle.latestDate);
      }
    }

    queryClient.invalidateQueries({ queryKey: ["usage:me", user?.email] });
  }, [
    query.data,
    setVideos,
    setAnalyticsData,
    channelId,
    onPersistLatestDate,
    queryClient,
    user?.email,
  ]);

  useEffect(() => {
    if (!query.error) {
      setAnalyticsError(null);
      return;
    }

    const err = query.error;
    if (err instanceof UsageLimitError) {
      setAnalyticsData({
        usageError: {
          limit: err.limit,
          used: err.used,
          message: err.message,
        },
      });
      setAnalyticsError(null);
      return;
    }

    setAnalyticsError(
      err instanceof Error ? err.message : "Failed to load analytics",
    );
  }, [query.error, setAnalyticsError, setAnalyticsData]);

  return {
    data: query.data,
    isLoading: query.isLoading,
    error: query.error,
    refetch: query.refetch,
  };
};
