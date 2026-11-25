/**
 * PYQ Mock Mapping Hooks
 *
 * React Query hooks wrapping pyqMockMappingService for generating,
 * viewing, and regenerating mock tests from PYQ papers.
 *
 * ## Exports
 *
 * | Hook                       | Type     | Description                                      |
 * |----------------------------|----------|--------------------------------------------------|
 * | `usePyqMockMapping`        | Query    | Check if a paper has a mock mapping              |
 * | `usePyqMockMappingWithTest`| Query    | Get mapping + full mock test details             |
 * | `useGeneratePyqMock`       | Mutation | Generate a new mock test from a PYQ paper        |
 * | `useRegeneratePyqMock`     | Mutation | Regenerate (replace existing) mock test          |
 *
 * @module hooks/pyq/usePyqMockMapping
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { pyqKeys } from './queryKeys';
import { pyqMockMappingService } from '@/services/pyq/pyqMockMappingService';
import { mockTestKeys } from '@/hooks/mockTest/queryKeys';
import type {
  GenerateMockResult,
  PyqMockMapping,
  AvailableMockTestItem,
  GetAvailableMockTestsParams,
} from '@/services/pyq/pyqMockMappingService';
import type { PaginatedResponse } from '@/types/academic';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Check if a PYQ paper has a mock mapping.
 *
 * @param paperId - The UUID of the PYQ paper.
 *
 * @example
 * const { data } = usePyqMockMapping('paper-uuid');
 * if (data) {
 *   console.log(`Maps to test: ${data.testId}`);
 * }
 */
export function usePyqMockMapping(paperId: string | undefined | null) {
  return useQuery<PyqMockMapping | null>({
    queryKey: pyqKeys.mockMappings.detail(paperId!),
    queryFn: async () => {
      const result = await pyqMockMappingService.getMockMapping(paperId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock mapping.');
      }
      return result.data!;
    },
    enabled: !!paperId,
  });
}

/**
 * Get the mock mapping for a paper along with the full mock test details.
 *
 * @param paperId - The UUID of the PYQ paper.
 *
 * @example
 * const { data } = usePyqMockMappingWithTest('paper-uuid');
 * if (data) {
 *   console.log(`Test: ${data.mockTest.title}, Status: ${data.mockTest.status}`);
 * }
 */
export function usePyqMockMappingWithTest(paperId: string | undefined | null) {
  return useQuery<GenerateMockResult | null>({
    queryKey: [...pyqKeys.mockMappings.detail(paperId!), 'withTest'],
    queryFn: async () => {
      const result = await pyqMockMappingService.getMockMappingWithTest(paperId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch mock mapping with test details.');
      }
      return result.data!;
    },
    enabled: !!paperId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Generate a new mock test from a PYQ paper.
 *
 * On success, invalidates:
 * - The mock mapping detail cache (so the UI reflects the new mapping)
 * - The mock test list cache (so the mock test appears in the tests list)
 *
 * @example
 * const generate = useGeneratePyqMock();
 * generate.mutate('paper-uuid', {
 *   onSuccess: (result) => console.log(`Created test: ${result.mockTest.testId}`),
 * });
 */
export function useGeneratePyqMock() {
  const queryClient = useQueryClient();

  return useMutation<
    GenerateMockResult,
    Error,
    string  // paperId
  >({
    mutationFn: async (paperId) => {
      const result = await pyqMockMappingService.generateMockFromPaper(paperId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to generate mock test.');
      }
      return result.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.mockMappings.detail(data.mockMapping.paperId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.lists(),
      });
    },
  });
}

/**
 * Regenerate (replace existing) a mock test for a PYQ paper.
 *
 * On success, invalidates:
 * - The mock mapping detail cache
 * - The mock test list cache
 * - The old mock test detail cache (since it no longer exists)
 *
 * @example
 * const regenerate = useRegeneratePyqMock();
 * regenerate.mutate('paper-uuid', {
 *   onSuccess: (result) => console.log(`Replaced with test: ${result.mockTest.testId}`),
 * });
 */
export function useRegeneratePyqMock() {
  const queryClient = useQueryClient();

  return useMutation<
    GenerateMockResult,
    Error,
    string  // paperId
  >({
    mutationFn: async (paperId) => {
      const result = await pyqMockMappingService.regenerateMockFromPaper(paperId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to regenerate mock test.');
      }
      return result.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.mockMappings.detail(data.mockMapping.paperId),
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.lists(),
      });
    },
  });
}

/**
 * Query available published mock tests in the institute that can be linked to a paper.
 *
 * Scoped to published mock tests with at least 1 question that are not already
 * mapped to any package paper.
 *
 * @param instituteId - Target institute UUID
 * @param options - Search and pagination filters
 */
export function useAvailableMockTestsQuery(
  instituteId: string | undefined | null,
  options?: GetAvailableMockTestsParams,
) {
  const page = options?.page ?? 1;
  const search = options?.search ?? '';
  return useQuery<PaginatedResponse<AvailableMockTestItem>>({
    queryKey: pyqKeys.mockMappings.availableMockTests(instituteId ?? undefined, search, page),
    queryFn: async () => {
      const result = await pyqMockMappingService.getAvailableExistingMockTests(instituteId, options);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to fetch available mock tests.');
      }
      return result.data!;
    },
    enabled: !!instituteId,
  });
}

export const useAvailableExistingMockTests = useAvailableMockTestsQuery;

/**
 * Assign / link an existing published mock test to an unmapped package paper.
 *
 * On success, invalidates:
 * - Mock mapping detail cache for this paper (updates mapped card immediately)
 * - Available mock tests list cache
 * - Mock test lists cache
 */
export function useAssignExistingMockTestMutation() {
  const queryClient = useQueryClient();

  return useMutation<
    GenerateMockResult,
    Error,
    { paperId: string; testId: string }
  >({
    mutationFn: async ({ paperId, testId }) => {
      const result = await pyqMockMappingService.assignExistingMockTest(paperId, testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to link mock test.');
      }
      return result.data!;
    },
    onSuccess: (data) => {
      queryClient.invalidateQueries({
        queryKey: pyqKeys.mockMappings.detail(data.mockMapping.paperId),
      });
      queryClient.invalidateQueries({
        queryKey: [...pyqKeys.mockMappings.all(), 'availableMockTests'],
      });
      queryClient.invalidateQueries({
        queryKey: mockTestKeys.mockTests.lists(),
      });
    },
  });
}

export const useAssignExistingMockTest = useAssignExistingMockTestMutation;
