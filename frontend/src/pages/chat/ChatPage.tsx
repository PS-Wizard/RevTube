import {
  Bot,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  History,
  Menu,
  MessageSquare,
  PanelLeft,
  PanelLeftClose,
  Plus,
  Search,
  Send,
  BrainCircuit,
  Globe,
  Square,
  Trash2,
  User,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/button";
import { Toggle, Tooltip } from "@/components/ui";
import { Badge } from "@/components/ui/badge";
import { Spinner } from "@/components/ui/Spinner";
import { Avatar, Box, Flex, Stack, Typography } from "@/components/ui";
import { ConfirmModal } from "@/components/ConfirmModal";
import { useChat, type ChatMessage, type Conversation, type UserChannel } from "@/hooks/useChat";
import { useAuth } from "@/hooks/useAuth";
import { useOrganization } from "@/contexts/OrganizationContext";
import { useDashboardStore } from "@/stores/dashboardStore";
import { ChatChart } from "@/components/chat/ChatChart";
import { ChatTable } from "@/components/chat/ChatTable";
import { ChatWorkbookExport } from "@/components/chat/ChatWorkbookExport";
import {
  ChatRoot,
  ChatOverlay,
  ChatSidebar,
  ChatSidebarHeader,
  ChatSidebarList,
  ChatSidebarItem,
  ChatMain,
  ChatMobileTopbar,
  ChatMessages,
  ChatEmptyState,
  MessageRow,
  MessageWrapper,
  MessageMeta,
  MessageBubble,
  ChatThinkingCard,
  ChatThinkingInner,
  ChatToolChip,
  ChatSkeletonGroup,
  ChatErrorBanner,
  ChatInputPanel,
  ChatInputWrapper,
  ChannelPill,
  ChatChannelSearchWrap,
} from "@/components/ui/chat";

const SIDEBAR_PAGE_LIMIT = 10;
const CHAT_MESSAGE_LIMIT = 10;
const CHANNELS_PER_PAGE = 8;

interface ChatPageProps {
  baseEndpoint?: string;
  mode?: "user" | "admin";
  className?: string;
}

export function ChatPage({ baseEndpoint = "/api/chat", mode = "user", className }: ChatPageProps) {
  const chat = useChat({
    onError: (err) => console.error("[Chat]", err),
    baseEndpoint,
    adminMode: mode === "admin",
  });

  const { user } = useAuth();
  const { currentOrganization } = useOrganization();
  const orgId = currentOrganization?.id;

  const dashboardChannelId = useDashboardStore((s) => s.channel.selectedChannel);
  const [selectedChannelId, setSelectedChannelId] = useState<string | null>(null);

  useEffect(() => {
    if (dashboardChannelId && !selectedChannelId) {
      setSelectedChannelId(dashboardChannelId);
    }
  }, [dashboardChannelId, selectedChannelId]);

  const loadAttemptsRef = useRef(0);
  const MAX_LOAD_ATTEMPTS = 3;

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [sidebarError, setSidebarError] = useState<string | null>(null);
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [inputValue, setInputValue] = useState("");
  const [sidebarLoading, setSidebarLoading] = useState(true);
  const [conversationLoading, setConversationLoading] = useState(false);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
  const [channelDialogOpen, setChannelDialogOpen] = useState(false);
  const [channelSearchQuery, setChannelSearchQuery] = useState("");
  const [channelPage, setChannelPage] = useState(0);
  const [allChannelsTotal, setAllChannelsTotal] = useState(0);
  // Admin-only kill-switch for the read-only DB SQL tool. Off by default:
  // the assistant only gets queryAnalyticsDb when the admin opts in.
  const [sqlToolEnabled, setSqlToolEnabled] = useState(false);

  const loadAdminChannels = useCallback(
    async (query: string, page: number) => {
      const { channels, total } = await chat.fetchAllChannels(query, CHANNELS_PER_PAGE, page * CHANNELS_PER_PAGE);
      chat.setUserChannels(channels);
      setAllChannelsTotal(total);
    },
    [chat],
  );

  const handleCloseChannelDialog = useCallback(() => {
    setChannelDialogOpen(false);
    setChannelSearchQuery("");
    setChannelPage(0);
  }, []);

  const [sidebarPage, setSidebarPage] = useState(1);
  const [sidebarTotal, setSidebarTotal] = useState(0);
  const [chatOffset, setChatOffset] = useState(0);
  const [chatTotalMessages, setChatTotalMessages] = useState(0);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [unreadMessagesCount, setUnreadMessagesCount] = useState(0);

  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const isUserScrollingRef = useRef(false);

  const fetchConversationsList = useCallback(
    async (page: number, orgIdOverride?: string) => {
      try {
        const offset = (page - 1) * SIDEBAR_PAGE_LIMIT;
        const { conversations: convs, totalCount } = await chat.listConversations(SIDEBAR_PAGE_LIMIT, offset, orgIdOverride || orgId);
        setConversations(convs);
        setSidebarTotal(totalCount);
      } catch (err) {
        console.error("[Chat] Failed to load conversations:", err);
      }
    },
    [chat, orgId],
  );

  const [deleteConfirmTarget, setDeleteConfirmTarget] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async function load() {
      loadAttemptsRef.current += 1;
      setSidebarLoading(true);
      setSidebarError(null);
      try {
        const { conversations: convs, totalCount } = await chat.listConversations(SIDEBAR_PAGE_LIMIT, 0, orgId);
        if (cancelled) return;
        setConversations(convs);
        setSidebarTotal(totalCount);
        if (convs.length > 0) {
          const firstId = convs[0].id;
          setActiveConversationId(firstId);
          const { totalMessages } = await chat.loadConversation(firstId, CHAT_MESSAGE_LIMIT, 0, orgId);
          if (cancelled) return;
          setChatTotalMessages(totalMessages);
          setChatOffset(0);
        }
        if (mode === "admin") {
          const { channels, total } = await chat.fetchAllChannels("", CHANNELS_PER_PAGE, 0);
          if (!cancelled) {
            chat.setUserChannels(channels);
            setAllChannelsTotal(total);
          }
        } else {
          let merged: UserChannel[] = [];
          if (orgId) {
            const [orgChannels, personalChannels] = await Promise.all([
              chat.fetchUserChannels(orgId),
              chat.fetchUserChannels(undefined).catch(() => [] as UserChannel[]),
            ]);
            const map = new Map<string, UserChannel>();
            orgChannels.forEach((ch) => {
              map.set(ch.channelId, { ...ch, owner: (ch as any).owner ?? { type: "org", orgId } });
            });
            personalChannels.forEach((ch) => {
              if (!map.has(ch.channelId)) {
                map.set(ch.channelId, { ...ch, owner: (ch as any).owner ?? { type: "user" } });
              } else {
                const existing = map.get(ch.channelId)!;
                (existing as any)._shared = true;
              }
            });
            merged = Array.from(map.values());
          } else {
            merged = await chat.fetchUserChannels(undefined);
          }
          if (!cancelled) chat.setUserChannels(merged);
        }
      } catch (err) {
        console.error("[Chat] Failed to load conversations on mount:", err);
        if (!cancelled) {
          setSidebarError("Failed to load conversations");
          if (loadAttemptsRef.current < MAX_LOAD_ATTEMPTS) {
            const delay = Math.min(1000 * Math.pow(2, loadAttemptsRef.current - 1), 5000);
            await new Promise((r) => setTimeout(r, delay));
            if (!cancelled) load();
          }
        }
      } finally {
        if (!cancelled) setSidebarLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [orgId]);

  const handleSidebarPageChange = useCallback(
    (newPage: number) => {
      setSidebarPage(newPage);
      fetchConversationsList(newPage);
    },
    [fetchConversationsList],
  );

  useEffect(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isNearBottom = container.scrollHeight - container.scrollTop - container.clientHeight < 150;
    if (isNearBottom || !isUserScrollingRef.current) {
      container.scrollTop = container.scrollHeight;
      setUnreadMessagesCount(0);
    } else if (chat.isStreaming) {
      setUnreadMessagesCount((prev) => prev + 1);
    }
  }, [chat.messages, chat.isStreaming, chat.thoughts]);

  const handleLoadOlderMessages = useCallback(async () => {
    if (loadingOlder || !activeConversationId || chat.messages.length >= chatTotalMessages) return;
    setLoadingOlder(true);
    const container = messagesContainerRef.current;
    const previousScrollHeight = container?.scrollHeight || 0;
    const previousScrollTop = container?.scrollTop || 0;
    try {
      const nextOffset = chatOffset + CHAT_MESSAGE_LIMIT;
      const { messages: olderMsgs } = await chat.loadConversation(activeConversationId, CHAT_MESSAGE_LIMIT, nextOffset, orgId);
      chat.prependMessages(olderMsgs);
      setChatOffset(nextOffset);
      requestAnimationFrame(() => {
        if (container) container.scrollTop = container.scrollHeight - previousScrollHeight + previousScrollTop;
      });
    } catch (err) {
      console.error("[Chat] Failed to load older messages:", err);
    } finally {
      setLoadingOlder(false);
    }
  }, [activeConversationId, chatOffset, chatTotalMessages, loadingOlder, chat, orgId]);

  const handleScroll = useCallback(() => {
    const container = messagesContainerRef.current;
    if (!container) return;
    const isScrolledUp = container.scrollHeight - container.scrollTop - container.clientHeight > 300;
    setShowScrollBottom(isScrolledUp);
    if (!isScrolledUp) setUnreadMessagesCount(0);
    isUserScrollingRef.current = isScrolledUp;
    if (container.scrollTop === 0 && chat.messages.length < chatTotalMessages && !loadingOlder) {
      void handleLoadOlderMessages();
    }
  }, [chatTotalMessages, chat.messages.length, loadingOlder, handleLoadOlderMessages]);

  const handleScrollToBottom = useCallback(() => {
    const container = messagesContainerRef.current;
    if (container) {
      container.scrollTo({ top: container.scrollHeight, behavior: "smooth" });
      setUnreadMessagesCount(0);
      isUserScrollingRef.current = false;
    }
  }, []);

  const handleNewConversation = useCallback(async () => {
    try {
      const id = await chat.createConversation(orgId);
      setActiveConversationId(id);
      chat.clearMessages();
      setChatOffset(0);
      setChatTotalMessages(0);
      setSidebarPage(1);
      await fetchConversationsList(1);
      setDrawerOpen(false);
      inputRef.current?.focus();
    } catch (err) {
      console.error("[Chat] Failed to create conversation:", err);
    }
  }, [chat, fetchConversationsList, orgId]);

  const handleSelectConversation = useCallback(
    async (id: string) => {
      if (chat.isStreaming) return;
      setActiveConversationId(id);
      setConversationLoading(true);
      chat.clearMessages();
      try {
        const { totalMessages } = await chat.loadConversation(id, CHAT_MESSAGE_LIMIT, 0, orgId);
        setChatTotalMessages(totalMessages);
        setChatOffset(0);
        setDrawerOpen(false);
      } catch (err) {
        console.error("[Chat] Failed to load conversation:", err);
      } finally {
        setConversationLoading(false);
      }
    },
    [chat, orgId],
  );

  const handleDeleteClick = useCallback((e: React.MouseEvent, id: string) => {
    e.stopPropagation();
    setDeleteConfirmTarget(id);
  }, []);

  const handleConfirmDelete = useCallback(async () => {
    const id = deleteConfirmTarget;
    if (!id) return;
    setDeleteConfirmTarget(null);
    try {
      await chat.deleteConversation(id, orgId);
      let nextPage = sidebarPage;
      if (conversations.length === 1 && sidebarPage > 1) {
        nextPage = sidebarPage - 1;
        setSidebarPage(nextPage);
      }
      await fetchConversationsList(nextPage);
      if (activeConversationId === id) {
        const remaining = conversations.filter((c) => c.id !== id);
        if (remaining.length > 0) {
          const newActiveId = remaining[0].id;
          setActiveConversationId(newActiveId);
          const { totalMessages } = await chat.loadConversation(newActiveId, CHAT_MESSAGE_LIMIT, 0, orgId);
          setChatTotalMessages(totalMessages);
          setChatOffset(0);
        } else {
          setActiveConversationId(null);
          chat.clearMessages();
          setChatOffset(0);
          setChatTotalMessages(0);
        }
      }
    } catch (err) {
      console.error("[Chat] Failed to delete conversation:", err);
    }
  }, [deleteConfirmTarget, activeConversationId, conversations, chat, sidebarPage, fetchConversationsList, orgId]);

  // Admin SQL kill-switch value shared by send + continue: toggle off means
  // the read-only DB tool stays out of the tool list for this conversation turn.
  const adminDisabledTools = mode === "admin" ? (sqlToolEnabled ? [] : ["queryAnalyticsDb"]) : undefined;

  const handleSend = useCallback(async () => {    const trimmed = inputValue.trim();
    if (!trimmed || chat.isStreaming) return;
    let convId = activeConversationId;
    if (!convId) {
      try {
        convId = await chat.createConversation(orgId);
        setActiveConversationId(convId);
      } catch (err) {
        console.error("[Chat] Failed to create conversation:", err);
        return;
      }
    }
    setInputValue("");
    // reset composer height without forcing sync layout
    if (inputRef.current) {
      requestAnimationFrame(() => {
        if (inputRef.current) inputRef.current.style.height = "auto";
      });
    }
    isUserScrollingRef.current = false;
    setChatOffset(0);
    await chat.sendMessage(
      trimmed,
      convId,
      selectedChannelId || undefined,
      orgId,
      { disabledTools: adminDisabledTools },
    );
    await fetchConversationsList(sidebarPage);
  }, [inputValue, activeConversationId, chat, selectedChannelId, sidebarPage, fetchConversationsList, orgId, adminDisabledTools]);

  // Resumes a cut-off answer in the same conversation: history (incl. prior
  // tool results context) is reused, so the model picks up where it stopped.
  const handleContinue = useCallback(async () => {
    if (!activeConversationId || chat.isStreaming) return;
    await chat.sendMessage(
      "Continue from where you left off.",
      activeConversationId,
      selectedChannelId || undefined,
      orgId,
      { disabledTools: adminDisabledTools },
    );
    await fetchConversationsList(sidebarPage);
  }, [activeConversationId, chat, selectedChannelId, orgId, adminDisabledTools, sidebarPage, fetchConversationsList]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
    },
    [handleSend],
  );

  // rAF-batched auto-grow: avoids forced sync layout on every keystroke
  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const val = e.target.value;
    if (val.length > 500) return;
    setInputValue(val);
    const el = inputRef.current;
    if (!el) return;
    // read/write separated in rAF to prevent continuous reflow
    requestAnimationFrame(() => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    });
  }, []);

  // when inputValue is set programmatically (suggested prompts, clear after send), sync height in rAF
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    requestAnimationFrame(() => {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 180)}px`;
    });
  }, [inputValue]);

  const markdownComponents: Components = useMemo(
    () => ({
      a: ({ href, children }: { href?: string; children?: React.ReactNode }) => (
        <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: "var(--primary)", textDecoration: "underline", textUnderlineOffset: 2 }}>
          {children}
        </a>
      ),
      table: ({ children }) => <ChatTable>{children}</ChatTable>,
      code: ({ className, children, ...props }: { className?: string; children?: React.ReactNode }) => {
        const isInline = !className;
        if (isInline)
          return (
            <code
              {...props}
              style={{ background: "var(--muted)", padding: "2px 4px", borderRadius: 6, fontFamily: "monospace", fontSize: 12, color: "var(--destructive)" }}
            >
              {children}
            </code>
          );
        return (
          <Box component="pre" sx={{ my: 1.5, overflowX: "auto", borderRadius: 8, border: "1px solid var(--border)", background: "var(--muted)", p: 2 }}>
            <code style={{ fontFamily: "monospace", fontSize: 13 }} className={className} {...props}>
              {children}
            </code>
          </Box>
        );
      },
    }),
    [],
  );

  const renderMessage = useCallback(
    (msg: ChatMessage, index: number) => {
      const isUser = msg.role === "user";
      const isLast = index === chat.messages.length - 1;
      const showStreaming = isLast && msg.role === "assistant" && chat.isStreaming;
      if (showStreaming && !msg.content?.trim()) return null;
      let senderLabel = isUser ? "You" : "Assistant";
      if (isUser && msg.userName) {
        const isMe = user?.uid && msg.userId === user.uid;
        senderLabel = isMe ? "You" : msg.userName;
      }
      return (
        <MessageRow
          key={`${msg.role}-${index}-${msg.content?.slice(0, 20)}`}
          isUser={isUser}
          isStreaming={showStreaming}
          style={{ animationDelay: `${Math.min(index * 28, 160)}ms` } as React.CSSProperties}
        >
          <MessageWrapper>
            <MessageMeta isUser={isUser}>
              <Box component="span" sx={{ display: "inline-flex", opacity: 0.8 }}>
                {isUser ? <User size={13} /> : <Bot size={13} />}
              </Box>
              <span>{senderLabel}</span>
            </MessageMeta>
            <MessageBubble isUser={isUser} isStreaming={showStreaming}>
              {isUser ? (
                msg.content
              ) : (
                <>
                  {msg.content ? (
                    <Box sx={{ fontSize: 14, lineHeight: 1.6 }}>
                      <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
                        {msg.content || ""}
                      </ReactMarkdown>
                    </Box>
                  ) : (
                    <Box component="span" sx={{ opacity: 0.35 }}>
                      —
                    </Box>
                  )}
                  {msg.chart && <ChatChart spec={msg.chart} />}
                  {!showStreaming && <ChatWorkbookExport content={msg.content || ""} />}
                </>
              )}
              {showStreaming && msg.content && (
                <Box component="span" sx={{ ml: 0.5, display: "inline-block", width: 2, height: 18, background: "var(--primary)", borderRadius: 999, verticalAlign: -2 }} />
              )}
            </MessageBubble>
          </MessageWrapper>
        </MessageRow>
      );
    },
    [chat.isStreaming, chat.messages.length, markdownComponents, user?.uid],
  );

  // Isolate heavy message list: typing (inputValue) no longer re-renders all bubbles
  const MemoizedMessages = useMemo(() => chat.messages.map((m, i) => renderMessage(m, i)), [chat.messages, renderMessage]);

  const totalPages = useMemo(() => Math.ceil(sidebarTotal / SIDEBAR_PAGE_LIMIT) || 1, [sidebarTotal]);

  return (
    <ChatRoot mode={mode} className={className}>
      <ChatOverlay open={drawerOpen} onClick={() => setDrawerOpen(false)} />

      <ChatSidebar collapsed={sidebarCollapsed} drawerOpen={drawerOpen}>
        <ChatSidebarHeader>
          <Button variant="ghost" size="icon-sm" onClick={() => setSidebarCollapsed((p) => !p)} aria-label={sidebarCollapsed ? "Expand sidebar" : "Collapse sidebar"}>
            {sidebarCollapsed ? <PanelLeft size={18} /> : <PanelLeftClose size={18} />}
          </Button>
          <Box sx={{ display: { xs: "block", md: "none" } }}>
            <Button variant="ghost" size="icon-sm" onClick={() => setDrawerOpen(false)} aria-label="Close sidebar">
              <PanelLeftClose size={18} />
            </Button>
          </Box>
        </ChatSidebarHeader>

        {!sidebarCollapsed && (
          <>
            <ChatSidebarList>
              {sidebarError && !sidebarLoading ? (
                <Stack gap={1} sx={{ alignItems: "center", p: 2, textAlign: "center" }}>
                  <Box component="span" sx={{ color: "var(--destructive)", fontSize: 14 }}>
                    {sidebarError}
                  </Box>
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      loadAttemptsRef.current = 0;
                      fetchConversationsList(1);
                      setSidebarError(null);
                    }}
                  >
                    Retry
                  </Button>
                </Stack>
              ) : sidebarLoading ? (
                <Flex gap={1} sx={{ justifyContent: "center", p: 3 }}>
                  <Spinner size="sm" />
                </Flex>
              ) : conversations.length === 0 ? (
                <Stack gap={1} sx={{ alignItems: "center", p: 3, textAlign: "center", color: "var(--muted-foreground)", fontSize: 14 }}>
                  <MessageSquare size={24} strokeWidth={1.25} style={{ opacity: 0.4 }} />
                  <span>No chats yet</span>
                  <Box component="span" sx={{ fontSize: 11 }}>
                    Click &quot;New Chat&quot; to start
                  </Box>
                </Stack>
              ) : (
                <Stack gap={0}>
                  {conversations.map((conv) => (
                    <ChatSidebarItem
                      key={conv.id}
                      active={conv.id === activeConversationId}
                      onClick={() => handleSelectConversation(conv.id)}
                    >
                      <Box component="span" sx={{ color: conv.id === activeConversationId ? "var(--primary)" : "var(--muted-foreground)", display: "inline-flex" }}>
                        <MessageSquare size={15} />
                      </Box>
                      <Stack gap={0} sx={{ flex: 1, minWidth: 0, alignItems: "flex-start" }}>
                        <Box component="span" sx={{ fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", width: "100%" }}>
                          {conv.title || "New conversation"}
                        </Box>
                        <Flex gap={1} sx={{ justifyContent: "space-between", width: "100%", fontSize: 11, color: "var(--muted-foreground)" }}>
                          <span>{conv.messageCount} messages</span>
                          <span>{new Date(conv.updatedAt).toLocaleDateString()}</span>
                        </Flex>
                      </Stack>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        onClick={(e) => handleDeleteClick(e, conv.id)}
                        disabled={chat.isStreaming}
                        aria-label="Delete chat"
                      >
                        <Trash2 size={13} />
                      </Button>
                    </ChatSidebarItem>
                  ))}
                </Stack>
              )}
            </ChatSidebarList>

            {sidebarTotal > SIDEBAR_PAGE_LIMIT && (
              <Flex gap={1} sx={{ alignItems: "center", justifyContent: "space-between", borderTop: "1px solid var(--border)", p: 1.5 }}>
                <Button variant="ghost" size="sm" sx={{ flex: 1 }} onClick={() => handleSidebarPageChange(sidebarPage - 1)} disabled={sidebarPage === 1 || chat.isStreaming}>
                  <ChevronLeft size={16} />
                </Button>
                <Box component="span" sx={{ fontSize: 12, color: "var(--muted-foreground)", whiteSpace: "nowrap" }}>
                  Page {sidebarPage} of {totalPages}
                </Box>
                <Button variant="ghost" size="sm" sx={{ flex: 1 }} onClick={() => handleSidebarPageChange(sidebarPage + 1)} disabled={sidebarPage === totalPages || chat.isStreaming}>
                  <ChevronRight size={16} />
                </Button>
              </Flex>
            )}

            <Box sx={{ borderTop: "1px solid var(--border)", p: 1.5 }}>
              <Button variant="secondary" size="sm" sx={{ width: "100%" }} onClick={handleNewConversation} disabled={chat.isStreaming}>
                <Plus size={16} /> New Chat
              </Button>
            </Box>
          </>
        )}
      </ChatSidebar>

      <ChatMain>
        <ChatMobileTopbar>
          <Button variant="ghost" size="icon-sm" onClick={() => setDrawerOpen(true)} aria-label="Open conversations">
            <Menu size={20} />
          </Button>
          <Box component="span" sx={{ flex: 1, minWidth: 0, textAlign: "center", fontSize: 14, fontWeight: 600, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
            {activeConversationId ? conversations.find((c) => c.id === activeConversationId)?.title || "Conversation" : "AI Chat"}
          </Box>
          <Button variant="ghost" size="icon-sm" onClick={handleNewConversation} disabled={chat.isStreaming} aria-label="New Chat">
            <Plus size={20} />
          </Button>
        </ChatMobileTopbar>

        <ChatMessages ref={messagesContainerRef as any} onScroll={handleScroll}>
          {conversationLoading ? (
            <Stack gap={1.5} sx={{ flex: 1, alignItems: "center", justifyContent: "center", color: "var(--muted-foreground)" }}>
              <Spinner size="lg" />
              <Box component="span" sx={{ fontSize: 14 }}>
                Loading messages...
              </Box>
            </Stack>
          ) : !activeConversationId ? (
            <ChatEmptyState>
              <BrainCircuit size={48} style={{ color: "var(--primary)", opacity: 0.6 }} />
              <Box component="h2" sx={{ fontSize: 20, fontWeight: 700 }}>
                {mode === "admin" ? "Admin AI Assistant" : "AI Analytics Assistant"}
              </Box>
              <Box component="p" sx={{ fontSize: 14, color: "var(--muted-foreground)" }}>
                {mode === "admin"
                  ? "Full-capability AI assistant with all tools including recommendations and strategic suggestions. Ask me anything:"
                  : "Ask me anything about your YouTube analytics. For example:"}
              </Box>
              <Flex gap={1} sx={{ flexWrap: "wrap", justifyContent: "center", mt: 1 }}>
                {(mode === "admin"
                  ? ["Show me an overview of all channels", "What are the best posting times for my channels?", "Compare top performing channels", "Suggest content strategies for growth"]
                  : ["Show me my channel overview", "How did my last 10 videos perform?", "What's my best time to post?", "Compare my best and worst performing videos"]
                ).map((q) => (
                  <Button
                    key={q}
                    variant="outline"
                    size="sm"
                    style={{ maxWidth: "100%", whiteSpace: "normal", textAlign: "center" }}
                    onClick={() => {
                      setInputValue(q);
                      inputRef.current?.focus();
                    }}
                  >
                    {q}
                  </Button>
                ))}
              </Flex>
            </ChatEmptyState>
          ) : (
            <>
              {chatTotalMessages > CHAT_MESSAGE_LIMIT && chat.messages.length < chatTotalMessages && (
                <Flex sx={{ justifyContent: "center", py: 1 }}>
                  <Button variant="secondary" size="sm" onClick={handleLoadOlderMessages} disabled={loadingOlder}>
                    {loadingOlder ? <Spinner size="xs" /> : <History size={13} />}
                    {loadingOlder ? "Loading..." : "Load older messages"}
                  </Button>
                </Flex>
              )}
              {MemoizedMessages}
              {chat.isStreaming &&
                (() => {
                  const last = chat.messages[chat.messages.length - 1];
                  const waiting = last?.role === "assistant" && !last.content?.trim();
                  const hasThought = chat.thoughts.length > 0 && !!chat.thoughts[0]?.content?.trim();
                  const hasTool = !!chat.activeTool;
                  if (hasThought) {
                    return (
                      <ChatThinkingCard>
                        <ChatThinkingInner>
                          <Flex gap={1} sx={{ alignItems: "center", borderBottom: "1px solid var(--border)", background: "var(--muted)", px: 1.5, py: 1, fontSize: 11, fontWeight: 600, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--muted-foreground)" }}>
                            <Box component="span" sx={{ width: 18, height: 18, borderRadius: 999, background: "var(--primary)", opacity: 0.1, color: "var(--primary)", display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                              <BrainCircuit size={12} />
                            </Box>
                            Thinking
                          </Flex>
                          <Box sx={{ px: 2, py: 1.5, fontSize: 14, whiteSpace: "pre-wrap", wordBreak: "break-word" }}>{chat.thoughts[0].content}</Box>
                        </ChatThinkingInner>
                      </ChatThinkingCard>
                    );
                  }
                  if (hasTool) {
                    return (
                      <ChatToolChip>
                        <Box component="span" sx={{ width: 12, height: 12, borderRadius: 999, border: "2px solid var(--border)", borderTopColor: "var(--primary)" }} />
                        <Box component="span" sx={{ fontWeight: 500 }}>
                          Gathering your data
                        </Box>
                      </ChatToolChip>
                    );
                  }
                  if (waiting) {
                    return (
                      <ChatSkeletonGroup>
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 8, border: "1px solid var(--border)", borderRadius: 12, p: 2 }}>
                          <Box sx={{ height: 10, width: "84%", borderRadius: 999, background: "var(--muted)" }} />
                          <Box sx={{ height: 10, width: "96%", borderRadius: 999, background: "var(--muted)" }} />
                          <Box sx={{ height: 10, width: "72%", borderRadius: 999, background: "var(--muted)" }} />
                        </Box>
                        <Flex gap={1} sx={{ alignItems: "center", px: 0.5, fontSize: 14, color: "var(--muted-foreground)" }}>
                          <Box component="span" sx={{ width: 8, height: 8, borderRadius: 999, background: "var(--primary)" }} />
                          Analyzing your data
                        </Flex>
                      </ChatSkeletonGroup>
                    );
                  }
                  return null;
                })()}
            </>
          )}
        </ChatMessages>

        {showScrollBottom && (
          <Box sx={{ position: "absolute", bottom: 96, right: 24, zIndex: 10 }}>
            <Button variant="secondary" size="icon" onClick={handleScrollToBottom} aria-label="Scroll to bottom">
              <ChevronDown size={20} />
              {unreadMessagesCount > 0 && (
                <Box component="span" sx={{ position: "absolute", top: -4, right: -4, width: 16, height: 16, borderRadius: 999, background: "var(--primary)", color: "var(--primary-foreground)", fontSize: 10, fontWeight: 700, display: "inline-flex", alignItems: "center", justifyContent: "center" }}>
                  {unreadMessagesCount}
                </Box>
              )}
            </Button>
          </Box>
        )}

        {chat.error && <ChatErrorBanner>{chat.error}</ChatErrorBanner>}

        {chat.showContinue && !chat.isStreaming && activeConversationId && (
          <Flex sx={{ justifyContent: "center", pb: 1 }}>
            <Button variant="outline" size="sm" onClick={handleContinue}>
              Continue
            </Button>
          </Flex>
        )}

        <ChatInputPanel>
          {mode === "admin" && (
            <Flex wrap gap={2} alignItems="center" sx={{ pb: 1.5 }}>
              <Toggle
                checked={sqlToolEnabled}
                onChange={setSqlToolEnabled}
                disabled={chat.isStreaming}
                ariaLabel="Enable direct database SQL tool"
                label="Direct DB SQL"
              />
              <Typography variant="caption">
                Lets the assistant run read-only SELECTs over the analytics tables for complex queries.
              </Typography>
            </Flex>
          )}
          <ChatInputWrapper>
            {chat.userChannels.length > 0 &&
              (() => {
                const selectedCh = chat.userChannels.find((ch) => ch.channelId === selectedChannelId);
                const displayChannel: UserChannel | null = selectedCh || (selectedChannelId ? { channelId: selectedChannelId, channelTitle: null } : null);
                return (
                  <Box sx={{ display: "flex", alignItems: "center", flexShrink: 0 }}>
                    {/* Circular avatar chooser: 40px instead of the ~150px
                        pill. Details via tooltip (desktop) / long-press
                        (touch); tap opens the channel dialog below. */}
                    <Tooltip
                      title={
                        displayChannel
                          ? `Chatting as ${displayChannel.channelTitle || displayChannel.channelId} — tap avatar to switch channel`
                          : "No channel selected — tap avatar to choose"
                      }
                    >
                      <button
                        type="button"
                        onClick={() => setChannelDialogOpen(true)}
                        disabled={chat.isStreaming}
                        aria-label={
                          displayChannel
                            ? `Chat channel: ${displayChannel.channelTitle || displayChannel.channelId}. Activate to switch channel.`
                            : "Choose chat channel"
                        }
                        title={displayChannel ? displayChannel.channelTitle || displayChannel.channelId || "Channel" : "All channels"}
                        className="h-10 w-10 shrink-0 rounded-full transition-transform hover:scale-105 disabled:opacity-50"
                      >
                        <Avatar
                          size="lg"
                          src={displayChannel?.thumbnailUrl || undefined}
                          alt={displayChannel?.channelTitle || "Channel"}
                        >
                          {displayChannel ? (
                            (displayChannel.channelTitle || "C").slice(0, 1).toUpperCase()
                          ) : (
                            <Globe size={14} />
                          )}
                        </Avatar>
                      </button>
                    </Tooltip>

                    <Modal open={channelDialogOpen} onClose={handleCloseChannelDialog} title="Select Channel" maxWidth="sm">
                      <ChatChannelSearchWrap>
                        <Search size={13} style={{ position: "absolute", left: 10, color: "var(--muted-foreground)", pointerEvents: "none" }} />
                        <Box
                          component="input"
                          placeholder="Filter channels..."
                          value={channelSearchQuery}
                          onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
                            const val = e.target.value;
                            setChannelSearchQuery(val);
                            setChannelPage(0);
                            if (mode === "admin") void loadAdminChannels(val, 0);
                          }}
                          sx={{ width: "100%", border: "1px solid var(--border)", borderRadius: 8, background: "var(--background)", py: 0.75, pl: 4, pr: 1, fontSize: 14, outline: "none" } as any}
                        />
                      </ChatChannelSearchWrap>
                      {(() => {
                        const isAdminMode = mode === "admin";
                        const itemSource = isAdminMode
                          ? chat.userChannels
                          : chat.userChannels.filter((ch) => !channelSearchQuery || (ch.channelTitle || "").toLowerCase().includes(channelSearchQuery.toLowerCase()));
                        const totalCount = isAdminMode ? allChannelsTotal : itemSource.length;
                        const totalPages = Math.ceil(totalCount / CHANNELS_PER_PAGE);
                        const pageItems = isAdminMode ? itemSource : itemSource.slice(channelPage * CHANNELS_PER_PAGE, (channelPage + 1) * CHANNELS_PER_PAGE);
                        return (
                          <Stack gap={0.5}>
                            <Box
                              component="button"
                              onClick={() => {
                                setSelectedChannelId(null);
                                handleCloseChannelDialog();
                              }}
                              sx={{
                                display: "flex",
                                alignItems: "center",
                                gap: 1.5,
                                width: "100%",
                                borderRadius: 8,
                                px: 1.5,
                                py: 1,
                                fontSize: 14,
                                textAlign: "left",
                                cursor: "pointer",
                                background: !selectedChannelId ? "var(--muted)" : "transparent",
                                color: !selectedChannelId ? "var(--primary)" : "inherit",
                                fontWeight: !selectedChannelId ? 500 : 400,
                              }}
                            >
                              <ChannelPill>
                                <Globe size={11} />
                              </ChannelPill>
                              All Channels
                            </Box>
                            {pageItems.map((ch) => (
                              <Box
                                key={ch.channelId}
                                component="button"
                                onClick={() => {
                                  setSelectedChannelId(ch.channelId);
                                  handleCloseChannelDialog();
                                }}
                                sx={{
                                  display: "flex",
                                  alignItems: "center",
                                  gap: 1.5,
                                  width: "100%",
                                  borderRadius: 8,
                                  px: 1.5,
                                  py: 1,
                                  fontSize: 14,
                                  textAlign: "left",
                                  cursor: "pointer",
                                  background: ch.channelId === selectedChannelId ? "var(--muted)" : "transparent",
                                  color: ch.channelId === selectedChannelId ? "var(--primary)" : "inherit",
                                  fontWeight: ch.channelId === selectedChannelId ? 500 : 400,
                                }}
                              >
                                {ch.thumbnailUrl ? (
                                  <Box component="img" src={ch.thumbnailUrl} alt="" sx={{ width: 20, height: 20, borderRadius: 999, objectFit: "cover" }} />
                                ) : (
                                  <ChannelPill>{(ch.channelTitle || "C").slice(0, 1).toUpperCase()}</ChannelPill>
                                )}
                                <Box component="span" sx={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                                  {ch.channelTitle}
                                </Box>
                                {(ch.owner || (ch as any)._shared) && (
                                  <Badge variant="outline">{(ch as any)._shared ? "Org • You" : ch.owner?.type === "org" ? "Org" : "You"}</Badge>
                                )}
                              </Box>
                            ))}
                            {totalPages > 1 && (
                              <Flex gap={1} sx={{ alignItems: "center", justifyContent: "center", borderTop: "1px solid var(--border)", pt: 1, mt: 1 }}>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={channelPage === 0}
                                  onClick={() => {
                                    const next = channelPage - 1;
                                    setChannelPage(next);
                                    if (isAdminMode) void loadAdminChannels(channelSearchQuery, next);
                                  }}
                                >
                                  <ChevronLeft size={13} />
                                </Button>
                                <Box component="span" sx={{ fontSize: 12, color: "var(--muted-foreground)" }}>
                                  {channelPage * CHANNELS_PER_PAGE + 1}–{Math.min((channelPage + 1) * CHANNELS_PER_PAGE, totalCount)} / {totalCount}
                                </Box>
                                <Button
                                  variant="ghost"
                                  size="icon-xs"
                                  disabled={channelPage >= totalPages - 1}
                                  onClick={() => {
                                    const next = channelPage + 1;
                                    setChannelPage(next);
                                    if (isAdminMode) void loadAdminChannels(channelSearchQuery, next);
                                  }}
                                >
                                  <ChevronRight size={13} />
                                </Button>
                              </Flex>
                            )}
                          </Stack>
                        );
                      })()}
                    </Modal>
                  </Box>
                );
              })()}

            <Box
              component="textarea"
              ref={inputRef}
              placeholder="Ask about your analytics..."
              rows={1}
              value={inputValue}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown as any}
              disabled={chat.isStreaming}
              maxLength={500}
              aria-label="Type your message here"
              sx={{
                flex: 1,
                minHeight: 56,
                maxHeight: 180,
                background: "transparent",
                border: "none",
                outline: "none",
                resize: "none",
                fontSize: 15,
                fontWeight: 500,
                lineHeight: 1.6,
                py: 1,
              }}
            />
            <Box component="span" sx={{ fontSize: 11, color: inputValue.length >= 500 ? "var(--destructive)" : "var(--muted-foreground)", fontWeight: inputValue.length >= 500 ? 600 : 400, alignSelf: "flex-end", pb: 0.5 }}>
              {inputValue.length}/500
            </Box>
            {chat.isStreaming ? (
              <Button variant="destructive" size="icon" onClick={chat.cancelStream} title="Cancel stream">
                <Square size={16} strokeWidth={2.5} />
              </Button>
            ) : (
              <Button variant="default" size="icon" onClick={handleSend} disabled={!inputValue.trim()} title="Send message">
                <Send size={16} strokeWidth={2.5} />
              </Button>
            )}
          </ChatInputWrapper>
        </ChatInputPanel>
      </ChatMain>

      <ConfirmModal
        isOpen={deleteConfirmTarget !== null}
        title="Delete Conversation"
        message="Are you sure you want to delete this conversation permanently? This action cannot be undone."
        confirmLabel="Delete"
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteConfirmTarget(null)}
      />
    </ChatRoot>
  );
}
