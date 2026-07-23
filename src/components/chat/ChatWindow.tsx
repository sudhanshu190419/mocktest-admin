'use client';

import { useEffect, useRef, useMemo, useCallback } from 'react';
import { cn } from '@/lib/utils';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { MessageBubble } from './MessageBubble';
import { MessageComposer } from './MessageComposer';
import type { ConversationWithDetails, Message } from '@/types/liveChat';

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface ChatWindowProps {
  conversation: ConversationWithDetails | null;
  messages: Message[];
  isLoadingMessages: boolean;
  messagesError: string | null;
  isSending: boolean;
  sendError: string | null;
  onSendMessage: (text: string) => void;
  onRetryMessages?: () => void;
  currentProfileId: string | null;
  className?: string;
  liveClassName?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Empty State (no conversation selected)
// ═══════════════════════════════════════════════════════════════════════════

function NoConversationPlaceholder() {
  return (
    <div className="flex h-full flex-col items-center justify-center px-8 text-center">
      <div className="mb-6 flex h-20 w-20 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-50 to-blue-100 dark:from-blue-900/20 dark:to-blue-900/10">
        <svg
          className="h-10 w-10 text-blue-500"
          fill="none"
          viewBox="0 0 24 24"
          strokeWidth={1.5}
          stroke="currentColor"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155"
          />
        </svg>
      </div>
      <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
        Select a conversation
      </h3>
      <p className="mt-2 max-w-sm text-sm leading-relaxed text-gray-500 dark:text-gray-400">
        Choose a student from the list to start responding to their questions
        during the live class.
      </p>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════════════

export function ChatWindow({
  conversation,
  messages,
  isLoadingMessages,
  messagesError,
  isSending,
  sendError,
  onSendMessage,
  onRetryMessages,
  currentProfileId,
  className,
  liveClassName,
}: ChatWindowProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to latest message
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Empty state ────────────────────────────────────────────────────
  if (!conversation) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <NoConversationPlaceholder />
      </div>
    );
  }

  // ── Loading state ──────────────────────────────────────────────────
  if (isLoadingMessages) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        {/* Chat header skeleton */}
        <div className="flex items-center gap-3 border-b border-gray-100 px-5 py-4 dark:border-gray-800">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="space-y-1.5">
            <Skeleton className="h-4 w-32" />
            <Skeleton className="h-3 w-20" />
          </div>
        </div>
        {/* Messages skeleton */}
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className={cn(
                'flex',
                i % 2 === 0 ? 'justify-start' : 'justify-end',
              )}
            >
              <div
                className={cn(
                  'rounded-2xl px-4 py-3',
                  i % 2 === 0 ? 'w-2/3' : 'w-1/2',
                )}
              >
                <Skeleton className="h-3 w-full" />
                <Skeleton className="mt-2 h-3 w-3/4" />
                <Skeleton className="mt-2 h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── Messages error state ───────────────────────────────────────────
  if (messagesError && messages.length === 0) {
    return (
      <div className={cn('flex h-full flex-col', className)}>
        <ChatHeader conversation={conversation} liveClassName={liveClassName} />
        <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
          <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-900/20">
            <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
            </svg>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400">{messagesError}</p>
          {onRetryMessages && (
            <button
              type="button"
              onClick={onRetryMessages}
              className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
            >
              Retry
            </button>
          )}
        </div>
      </div>
    );
  }

  // ── Normal render ──────────────────────────────────────────────────
  return (
    <div className={cn('flex h-full flex-col', className)}>
      {/* Chat Header */}
      <ChatHeader conversation={conversation} liveClassName={liveClassName} />

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto py-3">
        {messages.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center px-6 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 20.25c4.97 0 9-3.694 9-8.25s-4.03-8.25-9-8.25S3 7.444 3 12c0 2.104.859 4.023 2.273 5.48.432.447.74 1.04.586 1.641a4.483 4.483 0 01-.923 1.785A5.969 5.969 0 006 21c1.282 0 2.47-.402 3.445-1.087.81.22 1.668.337 2.555.337z" />
              </svg>
            </div>
            <p className="mt-3 text-sm text-gray-500 dark:text-gray-400">
              No messages yet. Send a message to start the conversation.
            </p>
          </div>
        ) : (
          <div className="space-y-0.5">
            {/* Group messages by date for date separators */}
            {messages.map((msg, index) => {
              const prevMsg = index > 0 ? messages[index - 1] : null;
              const showDateSeparator =
                !prevMsg ||
                new Date(msg.createdAt).toDateString() !==
                  new Date(prevMsg.createdAt).toDateString();

              return (
                <MessageBubble
                  key={msg.messageId}
                  message={msg}
                  isTeacher={msg.senderProfileId === currentProfileId}
                  showDateSeparator={showDateSeparator}
                />
              );
            })}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Send Error */}
      {sendError && (
        <div className="mx-4 mb-1 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-600 dark:bg-red-900/20 dark:text-red-400">
          {sendError}
        </div>
      )}

      {/* Message Composer */}
      <MessageComposer
        onSend={onSendMessage}
        isSending={isSending}
        disabled={!conversation}
      />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Chat Header (internal)
// ═══════════════════════════════════════════════════════════════════════════

function ChatHeader({
  conversation,
  liveClassName,
}: {
  conversation: ConversationWithDetails;
  liveClassName?: string;
}) {
  const initials = conversation.studentName
    .split(' ')
    .map((p) => p.charAt(0))
    .join('')
    .toUpperCase()
    .slice(0, 2);

  return (
    <div className="flex items-center gap-3 border-b border-gray-100 bg-white px-5 py-4 dark:border-gray-800 dark:bg-gray-950">
      <div className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-sm font-semibold text-white shadow-sm">
        {initials}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate text-sm font-semibold text-gray-900 dark:text-gray-100">
          {conversation.studentName}
        </h3>
        <p className="truncate text-xs text-gray-500 dark:text-gray-400">
          {liveClassName || 'Live Class Chat'}
        </p>
      </div>
    </div>
  );
}
