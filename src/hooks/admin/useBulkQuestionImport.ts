/**
 * Bulk Question Import Hook
 *
 * React Query hooks for fetching question reference data and executing
 * bulk question import mutations with cache invalidation.
 *
 * @module hooks/admin/useBulkQuestionImport
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  fetchQuestionReferenceData,
  importBulkQuestions,
} from '@/services/admin/bulkQuestionImportService';
import { questionKeys } from '../mockTest/queryKeys';
import { adminKeys } from './queryKeys';
import type {
  BulkQuestionImportRpcResult,
  QuestionImportPayloadItem,
  QuestionReferenceData,
} from '@/types/bulkQuestionImport';

export const bulkQuestionKeys = {
  all: ['bulk-question-import'] as const,
  referenceData: (instituteId?: string | null) =>
    [...bulkQuestionKeys.all, 'reference-data', instituteId] as const,
};

/**
 * Fetch reference data needed to parse and validate bulk questions.
 */
export function useQuestionReferenceData(instituteId?: string | null) {
  return useQuery<QuestionReferenceData, Error>({
    queryKey: bulkQuestionKeys.referenceData(instituteId),
    queryFn: async () => {
      if (!instituteId) {
        throw new Error('Institute ID is required.');
      }
      const result = await fetchQuestionReferenceData(instituteId);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Failed to load reference data.');
      }
      return result.data;
    },
    enabled: Boolean(instituteId),
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Mutation hook for executing the bulk question import.
 */
export function useImportBulkQuestions() {
  const queryClient = useQueryClient();

  return useMutation<
    BulkQuestionImportRpcResult,
    Error,
    {
      instituteId: string;
      payload: QuestionImportPayloadItem[];
      onProgress?: (completed: number, total: number) => void;
    }
  >({
    mutationFn: async ({ instituteId, payload, onProgress }) => {
      const result = await importBulkQuestions(instituteId, payload, onProgress);
      if (!result.success || !result.data) {
        throw new Error(result.error ?? 'Bulk question import failed.');
      }
      return result.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: questionKeys.questions.lists() });
      queryClient.invalidateQueries({ queryKey: adminKeys.questionApproval.all() });
      queryClient.invalidateQueries({ queryKey: bulkQuestionKeys.all });
    },
  });
}
