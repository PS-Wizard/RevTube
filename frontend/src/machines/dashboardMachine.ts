/**
 * XState Machine for Dashboard Tab Navigation and Loading States
 * Provides predictable state transitions and prevents invalid states
 */

import { createMachine, assign } from 'xstate';
import type { DashboardTab } from '../types/dashboard';

// ============================================================================
// CONTEXT & EVENTS
// ============================================================================

interface DashboardContext {
  activeTab: DashboardTab;
  error: string | null;
  retryCount: number;
}

type DashboardEvent =
  | { type: 'SWITCH_TAB'; tab: DashboardTab }
  | { type: 'LOAD_DATA' }
  | { type: 'DATA_LOADED' }
  | { type: 'DATA_ERROR'; error: string }
  | { type: 'RETRY' }
  | { type: 'RESET' };

// ============================================================================
// MACHINE DEFINITION
// ============================================================================

export const dashboardMachine = createMachine({
  id: 'dashboard',
  initial: 'idle',
  context: {
    activeTab: 'channelAnalytics' as DashboardTab,
    error: null,
    retryCount: 0,
  } as DashboardContext,
  
  states: {
    idle: {
      on: {
        SWITCH_TAB: {
          target: 'switchingTab',
          actions: assign({
            activeTab: ({ event }) => event.tab,
            error: null,
            retryCount: 0,
          }),
        },
        LOAD_DATA: 'loading',
      },
    },
    
    switchingTab: {
      always: [
        {
          target: 'loading',
          guard: ({ context }) => {
            // Auto-load data for tabs that need it
            return context.activeTab === 'videoAnalytics' || 
                   context.activeTab === 'channelAnalytics' ||
                   context.activeTab === 'audience' ||
                   context.activeTab === 'playlistAnalytics';
          },
        },
        { target: 'idle' },
      ],
    },
    
    loading: {
      on: {
        DATA_LOADED: 'success',
        DATA_ERROR: {
          target: 'error',
          actions: assign({
            error: ({ event }) => event.error,
            retryCount: ({ context }) => context.retryCount + 1,
          }),
        },
        SWITCH_TAB: {
          target: 'switchingTab',
          actions: assign({
            activeTab: ({ event }) => event.tab,
            error: null,
            retryCount: 0,
          }),
        },
      },
    },
    
    success: {
      on: {
        SWITCH_TAB: {
          target: 'switchingTab',
          actions: assign({
            activeTab: ({ event }) => event.tab,
            error: null,
            retryCount: 0,
          }),
        },
        LOAD_DATA: 'loading',
        RESET: 'idle',
      },
    },
    
    error: {
      on: {
        RETRY: {
          target: 'loading',
          guard: ({ context }) => context.retryCount < 3,
        },
        SWITCH_TAB: {
          target: 'switchingTab',
          actions: assign({
            activeTab: ({ event }) => event.tab,
            error: null,
            retryCount: 0,
          }),
        },
        RESET: {
          target: 'idle',
          actions: assign({
            error: null,
            retryCount: 0,
          }),
        },
      },
    },
  },
});

// ============================================================================
// TYPE EXPORTS
// ============================================================================

export type DashboardMachineContext = DashboardContext;
export type DashboardMachineEvent = DashboardEvent;
