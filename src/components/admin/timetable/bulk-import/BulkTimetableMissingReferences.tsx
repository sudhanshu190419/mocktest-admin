'use client';

import type { MissingAcademicReferences } from '@/types/bulkTimetableImport';
import { Books, Plus } from '@phosphor-icons/react';

interface BulkTimetableMissingReferencesProps {
  missingReferences: MissingAcademicReferences;
  onResolveChapter: (
    rawSubject: string,
    rawChapter: string,
    resolvedSubjectId: string | null,
  ) => void;
  onResolveTopic: (
    rawChapter: string,
    rawTopic: string,
    resolvedChapterId: string | null,
  ) => void;
}

export function BulkTimetableMissingReferences({
  missingReferences,
  onResolveChapter,
  onResolveTopic,
}: BulkTimetableMissingReferencesProps) {
  const { chapters, topics } = missingReferences;
  const totalMissing = chapters.length + topics.length;

  if (totalMissing === 0) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-xs dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
          <Books size={22} weight="bold" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-amber-900 dark:text-amber-200">
            Resolve Missing Lesson Plan References ({totalMissing})
          </h3>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/80">
            Your file references chapters or topics that do not exist yet. Create them below to automatically resolve lesson plans and make the timetable ready for import without re-uploading.
          </p>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        {/* ── Missing Chapters ──────────────────────────────────────────────── */}
        {chapters.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900/80 dark:text-amber-300/90">
              Missing Chapters ({chapters.length})
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {chapters.map((chap, idx) => {
                const canCreate = Boolean(chap.resolvedSubjectId);
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-white p-3.5 shadow-xs dark:border-amber-900/40 dark:bg-gray-900"
                  >
                    <div className="pr-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {chap.rawChapter}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Under Subject: <span className="font-medium text-gray-700 dark:text-gray-300">{chap.resolvedSubjectName ?? chap.rawSubject}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        Blocks {chap.rowNumbers.length} lesson{chap.rowNumbers.length === 1 ? '' : 's'} (Rows {chap.rowNumbers.slice(0, 4).join(', ')}{chap.rowNumbers.length > 4 ? '...' : ''})
                      </p>
                    </div>
                    {canCreate ? (
                      <button
                        type="button"
                        onClick={() =>
                          onResolveChapter(
                            chap.rawSubject,
                            chap.rawChapter,
                            chap.resolvedSubjectId,
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700"
                      >
                        <Plus size={13} weight="bold" />
                        Create Chapter
                      </button>
                    ) : (
                      <span className="inline-flex shrink-0 items-center rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Subject Required
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Missing Topics ────────────────────────────────────────────────── */}
        {topics.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900/80 dark:text-amber-300/90">
              Missing Topics ({topics.length})
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {topics.map((top, idx) => {
                const canCreate = Boolean(top.resolvedChapterId);
                return (
                  <div
                    key={idx}
                    className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-white p-3.5 shadow-xs dark:border-amber-900/40 dark:bg-gray-900"
                  >
                    <div className="pr-3">
                      <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                        {top.rawTopic}
                      </p>
                      <p className="text-xs text-gray-500 dark:text-gray-400">
                        Under Chapter: <span className="font-medium text-gray-700 dark:text-gray-300">{top.resolvedChapterName ?? top.rawChapter}</span>
                      </p>
                      <p className="mt-0.5 text-[11px] text-amber-700 dark:text-amber-400">
                        Blocks {top.rowNumbers.length} lesson{top.rowNumbers.length === 1 ? '' : 's'} (Rows {top.rowNumbers.slice(0, 4).join(', ')}{top.rowNumbers.length > 4 ? '...' : ''})
                      </p>
                    </div>
                    {canCreate ? (
                      <button
                        type="button"
                        onClick={() =>
                          onResolveTopic(
                            top.rawChapter,
                            top.rawTopic,
                            top.resolvedChapterId,
                          )
                        }
                        className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700"
                      >
                        <Plus size={13} weight="bold" />
                        Create Topic
                      </button>
                    ) : (
                      <span className="inline-flex shrink-0 items-center rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                        Chapter Required
                      </span>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
