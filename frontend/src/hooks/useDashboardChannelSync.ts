/**
 * Channel Synchronization Hook
 * Handles channel switching and resets all dependent state
 */

import { useEffect, useRef, useMemo } from 'react';
import { useDashboardStore } from '../stores/dashboardStore';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { getDashboardWorkspaceKey } from '../utils/dashboardWorkspaceScope';
import { devLog } from '../utils/devLog';

export const useDashboardChannelSync = () => {
  const { user } = useAuth();
  const { currentOrganization, isPersonalContext } = useOrganization();
  const selectedChannel = useDashboardStore(state => state.channel.selectedChannel);
  const resetChannelState = useDashboardStore(state => state.resetChannelState);
  
  const prevChannelRef = useRef<string | null>(null);

  const workspaceKey = useMemo(
    () =>
      getDashboardWorkspaceKey({
        userId: user?.uid,
        isPersonalContext,
        organizationId: currentOrganization?.id,
      }),
    [user?.uid, isPersonalContext, currentOrganization?.id],
  );

  useEffect(() => {
    if (!workspaceKey) return;
    prevChannelRef.current = null;
  }, [workspaceKey]);
  
  // Reset all state when channel changes
  useEffect(() => {
    if (!selectedChannel) return;
    
    // First mount: hydrate latest analytics date from cache so channel-only loads work
    // (switching tabs used to be the only path that set this + enabled useChannelAnalyticsQuery).
    if (prevChannelRef.current === null) {
      try {
        const stored = localStorage.getItem(`latestDataDate_${selectedChannel}`);
        const storedTime = localStorage.getItem(`latestDataDate_${selectedChannel}_time`);
        if (stored && storedTime) {
          const age = Date.now() - parseInt(storedTime, 10);
          if (age < 24 * 60 * 60 * 1000) {
            useDashboardStore.getState().setLatestDataDate(stored);
          }
        }
      } catch {
        /* ignore */
      }
      prevChannelRef.current = selectedChannel;
      return;
    }
    
    // Channel changed - reset everything
    if (prevChannelRef.current !== selectedChannel) {
      devLog('[ChannelSync] Channel changed, resetting state');
      
      // Reset all channel-dependent state
      resetChannelState();
      
      // Load video limit for new channel
      try {
        const storedLimit = localStorage.getItem(`videoLimit_${selectedChannel}`);
        const storedCustom = localStorage.getItem(`customLimit_${selectedChannel}`);
        
        if (storedLimit) {
          const parsed = storedLimit === 'all' || storedLimit === 'custom' 
            ? storedLimit 
            : parseInt(storedLimit, 10);
          
          useDashboardStore.setState(() => ({
            videoLimit: { 
              mode: parsed,
              customValue: storedCustom ? parseInt(storedCustom, 10) : 100
            }
          }));
        }
      } catch {
        /* ignore */
      }
      
      // Load latest data date for new channel
      try {
        const stored = localStorage.getItem(`latestDataDate_${selectedChannel}`);
        const storedTime = localStorage.getItem(`latestDataDate_${selectedChannel}_time`);
        
        if (stored && storedTime) {
          const age = Date.now() - parseInt(storedTime, 10);
          // Valid for 24 hours
          if (age < 24 * 60 * 60 * 1000) {
            useDashboardStore.getState().setLatestDataDate(stored);
          }
        }
      } catch {
        /* ignore */
      }
      
      // Dispatch event for other components
      window.dispatchEvent(new Event('channelChanged'));
      
      prevChannelRef.current = selectedChannel;
    }
  }, [selectedChannel, resetChannelState]);
  
  return {
    selectedChannel,
    isChannelChanging: prevChannelRef.current !== selectedChannel,
  };
};
