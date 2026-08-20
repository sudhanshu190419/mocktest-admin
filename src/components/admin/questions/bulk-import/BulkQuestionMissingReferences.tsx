'use client';

import type { MissingAcademicReferences } from '@/types/bulkQuestionImport';
import { Books, Plus, Warning, ArrowRight } from '@phosphor-icons/react';

interface BulkQuestionMissingReferencesProps {
  missingReferences: MissingAcademicReferences;
  onResolveSubject: (rawName: string) => void;
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

export function BulkQuestionMissingReferences({
  missingReferences,
  onResolveSubject,
  onResolveChapter,
  onResolveTopic,
}: BulkQuestionMissingReferencesProps) {
  const { subjects, chapters, topics } = missingReferences;
  const totalMissing = subjects.length + chapters.length + topics.length;

  if (totalMissing === 0) return null;

  return (
    <div className="space-y-4 rounded-2xl border border-amber-200 bg-amber-50/50 p-6 shadow-sm dark:border-amber-900/50 dark:bg-amber-950/20">
      <div className="flex items-start gap-3">
        <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-300">
          <Books size={22} weight="bold" />
        </div>
        <div>
          <h3 className="text-base font-semibold text-amber-900 dark:text-amber-200">
            Resolve Missing Academic References ({totalMissing})
          </h3>
          <p className="mt-1 text-xs text-amber-800/90 dark:text-amber-300/80">
            Your file references subjects, chapters, or topics that do not exist yet. Create them below in hierarchical order to automatically resolve and publish affected questions without re-uploading.
          </p>
        </div>
      </div>

      <div className="space-y-3 pt-2">
        {/* ── Missing Subjects ──────────────────────────────────────────────── */}
        {subjects.length > 0 && (
          <div className="space-y-2">
            <h4 className="text-xs font-bold uppercase tracking-wider text-amber-900/80 dark:text-amber-300/90">
              Missing Subjects ({subjects.length})
            </h4>
            <div className="grid gap-2 sm:grid-cols-2">
              {subjects.map((sub, idx) => (
                <div
                  key={idx}
                  className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-white p-3.5 shadow-xs dark:border-amber-900/40 dark:bg-gray-900"
                >
                  <div className="pr-3">
                    <p className="text-sm font-semibold text-gray-900 dark:text-gray-100">
                      {sub.rawName}
                    </p>
                    <p className="text-[11px] text-amber-700 dark:text-amber-400">
                      Blocks {sub.rowNumbers.length} question{sub.rowNumbers.length === 1 ? '' : 's'} (Rows {sub.rowNumbers.slice(0, 4).join(', ')}{sub.rowNumbers.length > 4 ? '...' : ''})
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={() => onResolveSubject(sub.rawName)}
                    className="inline-flex shrink-0 items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-semibold text-white shadow-xs transition hover:bg-blue-700"
                  >
                    <Plus size={13} weight="bold" />
                    Create Subject
                  </button>
                </div>
              ))}
            </div>
          </div>
        )}

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
                      <p className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                        <span>Under:</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{chap.rawSubject}</span>
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        Blocks {chap.rowNumbers.length} question{chap.rowNumbers.length === 1 ? '' : 's'}
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
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          <Warning size={12} />
                          Create Subject First
                        </span>
                      </div>
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
                      <p className="flex items-center gap-1 text-[11px] text-gray-500 dark:text-gray-400">
                        <span>Under:</span>
                        <span className="font-medium text-gray-700 dark:text-gray-300">{top.rawChapter}</span>
                      </p>
                      <p className="text-[11px] text-amber-700 dark:text-amber-400">
                        Blocks {top.rowNumbers.length} question{top.rowNumbers.length === 1 ? '' : 's'}
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
                      <div className="text-right">
                        <span className="inline-flex items-center gap-1 rounded-lg bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          <Warning size={12} />
                          Create Chapter First
                        </span>
                      </div>
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
