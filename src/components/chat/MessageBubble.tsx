'use client';

import { cn } from '@/lib/utils';
import type { Message } from '@/types/liveChat';

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatMessageTime(isoString: string): string {
  const date = new Date(isoString);
  return date.toLocaleTimeString(undefined, {
    hour: '2-digit',
    minute: '2-digit',
  });
}

function formatMessageDate(isoString: string): string {
  const date = new Date(isoString);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(yesterday.getDate() - 1);

  if (date.toDateString() === today.toDateString()) return 'Today';
  if (date.toDateString() === yesterday.toDateString()) return 'Yesterday';
  return date.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: date.getFullYear() !== today.getFullYear() ? 'numeric' : undefined,
  });
}

// ═══════════════════════════════════════════════════════════════════════════
//  Date Separator
// ═══════════════════════════════════════════════════════════════════════════

function DateSeparator({ date }: { date: string }) {
  return (
    <div className="flex items-center gap-3 py-3">
      <div className="flex-1 border-t border-gray-100 dark:border-gray-800" />
      <span className="text-[11px] font-medium text-gray-400">
        {formatMessageDate(date)}
      </span>
      <div className="flex-1 border-t border-gray-100 dark:border-gray-800" />
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface MessageBubbleProps {
  message: Message;
  isTeacher: boolean;
  showDateSeparator?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function MessageBubble({
  message,
  isTeacher,
  showDateSeparator = false,
}: MessageBubbleProps) {
  return (
    <>
      {showDateSeparator && <DateSeparator date={message.createdAt} />}
      <div
        className={cn(
          'flex px-4 py-0.5',
          isTeacher ? 'justify-end' : 'justify-start',
        )}
      >
        <div
          className={cn(
            'max-w-[75%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed',
            isTeacher
              ? 'bg-[#166534] text-white rounded-br-md'
              : 'bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100 rounded-bl-md',
          )}
        >
          <p className="whitespace-pre-wrap break-words">{message.message}</p>
          <p
            className={cn(
              'mt-1 text-[10px] leading-none',
              isTeacher
                ? 'text-white/60'
                : 'text-gray-400 dark:text-gray-500',
            )}
          >
            {formatMessageTime(message.createdAt)}
          </p>
        </div>
      </div>
    </>
  );
}
