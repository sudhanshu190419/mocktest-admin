export function getSafeNextUrl(
  rawNext: string | null | undefined,
  fallback = '/student/overview',
): string {
  if (
    !rawNext ||
    !rawNext.startsWith('/') ||
    rawNext.startsWith('//') ||
    /[\\\u0000-\u0020\u007f]/.test(rawNext)
  )
    return fallback;
  try {
    const base = 'https://navigation.invalid';
    const url = new URL(rawNext, base);
    const path = decodeURIComponent(url.pathname).toLowerCase();
    if (
      url.origin !== base ||
      /[\\\u0000-\u0020\u007f%]/.test(path) ||
      path.startsWith('//') ||
      path.split('/').some((segment) => segment === '.' || segment === '..') ||
      /^\/(login|signup|onboarding|forgot-password)(\/|$)/.test(path)
    )
      return fallback;
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return fallback;
  }
}

export function authRoute(
  path: '/login' | '/signup' | '/signup/verify' | '/onboarding' | '/forgot-password',
  next = '/student/overview',
): string {
  return `${path}?next=${encodeURIComponent(getSafeNextUrl(next, '/student/overview'))}`;
}
