'use client';

import { useState, useMemo } from 'react';
import { cn } from '@/lib/utils';

export interface Column<T> {
  key: string;
  header: string;
  sortable?: boolean;
  render?: (item: T) => React.ReactNode;
  className?: string;
  headerClassName?: string;
}

interface DataTableProps<T> {
  columns: Column<T>[];
  data: T[];
  keyExtractor: (item: T) => string;
  onRowClick?: (item: T) => void;
  isLoading?: boolean;
  emptyState?: React.ReactNode;
  sortable?: boolean;
  page?: number;
  pageSize?: number;
  totalCount?: number;
  onPageChange?: (page: number) => void;
  selectedIds?: Set<string>;
  onSelectionChange?: (ids: Set<string>) => void;
  className?: string;
}

export function DataTable<T>({
  columns,
  data,
  keyExtractor,
  onRowClick,
  isLoading,
  emptyState,
  sortable = false,
  page,
  pageSize,
  totalCount,
  onPageChange,
  selectedIds,
  onSelectionChange,
  className,
}: DataTableProps<T>) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('asc');

  const sortedData = useMemo(() => {
    if (!sortKey || !sortable) return data;
    return [...data].sort((a, b) => {
      const aVal = (a as any)[sortKey];
      const bVal = (b as any)[sortKey];
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      const cmp = String(aVal).localeCompare(String(bVal), undefined, { numeric: true });
      return sortDir === 'asc' ? cmp : -cmp;
    });
  }, [data, sortKey, sortDir, sortable]);

  const handleSort = (key: string) => {
    if (!sortable) return;
    if (sortKey === key) {
      setSortDir((d) => (d === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortKey(key);
      setSortDir('asc');
    }
  };

  const allSelected =
    selectedIds && data.length > 0 && data.every((item) => selectedIds.has(keyExtractor(item)));

  const toggleAll = () => {
    if (!onSelectionChange) return;
    if (allSelected) {
      onSelectionChange(new Set());
    } else {
      const all = new Set(data.map((item) => keyExtractor(item)));
      // Preserve any previously selected items that aren't in current page
      if (selectedIds) {
        selectedIds.forEach((id) => all.add(id));
      }
      onSelectionChange(all);
    }
  };

  const totalPages = pageSize && totalCount ? Math.ceil(totalCount / pageSize) : 0;

  return (
    <div className={cn('space-y-4', className)}>
      <div className="overflow-hidden rounded-xl border border-gray-200 dark:border-gray-700">
        <div className="overflow-x-auto">
          <table className="min-w-full divide-y divide-gray-200 dark:divide-gray-700">
            <thead className="bg-gray-50 dark:bg-gray-800/50">
              <tr>
                {onSelectionChange && (
                  <th className="w-10 px-4 py-3">
                    <input
                      type="checkbox"
                      checked={allSelected ?? false}
                      onChange={toggleAll}
                      className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                    />
                  </th>
                )}
                {columns.map((col) => (
                  <th
                    key={col.key}
                    onClick={() => col.sortable && handleSort(col.key)}
                    className={cn(
                      'px-4 py-3 text-left text-[11px] font-semibold uppercase tracking-wider text-gray-500 dark:text-gray-400',
                      col.sortable && 'cursor-pointer select-none hover:text-gray-700 dark:hover:text-gray-200',
                      col.headerClassName,
                    )}
                  >
                    <span className="inline-flex items-center gap-1">
                      {col.header}
                      {sortable && col.sortable && sortKey === col.key && (
                        <svg
                          className={cn(
                            'h-3 w-3 transition-transform',
                            sortDir === 'desc' && 'rotate-180',
                          )}
                          fill="none"
                          viewBox="0 0 24 24"
                          strokeWidth={2}
                          stroke="currentColor"
                        >
                          <path
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            d="M5 15l7-7 7 7"
                          />
                        </svg>
                      )}
                    </span>
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100 bg-white dark:divide-gray-800 dark:bg-gray-900/50">
              {isLoading ? (
                Array.from({ length: 5 }).map((_, i) => (
                  <tr key={`skel-${i}`}>
                    {onSelectionChange && <td className="px-4 py-3"><div className="h-4 w-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700" /></td>}
                    {columns.map((col) => (
                      <td key={col.key} className="px-4 py-3">
                        <div
                          className="h-4 animate-pulse rounded bg-gray-200 dark:bg-gray-700"
                          style={{ width: `${40 + Math.random() * 40}%` }}
                        />
                      </td>
                    ))}
                  </tr>
                ))
              ) : sortedData.length === 0 ? (
                <tr>
                  <td
                    colSpan={columns.length + (onSelectionChange ? 1 : 0)}
                    className="px-4 py-12"
                  >
                    {emptyState ?? (
                      <div className="text-center text-sm text-gray-500">
                        No data found
                      </div>
                    )}
                  </td>
                </tr>
              ) : (
                sortedData.map((item) => {
                  const id = keyExtractor(item);
                  const isSelected = selectedIds?.has(id);
                  return (
                    <tr
                      key={id}
                      onClick={() => onRowClick?.(item)}
                      className={cn(
                        'transition-colors',
                        onRowClick && 'cursor-pointer',
                        isSelected
                          ? 'bg-blue-50/50 dark:bg-blue-900/10'
                          : 'hover:bg-gray-50 dark:hover:bg-gray-800/30',
                      )}
                    >
                      {onSelectionChange && (
                        <td className="px-4 py-3">
                          <input
                            type="checkbox"
                            checked={!!isSelected}
                            onChange={() => {
                              const next = new Set(selectedIds);
                              if (isSelected) {
                                next.delete(id);
                              } else {
                                next.add(id);
                              }
                              onSelectionChange(next);
                            }}
                            onClick={(e) => e.stopPropagation()}
                            className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500"
                          />
                        </td>
                      )}
                      {columns.map((col) => (
                        <td
                          key={col.key}
                          className={cn(
                            'whitespace-nowrap px-4 py-3 text-sm text-gray-700 dark:text-gray-300',
                            col.className,
                          )}
                        >
                          {col.render
                            ? col.render(item)
                            : String((item as any)[col.key] ?? '')}
                        </td>
                      ))}
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Pagination */}
      {totalPages > 1 && page && onPageChange && (
        <div className="flex items-center justify-between text-sm text-gray-600 dark:text-gray-400">
          <span>
            Showing {((page - 1) * (pageSize ?? 20)) + 1}–{Math.min(page * (pageSize ?? 20), totalCount ?? 0)} of{' '}
            {totalCount}
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={page <= 1}
              onClick={() => onPageChange(page - 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Previous
            </button>
            <span className="text-xs font-medium">
              Page {page} of {totalPages}
            </span>
            <button
              type="button"
              disabled={page >= totalPages}
              onClick={() => onPageChange(page + 1)}
              className="rounded-lg border border-gray-200 px-3 py-1.5 text-xs font-medium hover:bg-gray-50 disabled:opacity-40 dark:border-gray-700 dark:hover:bg-gray-800"
            >
              Next
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
