'use client';

import { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import type { QuestionFilters } from '@/types/mockTest';

export interface FilterState {
  subjectId: string;
  chapterId: string;
  topicId: string;
  difficulty: string;
  questionType: string;
  status: string;
  search: string;
}

const DEFAULT_FILTERS: FilterState = {
  subjectId: '',
  chapterId: '',
  topicId: '',
  difficulty: '',
  questionType: '',
  status: '',
  search: '',
};

export function useQuestionFilters() {
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const timerRef = useRef<NodeJS.Timeout | null>(null);

  const updateFilter = useCallback((key: keyof FilterState, value: string) => {
    setFilters((prev) => ({ ...prev, [key]: value }));
  }, []);

  const resetFilters = useCallback(() => {
    setFilters(DEFAULT_FILTERS);
    setDebouncedSearch('');
  }, []);

  // Debounce search input (300ms)
  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      setDebouncedSearch(filters.search);
    }, 300);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [filters.search]);

  const apiFilters: QuestionFilters = useMemo(() => {
    const result: QuestionFilters = {};
    if (filters.subjectId) result.subjectId = filters.subjectId;
    if (filters.chapterId) result.chapterId = filters.chapterId;
    if (filters.difficulty) result.difficulty = filters.difficulty as any;
    if (filters.questionType) result.questionType = filters.questionType as any;
    if (filters.status) result.status = filters.status as any;
    if (debouncedSearch) result.search = debouncedSearch;
    return result;
  }, [filters, debouncedSearch]);

  const hasActiveFilters = useMemo(
    () => Object.values(filters).some((v) => v !== ''),
    [filters],
  );

  return {
    filters,
    updateFilter,
    resetFilters,
    apiFilters,
    hasActiveFilters,
    isSearching: filters.search !== debouncedSearch,
  };
}
