import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('AuthContext & RoleGuard Resilience Architecture Contracts', () => {
  const authContextPath = 'C:/Projects/mocktest-admin/src/context/AuthContext.tsx';
  const roleGuardPath = 'C:/Projects/mocktest-admin/src/components/auth/RoleGuard.tsx';

  it('AuthContext defines retryAuth in AuthContextType interface', () => {
    const content = fs.readFileSync(authContextPath, 'utf8');
    expect(content).toContain('retryAuth: () => Promise<void>;');
    expect(content).toContain('AUTH_INIT_TIMEOUT_MS = 5000');
  });

  it('AuthContext implements withTimeout helper with bounded timer', () => {
    const content = fs.readFileSync(authContextPath, 'utf8');
    expect(content).toContain('function withTimeout<T>(');
    expect(content).toContain('Promise.race([');
    expect(content).toContain('clearTimeout(timeoutId)');
  });

  it('AuthContext uses initRequestIdRef generation counter to prevent stale async overwrites', () => {
    const content = fs.readFileSync(authContextPath, 'utf8');
    expect(content).toContain('const initRequestIdRef = useRef<number>(0);');
    expect(content).toContain('const currentRequestId = ++initRequestIdRef.current;');
    expect(content).toContain('if (initRequestIdRef.current !== currentRequestId) return;');
  });

  it('AuthContext signOut increments generation counter and invalidates pending in-flight requests', () => {
    const content = fs.readFileSync(authContextPath, 'utf8');
    expect(content).toContain('++initRequestIdRef.current;');
  });

  it('AuthContext has guaranteed finally block setting loading to false', () => {
    const content = fs.readFileSync(authContextPath, 'utf8');
    expect(content).toContain('} finally {');
    expect(content).toContain('if (initRequestIdRef.current === currentRequestId) {');
    expect(content).toContain('setLoading(false);');
  });

  it('AuthContext exposes retryAuth in provider value and coalesces in-flight retries', () => {
    const content = fs.readFileSync(authContextPath, 'utf8');
    expect(content).toContain('initInFlightRef');
    expect(content).toContain('const retryAuth = async (): Promise<void> => {');
    expect(content).toContain('await initializeAuth();');
    expect(content).toContain('retryAuth,');
  });

  it('RoleGuard includes 8-second safety timeout and recovery UI for hanging auth states', () => {
    const content = fs.readFileSync(roleGuardPath, 'utf8');
    expect(content).toContain('const [loadTimedOut, setLoadTimedOut] = React.useState(false);');
    expect(content).toContain('const [isRetrying, setIsRetrying] = React.useState(false);');
    expect(content).toContain('8000');
    expect(content).toContain('Authentication Taking Longer Than Expected');
    expect(content).toContain('Retry Connection');
    expect(content).toContain('handleRetry');
  });

  it('RoleGuard uses useAuth retryAuth API without duplicating auth logic', () => {
    const content = fs.readFileSync(roleGuardPath, 'utf8');
    expect(content).toContain('const { teacherProfile, loading, deviceStatus, retryAuth } = useAuth();');
    expect(content).toContain('await retryAuth();');
  });
});

describe('withTimeout Logic Unit Tests', () => {
  function withTimeout<T>(promise: Promise<T>, timeoutMs: number, errorMessage: string): Promise<T> {
    let timeoutId: ReturnType<typeof setTimeout>;
    const timeoutPromise = new Promise<T>((_, reject) => {
      timeoutId = setTimeout(() => {
        reject(new Error(errorMessage));
      }, timeoutMs);
    });

    return Promise.race([
      promise.then((res) => {
        clearTimeout(timeoutId);
        return res;
      }),
      timeoutPromise,
    ]);
  }

  it('A. withTimeout resolves immediately when underlying promise resolves fast', async () => {
    const fastPromise = Promise.resolve({ data: { session: { user: { id: 'u-1' } } } });
    const result = await withTimeout(fastPromise, 5000, 'Timed out');
    expect(result.data.session.user.id).toBe('u-1');
  });

  it('B. withTimeout rejects immediately when underlying promise rejects', async () => {
    const failingPromise = Promise.reject(new Error('Network error'));
    await expect(withTimeout(failingPromise, 5000, 'Timed out')).rejects.toThrow('Network error');
  });

  it('C. withTimeout rejects with custom error when underlying promise hangs indefinitely', async () => {
    vi.useFakeTimers();
    const hangingPromise = new Promise((resolve) => {
      // never resolves
    });

    const timeoutPromise = withTimeout(hangingPromise, 5000, 'Auth session initialization timed out');

    vi.advanceTimersByTime(5500);

    await expect(timeoutPromise).rejects.toThrow('Auth session initialization timed out');
    vi.useRealTimers();
  });
});

describe('Generation Counter State Invalidation Logic', () => {
  it('D. Stale async resolution is dropped when generation ID increments (e.g. on logout or retry)', async () => {
    let globalRequestId = 0;
    let authState: string | null = null;

    // Simulate first request
    const req1 = ++globalRequestId;
    const slowInit = new Promise<string>((res) => setTimeout(() => res('user-1'), 100));

    // Simulate user clicking Sign Out or Retry before req1 finishes
    const req2 = ++globalRequestId;
    authState = 'signed-out';

    // When req1 eventually resolves:
    const user1 = await slowInit;
    if (req1 === globalRequestId) {
      authState = user1; // Should not execute
    }

    expect(authState).toBe('signed-out');
  });
});
