import { useEffect, useCallback } from 'react';

const AUTH_HINT_KEY = 'revtube:auth-hint:v1';
const LAST_SELECTED_CHANNEL_KEY = 'selectedChannel_last';

export const readBootstrapUserId = (): string | null => {
  try {
    const raw = localStorage.getItem(AUTH_HINT_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { uid?: string };
    return parsed?.uid || null;
  } catch {
    return null;
  }
};

interface UseStorageSyncProps {
  selectedChannel: string | null;
  selectedChannelStorageKey: string | null;
  userEmail?: string;
  isPersonalContext: boolean;
}

export const useStorageSync = ({
  selectedChannel,
  selectedChannelStorageKey,
  userEmail,
  isPersonalContext
}: UseStorageSyncProps) => {
  // Save selected channel to localStorage whenever it changes
  useEffect(() => {
    if (selectedChannel) {
      try {
        localStorage.setItem(LAST_SELECTED_CHANNEL_KEY, selectedChannel);
        if (selectedChannelStorageKey) {
          localStorage.setItem(selectedChannelStorageKey, selectedChannel);
        }
        if (isPersonalContext && userEmail) {
          localStorage.setItem(`selectedChannel_personal_${userEmail}`, selectedChannel);
        }
      } catch (err) {
        console.warn('Failed to save selected channel to localStorage:', err);
      }
    }
  }, [selectedChannel, selectedChannelStorageKey, isPersonalContext, userEmail]);
};

interface UseAudienceDaysStorageProps {
  audienceDays: number;
}

export const useAudienceDaysStorage = ({ audienceDays }: UseAudienceDaysStorageProps) => {
  useEffect(() => {
    try {
      localStorage.setItem('audienceRangeDays', String(audienceDays));
    } catch {
      // ignore localStorage errors
    }
  }, [audienceDays]);
};

interface UseVideLimitStorageProps {
  selectedChannel: string | null;
  videoLimit: number | 'all' | 'custom';
  customLimit: number;
}

export const useVideoLimitStorage = ({
  selectedChannel,
  videoLimit,
  customLimit
}: UseVideLimitStorageProps) => {
  const getVideoLimitStorageKey = useCallback(() => `videoLimit_${selectedChannel || 'default'}`, [selectedChannel]);
  const getCustomLimitStorageKey = useCallback(() => `customLimit_${selectedChannel || 'default'}`, [selectedChannel]);

  // Save video limit to localStorage whenever it changes
  useEffect(() => {
    if (selectedChannel) {
      try {
        localStorage.setItem(getVideoLimitStorageKey(), String(videoLimit));
      } catch (err) {
        console.warn('Failed to save video limit to localStorage:', err);
      }
    }
  }, [videoLimit, selectedChannel, getVideoLimitStorageKey]);

  // Save custom limit to localStorage whenever it changes
  useEffect(() => {
    if (selectedChannel) {
      try {
        localStorage.setItem(getCustomLimitStorageKey(), String(customLimit));
      } catch (err) {
        console.warn('Failed to save custom limit to localStorage:', err);
      }
    }
  }, [customLimit, selectedChannel, getCustomLimitStorageKey]);
};

interface UseLatestDataDateStorageProps {
  selectedChannel: string | null;
  latestDataDate: string;
}

export const useLatestDataDateStorage = ({
  selectedChannel,
  latestDataDate
}: UseLatestDataDateStorageProps) => {
  const saveLatestDataDate = useCallback((date: string) => {
    if (selectedChannel && date) {
      try {
        localStorage.setItem(`latestDate_${selectedChannel}`, JSON.stringify({ date, timestamp: Date.now() }));
      } catch {
        // Ignore localStorage errors
      }
    }
  }, [selectedChannel]);

  useEffect(() => {
    if (latestDataDate) {
      saveLatestDataDate(latestDataDate);
    }
  }, [latestDataDate, saveLatestDataDate]);

  return { saveLatestDataDate };
};
