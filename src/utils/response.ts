/**
 * Shared Response Builders
 *
 * Generic helpers for constructing standardised API response shapes
 * used across service layers.
 *
 * @module utils/response
 */

/**
 * Builds a standardised paginated response object.
 *
 * @param data     - The array of items for the current page.
 * @param count    - The total number of items across all pages.
 * @param page     - The current page number (1-indexed).
 * @param pageSize - The number of items per page.
 *
 * @returns A `PaginatedResponse`-compatible shape with computed `pageCount`.
 */
export function buildPaginatedResponse<T>(
  data: T[],
  count: number,
  page: number,
  pageSize: number,
): {
  data: T[];
  count: number;
  page: number;
  pageSize: number;
  pageCount: number;
} {
  return {
    data,
    count,
    page,
    pageSize,
    pageCount: pageSize > 0 ? Math.ceil(count / pageSize) : 0,
  };
}
