'use client';

import { EmptyState } from '@/components/ui/EmptyState';
import { CalendarBlank, WarningCircle } from '@phosphor-icons/react';
import { LessonOccurrenceCard, type DataState } from './LessonOccurrenceCard';
import type { LessonPlan, SkipKind, SlotClassStatus } from '@/types/lessonPlan';
import type { TimetableSlot } from '@/types/timetable';

/**
 * A fully prepared occurrence for rendering — the page joins the three data
 * sources (lesson_plans / live_classes / holidays+leaves) and computes the
 * editability state before passing items here. The card stays presentational.
 */
export interface PreparedOccurrence {
  /** YYYY-MM-DD (from the timetable rule). */
  occurrenceDate: string;
  plan: LessonPlan | null;
  classStatus: SlotClassStatus | null;
  skipKind: SkipKind | null;
  editable: boolean;
  lockedMessage: string | null;
}

interface LessonOccurrenceListProps {
  /** The resolved timetable slot (drives day/time labels + timezone). */
  slot: TimetableSlot;
  /** Occurrences for the displayed month, already joined + editability-computed. */
  occurrences: PreparedOccurrence[];
  /** Per-axis query states (skeletons / honest "unavailable" instead of false empties). */
  plansState: DataState;
  classesState: DataState;
  skipsState: DataState;
  /** Phase 2C-3 connects this to the lesson editor modal. */
  onEdit: (occurrenceDate: string) => void;
}

/**
 * Vertical list of lesson-planner occurrence cards for one month.
 *
 * Renders only the dates the timetable rule actually produces (validity +
 * weekday aware) — never a full calendar grid. Loading, error, and empty
 * month states are handled here; the occurrence dates themselves are
 * generated locally, so they render immediately while queries load.
 */
export function LessonOccurrenceList({
  slot,
  occurrences,
  plansState,
  classesState,
  skipsState,
  onEdit,
}: LessonOccurrenceListProps) {
  const failedAxes = [
    plansState === 'error' && 'lesson plans',
    classesState === 'error' && 'class statuses',
    skipsState === 'error' && 'holiday/leave info',
  ].filter((x): x is string => Boolean(x));

  if (occurrences.length === 0) {
    return (
      <div className="space-y-4">
        {failedAxes.length > 0 && <ErrorBanner failedAxes={failedAxes} />}
        <EmptyState
          icon={<CalendarBlank size={32} />}
          title="No timetable occurrences in this month"
          description="The selected month falls outside this slot's validity window or has no matching weekdays."
        />
      </div>
    );
  }

  return (
    <div className="space-y-4">
      {failedAxes.length > 0 && <ErrorBanner failedAxes={failedAxes} />}

      <div className="space-y-3">
        {occurrences.map((occurrence) => (
          <LessonOccurrenceCard
            key={occurrence.occurrenceDate}
            occurrenceDate={occurrence.occurrenceDate}
            dayOfWeek={slot.dayOfWeek}
            startTime={slot.startTime}
            endTime={slot.endTime}
            plan={occurrence.plan}
            plansState={plansState}
            classStatus={occurrence.classStatus}
            classesState={classesState}
            skipKind={occurrence.skipKind}
            skipsState={skipsState}
            editable={occurrence.editable}
            lockedMessage={occurrence.lockedMessage}
            onEdit={onEdit}
          />
        ))}
      </div>
    </div>
  );
}

/** Compact amber banner listing which data axes failed to load. */
function ErrorBanner({ failedAxes }: { failedAxes: string[] }) {
  return (
    <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800 dark:border-amber-900/50 dark:bg-amber-900/20 dark:text-amber-300">
      <WarningCircle size={16} className="mt-0.5 shrink-0" />
      <p>
        Couldn&apos;t load {failedAxes.join(', ')}. Showing what&apos;s available — please refresh.
      </p>
    </div>
  );
}
