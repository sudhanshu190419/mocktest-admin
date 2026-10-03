'use client';

import React from 'react';
import { IconRefresh, IconCheckCircle } from '@/components/icons/student-icons';
import type { StudentRecording } from '@/services/student/studentRecordingWebService';
import { StudentRecordingCard } from './StudentRecordingCard';

interface StudentRecordingsGridProps {
  recordings: StudentRecording[];
  hasNextPage?: boolean;
  isFetchingNextPage?: boolean;
  onLoadMore?: () => void;
  totalSubjectCount?: number;
}

export const StudentRecordingsGrid: React.FC<StudentRecordingsGridProps> = ({
  recordings,
  hasNextPage = false,
  isFetchingNextPage = false,
  onLoadMore,
  totalSubjectCount,
}) => {
  return (
    <div className="space-y-8">
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-5 sm:gap-6">
        {recordings.map((recording) => (
          <StudentRecordingCard key={recording.recordingId} recording={recording} />
        ))}
      </div>

      {/* Pagination Controls / Infinite Scroll Trigger */}
      {hasNextPage && (
        <div className="pt-4 flex flex-col items-center justify-center gap-2">
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isFetchingNextPage}
            className="inline-flex min-h-[44px] items-center justify-center gap-2 px-6 py-2.5 rounded-field bg-white hover:bg-sky-tint text-brand border border-line shadow-xs text-xs font-bold transition-all active:scale-[0.98] disabled:opacity-50"
          >
            {isFetchingNextPage ? (
              <>
                <IconRefresh size={16} className="animate-spin text-brand" />
                <span>Loading more lectures...</span>
              </>
            ) : (
              <>
                <span>Load More Lectures (20 more)</span>
              </>
            )}
          </button>
          <span className="text-caption text-ink-muted">
            Loaded {recordings.length} {totalSubjectCount ? `of ${totalSubjectCount}` : ''} lectures
          </span>
        </div>
      )}

      {!hasNextPage && recordings.length > 0 && (
        <div className="pt-6 border-t border-line text-center">
          <div className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-paper border border-line text-caption font-semibold text-ink-muted">
            <IconCheckCircle size={14} className="text-emerald-500" />
            <span>
              All lectures loaded ({recordings.length} total)
            </span>
          </div>
        </div>
      )}
    </div>
  );
};
