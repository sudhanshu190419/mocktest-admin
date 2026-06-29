/**
 * Application Providers
 *
 * Combines all top-level providers required by the shared layer into a
 * single component for the Next.js App Router root layout.
 *
 * Providers included:
 *   - Redux (react-redux) — consumed by the useAuth hook
 *   - React Query (@tanstack/react-query) — consumed by all data hooks
 *
 * @module lib/providers
 */

'use client';

import { useState } from 'react';
import { Provider as ReduxProvider } from 'react-redux';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { makeStore } from '../store';
import type { ReactNode } from 'react';

// ─── React Query Configuration ──────────────────────────────────────────────

/**
 * Creates a singleton QueryClient with sensible defaults for the
 * admin dashboard use case.
 *
 * - `staleTime`: 30 seconds — data is fresh for 30s before refetch.
 * - `gcTime`: 5 minutes — unused query data is garbage collected after 5 min.
 * - `retry`: 1 — failed queries are retried once before surfacing the error.
 * - `refetchOnWindowFocus`: true — keep data fresh when the user returns.
 */
function makeQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30 * 1000,
        gcTime: 5 * 60 * 1000,
        retry: 1,
        refetchOnWindowFocus: true,
      },
    },
  });
}

let browserQueryClient: QueryClient | undefined;

/**
 * Returns a QueryClient singleton for the current environment.
 * - Server-side: creates a new client per request.
 * - Client-side: uses a singleton (module-level cache).
 */
function getQueryClient(): QueryClient {
  if (typeof window === 'undefined') {
    // Server: always create a new client per render.
    return makeQueryClient();
  }
  // Browser: reuse the singleton across renders.
  if (!browserQueryClient) {
    browserQueryClient = makeQueryClient();
  }
  return browserQueryClient;
}

// ─── Provider Component ─────────────────────────────────────────────────────

interface ProvidersProps {
  children: ReactNode;
}

export default function Providers({ children }: ProvidersProps) {
  const [store] = useState(makeStore);
  const queryClient = getQueryClient();

  return (
    <ReduxProvider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ReduxProvider>
  );
}
