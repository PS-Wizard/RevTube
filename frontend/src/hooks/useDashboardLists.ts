/**
 * useDashboardLists - Zustand-integrated saved lists (video / playlist).
 */

import { useEffect, useCallback, useMemo } from 'react';
import { toast } from 'react-hot-toast';

import { useDashboardStore } from '../stores/dashboardStore';
import { useAuth } from './useAuth';
import { useOrganization } from './useOrganization';
import { useConfirm } from './useConfirm';

import type { VideoMetadata } from '../types/youtube';
import type { PlaylistMetadata } from '../types/youtube';
import type { SavedList } from '../services/savedListService';
import { saveList, getUserLists, deleteList } from '../services/savedListService';
import { YouTubeService } from '../services/youtubeService';

export const useDashboardLists = () => {
  const { user, allTokens, accessToken } = useAuth();
  const { currentOrganization, isPersonalContext, loading: organizationLoading } = useOrganization();
  const { confirm: confirmAction } = useConfirm();

  const savedLists = useDashboardStore(state => state.lists.savedLists);
  const setSavedLists = useDashboardStore(state => state.setSavedLists);
  const activeListIds = useDashboardStore(state => state.listSelection.activeListIds);
  const setActiveListIds = useDashboardStore(state => state.setActiveListIds);
  const activeTab = useDashboardStore(state => state.ui.activeTab);
  const selectedChannel = useDashboardStore(state => state.channel.selectedChannel);
  const setVideos = useDashboardStore(state => state.setVideos);
  const setPlaylists = useDashboardStore(state => state.setPlaylists);
  const setSelectedVideoIds = useDashboardStore(state => state.setSelectedVideoIds);
  const setSelectedVideo = useDashboardStore(state => state.setSelectedVideo);
  const setSelectedPlaylists = useDashboardStore(state => state.setSelectedPlaylists);
  const setLoadingVideos = useDashboardStore(state => state.setLoadingVideos);

  const youtubeAccessToken = useMemo(() => {
    if (!selectedChannel) return '';
    const org = useDashboardStore.getState().channel.orgTokenMap[selectedChannel];
    if (org?.accessToken) return org.accessToken;
    const t = allTokens.find(x => x.channelId === selectedChannel);
    return t?.accessToken ?? accessToken ?? '';
  }, [selectedChannel, allTokens, accessToken]);
  const channels = useDashboardStore((state) => state.channel.channels);
  const personalEmpty = isPersonalContext && channels.length === 0;

  const activeLists = savedLists.filter(list => {
    const isPlaylistList = list.listType === 'playlist';
    if (activeTab === 'playlistAnalytics' && !isPlaylistList) return false;
    if (activeTab !== 'playlistAnalytics' && isPlaylistList) return false;
    return activeListIds.has(list.id);
  });

  useEffect(() => {
    const loadLists = async () => {
      if (!user?.uid) {
        setSavedLists([]);
        return;
      }

      try {
        let lists: SavedList[] = [];

        if (isPersonalContext) {
          lists = await getUserLists(user.uid);
        } else if (currentOrganization) {
          const { getOrganizationLists } = await import('../services/organizationListService');
          lists = await getOrganizationLists(currentOrganization.id);
        }

        setSavedLists(lists.sort((a, b) => b.createdAt - a.createdAt));
      } catch (error) {
        console.error('Error loading lists:', error);
        setSavedLists([]);
      }
    };

    if (!organizationLoading) {
      void loadLists();
    }
  }, [user?.uid, isPersonalContext, currentOrganization?.id, organizationLoading, setSavedLists, currentOrganization]);

  const handleCreateList = useCallback(
    async (
      ids: string[],
      metadata: { name: string; date: string; color: string; annotationTitle: string }
    ) => {
      if (!user?.uid || !user?.email || !selectedChannel) {
        toast.error('Missing required information to create list');
        return;
      }

      if (personalEmpty) {
        return;
      }
      const token = youtubeAccessToken;
      if (!token) {
        toast.error('No access token available');
        return;
      }

      const youtubeService = new YouTubeService(user.email, token);
      setLoadingVideos(true);

      try {
        const isPlaylistContext = activeTab === 'playlistAnalytics';

        let importedVideos: VideoMetadata[] = [];
        let importedPlaylists: PlaylistMetadata[] = [];

        if (isPlaylistContext) {
          importedPlaylists = await youtubeService.fetchDashboardPlaylistsByIds(ids);
        } else {
          importedVideos = await youtubeService.fetchDashboardVideosByIds(ids);
        }

        const list: SavedList = {
          id: Date.now().toString(),
          name: metadata.name,
          listType: isPlaylistContext ? 'playlist' : 'video',
          videoIds: isPlaylistContext ? [] : ids,
          playlistIds: isPlaylistContext ? ids : [],
          trackDate: metadata.date,
          color: metadata.color,
          annotations: [{ date: metadata.date, title: metadata.annotationTitle }],
          channelId: selectedChannel,
          createdAt: Date.now(),
          organizationId: isPersonalContext ? undefined : currentOrganization?.id,
          createdBy: user.uid,
        };

        if (isPersonalContext) {
          await saveList(user.uid, list);
        } else if (currentOrganization) {
          const { saveOrganizationList } = await import('../services/organizationListService');
          await saveOrganizationList(currentOrganization.id, list, user.uid);
        }

        if (isPlaylistContext) {
          const prevP = useDashboardStore.getState().playlists.playlists;
          const newItems = importedPlaylists.filter(p => !prevP.some(existing => existing.id === p.id));
          setPlaylists([...prevP, ...newItems]);
          setSelectedPlaylists(new Set(ids));
        } else {
          const prevV = useDashboardStore.getState().videos.videos;
          const newItems = importedVideos.filter(v => !prevV.some(existing => existing.videoId === v.videoId));
          setVideos([...prevV, ...newItems]);
          setSelectedVideo(null);
          setSelectedVideoIds(new Set(ids));
        }

        const prevLists = useDashboardStore.getState().lists.savedLists;
        setSavedLists([list, ...prevLists]);
        setActiveListIds(new Set([list.id]));
        useDashboardStore.setState(s => {
          s.listSelection.isTemporaryList = false;
        });

        toast.success('List created successfully');
      } catch (err) {
        console.error('List creation failed', err);
        toast.error('Failed to create and save list.');
      } finally {
        setLoadingVideos(false);
      }
    },
    [user, selectedChannel, personalEmpty, youtubeAccessToken, setLoadingVideos, activeTab, isPersonalContext, currentOrganization, setSavedLists, setActiveListIds, setPlaylists, setSelectedPlaylists, setVideos, setSelectedVideo, setSelectedVideoIds]
  );

  const handleUpdateList = useCallback(
    async (updatedList: SavedList) => {
      if (!user?.uid) {
        toast.error('User not authenticated');
        return;
      }

      try {
        if (isPersonalContext) {
          await saveList(user.uid, updatedList);
        } else if (currentOrganization) {
          const { saveOrganizationList } = await import('../services/organizationListService');
          await saveOrganizationList(currentOrganization.id, updatedList, user.uid);
        }

        const prev = useDashboardStore.getState().lists.savedLists;
        setSavedLists(prev.map(l => (l.id === updatedList.id ? updatedList : l)));

        toast.success('List updated successfully');
      } catch (error) {
        console.error('Failed to update list:', error);
        toast.error('Failed to update list.');
      }
    },
    [user, isPersonalContext, currentOrganization, setSavedLists]
  );

  const handleRemoveList = useCallback(
    async (e: React.MouseEvent, listId: string) => {
      e.stopPropagation();

      const confirmed = await confirmAction('This list and its annotations will be permanently removed.', {
        title: 'Delete saved list?',
        confirmLabel: 'Delete',
      });
      if (!confirmed) return;

      if (!user?.uid) {
        toast.error('User not authenticated');
        return;
      }

      try {
        if (isPersonalContext) {
          await deleteList(user.uid, listId);
        } else if (currentOrganization) {
          const { deleteOrganizationList } = await import('../services/organizationListService');
          await deleteOrganizationList(currentOrganization.id, listId);
        }

        const prevLists = useDashboardStore.getState().lists.savedLists;
        setSavedLists(prevLists.filter(l => l.id !== listId));

        if (activeListIds.has(listId)) {
          const prevIds = useDashboardStore.getState().listSelection.activeListIds;
          const next = new Set(prevIds);
          next.delete(listId);
          setActiveListIds(next);
        }

        toast.success('List deleted successfully');
      } catch (err) {
        console.error('Failed to delete list:', err);
        toast.error('Failed to delete list.');
      }
    },
    [user, isPersonalContext, currentOrganization, activeListIds, confirmAction, setSavedLists, setActiveListIds]
  );

  return {
    savedLists,
    activeLists,
    handleCreateList,
    handleUpdateList,
    handleRemoveList,
  };
};
