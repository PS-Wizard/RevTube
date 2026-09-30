/**
 * analyticsFilter.ts
 * 
 * Client-side filtering utilities for analytics data.
 * Allows filtering full channel data by video IDs without making new API calls.
 */

import type { AnalyticsReport } from '../services/analyticsService';

/**
 * Filter analytics report rows by video IDs
 * Assumes data has 'video' dimension in the response
 */
export function filterAnalyticsByVideos(
  report: AnalyticsReport | null,
  videoIds: string[]
): AnalyticsReport | null {
  if (!report || !report.rows || videoIds.length === 0) {
    return report;
  }

  const videoIdSet = new Set(videoIds);
  
  // Find the index of the 'video' column in columnHeaders
  const videoColumnIndex = report.columnHeaders?.findIndex(
    header => header.name === 'video'
  ) ?? -1;

  // If no video dimension, return original report
  if (videoColumnIndex === -1) {
    return report;
  }

  // Filter rows to only include specified video IDs
  const filteredRows = report.rows.filter(row => {
    const videoId = row[videoColumnIndex];
    return videoIdSet.has(videoId);
  });

  return {
    ...report,
    rows: filteredRows
  };
}

/**
 * Aggregate analytics data by date from rows that may have video dimension
 * Useful for converting video-level data to date-level aggregates
 */
export function aggregateByDate(
  report: AnalyticsReport | null,
  metricsToAggregate: string[]
): AnalyticsReport | null {
  if (!report || !report.rows || !report.columnHeaders) {
    return report;
  }

  // Find column indices
  const dateIndex = report.columnHeaders.findIndex(h => h.name === 'day');
  if (dateIndex === -1) return report;

  // Build map of metric name to column index
  const metricIndices = new Map<string, number>();
  metricsToAggregate.forEach(metric => {
    const idx = report.columnHeaders!.findIndex(h => h.name === metric);
    if (idx !== -1) {
      metricIndices.set(metric, idx);
    }
  });

  // Group by date and aggregate
  const dateMap = new Map<string, string[]>();
  
  report.rows.forEach(row => {
    const date = row[dateIndex];
    if (!dateMap.has(date)) {
      // Initialize with date and zeros for each metric
      const newRow = [...row];
      dateMap.set(date, newRow);
    } else {
      // Aggregate metrics
      const existing = dateMap.get(date)!;
      metricIndices.forEach((colIdx) => {
        const value = Number(row[colIdx]) || 0;
        existing[colIdx] = String((Number(existing[colIdx]) || 0) + value);
      });
    }
  });

  return {
    ...report,
    rows: Array.from(dateMap.values()).sort((a, b) => 
      String(a[dateIndex]).localeCompare(String(b[dateIndex]))
    )
  };
}

/**
 * Filter and aggregate analytics data for a specific set of videos
 * Returns date-aggregated data for the filtered videos
 */
export function getVideoSubset(
  fullReport: AnalyticsReport | null,
  videoIds: string[],
  metricsToAggregate: string[] = ['views', 'estimatedMinutesWatched', 'averageViewPercentage']
): AnalyticsReport | null {
  const filtered = filterAnalyticsByVideos(fullReport, videoIds);
  return aggregateByDate(filtered, metricsToAggregate);
}
