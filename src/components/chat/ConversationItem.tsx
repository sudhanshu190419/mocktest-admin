'use client';

import { cn } from '@/lib/utils';
import type { TeacherConversationItem } from '@/types/liveChat';

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

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface ConversationItemProps {
  conversation: TeacherConversationItem;
  isActive: boolean;
  onSelect: (conversationId: string) => void;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function ConversationItem({
  conversation,
  isActive,
  onSelect,
}: ConversationItemProps) {
  const { studentName, lastMessage, lastMessageAt } = conversation;

  return (
    <button
      type="button"
      onClick={() => onSelect(conversation.conversationId)}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3 text-left transition-all',
        isActive
          ? 'bg-blue-50 dark:bg-blue-900/20'
          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30',
      )}
    >
      {/* Avatar */}
      <div
        className={cn(
          'flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-sm font-semibold transition-colors',
          isActive
            ? 'bg-blue-600 text-white'
            : 'bg-gray-200 text-gray-600 dark:bg-gray-700 dark:text-gray-300',
        )}
      >
        {getInitials(studentName)}
      </div>

      {/* Content */}
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              'truncate text-sm font-medium',
              isActive
                ? 'text-blue-700 dark:text-blue-400'
                : 'text-gray-900 dark:text-gray-100',
            )}
          >
            {studentName}
          </span>
          <span className="flex-shrink-0 text-[11px] text-gray-400">
            {formatRelativeTime(lastMessageAt)}
          </span>
        </div>
        <p
          className={cn(
            'mt-0.5 truncate text-sm',
            isActive
              ? 'text-blue-600/70 dark:text-blue-400/70'
              : 'text-gray-500 dark:text-gray-400',
          )}
        >
          {lastMessage ?? 'No messages yet'}
        </p>
      </div>
    </button>
  );
}
