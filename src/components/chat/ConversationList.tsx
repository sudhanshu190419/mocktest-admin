'use client';

import { cn } from '@/lib/utils';
import { SearchBar } from '@/components/ui/SearchBar';
import { Skeleton } from '@/components/ui/LoadingSkeleton';
import { ConversationItem } from './ConversationItem';
import type { TeacherConversationItem } from '@/types/liveChat';

// ═══════════════════════════════════════════════════════════════════════════
//  Props
// ═══════════════════════════════════════════════════════════════════════════

interface ConversationListProps {
  conversations: TeacherConversationItem[];
  isLoading: boolean;
  error: string | null;
  activeConversationId: string | null;
  onSelectConversation: (conversationId: string) => void;
  onSearch: (searchTerm: string) => void;
  searchTerm: string;
  onRetry?: () => void;
  className?: string;
  /** When true, renders as a standalone list for mobile with its own search bar embedded. */
  standalone?: boolean;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Component
// ═══════════════════════════════════════════════════════════════════════════

export function ConversationList({
  conversations,
  isLoading,
  error,
  activeConversationId,
  onSelectConversation,
  onSearch,
  searchTerm,
  onRetry,
  className,
  standalone = false,
}: ConversationListProps) {
  return (
    <div className={cn('flex flex-col', className)}>
      {/* Search Bar */}
      {standalone && (
        <div className="border-b border-gray-100 p-3 dark:border-gray-800">
          <div className="relative">
            <input
              type="text"
              value={searchTerm}
              onChange={(e) => onSearch(e.target.value)}
              placeholder="Search students..."
              className="w-full rounded-lg border border-gray-200 bg-gray-50 py-2 pl-10 pr-4 text-sm text-gray-900 placeholder-gray-400 focus:border-blue-500 focus:outline-none focus:ring-2 focus:ring-blue-500/20 dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:placeholder-gray-500"
            />
            <svg
              className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth={2}
              stroke="currentColor"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M21 21l-5.197-5.197m0 0A7.5 7.5 0 105.196 5.196a7.5 7.5 0 0010.607 10.607z"
              />
            </svg>
            {searchTerm && (
              <button
                type="button"
                onClick={() => onSearch('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 rounded-full p-0.5 text-gray-400 hover:text-gray-600 dark:hover:text-gray-300"
              >
                <svg className="h-4 w-4" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            )}
          </div>
        </div>
      )}

      {/* Search (non-standalone/desktop: use shared SearchBar) */}
      {!standalone && (
        <div className="border-b border-gray-100 p-3 dark:border-gray-800">
          <SearchBar
            value={searchTerm}
            onChange={onSearch}
            placeholder="Search students..."
            className="w-full"
          />
        </div>
      )}

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {isLoading ? (
          <div className="space-y-1 p-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3 px-1 py-2.5">
                <Skeleton className="h-10 w-10 flex-shrink-0 rounded-full" />
                <div className="min-w-0 flex-1 space-y-2">
                  <Skeleton className="h-3.5 w-24" />
                  <Skeleton className="h-3 w-40" />
                </div>
              </div>
            ))}
          </div>
        ) : error ? (
          <div className="flex flex-col items-center gap-3 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-red-50 text-red-500 dark:bg-red-900/20">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m9-.75a9 9 0 11-18 0 9 9 0 0118 0zm-9 3.75h.008v.008H12v-.008z" />
              </svg>
            </div>
            <p className="text-sm text-gray-500 dark:text-gray-400">{error}</p>
            {onRetry && (
              <button
                type="button"
                onClick={onRetry}
                className="rounded-lg bg-blue-600 px-4 py-1.5 text-xs font-semibold text-white transition-colors hover:bg-blue-700"
              >
                Retry
              </button>
            )}
          </div>
        ) : conversations.length === 0 ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gray-100 text-gray-400 dark:bg-gray-800">
              <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" d="M20.25 8.511c.884.284 1.5 1.128 1.5 2.097v4.286c0 1.136-.847 2.1-1.98 2.193-.34.027-.68.052-1.02.072v3.091l-3-3c-1.354 0-2.694-.055-4.02-.163a2.115 2.115 0 01-.825-.242m9.345-8.334a2.126 2.126 0 00-.476-.095 48.64 48.64 0 00-8.048 0c-1.131.094-1.976 1.057-1.976 2.192v4.286c0 .837.46 1.58 1.155 1.951m9.345-8.334V6.637c0-1.621-1.152-3.026-2.76-3.235A48.455 48.455 0 0011.25 3c-2.115 0-4.198.137-6.24.402-1.608.209-2.76 1.614-2.76 3.235v6.226c0 1.621 1.152 3.026 2.76 3.235.577.075 1.157.14 1.74.194V21l4.155-4.155" />
              </svg>
            </div>
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {searchTerm ? 'No students found' : 'No conversations yet'}
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-400">
              {searchTerm
                ? `No results for "${searchTerm}"`
                : 'Students will appear here when they start a chat during a live class.'}
            </p>
          </div>
        ) : (
          <div className="divide-y divide-gray-50 dark:divide-gray-800/50">
            {conversations.map((conv) => (
              <ConversationItem
                key={conv.conversationId}
                conversation={conv}
                isActive={conv.conversationId === activeConversationId}
                onSelect={onSelectConversation}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
