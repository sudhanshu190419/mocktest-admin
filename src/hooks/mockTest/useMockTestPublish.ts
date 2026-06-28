/**
 * Mock Test Publish Hooks
 *
 * React Query hooks wrapping the mockTestPublishService API calls.
 * Provides cached queries and mutations for the publish workflow.
 *
 * ## Exports
 *
 * | Hook                        | Type     | Description                                     |
 * |-----------------------------|----------|-------------------------------------------------|
 * | `useValidateMockTestReady`  | Query    | Pre-publish validation checklist                |
 * | `usePublishMockTestWorkflow`| Mutation | Full publish workflow (validate → publish)      |
 * | `useUnpublishMockTest`      | Mutation | Unpublish a test (published → draft)            |
 *
 * @module hooks/mockTest/useMockTestPublish
 */

import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { mockTestKeys } from './queryKeys';
import {
  validateMockTestReady,
  publishMockTestWorkflow,
  unpublishMockTest,
} from '../../services/mockTest/mockTestPublishService';
import type { MockTest } from '../../types/mockTest';
import type {
  ValidationReport,
  PublishSummary,
} from '../../services/mockTest/mockTestPublishService';

// ─── Queries ────────────────────────────────────────────────────────────────

/**
 * Run the pre-publish validation checklist for a mock test.
 *
 * The query is disabled when `testId` is falsy. It never throws on
 * validation failure — the `ValidationReport` is returned whether or
 * not the test is ready, allowing the consumer to inspect `isValid`,
 * `errors`, and `warnings`.
 *
 * @param testId - The UUID of the mock test to validate.
 *
 * @example
 * const { data: report } = useValidateMockTestReady(testId);
 * if (report?.isValid) {
 *   // ready to publish
 * } else {
 *   console.log(report?.errors);
 * }
 */
export function useValidateMockTestReady(testId: string | undefined | null) {
  return useQuery<ValidationReport>({
    queryKey: mockTestKeys.publish.validation(testId ?? undefined),
    queryFn: async () => {
      const result = await validateMockTestReady(testId!);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to validate mock test readiness.');
      }
      return result.data!;
    },
    enabled: !!testId,
  });
}

// ─── Mutations ──────────────────────────────────────────────────────────────

/**
 * Execute the full publish workflow for a mock test.
 *
 * Orchestrates: validate → generate snapshots → status transition.
 *
 * On success, invalidates:
 * - Mock test detail (status changed)
 * - Mock test lists (status changed)
 * - Publish validation (no longer needed)
 * - Publish summary (new summary available)
 *
 * @example
 * const { mutate, isPending } = usePublishMockTestWorkflow();
 * mutate(testId, {
 *   onSuccess: (summary) => {
 *     console.log(`Published! ${summary.questionCount} questions.`);
 *   },
 *   onError: (error) => {
 *     console.error('Publish failed:', error.message);
 *   },
 * });
 */
export function usePublishMockTestWorkflow() {
  const queryClient = useQueryClient();

  return useMutation<PublishSummary, Error, string>({
    mutationFn: async (testId) => {
      const result = await publishMockTestWorkflow(testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to publish mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, testId) => {
      // Invalidate the affected mock test
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.detail(testId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });

      // Invalidate publish caches (validation is stale, summary exists)
      queryClient.invalidateQueries({ queryKey: mockTestKeys.publish.validation(testId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.publish.summary(testId) });
    },
  });
}

/**
 * Unpublish a mock test, reverting it from `published` back to `draft`.
 *
 * This is ONLY allowed when no student attempts exist for the test.
 *
 * On success, invalidates:
 * - Mock test detail (status changed)
 * - Mock test lists (status changed)
 * - Publish validation (test can be published again)
 * - Publish summary (no longer applicable)
 *
 * @example
 * const { mutate, isPending } = useUnpublishMockTest();
 * mutate(testId, {
 *   onSuccess: (test) => {
 *     console.log(`Test returned to draft: ${test.title}`);
 *   },
 * });
 */
export function useUnpublishMockTest() {
  const queryClient = useQueryClient();

  return useMutation<MockTest, Error, string>({
    mutationFn: async (testId) => {
      const result = await unpublishMockTest(testId);
      if (!result.success) {
        throw new Error(result.error ?? 'Failed to unpublish mock test.');
      }
      return result.data!;
    },
    onSuccess: (_data, testId) => {
      // Invalidate the affected mock test
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.detail(testId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.mockTests.lists() });

      // Invalidate publish caches (validation is relevant again, summary is stale)
      queryClient.invalidateQueries({ queryKey: mockTestKeys.publish.validation(testId) });
      queryClient.invalidateQueries({ queryKey: mockTestKeys.publish.summary(testId) });
    },
  });
}
