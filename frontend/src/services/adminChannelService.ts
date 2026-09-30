// ─────────────────────────────────────────────────────────────────────────────
// Admin channel service -- lists every connected channel across the whole
// system (all org channels + all users' personal tokens). Used by the admin
// optimizers so the admin can browse/analyze any connected channel.
// ─────────────────────────────────────────────────────────────────────────────
import { getFirebaseAuthHeader } from './authHeaders';
import { getResolvedApiBaseUrl } from '../utils/apiBase';

export interface SystemChannel {
  channelId: string;
  channelTitle: string;
  thumbnailUrl?: string;
  ownerType: 'org' | 'user';
  ownerName?: string;
}

export const getAdminChannels = async (): Promise<SystemChannel[]> => {
  const baseUrl = getResolvedApiBaseUrl();
  const response = await fetch(`${baseUrl}/admin/channels`, {
    headers: {
      ...(await getFirebaseAuthHeader()),
    },
  });

  if (!response.ok) {
    throw new Error(`Failed to load system channels (${response.status})`);
  }

  const data = (await response.json()) as { channels?: SystemChannel[] };
  return data.channels || [];
};
