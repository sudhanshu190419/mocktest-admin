'use client';

import { useState, useCallback, useMemo } from 'react';

export function useQuestionBulkActions() {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkAction, setBulkAction] = useState<string>('');

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
    setBulkAction('');
  }, []);

  const selectAll = useCallback((ids: string[]) => {
    setSelectedIds(new Set(ids));
  }, []);

  const handleBulkAction = useCallback(
    (action: string) => {
      setBulkAction(action);
    },
    [],
  );

  const selectionCount = useMemo(() => selectedIds.size, [selectedIds]);

  return {
    selectedIds,
    setSelectedIds,
    clearSelection,
    selectAll,
    bulkAction,
    setBulkAction,
    handleBulkAction,
    selectionCount,
  };
}
