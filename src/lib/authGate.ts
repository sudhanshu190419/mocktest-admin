/**
 * Guest Auth Gate Helper (§5.3)
 *
 * Storefront and marketing surfaces remain public.
 * When an unauthenticated guest clicks a commit action (Enroll, Buy, Start Test),
 * this helper redirects them to /login with the return destination in the `next` param.
 */

export interface RouterLike {
  push: (url: string) => void;
}

export function buildLoginRedirectUrl(nextPath?: string): string {
  if (!nextPath || nextPath === '/') {
    return '/login';
  }
  const encoded = encodeURIComponent(nextPath);
  return `/login?next=${encoded}`;
}

export function requireAuth(
  isAuthenticated: boolean,
  router: RouterLike,
  actionOrNextPath: (() => void) | string,
  nextPathFallback?: string
): void {
  if (isAuthenticated) {
    if (typeof actionOrNextPath === 'function') {
      actionOrNextPath();
    } else {
      router.push(actionOrNextPath);
    }
    return;
  }

  const destination =
    typeof actionOrNextPath === 'string'
      ? actionOrNextPath
      : nextPathFallback || (typeof window !== 'undefined' ? window.location.pathname : '/');

  router.push(buildLoginRedirectUrl(destination));
}
