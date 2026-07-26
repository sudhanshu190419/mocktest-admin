'use client';

/**
 * RecordingsEmptyState
 *
 * Displays an empty state message when no recordings are found.
 * Adapts its message based on the user role (teacher vs student).
 *
 * @module components/recording/RecordingsEmptyState
 */

// ─── Icons ──────────────────────────────────────────────────────────────────

import { VideoCamera } from '@phosphor-icons/react';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RecordingsEmptyStateProps {
  /** The role variant determines the message shown. */
  variant: 'teacher' | 'student';
  /** Optional search term to show a "no results" message. */
  searchTerm?: string;
  /** Additional className for custom styling. */
  className?: string;
}

// ─── Component ──────────────────────────────────────────────────────────────

export function RecordingsEmptyState({
  variant,
  searchTerm,
  className = '',
}: RecordingsEmptyStateProps) {
  // Show "no search results" message if a search term is provided
  if (searchTerm) {
    return (
      <div
        className={`flex flex-col items-center justify-center py-16 text-center ${className}`}
      >
        <VideoCamera
          size={48}
          weight="light"
          className="mb-4 text-gray-300 dark:text-gray-600"
        />
        <h3 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
          No results for &ldquo;{searchTerm}&rdquo;
        </h3>
        <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
          Try adjusting your search terms or filters to find what you&apos;re
          looking for.
        </p>
      </div>
    );
  }

  return (
    <div
      className={`flex flex-col items-center justify-center py-16 text-center ${className}`}
    >
      <VideoCamera
        size={64}
        weight="light"
        className="mb-4 text-gray-300 dark:text-gray-600"
      />
      <h3 className="mb-1 text-lg font-semibold text-gray-900 dark:text-gray-100">
        {variant === 'teacher' ? 'No recordings yet' : 'No recordings available'}
      </h3>
      <p className="max-w-sm text-sm text-gray-500 dark:text-gray-400">
        {variant === 'teacher'
          ? 'Recordings will appear here after you finish a live class. Make sure recording is enabled when you go live.'
          : 'Your teachers have not published any recorded classes for your batches yet. Check back later.'}
      </p>
    </div>
  );
}
