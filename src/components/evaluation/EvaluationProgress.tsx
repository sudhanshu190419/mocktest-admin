'use client';

interface EvaluationProgressProps {
  evaluated: number;
  total: number;
  currentQuestionIndex?: number;
  items?: Array<{ evaluationStatus?: string | null }>;
}

export function EvaluationProgress({
  evaluated,
  total,
  currentQuestionIndex,
  items,
}: EvaluationProgressProps) {
  const percentage = total > 0 ? (evaluated / total) * 100 : 0;
  const isComplete = evaluated === total && total > 0;

  return (
    <div className="rounded-lg border border-gray-200 bg-white p-4 dark:border-gray-700 dark:bg-gray-900">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-700 dark:text-gray-300">
          {evaluated} / {total} Subjective Questions Evaluated
        </span>
        <span
          className={`text-xs font-medium ${
            isComplete
              ? 'text-emerald-600 dark:text-emerald-400'
              : 'text-amber-600 dark:text-amber-400'
          }`}
        >
          {isComplete ? '✓ Complete' : `${Math.round(percentage)}%`}
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-2 w-full overflow-hidden rounded-full bg-gray-200 dark:bg-gray-700">
        <div
          className={`h-full rounded-full transition-all duration-500 ${
            isComplete ? 'bg-emerald-500' : 'bg-blue-500'
          }`}
          style={{ width: `${percentage}%` }}
        />
      </div>
      {/* Question indicators */}
      {total > 0 && (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {Array.from({ length: total }).map((_, i) => {
            const isEvaluated = items
              ? items[i]?.evaluationStatus === 'manual_evaluated'
              : i < evaluated;
            const isCurrent = currentQuestionIndex === i;
            return (
              <span
                key={i}
                className={`inline-flex h-6 w-6 items-center justify-center rounded-full text-[11px] font-medium ${
                  isCurrent
                    ? 'ring-2 ring-blue-400 bg-blue-100 text-blue-700 dark:bg-blue-900/40 dark:text-blue-400'
                    : isEvaluated
                    ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400'
                    : 'bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400'
                }`}
                title={
                  isCurrent
                    ? 'Current question'
                    : isEvaluated
                    ? 'Evaluated'
                    : 'Pending'
                }
              >
                {i + 1}
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
}
