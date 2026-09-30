import { useMutation, useQuery } from '@tanstack/react-query';
import {
  enqueueVideoAudit,
  getVideoAuditJobStatus,
  getVideoAuditHistory,
  getVideoAuditHistoryItem,
  saveVideoAudit,
  deleteVideoAuditHistory,
} from '../../services/videoAuditService';
import type { VideoAuditBatchResult, VideoAuditHistoryResponse, VideoAuditJobStatus, VideoAuditHistoryDetail } from '../../types/videoAudit';

export type VideoAuditEnqueueResponse = { jobId: string };

interface UseVideoAuditOptions {
  onSuccess?: (data: VideoAuditEnqueueResponse) => void;
  onError?: (error: Error) => void;
}

export function useVideoAudit({ onSuccess, onError }: UseVideoAuditOptions = {}) {
  return useMutation({
    mutationFn: (payload: { channelId: string; videoIds: string[]; includeThumbnail?: boolean; accessToken?: string | null; orgId?: string }) =>
      enqueueVideoAudit({ channelId: payload.channelId, videoIds: payload.videoIds, includeThumbnail: payload.includeThumbnail }, payload.accessToken, payload.orgId),
    onSuccess,
    onError,
    retry: 0,
    meta: { suppressGlobalErrorToast: true },
  });
}

export function useVideoAuditJobStatus(jobId: string | null, enabled: boolean = true) {
  return useQuery<VideoAuditJobStatus>({
    queryKey: ['video-audit-job', jobId],
    queryFn: () => getVideoAuditJobStatus(jobId!),
    enabled: enabled && !!jobId,
    refetchInterval: (query) => {
      const state = query.state.data?.state;
      return state === 'waiting' || state === 'active' || state === 'delayed' ? 3000 : false;
    },
    retry: 0,
  });
}

export function useVideoAuditHistory(params?: { limit?: number; page?: number }) {
  return useQuery<VideoAuditHistoryResponse>({
    queryKey: ['video-audit-history', params?.page ?? 1],
    queryFn: () => getVideoAuditHistory(params),
  });
}

export function useVideoAuditHistoryItem(id: number | null, enabled: boolean = true) {
  return useQuery<VideoAuditHistoryDetail>({
    queryKey: ['video-audit-history-item', id],
    queryFn: () => getVideoAuditHistoryItem(id!),
    enabled: enabled && !!id,
    retry: 0,
  });
}

export function useSaveVideoAudit() {
  return useMutation({
    mutationFn: (payload: { name?: string; channelId?: string; channelTitle?: string; results: VideoAuditBatchResult }) => saveVideoAudit(payload),
    retry: 0,
  });
}

export function useDeleteVideoAuditHistory() {
  return useMutation({
    mutationFn: (id: number) => deleteVideoAuditHistory(id),
    retry: 0,
  });
}