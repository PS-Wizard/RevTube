import { useCallback, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { auth } from '../config/firebase';
import { USAGE_QUERY_KEY } from './useUsage';

export interface ChatChartSpec {
  type: 'line' | 'bar' | 'pie' | 'area';
  title: string;
  data: Array<Record<string, unknown>>;
  xKey?: string;
  series: Array<{ name: string; dataKey: string; color?: string }>;
  xAxisLabel?: string;
  yAxisLabel?: string;
}

export interface ChatMessage {
  id?: string;
  role: 'user' | 'assistant' | 'tool';
  content: string;
  toolCalls?: Array<{ name: string; args: Record<string, unknown> }>;
  timestamp?: string;
  userId?: string;
  userName?: string;
  /** Chart spec attached to an assistant message that created a visualization. */
  chart?: ChatChartSpec;
}

export interface Conversation {
  id: string;
  title: string;
  createdAt: string;
  updatedAt: string;
  messageCount: number;
}

export interface UserChannel {
  channelId: string;
  channelTitle: string | null;
  thumbnailUrl?: string | null;
  /** Present on admin channels from /channels/all. */
  owner?: { type: string; uid?: string | null; orgId?: string | null };
}

type SSEEvent =
  | { type: 'token'; content: string }
  | { type: 'tool_start'; tool?: string; args?: Record<string, unknown> }
  | { type: 'tool_end'; tool?: string }
  | { type: 'thought'; content: string }
  | { type: 'thought_end' }
  | { type: 'channels'; channels: Array<{ channelId: string; channelTitle: string | null }> }
  | { type: 'tools'; tools: string[] }
  | { type: 'usage'; pageKey: string; used: number; limit: number }
  | { type: 'chart'; chart: ChatChartSpec }
  | { type: 'truncated' }
  | { type: 'done' }
  | { type: 'error'; message: string };

interface UseChatOptions {
  onError?: (error: string) => void;
  /** API base path for chat endpoints. Defaults to '/api/chat'. Use '/api/chat/admin' for admin chat. */
  baseEndpoint?: string;
  /** True for the admin chat. Keeps the system-wide channel list loaded via
   *  /channels/all intact instead of clearing it at message send time. */
  adminMode?: boolean;
}

export interface ThinkingStep {
  content: string;
  timestamp: number;
}

export function useChat({ onError, baseEndpoint = '/api/chat', adminMode = false }: UseChatOptions = {}) {
  const queryClient = useQueryClient();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [isStreaming, setIsStreaming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeTool, setActiveTool] = useState<string | null>(null);
  const [thoughts, setThoughts] = useState<ThinkingStep[]>([]);
  const [userChannels, setUserChannels] = useState<UserChannel[]>([]);
  const [showContinue, setShowContinue] = useState(false);
  const abortControllerRef = useRef<AbortController | null>(null);
  const justFinishedToolRef = useRef(false);

  /** Get a fresh Firebase ID token for the auth header. */
  const getToken = useCallback(async (): Promise<string> => {
    const user = auth.currentUser;
    if (!user) throw new Error('Not authenticated');
    return user.getIdToken();
  }, []);

  /** Create a new conversation (optionally org-scoped). */
  const createConversation = useCallback(async (orgId?: string): Promise<string> => {
    const token = await getToken();
    const response = await fetch(`${baseEndpoint}/conversations`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Firebase-Token': token,
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to create conversation');
    }

    const data = await response.json();
    return data.conversation.id;
  }, [getToken, baseEndpoint]);

  /** List user's conversations (paginated, optionally org-scoped). */
  const listConversations = useCallback(async (limit = 50, offset = 0, orgId?: string): Promise<{ conversations: Conversation[]; totalCount: number }> => {
    const token = await getToken();
    const response = await fetch(`${baseEndpoint}/conversations?limit=${limit}&offset=${offset}`, {
      headers: {
        'X-Firebase-Token': token,
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to list conversations');
    }

    const data = await response.json();
    return {
      conversations: data.conversations || [],
      totalCount: data.totalCount || 0,
    };
  }, [getToken, baseEndpoint]);

  /** Load conversation history (paginated). */
  const loadConversation = useCallback(async (conversationId: string, limit = 100, offset = 0, orgId?: string): Promise<{ messages: ChatMessage[]; totalMessages: number }> => {
    const token = await getToken();
    const response = await fetch(`${baseEndpoint}/conversations/${conversationId}?limit=${limit}&offset=${offset}`, {
      headers: {
        'X-Firebase-Token': token,
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to load conversation');
    }

    const data = await response.json();
    const conversation = data.conversation || {};
    const msgs: ChatMessage[] = (conversation.messages || [])
      .filter((m: { role: string; content?: string | null }) => m.role !== 'tool' && !(m.role === 'assistant' && !m.content)) // Filter out tool messages and empty assistant placeholders
      .map((m: { role: string; content: string; tool_calls?: Array<{ function: { name: string } }>; userId?: string; userName?: string; chart?: ChatChartSpec }) => ({
        role: m.role as 'user' | 'assistant',
        content: m.content || '',
        toolCalls: m.tool_calls?.map((tc: { function: { name: string } }) => ({
          name: tc.function.name,
          args: {},
        })) || [],
        userId: m.userId,
        userName: m.userName,
        chart: m.chart,
      }));

    if (offset === 0) {
      setMessages(msgs);
    }
    return { messages: msgs, totalMessages: conversation.totalMessages || 0 };
  }, [getToken, baseEndpoint]);

  /** Fetch user's connected YouTube channels (optionally org-scoped). */
  const fetchUserChannels = useCallback(async (orgId?: string): Promise<UserChannel[]> => {
    const token = await getToken();
    const headers: Record<string, string> = {
      'X-Firebase-Token': token,
    };
    if (orgId) headers['X-Org-Id'] = orgId;
    const response = await fetch(`${baseEndpoint}/channels`, {
      headers,
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to fetch channels');
    }

    const data = await response.json();
    return data.channels || [];
  }, [getToken, baseEndpoint]);

  /** Admin-only: fetch ALL channels across all users/orgs with search + pagination. */
  const fetchAllChannels = useCallback(async (searchQuery = '', limit = 20, offset = 0): Promise<{ channels: UserChannel[]; total: number }> => {
    const token = await getToken();
    const params = new URLSearchParams();
    if (searchQuery) params.set('q', searchQuery);
    params.set('limit', String(limit));
    params.set('offset', String(offset));
    const response = await fetch(`${baseEndpoint}/channels/all?${params}`, {
      headers: { 'X-Firebase-Token': token },
    });
    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to fetch all channels');
    }
    const data = await response.json();
    return { channels: data.channels || [], total: data.total || 0 };
  }, [getToken, baseEndpoint]);

  /** Delete a conversation. */
  const deleteConversation = useCallback(async (conversationId: string, orgId?: string): Promise<void> => {
    const token = await getToken();
    const response = await fetch(`${baseEndpoint}/conversations/${conversationId}`, {
      method: 'DELETE',
      headers: {
        'X-Firebase-Token': token,
        ...(orgId ? { 'X-Org-Id': orgId } : {}),
      },
    });

    if (!response.ok) {
      const err = await response.json();
      throw new Error(err.error?.message || 'Failed to delete conversation');
    }
  }, [getToken, baseEndpoint]);

  /** Send a message and stream the response via SSE. */
  const sendMessage = useCallback(async (content: string, conversationId: string, contextChannelId?: string, orgId?: string, options?: { disabledTools?: string[] }) => {
    const token = await getToken();

    // Reset states
    setError(null);
    setIsStreaming(true);
    setActiveTool(null);
    setThoughts([]);
    setShowContinue(false);
    // In admin mode keep the system-wide channel list intact (the backend does
    // not send a channels event to refresh it). User mode clears it so the SSE
    // channels event repopulates the selector with fresh data.
    if (!adminMode) setUserChannels([]);

    // Add user message immediately
    const userMessage: ChatMessage = { role: 'user', content };
    setMessages((prev) => [...prev, userMessage]);

    // Add placeholder for assistant response
    const assistantMessage: ChatMessage = { role: 'assistant', content: '' };
    setMessages((prev) => [...prev, assistantMessage]);

    // Create abort controller for cancellation
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    try {
      const response = await fetch(`${baseEndpoint}/conversations/${conversationId}/messages`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Firebase-Token': token,
          ...(orgId ? { 'X-Org-Id': orgId } : {}),
        },
        body: JSON.stringify({ message: content, contextChannelId, ...(options?.disabledTools ? { disabledTools: options.disabledTools } : {}) }),
        signal: abortController.signal,
      });

      if (!response.ok) {
        const errData = await response.json().catch(() => ({ error: { message: 'Request failed' } }));
        throw new Error(errData.error?.message || `Request failed with status ${response.status}`);
      }

      const reader = response.body?.getReader();
      if (!reader) throw new Error('No response body stream');

      const decoder = new TextDecoder();
      let buffer = '';

      // Read the SSE stream
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // Keep incomplete line in buffer

        for (const line of lines) {
          const trimmed = line.trim();
          if (!trimmed || trimmed.startsWith(':')) continue; // Skip comments/keepalives
          if (!trimmed.startsWith('data: ')) continue;

          const dataStr = trimmed.slice(6);
          try {
            const event: SSEEvent = JSON.parse(dataStr);

            switch (event.type) {
              case 'token': {
                const shouldBreak = justFinishedToolRef.current;
                justFinishedToolRef.current = false;
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    const prefix = shouldBreak && last.content.length > 0 ? '\n\n' : '';
                    updated[updated.length - 1] = {
                      ...last,
                      content: last.content + prefix + event.content,
                    };
                  }
                  return updated;
                });
                break;
              }

              case 'tool_start':
                // The backend intentionally omits the tool name (internal-only).
                // Track "a tool is running" as a generic flag -- never a name.
                setActiveTool('working');
                justFinishedToolRef.current = false;
                break;

              case 'tool_end':
                setActiveTool(null);
                justFinishedToolRef.current = true;
                break;

              case 'thought':
                setThoughts([{ content: event.content, timestamp: Date.now() }]);
                break;

              case 'thought_end':
                setThoughts([]);
                break;

              case 'channels':
                setUserChannels(event.channels);
                break;

              case 'usage':
                // Invalidate the usage query so the Layout sidebar UsageBar updates
                queryClient.invalidateQueries({ queryKey: [USAGE_QUERY_KEY] });
                break;

              case 'chart':
                // Attach the chart spec to the last assistant message so it
                // renders inline in the bubble and can be downloaded.
                setMessages((prev) => {
                  const updated = [...prev];
                  const last = updated[updated.length - 1];
                  if (last && last.role === 'assistant') {
                    updated[updated.length - 1] = { ...last, chart: event.chart };
                  }
                  return updated;
                });
                break;

              case 'done':
                // Streaming complete -- clear thinking steps after a moment
                setTimeout(() => setThoughts([]), 2000);
                break;

              case 'truncated':
                // Answer was cut short (output budget / interrupted stream):
                // offer Continue, which reuses this conversation's history.
                setShowContinue(true);
                break;

              case 'error':
                setError(event.message);
                onError?.(event.message);
                break;
            }
          } catch {
            // Skip malformed JSON chunks
          }
        }
      }
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : 'An error occurred';
      if (message !== 'The user aborted a request.') {
        setError(message);
        onError?.(message);
      }
    } finally {
      setIsStreaming(false);
      setActiveTool(null);
      abortControllerRef.current = null;
    }
  }, [getToken, onError, queryClient, baseEndpoint, adminMode]);

  /** Cancel the current streaming request. */
  const cancelStream = useCallback(() => {
    abortControllerRef.current?.abort();
    setIsStreaming(false);
    setActiveTool(null);
  }, []);

  /** Clear all messages and state. */
  const clearMessages = useCallback(() => {
    setMessages([]);
    setError(null);
    setActiveTool(null);
    setThoughts([]);
    setShowContinue(false);
  }, []);

  /** Prepend older messages for pagination. */
  const prependMessages = useCallback((olderMessages: ChatMessage[]) => {
    setMessages((prev) => [...olderMessages, ...prev]);
  }, []);

  return {
    messages,
    isStreaming,
    error,
    activeTool,
    thoughts,
    showContinue,
    userChannels,
    setUserChannels,
    sendMessage,
    cancelStream,
    createConversation,
    listConversations,
    loadConversation,
    deleteConversation,
    clearMessages,
    prependMessages,
    fetchUserChannels,
    fetchAllChannels,
  };
}