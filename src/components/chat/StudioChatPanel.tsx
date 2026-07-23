'use client';

/**
 * StudioChatPanel — Collapsible chat side panel for the Live Studio.
 *
 * Designed for the 360px right-side panel inside LiveStudioView.
 * Displays a searchable student conversation list, and when a student
 * is selected, shows the message thread with a composer.
 *
 * Uses the existing liveChatService for all data and realtime.
 *
 * @module components/chat/StudioChatPanel
 */

import { useState, useCallback, useEffect, useRef, useMemo } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/config/supabase';
import { liveChatService } from '@/services/liveChatService';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ChatCircleDots, ArrowLeft, X } from '@phosphor-icons/react';
import type { ConversationWithDetails, Message, TeacherConversationItem } from '@/types/liveChat';

// ─── Internal DB row shape for Realtime payload ───────────────────────
interface DbMessage {
  message_id: string;
  conversation_id: string;
  sender_profile_id: string;
  message: string;
  created_at: string;
}

function mapMessage(db: DbMessage): Message {
  return {
    messageId: db.message_id,
    conversationId: db.conversation_id,
    senderProfileId: db.sender_profile_id,
    message: db.message,
    createdAt: db.created_at,
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function getInitials(name: string): string {
  return name
    .split(' ')
    .map((p) => p.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

function formatRelTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const sec = Math.floor(diff / 1000);
  if (sec < 60) return 'now';
  if (sec < 3600) return `${Math.floor(sec / 60)}m`;
  if (sec < 86400) return `${Math.floor(sec / 3600)}h`;
  return `${Math.floor(sec / 86400)}d`;
}

function useDebounce<T>(value: T, ms: number): T {
  const [d, set] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => set(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return d;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface StudioChatPanelProps {
  classId: string;
  currentProfileId: string | null;
  onClose: () => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function StudioChatPanel({
  classId,
  currentProfileId,
  onClose,
}: StudioChatPanelProps) {
  // ── View navigation: 'list' | 'thread' ─────────────────────────
  const [view, setView] = useState<'list' | 'thread'>('list');
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [activeStudentName, setActiveStudentName] = useState('');
  const [search, setSearch] = useState('');
  const debouncedSearch = useDebounce(search, 300);

  // Reset when classId changes
  useEffect(() => {
    setView('list');
    setActiveConvId(null);
    setSearch('');
  }, [classId]);

  // ── Streaming realtime state ─────────────────────────────────
  // These hold NEW data arriving via Realtime. We never clear them.
  // Each new message updates both (1) the conversation list preview
  // and (2) the active thread (if it belongs to the open conversation).
  const [rtMessages, setRtMessages] = useState<Message[]>([]);
  const [convUpdates, setConvUpdates] = useState<
    Map<string, { message: string; createdAt: string }>
  >(new Map());

  // Refs to avoid stale closures in the Realtime callback
  const activeConvIdRef = useRef<string | null>(null);
  const convIdsRef = useRef<Set<string>>(new Set());
  const unsubRef = useRef<(() => void) | null>(null);

  // Keep refs in sync with state
  useEffect(() => { activeConvIdRef.current = activeConvId; }, [activeConvId]);

  // Reset message buffer when switching conversations (NOT convUpdates —
  // those persist to keep the list current)
  useEffect(() => {
    setRtMessages([]);
  }, [activeConvId]);

  // ═══════════════════════════════════════════════════════════════
  //  Queries
  // ═══════════════════════════════════════════════════════════════

  const { data: convData, isLoading: convLoading, error: convError, refetch: refetchConvs } = useQuery({
    queryKey: ['studio-chat', classId, 'conversations'],
    queryFn: async () => {
      const r = await liveChatService.getTeacherConversations(classId);
      if (!r.success) throw new Error(r.error ?? 'Failed');
      return r.data as TeacherConversationItem[];
    },
    enabled: !!classId,
    staleTime: Infinity,
    refetchOnMount: false,
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });

  const conversations = useMemo(() => {
    // Merge realtime updates into the fetched conversation list
    if (convUpdates.size === 0) return convData ?? [];

    return (convData ?? [])
      .map((conv) => {
        const update = convUpdates.get(conv.conversationId);
        if (!update) return conv;
        return {
          ...conv,
          lastMessage: update.message,
          lastMessageAt: update.createdAt,
        };
      })
      .sort(
        (a, b) =>
          new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime(),
      );
  }, [convData, convUpdates]);

  // Sync convIdsRef AFTER conversations is computed
  useEffect(() => {
    convIdsRef.current = new Set(conversations.map((c) => c.conversationId));
  }, [conversations]);

  const { data: searchResults, isLoading: searchLoading } = useQuery({
    queryKey: ['studio-chat', classId, 'search', debouncedSearch],
    queryFn: async () => {
      if (debouncedSearch.length < 2) return null;
      const r = await liveChatService.searchStudents(classId, debouncedSearch);
      if (!r.success) throw new Error(r.error ?? 'Search failed');
      return r.data as TeacherConversationItem[];
    },
    enabled: !!classId && debouncedSearch.length >= 2,
    staleTime: 5_000,
  });

  const displayed = searchResults ?? conversations;

  // ── Conversation detail ────────────────────────────────────────
  const { data: convDetail, isLoading: detailLoading } = useQuery({
    queryKey: ['studio-chat', 'conv', activeConvId],
    queryFn: async () => {
      if (!activeConvId) return null;
      const r = await liveChatService.getConversation(activeConvId);
      if (!r.success) throw new Error(r.error ?? 'Failed');
      return r.data as ConversationWithDetails;
    },
    enabled: !!activeConvId,
    staleTime: 60_000,
  });

  // ── Messages ───────────────────────────────────────────────────
  const { data: msgData, isLoading: msgLoading, error: msgError, refetch: refetchMsgs } = useQuery({
    queryKey: ['studio-chat', 'msgs', activeConvId],
    queryFn: async () => {
      if (!activeConvId) return [];
      const r = await liveChatService.getConversationMessages(activeConvId);
      if (!r.success) throw new Error(r.error ?? 'Failed');
      return r.data as Message[];
    },
    enabled: !!activeConvId,
    staleTime: 0,
  });

  // ── Unified Realtime subscription ──────────────────────────────
  // Listens to ALL new messages for the entire duration the panel is open.
  // Works regardless of whether a conversation thread is active.
  //
  // Handles BOTH:
  //   1. Conversation list preview updates (lastMessage, lastMessageAt, sort order)
  //   2. Message thread updates (if the new message is for the active conversation)
  //
  // Uses refs (convIdsRef, activeConvIdRef) inside the callback so we never
  // need to re-create the subscription when state changes.
  //
  // Key fix: this effect depends ONLY on `classId`, NOT on `activeConvId`.
  // This means the subscription stays alive even when no thread is open,
  // so the conversation list receives realtime updates at all times.
  useEffect(() => {
    // Clean up any previous subscription before creating a new one
    if (unsubRef.current) {
      unsubRef.current();
      unsubRef.current = null;
    }

    const channel = supabase
      .channel(`studio-chat:${classId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
        },
        (payload: { new: Record<string, unknown> }) => {
          const msg = payload.new as unknown as DbMessage;

          // Only process messages for conversations we know about
          if (!convIdsRef.current.has(msg.conversation_id)) return;

          // ── 1. Update conversation list preview ─────────────────
          setConvUpdates((prev) => {
            const next = new Map(prev);
            next.set(msg.conversation_id, {
              message: msg.message,
              createdAt: msg.created_at,
            });
            return next;
          });

          // ── 2. If this message is for the active conversation, append to thread ──
          if (msg.conversation_id === activeConvIdRef.current) {
            setRtMessages((prev) => [...prev, mapMessage(msg)]);
          }
        },
      )
      .subscribe();

    unsubRef.current = () => {
      supabase.removeChannel(channel);
    };

    return () => {
      if (unsubRef.current) {
        unsubRef.current();
        unsubRef.current = null;
      }
    };
  }, [classId]); // <--- ONLY classId — NOT activeConvId

  const allMessages = useMemo(() => {
    const fetched = msgData ?? [];
    if (rtMessages.length === 0) return fetched;
    const seen = new Set<string>();
    return [...fetched, ...rtMessages].filter((m) => {
      if (seen.has(m.messageId)) return false;
      seen.add(m.messageId);
      return true;
    }).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  }, [msgData, rtMessages]);

  // ── Send message ───────────────────────────────────────────────
  const [msgText, setMsgText] = useState('');

  const sendMutation = useMutation({
    mutationFn: async (text: string) => {
      if (!activeConvId) throw new Error('No active conversation');
      const r = await liveChatService.sendMessage({ conversationId: activeConvId, message: text });
      if (!r.success) throw new Error(r.error ?? 'Failed');
      return r.data as Message;
    },
    onSuccess: (m) => { if (m) setRtMessages((prev) => [...prev, m]); },
  });

  const handleSend = useCallback(() => {
    const trimmed = msgText.trim();
    if (!trimmed || !activeConvId) return;
    sendMutation.mutate(trimmed);
    setMsgText('');
  }, [msgText, activeConvId, sendMutation]);

  // Auto-scroll
  const msgsEndRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    msgsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [allMessages]);

  // ── Open conversation thread ────────────────────────────────────
  const openConversation = useCallback((convId: string, studentName: string) => {
    setActiveConvId(convId);
    setActiveStudentName(studentName);
    setView('thread');
  }, []);

  // ── Render ──────────────────────────────────────────────────────
  return (
    <div className="flex h-full flex-col min-h-0 bg-navy-900 text-white">
      {/* ═══ HEADER - fixed top ═══ */}
      <div className="flex items-center justify-between border-b border-white/10 px-3 py-2.5 shrink-0">
        {view === 'thread' ? (
          <div className="flex items-center gap-2 min-w-0 flex-1">
            <button
              onClick={() => { setView('list'); setActiveConvId(null); }}
              className="flex items-center gap-1 text-xs text-blue-300 hover:text-white shrink-0"
            >
              <ArrowLeft size={14} />
              Back
            </button>
            <span className="text-xs font-semibold truncate">{activeStudentName}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2">
            <ChatCircleDots size={16} className="text-blue-400" />
            <span className="text-xs font-semibold">Live Chat</span>
          </div>
        )}
        <button onClick={onClose} className="p-1 rounded hover:bg-white/10 text-white/60 hover:text-white shrink-0">
          <X size={16} />
        </button>
      </div>

      {/* ═══ SCROLLABLE CONTENT ═══ */}
      <div className="flex-1 min-h-0 overflow-y-auto">
        {view === 'list' ? (
          /* ── Conversation List ── */
          <>
            {/* Search - stays with list */}
            <div className="sticky top-0 z-10 bg-navy-900 border-b border-white/10 px-3 py-2">
              <div className="relative">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="Search students..."
                  className="w-full rounded-lg bg-white/10 border border-white/10 px-3 py-1.5 pl-8 text-xs text-white placeholder-white/40 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
                />
                <svg className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-white/40" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z" />
                </svg>
                {search && (
                  <button onClick={() => setSearch('')} className="absolute right-2 top-1/2 -translate-y-1/2 text-white/40 hover:text-white">
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Student list */}
            {convLoading || searchLoading ? (
              <div className="space-y-1 p-3">
                {Array.from({ length: 4 }).map((_, i) => (
                  <div key={i} className="flex items-center gap-2 px-1 py-2">
                    <Skeleton className="h-7 w-7 rounded-full !bg-white/10" />
                    <div className="flex-1 space-y-1.5">
                      <Skeleton className="h-3 w-20 !bg-white/10" />
                      <Skeleton className="h-2.5 w-32 !bg-white/10" />
                    </div>
                  </div>
                ))}
              </div>
            ) : convError ? (
              <div className="flex flex-col items-center gap-2 p-4 text-center">
                <p className="text-xs text-red-400">Failed to load</p>
                <button onClick={() => refetchConvs()} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">Retry</button>
              </div>
            ) : displayed.length === 0 ? (
              <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                <ChatCircleDots size={28} className="text-white/20 mb-2" />
                <p className="text-xs text-white/40">{search ? 'No results found' : 'No conversations yet'}</p>
              </div>
            ) : (
              <div className="divide-y divide-white/5">
                {displayed.map((conv) => (
                  <button
                    key={conv.conversationId}
                    onClick={() => openConversation(conv.conversationId, conv.studentName)}
                    className="flex w-full items-center gap-2 px-3 py-2.5 text-left hover:bg-white/5 transition-colors"
                  >
                    <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-[10px] font-semibold text-blue-300">
                      {getInitials(conv.studentName)}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-1">
                        <span className="truncate text-xs font-medium text-white/90">{conv.studentName}</span>
                        <span className="shrink-0 text-[10px] text-white/40">{formatRelTime(conv.lastMessageAt)}</span>
                      </div>
                      <p className="truncate text-[11px] text-white/50">{conv.lastMessage ?? 'No messages'}</p>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </>
        ) : (
          /* ── Message Thread ── */
          <>
            {detailLoading || msgLoading ? (
              <div className="space-y-3 p-4">
                {Array.from({ length: 3 }).map((_, i) => (
                  <div key={i} className={`flex ${i % 2 === 0 ? 'justify-start' : 'justify-end'}`}>
                    <div className={`rounded-xl px-3 py-2 ${i % 2 === 0 ? 'w-4/5' : 'w-3/5'}`}>
                      <Skeleton className={`h-2.5 w-full !bg-white/10 ${i % 2 === 0 ? '' : 'ml-auto'}`} />
                      <Skeleton className={`mt-1.5 h-2.5 w-2/3 !bg-white/10 ${i % 2 === 0 ? '' : 'ml-auto'}`} />
                    </div>
                  </div>
                ))}
              </div>
            ) : msgError && allMessages.length === 0 ? (
              <div className="flex flex-col items-center justify-center gap-2 px-4 py-12">
                <p className="text-xs text-red-400">Failed to load messages</p>
                <button onClick={() => refetchMsgs()} className="rounded-lg bg-blue-600 px-3 py-1 text-xs font-semibold text-white">Retry</button>
              </div>
            ) : (
              <>
                {allMessages.length === 0 ? (
                  <div className="flex flex-col items-center justify-center px-4 py-12 text-center">
                    <p className="text-xs text-white/40">No messages yet. Send one below!</p>
                  </div>
                ) : (
                  <div className="space-y-1 py-2">
                    {allMessages.map((msg) => {
                      const isMe = msg.senderProfileId === currentProfileId;
                      return (
                        <div key={msg.messageId} className={`flex px-3 py-0.5 ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[85%] rounded-xl px-3 py-2 text-xs leading-relaxed ${
                            isMe
                              ? 'bg-[#166534] text-white rounded-br-sm'
                              : 'bg-white/10 text-white/90 rounded-bl-sm'
                          }`}>
                            <p className="whitespace-pre-wrap break-words">{msg.message}</p>
                            <p className={`mt-0.5 text-[9px] ${isMe ? 'text-white/50' : 'text-white/30'}`}>{formatTime(msg.createdAt)}</p>
                          </div>
                        </div>
                      );
                    })}
                    <div ref={msgsEndRef} />
                  </div>
                )}
              </>
            )}
          </>
        )}
      </div>

      {/* ═══ ERROR BANNER - fixed bottom (if any) ═══ */}
      {sendMutation.error && (
        <div className="shrink-0 mx-3 mb-1 rounded-lg bg-red-500/20 px-3 py-1.5 text-[11px] text-red-300">
          {sendMutation.error.message}
        </div>
      )}

      {/* ═══ COMPOSER - fixed bottom ═══ */}
      <div className="shrink-0 flex items-end gap-1.5 border-t border-white/10 p-3">
        <textarea
          value={msgText}
          onChange={(e) => setMsgText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          placeholder="Type a message..."
          rows={1}
          className="min-h-[32px] max-h-[80px] w-full resize-none rounded-lg bg-white/10 border border-white/10 px-3 py-1.5 text-xs text-white placeholder-white/40 focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400/30"
        />
        <button
          type="button"
          onClick={handleSend}
          disabled={!msgText.trim() || sendMutation.isPending}
          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-[#166534] text-white transition-all hover:bg-[#14502c] active:scale-95 disabled:bg-white/10 disabled:text-white/30"
        >
          {sendMutation.isPending ? (
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
    </div>
  );
}
