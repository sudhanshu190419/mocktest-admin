'use client';

import { useState } from 'react';
import { EmptyState } from '@/components/ui/EmptyState';
import { CalendarBlank } from '@phosphor-icons/react';
import type { ImportedRow, ImportGroup, ReferenceData } from '@/types/bulkTimetableImport';
import {
  BulkTimetableGroupCard,
  type DisplayMaps,
} from './BulkTimetableGroupCard';

/** Build display maps from reference data (exported for the page). */
export function buildDisplayMaps(reference: ReferenceData): DisplayMaps {
  const teacherName = new Map<string, string>();
  for (const t of reference.teachers) teacherName.set(t.teacherId, t.name || t.phone || '');

  const subjectName = new Map<string, string>();
  for (const s of reference.subjects) subjectName.set(s.subjectId, s.name);

  const batchName = new Map<string, string>();
  for (const b of reference.batches) batchName.set(b.batchId, b.name);

  const batchSubjectLabel = new Map<string, string>();
  for (const bs of reference.batchSubjects) {
    const subject = bs.name ?? subjectName.get(bs.subjectId) ?? 'Subject';
    const batch = batchName.get(bs.batchId) ?? 'Batch';
    batchSubjectLabel.set(bs.batchSubjectId, `${subject} — ${batch}`);
  }

  const chapterName = new Map<string, string>();
  for (const c of reference.chapters) chapterName.set(c.chapterId, c.name);

  const topicName = new Map<string, string>();
  for (const t of reference.topics) topicName.set(t.topicId, t.name);

  return { teacherName, subjectName, batchName, batchSubjectLabel, chapterName, topicName };
}

interface BulkTimetableGroupListProps {
  groups: ImportGroup[];
  /** group.key → the group's valid, non-duplicate rows. */
  rowsByGroup: Map<string, ImportedRow[]>;
  displayMaps: DisplayMaps;
}

/**
 * Grouped timetable preview.
 *
 * Default expansion: all cards expanded for ≤ 20 groups, collapsed above —
 * keeping the DOM bounded for files up to 5,000 rows (no raw-row rendering).
 * The parent remounts this list per file (via a `key`) so expansion state
 * resets naturally.
 */
export function BulkTimetableGroupList({ groups, rowsByGroup, displayMaps }: BulkTimetableGroupListProps) {
  const [expandedKeys, setExpandedKeys] = useState<Set<string>>(() => {
    if (groups.length <= 20) return new Set(groups.map((g) => g.key));
    return new Set<string>();
  });

  const allExpanded = groups.length > 0 && expandedKeys.size === groups.length;

  const toggle = (key: string) => {
    setExpandedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const expandAll = () => setExpandedKeys(new Set(groups.map((g) => g.key)));
  const collapseAll = () => setExpandedKeys(new Set<string>());

  if (groups.length === 0) {
    return (
      <EmptyState
        icon={<CalendarBlank size={28} />}
        title="No valid timetable schedules"
        description="Every row in this file has a blocking error, so no recurring schedules could be built. Fix the errors and upload the file again."
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-sm font-semibold text-gray-700 dark:text-gray-200">
          {groups.length} timetable schedule{groups.length === 1 ? '' : 's'}
        </h2>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={expandAll}
            disabled={allExpanded}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Expand All
          </button>
          <button
            type="button"
            onClick={collapseAll}
            disabled={expandedKeys.size === 0}
            className="rounded-lg border border-gray-300 px-3 py-1.5 text-xs font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-40 dark:border-gray-600 dark:text-gray-300 dark:hover:bg-gray-800"
          >
            Collapse All
          </button>
        </div>
      </div>

      <div className="space-y-3">
        {groups.map((group) => (
          <BulkTimetableGroupCard
            key={group.key}
            group={group}
            rows={rowsByGroup.get(group.key) ?? []}
            displayMaps={displayMaps}
            expanded={expandedKeys.has(group.key)}
            onToggle={() => toggle(group.key)}
          />
        ))}
      </div>
    </div>
  );
}
