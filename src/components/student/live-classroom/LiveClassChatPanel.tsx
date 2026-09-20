'use client';

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { PaperPlaneRight, User, X, ChatCircleDots } from '@phosphor-icons/react';
import { supabase } from '@/config/supabase';
import { useAuth } from '@/context/AuthContext';

export interface ChatMessageItem {
  id: string;
  senderName: string;
  senderRole: 'student' | 'teacher';
  message: string;
  createdAt: string;
}

interface LiveClassChatPanelProps {
  classId: string;
  isOpen: boolean;
  onClose: () => void;
  teacherName?: string | null;
}

export const LiveClassChatPanel: React.FC<LiveClassChatPanelProps> = ({
  classId,
  isOpen,
  onClose,
  teacherName,
}) => {
  const { user } = useAuth();
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [inputMessage, setInputMessage] = useState<string>('');
  const [sending, setSending] = useState<boolean>(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom
  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, []);

  useEffect(() => {
    scrollToBottom();
  }, [messages, scrollToBottom]);

  // Setup Supabase Realtime broadcast channel for this classroom
  useEffect(() => {
    if (!classId) return;

    const channelName = `live-class-chat:${classId}`;
    const channel = supabase.channel(channelName, {
      config: { broadcast: { self: false } },
    });

    channel
      .on('broadcast', { event: 'new_message' }, ({ payload }) => {
        if (payload && payload.id && payload.message) {
          setMessages((prev) => [...prev, payload as ChatMessageItem]);
        }
      })
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [classId]);

  const handleSendMessage = async (e?: React.FormEvent) => {
    e?.preventDefault();
    const text = inputMessage.trim();
    if (!text || sending) return;

    setSending(true);
    const myName = user?.user_metadata?.name || user?.user_metadata?.full_name || 'Student';

    const newMessage: ChatMessageItem = {
      id: `msg_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      senderName: myName,
      senderRole: 'student',
      message: text,
      createdAt: new Date().toISOString(),
    };

    // Optimistically update local message thread
    setMessages((prev) => [...prev, newMessage]);
    setInputMessage('');

    try {
      // Broadcast to other classroom participants via Realtime
      const channelName = `live-class-chat:${classId}`;
      const channel = supabase.channel(channelName);
      await channel.send({
        type: 'broadcast',
        event: 'new_message',
        payload: newMessage,
      });
    } catch (err) {
      console.warn('[LiveClassChatPanel] Realtime broadcast error:', err);
    } finally {
      setSending(false);
    }
  };

  if (!isOpen) return null;

  return (
    <aside className="w-full lg:w-80 xl:w-96 flex flex-col bg-ink border-l border-ink text-white shrink-0 z-20 h-full">
      {/* Chat header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-ink bg-ink/40">
        <div className="flex items-center gap-2">
          <ChatCircleDots size={16} weight="bold" className="text-sky-ink" />
          <h2 className="text-xs font-bold text-white tracking-wide uppercase">Live Class Chat</h2>
        </div>

        <button
          type="button"
          onClick={onClose}
          className="p-1 rounded-lg text-ink-muted hover:text-white hover:bg-ink transition-colors"
          title="Close chat"
        >
          <X size={16} weight="bold" />
        </button>
      </div>

      {/* Messages list */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 min-h-0 text-xs">
        {messages.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-center p-6 text-ink-secondary space-y-2">
            <ChatCircleDots size={28} weight="duotone" className="text-ink-secondary" />
            <p className="font-semibold text-ink-muted">Class chat is open</p>
            <p className="text-caption leading-relaxed">
              Ask questions and interact with your instructor during the live lecture.
            </p>
          </div>
        ) : (
          messages.map((m) => {
            const isTeacher = m.senderRole === 'teacher';
            const isMe = m.senderName === (user?.user_metadata?.name || 'Student');

            return (
              <div
                key={m.id}
                className={`flex flex-col gap-1 ${isMe ? 'items-end' : 'items-start'}`}
              >
                <div className="flex items-center gap-1.5 text-caption text-ink-muted px-1">
                  <span className={`font-bold ${isTeacher ? 'text-brand' : 'text-ink-muted'}`}>
                    {m.senderName}
                  </span>
                  {isTeacher && (
                    <span className="px-1 py-0.2 rounded bg-brand/20 text-brand text-[9px] font-black uppercase">
                      Faculty
                    </span>
                  )}
                  <span>
                    {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                </div>

                <div
                  className={`px-3 py-2 rounded-2xl max-w-[85%] text-xs leading-relaxed ${
                    isMe
                      ? 'bg-brand text-white rounded-tr-xs'
                      : isTeacher
                      ? 'bg-ink/80 border border-brand/30 text-brand rounded-tl-xs'
                      : 'bg-ink text-sky-ink rounded-tl-xs'
                  }`}
                >
                  {m.message}
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Message Composer */}
      <form onSubmit={handleSendMessage} className="p-3 border-t border-ink bg-ink/60">
        <div className="relative flex items-center">
          <input
            type="text"
            value={inputMessage}
            onChange={(e) => setInputMessage(e.target.value)}
            placeholder="Type your question..."
            maxLength={300}
            className="w-full pl-3.5 pr-10 py-2.5 rounded-xl bg-ink border border-ink text-xs text-white placeholder:text-ink-muted focus:outline-hidden focus:ring-2 focus:ring-brand/40 focus:border-brand transition-all"
          />

          <button
            type="submit"
            disabled={!inputMessage.trim() || sending}
            className="absolute right-1.5 p-2 rounded-lg bg-brand hover:bg-brand disabled:opacity-40 disabled:hover:bg-brand text-white transition-colors"
            title="Send message"
          >
            <PaperPlaneRight size={13} weight="fill" />
          </button>
        </div>
      </form>
    </aside>
  );
};
