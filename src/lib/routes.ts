/**
 * Student route predicates — single source of truth for route-based behavior.
 */

/** Returns true for exam engine routes (test instructions + runner). */
export function isExamEnginePath(pathname: string): boolean {
  return /^\/student\/tests\/[^/]+(\/runner)?\/?$/.test(pathname);
}

/** Returns true for any student portal route. */
export function isStudentPortalPath(pathname: string): boolean {
  return pathname.startsWith('/student');
}
