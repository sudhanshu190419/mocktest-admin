'use client';

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { useAuth } from '@/context/AuthContext';
import { liveChatService } from '@/services/liveChatService';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { X } from '@phosphor-icons/react';
import type { ConversationWithDetails, Message, TeacherConversationItem } from '@/types/liveChat';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatRelativeTime(isoString: string): string {
  const now = Date.now();
  const then = new Date(isoString).getTime();
  const diffMs = now - then;
  const diffSec = Math.floor(diffMs / 1000);

  if (diffSec < 60) return 'Just now';
  if (diffSec < 3600) return `${Math.floor(diffSec / 60)} min ago`;
  if (diffSec < 86400) return `${Math.floor(diffSec / 3600)}h ago`;
  if (diffSec < 604800) return `${Math.floor(diffSec / 86400)}d ago`;
  return new Date(isoString).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  });
}

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((part) => part.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatMessageTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function useDebounce<T>(value: T, delayMs: number): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delayMs);
    return () => clearTimeout(timer);
  }, [value, delayMs]);
  return debounced;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface LiveClassChatPanelProps {
  classId: string;
  liveClassName: string;
  isOpen: boolean;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function LiveClassChatPanel({
  classId,
  liveClassName,
  isOpen,
  onClose,
}: LiveClassChatPanelProps) {
  const { user } = useAuth();
  const currentProfileId = user?.id ?? null;

  // ── State ─────────────────────────────────────────────────────────
  const [activeConversationId, setActiveConversationId] = useState<string | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [realtimeMessages, setRealtimeMessages] = useState<Message[]>([]);
  const unsubscribeRef = useRef<(() => void) | null>(null);

  const debouncedSearch = useDebounce(searchTerm, 300);
  const [messageText, setMessageText] = useState('');

  // Reset state when classId changes
  useEffect(() => {
    setActiveConversationId(null);
    setSearchTerm('');
    setRealtimeMessages([]);
  }, [classId]);

  // ── Fetch Conversations ───────────────────────────────────────────
  const {
    data: conversationsData,
    isLoading: loadingConversations,
    error: conversationsError,
    refetch: refetchConversations,
  } = useQuery({
    queryKey: ['live-chat', 'conversations', classId],
    queryFn: async () => {
      if (!classId) return [];
      const result = await liveChatService.getTeacherConversations(classId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load conversations');
      }
      return result.data as TeacherConversationItem[];
    },
    enabled: !!classId,
    staleTime: 10_000,
  });

  const conversations = conversationsData ?? [];

  // ── Search ─────────────────────────────────────────────────────────
  const {
    data: searchResults,
    isLoading: searching,
  } = useQuery({
    queryKey: ['live-chat', 'search', classId, debouncedSearch],
    queryFn: async () => {
      if (!classId || debouncedSearch.length < 2) return null;
      const result = await liveChatService.searchStudents(classId, debouncedSearch);
      if (!result.success) {
        throw new Error(result.error ?? 'Search failed');
      }
      return result.data as TeacherConversationItem[];
    },
    enabled: !!classId && debouncedSearch.length >= 2,
    staleTime: 5_000,
  });

  const displayed = searchResults ?? conversations;

  // ── Fetch Conversation Details ─────────────────────────────────────
  const {
    data: convDetails,
    isLoading: loadingConvDetails,
  } = useQuery({
    queryKey: ['live-chat', 'conversation', activeConversationId],
    queryFn: async () => {
      if (!activeConversationId) return null;
      const result = await liveChatService.getConversation(activeConversationId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load conversation');
      }
      return result.data as ConversationWithDetails;
    },
    enabled: !!activeConversationId,
    staleTime: 60_000,
  });

  // ── Fetch Messages ────────────────────────────────────────────────
  const {
    data: messagesData,
    isLoading: loadingMessages,
    error: messagesError,
    refetch: refetchMessages,
  } = useQuery({
    queryKey: ['live-chat', 'messages', activeConversationId],
    queryFn: async () => {
      if (!activeConversationId) return [];
      const result = await liveChatService.getConversationMessages(activeConversationId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to load messages');
      }
      return result.data as Message[];
    },
    enabled: !!activeConversationId,
    staleTime: 0,
  });

  // Reset realtime messages on conversation switch
  useEffect(() => {
    setRealtimeMessages([]);
  }, [activeConversationId]);

  // ── Realtime Subscription ─────────────────────────────────────────
  useEffect(() => {
    if (unsubscribeRef.current) {
      unsubscribeRef.current();
      unsubscribeRef.current = null;
    }
    if (!activeConversationId) return;

    const subscription = liveChatService.subscribeToMessages(
      activeConversationId,
      (message: Message) => {
        setRealtimeMessages((prev) => [...prev, message]);
      },
    );
    unsubscribeRef.current = subscription.unsubscribe;

    return () => {
      if (unsubscribeRef.current) {
        unsubscribeRef.current();
        unsubscribeRef.current = null;
      }
    };
  }, [activeConversationId]);

  // Combine messages
  const allMessages = useMemo(() => {
    const fetched = messagesData ?? [];
    if (realtimeMessages.length === 0) return fetched;

    const seenIds = new Set<string>();
    const combined: Message[] = [];
    for (const msg of [...fetched, ...realtimeMessages]) {
      if (!seenIds.has(msg.messageId)) {
        seenIds.add(msg.messageId);
        combined.push(msg);
      }
    }
    return combined.sort(
      (a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime(),
    );
  }, [messagesData, realtimeMessages]);

  // ── Send Message ──────────────────────────────────────────────────
  const sendMessageMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!activeConversationId) throw new Error('No active conversation');
      const result = await liveChatService.sendMessage({
        conversationId: activeConversationId,
        message: text,
      });
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to send message');
      }
      return result.data as Message;
    },
    onSuccess: (sentMsg) => {
      if (sentMsg) {
        setRealtimeMessages((prev) => [...prev, sentMsg]);
      }
    },
  });

  const handleSend = useCallback(() => {
    const trimmed = messageText.trim();
    if (!trimmed || !activeConversationId) return;
    sendMessageMutation.mutate(trimmed);
    setMessageText('');
  }, [messageText, activeConversationId, sendMessageMutation]);

  // Auto-scroll ref
  const messagesEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  // ── Render ────────────────────────────────────────────────────────
  if (!isOpen) return null;

  return (
    <div className="flex h-full flex-col border-l border-gray-200 bg-white dark:border-gray-800 dark:bg-gray-950">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-100 px-4 py-3 dark:border-gray-800">
        <div>
          <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
            Live Chat
          </h3>
          <p className="text-xs text-gray-500 dark:text-gray-400">{liveClassName}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800"
        >
          <X size={18} />
        </button>
      </div>

      {/* Conversation list or active chat */}
      <div className="flex flex-1 overflow-hidden">
        {/* Left: Conversation list */}
        <div className="flex w-56 flex-shrink-0 flex-col border-r border-gray-100 dark:border-gray-800">
          {/* Search */}
          <div className="border-b border-gray-100 p-2 dark:border-gray-800">
            <div className="relative">
              <input
                type="text"
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                placeholder="Search..."
                className="w-full rounded-lg border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-2 text-xs text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
              />
              <svg
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
                fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor"
              >
                <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
              </svg>
            </div>
          </div>

          {/* Student list */}
          <div className="flex-1 overflow-y-auto">
            {loadingConversations || searching ? (
              <div className="space-y-1 p-2">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-1 py-1.5">
                    <Skeleton className="h-6 w-6 rounded-full" />
                    <Skeleton className="h-3 flex-1" />
                  </div>
                ))}
              </div>
            ) : conversationsError ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="text-xs text-red-500">Failed to load</p>
                <button
                  type="button"
                  onClick={() => refetchConversations()}
                  className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
                >
                  Retry
                </button>
              </div>
            ) : displayed.length === 0 ? (
              <div className="flex flex-col items-center justify-center p-4 text-center">
                <svg className="mb-2 h-8 w-8 text-gray-300" fill="none" viewBox="0 0 24 24" strokeWidth={1} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242" />
                </svg>
                <p className="text-xs text-gray-400">
                  {searchTerm ? 'No results' : 'No chats yet'}
                </p>
              </div>
            ) : (
              <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
                {displayed.map((conv) => (
                  <button
                    key={conv.conversationId}
                    type="button"
                    onClick={() => {
                      setActiveConversationId(conv.conversationId);
                      setSearchTerm('');
                    }}
                    className={`flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/30 ${
                      conv.conversationId === activeConversationId
                        ? 'bg-blue-50 dark:bg-blue-900/20'
                        : ''
                    }`}
                  >
                    <div
                      className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-semibold ${
                        conv.conversationId === activeConversationId
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300'
                      }`}
                    >
                      {getInitials(conv.studentName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-medium text-gray-900 dark:text-gray-100">
                          {conv.studentName}
                        </span>
                        <span className="flex-shrink-0 text-[10px] text-gray-400">
                          {formatRelativeTime(conv.lastMessageAt)}
                        </span>
                      </div>
                      <p className="truncate text-[11px] text-gray-500 dark:text-gray-400">
                        {conv.lastMessage ?? 'No messages'}
                      </p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Right: Chat messages */}
        <div className="flex flex-1 flex-col">
          {!activeConversationId ? (
            <div className="flex h-full flex-col items-center justify-center px-4 text-center">
              <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-xl bg-blue-50 dark:bg-blue-900/20">
                <svg className="h-6 w-6 text-blue-500" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
                </svg>
              </div>
              <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                Select a student
              </h4>
              <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">
                Choose a student to start chatting
              </p>
            </div>
          ) : loadingMessages || loadingConvDetails ? (
            <div className="flex flex-1 flex-col">
              <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                <Skeleton className="h-7 w-7 rounded-full" />
                <Skeleton className="h-3.5 w-28" />
              </div>
              <div className="flex-1 space-y-3 overflow-y-auto p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                    <div className={`rounded-2xl px-3 py-2 ${i % 2 === 0 ? 'w-2/3' : 'w-1/2'}`}>
                      <Skeleton className="h-2.5 w-full" />
                      <Skeleton className="mt-1.5 h-2.5 w-2/3" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : messagesError && allMessages.length === 0 ? (
            <div className="flex h-full flex-col items-center justify-center gap-2 px-4">
              <p className="text-xs text-red-500">Failed to load messages</p>
              <button
                type="button"
                onClick={() => refetchMessages()}
                className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white"
              >
                Retry
              </button>
            </div>
          ) : (
            <>
              {/* Chat header */}
              {convDetails && (
                <div className="flex items-center gap-2 border-b border-gray-100 px-4 py-3 dark:border-gray-800">
                  <div className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-[10px] font-semibold text-white">
                    {getInitials(convDetails.studentName)}
                  </div>
                  <div className="min-w-0 flex-1">
                    <h4 className="truncate text-xs font-semibold text-gray-900 dark:text-gray-100">
                      {convDetails.studentName}
                    </h4>
                  </div>
                </div>
              )}

              {/* Messages */}
              <div className="flex-1 overflow-y-auto py-2">
                {allMessages.length === 0 ? (
                  <div className="flex h-full flex-col items-center justify-center px-4 text-center">
                    <p className="text-xs text-gray-400">No messages yet</p>
                  </div>
                ) : (
                  <div className="space-y-0.5">
                    {allMessages.map((msg) => (
                      <div
                        key={msg.messageId}
                        className={`flex px-3 py-0.5 ${
                          msg.senderProfileId === currentProfileId ? 'justify-end' : 'justify-start'
                        }`}
                      >
                        <div
                          className={`max-w-[80%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            msg.senderProfileId === currentProfileId
                              ? 'bg-[#166534] text-white rounded-br-sm'
                              : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 rounded-bl-sm'
                          }`}
                        >
                          <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                          <p
                            className={`mt-0.5 text-[9px] leading-none ${
                              msg.senderProfileId === currentProfileId
                                ? 'text-white/60'
                                : 'text-gray-400 dark:text-gray-500'
                            }`}
                          >
                            {formatMessageTime(msg.createdAt)}
                          </p>
                        </div>
                      </div>
                    ))}
                    <div ref={messagesEndRef} />
                  </div>
                )}
              </div>

              {/* Send error */}
              {sendMessageMutation.error && (
                <div className="mx-3 mb-1 rounded-lg bg-red-50 px-3 py-1.5 text-[11px] text-red-600 dark:bg-red-900/20 dark:text-red-400">
                  {sendMessageMutation.error.message}
                </div>
              )}

              {/* Composer */}
              <div className="flex items-end gap-1.5 border-t border-gray-100 p-3 dark:border-gray-800">
                <textarea
                  value={messageText}
                  onChange={(e) => setMessageText(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !e.shiftKey) {
                      e.preventDefault();
                      handleSend();
                    }
                  }}
                  placeholder="Type a message..."
                  rows={1}
                  className="min-h-[32px] max-h-[80px] w-full resize-none rounded-lg border border-gray-200 bg-gray-50 px-3 py-1.5 text-xs text-gray-900 placeholder-gray-400 transition-colors focus:border-blue-500 focus:bg-white focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100"
                  style={{ lineHeight: '1.4' }}
                />
                <button
                  type="button"
                  onClick={handleSend}
                  disabled={!messageText.trim() || sendMessageMutation.isPending}
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-[#166534] text-white transition-all hover:bg-[#14502c] active:scale-95 disabled:bg-gray-100 disabled:text-gray-400 dark:disabled:bg-gray-800"
                >
                  {sendMessageMutation.isPending ? (
                    <svg className="h-3.5 w-3.5 animate-spin" fill="none" viewBox="0 0 24 24">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  ) : (
                    <svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M6 12L3.269 3.126A59.768 59.768 0 0121.485 12 59.77 59.77 0 013.27 20.876L5.999 12zm0 0h7.5" />
                    </svg>
                  )}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
