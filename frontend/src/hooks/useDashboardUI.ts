/**
 * Refactored UI State Management Hook
 * Consolidates UI-related state (tabs, charts, modals, etc.)
 */

import { useCallback, useEffect } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import type { DashboardTab, ChartType } from '../types/dashboard';

export const useDashboardUI = () => {
  // Store state (narrow subscriptions to reduce unrelated rerenders)
  const activeTab = useDashboardStore(state => state.ui.activeTab);
  const activeChart = useDashboardStore(state => state.ui.activeChart);
  const showAnnotations = useDashboardStore(state => state.ui.showAnnotations);
  const trueDeltaEnabled = useDashboardStore(state => state.ui.trueDeltaEnabled);
  const compareEnabled = useDashboardStore(state => state.ui.compareEnabled);
  const showAllTimeViews = useDashboardStore(state => state.ui.showAllTimeViews);
  const selectedMetrics = useDashboardStore(state => state.ui.selectedMetrics);
  const selectedDimensions = useDashboardStore(state => state.ui.selectedDimensions);
  const selectedPlaylistMetas = useDashboardStore(state => state.ui.selectedPlaylistMetas);

  const showListDropdown = useDashboardStore(state => state.modals.showListDropdown);
  const isAddListModalOpen = useDashboardStore(state => state.modals.isAddListModalOpen);
  const isEditListModalOpen = useDashboardStore(state => state.modals.isEditListModalOpen);
  const editingList = useDashboardStore(state => state.modals.editingList);
  const listSearchTerm = useDashboardStore(state => state.modals.listSearchTerm);

  const period = useDashboardStore(state => state.dateRange.period);
  const customStartDate = useDashboardStore(state => state.dateRange.customStartDate);
  const customEndDate = useDashboardStore(state => state.dateRange.customEndDate);
  const latestDataDate = useDashboardStore(state => state.dateRange.latestDataDate);

  // Store actions
  const setActiveTab = useDashboardStore(state => state.setActiveTab);
  const setActiveChart = useDashboardStore(state => state.setActiveChart);
  const setShowAnnotations = useDashboardStore(state => state.setShowAnnotations);
  const setTrueDeltaEnabled = useDashboardStore(state => state.setTrueDeltaEnabled);
  const setCompareEnabled = useDashboardStore(state => state.setCompareEnabled);
  const setShowAllTimeViews = useDashboardStore(state => state.setShowAllTimeViews);
  const setPeriod = useDashboardStore(state => state.setPeriod);
  const setCustomDateRange = useDashboardStore(state => state.setCustomDateRange);
  const setLatestDataDate = useDashboardStore(state => state.setLatestDataDate);

  // Modal actions
  const setShowListDropdown = useDashboardStore(state => state.setShowListDropdown);
  const setIsAddListModalOpen = useDashboardStore(state => state.setIsAddListModalOpen);
  const setIsEditListModalOpen = useDashboardStore(state => state.setIsEditListModalOpen);
  const setEditingList = useDashboardStore(state => state.setEditingList);

  const switchTab = useCallback((tab: DashboardTab) => {
    setActiveTab(tab);
    if (tab === 'playlistAnalytics') {
      useDashboardStore.getState().setSelectedVideo(null);
      useDashboardStore.getState().setSelectedVideoIds(new Set());
      useDashboardStore.getState().setTableCheckedOverride(null);
      useDashboardStore.getState().setFilterByVideos(false);
      useDashboardStore.getState().setSelectedVideos(new Set());
    }
    if (tab === 'audience') {
      // Don't carry video selection from other tabs -- audience dimensions
      // should default to channel-wide, not filtered by specific videos.
      useDashboardStore.getState().setSelectedVideo(null);
      useDashboardStore.getState().setSelectedVideoIds(new Set());
      useDashboardStore.getState().setTableCheckedOverride(null);
    }
  }, [setActiveTab]);

  const switchChart = useCallback((chart: ChartType) => {
    const selectedVideo = useDashboardStore.getState().videoSelection.selectedVideo;
    if (chart === 'ctr' && !selectedVideo) return;
    setActiveChart(chart);
  }, [setActiveChart]);

  useEffect(() => {
    const selectedVideo = useDashboardStore.getState().videoSelection.selectedVideo;
    if (!selectedVideo && activeChart === 'ctr') {
      setActiveChart('views');
    }
  }, [activeChart, setActiveChart]);

  const changePeriod = useCallback((nextPeriod: 7 | 30 | 90 | null) => {
    setPeriod(nextPeriod);
    if (nextPeriod && latestDataDate) {
      const end = new Date(latestDataDate);
      const start = new Date(end);
      start.setDate(start.getDate() - (nextPeriod - 1));
      setCustomDateRange(start.toISOString(), end.toISOString());
    } else if (!nextPeriod) {
      setCustomDateRange(null, null);
    }
  }, [setPeriod, setCustomDateRange, latestDataDate]);

  const togglePeriod = useCallback((nextPeriod: 7 | 30 | 90) => {
    if (period === nextPeriod) changePeriod(null);
    else changePeriod(nextPeriod);
  }, [period, changePeriod]);

  const toggleMetric = useCallback((metricId: string) => {
    const newMetrics = new Set(selectedMetrics);
    if (newMetrics.has(metricId)) {
      if (newMetrics.size > 1) newMetrics.delete(metricId);
    } else {
      newMetrics.add(metricId);
    }
    useDashboardStore.setState(state => ({ ui: { ...state.ui, selectedMetrics: newMetrics } }));
  }, [selectedMetrics]);

  const toggleDimension = useCallback((dimId: string) => {
    const newDimensions = new Set(selectedDimensions);
    if (newDimensions.has(dimId)) {
      if (newDimensions.size > 1) newDimensions.delete(dimId);
    } else {
      newDimensions.add(dimId);
    }
    useDashboardStore.setState(state => ({ ui: { ...state.ui, selectedDimensions: newDimensions } }));
  }, [selectedDimensions]);

  const togglePlaylistMeta = useCallback((metaId: string) => {
    const newMetas = new Set(selectedPlaylistMetas);
    if (newMetas.has(metaId)) newMetas.delete(metaId);
    else newMetas.add(metaId);
    useDashboardStore.setState(state => ({ ui: { ...state.ui, selectedPlaylistMetas: newMetas } }));
  }, [selectedPlaylistMetas]);

  return {
    activeTab,
    activeChart,
    showAnnotations,
    trueDeltaEnabled,
    compareEnabled,
    showAllTimeViews,
    selectedMetrics,
    selectedDimensions,
    selectedPlaylistMetas,
    period,
    customStartDate,
    customEndDate,
    latestDataDate,
    showListDropdown,
    isAddListModalOpen,
    isEditListModalOpen,
    editingList,
    listSearchTerm,
    switchTab,
    switchChart,
    setShowAnnotations,
    setTrueDeltaEnabled,
    setCompareEnabled,
    setShowAllTimeViews,
    changePeriod,
    togglePeriod,
    setCustomDateRange,
    setLatestDataDate,
    setShowListDropdown,
    setIsAddListModalOpen,
    setIsEditListModalOpen,
    setEditingList,
    setListSearchTerm: (term: string) => {
      useDashboardStore.setState(state => {
        state.modals.listSearchTerm = term;
      });
    },
    toggleMetric,
    toggleDimension,
    togglePlaylistMeta,
  };
};
