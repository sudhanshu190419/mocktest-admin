'use client';

import { cn } from '@/lib/utils';

interface ProfileSectionProps {
  title: string;
  children: React.ReactNode;
  onEdit?: () => void;
  className?: string;
  loading?: boolean;
}

export function ProfileSection({
  title,
  children,
  onEdit,
  className,
  loading = false,
}: ProfileSectionProps) {
  return (
    <div className={cn('rounded-xl border border-gray-200 bg-white p-5 dark:border-gray-700 dark:bg-gray-900', className)}>
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-sm font-semibold text-gray-900 dark:text-gray-100">{title}</h3>
        {onEdit && (
          <button
            type="button"
            onClick={onEdit}
            className="inline-flex items-center gap-1 rounded-lg px-2.5 py-1 text-xs font-medium text-blue-600 transition-colors hover:bg-blue-50 dark:text-blue-400 dark:hover:bg-blue-900/20"
            aria-label={`Edit ${title.toLowerCase()}`}
          >
            <svg className="h-3 w-3" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" d="M16.862 4.487l1.687-1.688a1.875 1.875 0 112.652 2.652L10.582 16.07a4.5 4.5 0 01-1.897 1.13L6 18l.8-2.685a4.5 4.5 0 011.13-1.897l8.932-8.931zm0 0L19.5 7.125M18 14v4.75A2.25 2.25 0 0115.75 21H5.25A2.25 2.25 0 013 18.75V8.25A2.25 2.25 0 015.25 6H10" />
            </svg>
            Edit
          </button>
        )}
      </div>
      {loading ? (
        <div className="space-y-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <div className="h-3 w-20 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 flex-1 animate-pulse rounded bg-gray-200 dark:bg-gray-700" />
            </div>
          ))}
        </div>
      ) : (
        children
      )}
    </div>
  );
}

// ─── Profile Field (atomic display component) ──────────────────────────────

interface ProfileFieldProps {
  label: string;
  value: string | number | null | undefined;
  className?: string;
  mono?: boolean;
}

export function ProfileField({ label, value, className, mono }: ProfileFieldProps) {
  return (
    <div className={cn('flex items-start justify-between gap-4 py-2', className)}>
      <dt className="min-w-[100px] text-xs font-medium text-gray-500 dark:text-gray-400">
        {label}
      </dt>
      <dd
        className={cn(
          'flex-1 text-right text-sm font-medium text-gray-900 dark:text-gray-100',
          mono && 'font-mono text-xs tracking-wide',
        )}
      >
        {value ?? '—'}
      </dd>
    </div>
  );
}

// ─── Profile Divider ──────────────────────────────────────────────────────

export function ProfileDivider() {
  return <div className="h-px bg-gray-100 dark:bg-gray-700" />;
}
