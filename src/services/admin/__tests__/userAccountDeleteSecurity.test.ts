import { describe, it, expect, vi } from 'vitest';
/**
 * User Account Deletion & OTP Re-authentication Security Tests
 *
 * Validates Security Finding F-02, Recursive Storage Cleanup & Durable Failure/Retry Scenarios A–F:
 * - Server-side enforcement of recent OTP re-authentication (amr claim <= 300s).
 * - Strict token subject binding (claims.sub required, must be string, must match verified userId).
 * - Immediate rejection (HTTP 401) on missing or invalid JWT authentication.
 * - Rejection (HTTP 403) on valid JWT without recent OTP (password-only, missing amr, stale > 300s, future timestamp).
 * - Complete protection of destructive operations: storage cleanup, database RPC, and Auth admin deletion
 *   are NEVER invoked when authentication or OTP re-authentication fails.
 * - Recursive Storage Cleanup: handles >500 files, multi-level nested folders, files + folders mixed,
 *   removal errors, nested folder errors, empty verification, empty prefix, and idempotent retries.
 * - Outbox Security & Update Verification: halts before Auth deletion if storage_completed update fails;
 *   returns 500 if finalization update fails; guarantees durable recovery for Scenarios A–F.
 */

import {
  handleUserAccountDelete,
  validateOtpReauthentication,
  cleanStoragePrefix,
  cleanExplicitStoragePaths,
  deduplicateStoragePaths,
  isStorageFolderEntry,
  recoverAccountDeletionJobs,
  MAX_STORAGE_RECURSION_DEPTH,
  MAX_STORAGE_PAGES_PER_FOLDER,
  UserJwtClaims,
  UserAccountDeleteDependencies,
} from '../../../../supabase/functions/user-account-delete/accountDeleteCore';

describe('F-02: User Account Deletion Server-Side OTP Re-authentication & Durable Recovery Suite', () => {
  const referenceNowMs = 1770000000 * 1000; // Fixed timestamp: 1770000000 seconds
  const referenceNowSec = 1770000000;
  const testUserId = '11111111-2222-3333-4444-555555555555';
  const victimUserId = '99999999-8888-7777-6666-555555555555';

  function createTestJwt(payload: Record<string, any>): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    const signature = 'valid_test_signature_bytes';
    return `${header}.${body}.${signature}`;
  }

  function createValidOtpClaims(overrides: Partial<UserJwtClaims> = {}): UserJwtClaims {
    return {
      sub: testUserId,
      email: 'student@example.com',
      phone: '+919876543210',
      role: 'authenticated',
      amr: [
        {
          method: 'otp',
          timestamp: referenceNowSec - 30, // 30 seconds ago (well within 300s limit)
        },
      ],
      iat: referenceNowSec - 30,
      exp: referenceNowSec + 3600,
      ...overrides,
    };
  }

  /**
   * In-memory virtual storage client mock for faithful, deterministic testing
   * of recursive list, remove, pagination, and emptiness verification.
   */
  function createVirtualStorageClient(initialFiles: string[] = []) {
    const files = new Set<string>(initialFiles);

    const storageMethods = {
      list: vi.fn(async (prefix: string, options: { limit?: number; offset?: number } = {}) => {
        const normPrefix = (prefix || '').replace(/^\/+|\/+$/g, '');
        const pfx = normPrefix ? `${normPrefix}/` : '';
        const limit = options.limit || 100;
        const offset = options.offset || 0;

        const directChildren = new Map<string, { name: string; id: string | null; metadata: any }>();
        for (const file of files) {
          if (file.startsWith(pfx)) {
            const rel = file.slice(pfx.length);
            const parts = rel.split('/');
            const name = parts[0];
            const isFolder = parts.length > 1;
            if (!directChildren.has(name)) {
              directChildren.set(name, {
                name,
                id: isFolder ? null : `id-${name}`,
                metadata: isFolder ? null : { size: 100 },
              });
            }
          }
        }
        const allItems = Array.from(directChildren.values());
        return { data: allItems.slice(offset, offset + limit), error: null };
      }),
      remove: vi.fn(async (pathsToDelete: string[]) => {
        for (const p of pathsToDelete) {
          files.delete(p);
        }
        return { data: pathsToDelete.map((p) => ({ name: p })), error: null };
      }),
    };

    return {
      files,
      storage: {
        from: vi.fn(() => storageMethods),
      },
      methods: storageMethods,
    };
  }

  interface MockDepsOptions {
    authUser?: any;
    authError?: any;
    claimsOverride?: any;
    rpcError?: any;
    deleteUserError?: any;
    nowMs?: number;
    studentId?: string | null;
    teacherId?: string | null;
    storageListError?: any;
    storageRemoveError?: any;
    storageCompletedUpdateError?: any;
    finalUpdateError?: any;
    onStorageList?: (bucket: string, prefix: string) => void;
    profileRole?: string;
    profileRow?: any;
    profileError?: any;
    outboxRow?: any;
    outboxStatus?: string;
    outboxRole?: string;
    outboxLookupError?: any;
    doubtAttachments?: Array<{ bucket?: string; storage_path: string; doubt_id?: string; uploaded_by?: string }>;
    pendingStoragePaths?: Array<{ bucket?: string; storage_path: string }>;
    outboxPendingPaths?: Array<{ bucket?: string; storage_path: string }>;
    rpcPendingPaths?: Array<{ bucket?: string; storage_path: string }>;
  }

  function createMockEnvironment(options: MockDepsOptions = {}) {
    const authUser = options.authUser !== undefined
      ? options.authUser
      : { id: testUserId, email: 'student@example.com', phone: '+919876543210' };

    const studentRecord = options.studentId !== undefined
      ? (options.studentId ? { student_id: options.studentId } : null)
      : { student_id: 'student-1234' };

    const teacherRecord = options.teacherId !== undefined
      ? (options.teacherId ? { teacher_id: options.teacherId } : null)
      : null;

    const profileRecord = options.profileRow !== undefined
      ? options.profileRow
      : (options.profileRole !== null
          ? { profile_id: authUser?.id || testUserId, role: options.profileRole || 'student' }
          : null);

    const outboxRecord = options.outboxRow !== undefined
      ? options.outboxRow
      : (options.outboxStatus
          ? {
              profile_id: authUser?.id || testUserId,
              user_role: options.outboxRole || 'student',
              status: options.outboxStatus,
              pending_storage_paths: options.outboxPendingPaths || options.pendingStoragePaths || (options.doubtAttachments || []).map((d: any) => ({
                bucket: d.bucket || 'doubt-attachments',
                storage_path: d.storage_path,
              })),
            }
          : null);

    const outboxUpdateEqSpy = vi.fn().mockImplementation(async (field: string, val: any) => {
      return { data: null, error: null };
    });

    const outboxUpdateSpy = vi.fn().mockImplementation((payload: any) => {
      if (payload.status === 'storage_completed' && options.storageCompletedUpdateError) {
        return { eq: vi.fn().mockResolvedValue({ data: null, error: options.storageCompletedUpdateError }) };
      }
      if (payload.status === 'completed' && options.finalUpdateError) {
        return { eq: vi.fn().mockResolvedValue({ data: null, error: options.finalUpdateError }) };
      }
      return { eq: outboxUpdateEqSpy };
    });

    const deletedPaths = new Set<string>();

    const spies = {
      getUserSpy: vi.fn().mockResolvedValue({
        data: { user: authUser },
        error: options.authError || null,
      }),
      getClaimsSpy: vi.fn(),
      rpcSpy: vi.fn().mockResolvedValue({
        data: {
          success: true,
          profile_id: testUserId,
          student_id: studentRecord?.student_id || null,
          teacher_id: teacherRecord?.teacher_id || null,
          pending_storage_paths: options.rpcPendingPaths || options.pendingStoragePaths || (options.doubtAttachments || []).map((d: any) => ({
            bucket: d.bucket || 'doubt-attachments',
            storage_path: d.storage_path,
          })),
        },
        error: options.rpcError || null,
      }),
      storageListSpy: vi.fn().mockResolvedValue({
        data: [{ name: 'avatar.png', id: 'id-1', metadata: { size: 10 } }],
        error: options.storageListError || null,
      }),
      storageRemoveSpy: vi.fn().mockResolvedValue({
        data: [{ name: 'avatar.png' }],
        error: options.storageRemoveError || null,
      }),
      deleteUserAdminSpy: vi.fn().mockResolvedValue({
        data: { user: null },
        error: options.deleteUserError || null,
      }),
      selectStudentSpy: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: studentRecord,
            error: null,
          }),
        }),
      }),
      selectTeacherSpy: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue({
            data: teacherRecord,
            error: null,
          }),
        }),
      }),
      selectProfileSpy: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue(
            options.profileError
              ? { data: null, error: options.profileError }
              : { data: profileRecord, error: null }
          ),
        }),
      }),
      selectOutboxSpy: vi.fn().mockReturnValue({
        eq: vi.fn().mockReturnValue({
          maybeSingle: vi.fn().mockResolvedValue(
            options.outboxLookupError
              ? { data: null, error: options.outboxLookupError }
              : { data: outboxRecord, error: null }
          ),
        }),
      }),
      outboxUpdateSpy,
      outboxUpdateEqSpy,
    };

    if (options.claimsOverride !== undefined) {
      spies.getClaimsSpy.mockResolvedValue({
        data: { claims: options.claimsOverride },
        error: null,
      });
    }

    const mockCallerClient = {
      auth: {
        getUser: spies.getUserSpy,
        getClaims: options.claimsOverride !== undefined ? spies.getClaimsSpy : undefined,
      },
    };

    const mockAdminClient = {
      from: vi.fn((table: string) => {
        if (table === 'profiles') {
          return { select: spies.selectProfileSpy };
        }
        if (table === 'student_details') {
          return { select: spies.selectStudentSpy };
        }
        if (table === 'teacher_details') {
          return { select: spies.selectTeacherSpy };
        }
        if (table === 'doubt_attachments') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: any) => {
                const files = (options.doubtAttachments || []).filter((d: any) =>
                  col === 'uploaded_by' ? d.uploaded_by === val : true
                );
                return Promise.resolve({ data: files, error: null });
              }),
              in: vi.fn().mockImplementation((col: string, vals: any[]) => {
                const files = (options.doubtAttachments || []).filter((d: any) =>
                  col === 'doubt_id' ? vals.includes(d.doubt_id) : true
                );
                return Promise.resolve({ data: files, error: null });
              }),
            }),
          };
        }
        if (table === 'student_doubts') {
          return {
            select: vi.fn().mockReturnValue({
              eq: vi.fn().mockImplementation((col: string, val: any) => {
                const doubtIds = Array.from(
                  new Set((options.doubtAttachments || []).map((d: any) => d.doubt_id).filter(Boolean))
                ).map((id) => ({ doubt_id: id }));
                return Promise.resolve({ data: doubtIds, error: null });
              }),
            }),
          };
        }
        if (table === 'account_deletion_records') {
          return {
            select: spies.selectOutboxSpy,
            update: spies.outboxUpdateSpy,
          };
        }
        return {
          select: vi.fn().mockReturnValue({
            eq: vi.fn().mockReturnValue({
              maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }),
            }),
          }),
          update: spies.outboxUpdateSpy,
        };
      }),
      storage: {
        from: vi.fn((bucket: string) => ({
          list: vi.fn(async (prefix: string, opts?: any) => {
            if (options.onStorageList) {
              options.onStorageList(bucket, prefix);
            }
            if (options.storageListError) {
              return { data: null, error: options.storageListError };
            }
            // If the files for this bucket/prefix were removed, return empty array to confirm verification
            const key = `${bucket}/${prefix}/avatar.png`;
            if (deletedPaths.has(key)) {
              return { data: [], error: null };
            }
            return spies.storageListSpy(prefix, opts);
          }),
          remove: vi.fn(async (paths: string[]) => {
            if (options.storageRemoveError) {
              return { data: null, error: options.storageRemoveError };
            }
            for (const p of paths) {
              deletedPaths.add(`${bucket}/${p}`);
            }
            return spies.storageRemoveSpy(paths);
          }),
        })),
      },
      rpc: spies.rpcSpy,
      auth: {
        admin: {
          deleteUser: spies.deleteUserAdminSpy,
        },
      },
    };

    const deps: UserAccountDeleteDependencies = {
      createSupabaseClient: vi.fn((url: string, key: string, opts?: any) => {
        if (key === 'test-service-role-key') {
          return mockAdminClient;
        }
        return mockCallerClient;
      }),
      nowMs: () => (options.nowMs !== undefined ? options.nowMs : referenceNowMs),
      env: {
        SUPABASE_URL: 'https://test.supabase.co',
        SUPABASE_ANON_KEY: 'test-anon-key',
        SUPABASE_SERVICE_ROLE_KEY: 'test-service-role-key',
      },
    };

    return { deps, spies, mockAdminClient, mockCallerClient };
  }

  function createDeleteRequest(authHeader?: string | null): Request {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    };
    if (authHeader !== undefined && authHeader !== null) {
      headers['Authorization'] = authHeader;
    }
    return new Request('https://test.supabase.co/functions/v1/user-account-delete', {
      method: 'POST',
      headers,
    });
  }

  // ── 1. Pure Unit Tests: validateOtpReauthentication & Subject Binding ────────
  describe('Pure Claim Validation & Strict Subject Binding: validateOtpReauthentication', () => {
    it('accepts valid claims with matching subject and fresh OTP within 300 seconds', () => {
      const claims = createValidOtpClaims({
        sub: testUserId,
        amr: [{ method: 'otp', timestamp: referenceNowSec - 60 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.otpTimestamp).toBe(referenceNowSec - 60);
    });

    it('rejects when token sub is missing (undefined)', () => {
      const claims = createValidOtpClaims({ sub: undefined });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Missing or malformed token subject');
    });

    it('rejects when token sub is empty string', () => {
      const claims = createValidOtpClaims({ sub: '' });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Missing or malformed token subject');
    });

    it('rejects when token sub is non-string (number)', () => {
      const claims = createValidOtpClaims({ sub: 12345 as any });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Missing or malformed token subject');
    });

    it('rejects when token sub is non-string (boolean)', () => {
      const claims = createValidOtpClaims({ sub: true as any });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Missing or malformed token subject');
    });

    it('rejects when token sub is non-string (object)', () => {
      const claims = createValidOtpClaims({ sub: {} as any });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Missing or malformed token subject');
    });

    it('rejects when token sub does not match authenticated user id', () => {
      const claims = createValidOtpClaims({ sub: victimUserId });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Token subject does not match authenticated user');
    });

    it('accepts valid claims with method "sms" within 300 seconds', () => {
      const claims = createValidOtpClaims({
        amr: [{ method: 'sms', timestamp: referenceNowSec - 45 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('accepts OTP with allowable clock skew (e.g. +5 seconds in future)', () => {
      const claims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec + 5 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(true);
      expect(result.statusCode).toBe(200);
    });

    it('rejects OTP timestamp in the future beyond clock-skew tolerance (+15s)', () => {
      const claims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec + 15 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('future beyond allowable clock skew');
    });

    it('rejects OTP timestamp older than 300 seconds (301 seconds)', () => {
      const claims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 301 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('OTP authentication has expired');
    });

    it('rejects missing or null amr array', () => {
      const claims = createValidOtpClaims({ amr: undefined });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Missing authentication method references (amr)');
    });

    it('rejects amr containing only non-OTP methods (e.g. password, oauth)', () => {
      const claims = createValidOtpClaims({
        amr: [
          { method: 'password', timestamp: referenceNowSec - 10 },
          { method: 'oauth', timestamp: referenceNowSec - 10 },
        ],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('requires verified OTP authentication');
    });

    it('picks the most recent OTP entry when multiple amr entries exist', () => {
      const claims = createValidOtpClaims({
        amr: [
          { method: 'otp', timestamp: referenceNowSec - 500 }, // Expired
          { method: 'password', timestamp: referenceNowSec - 100 },
          { method: 'otp', timestamp: referenceNowSec - 20 }, // Fresh
        ],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.otpTimestamp).toBe(referenceNowSec - 20);
    });

    it('handles millisecond timestamps gracefully in amr', () => {
      const claims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: (referenceNowSec - 30) * 1000 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(true);
      expect(result.statusCode).toBe(200);
      expect(result.otpTimestamp).toBe(referenceNowSec - 30);
    });

    it('rejects non-numeric or negative OTP timestamps', () => {
      const claims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: -100 }],
      });
      const result = validateOtpReauthentication(claims, testUserId, referenceNowMs);

      expect(result.authorized).toBe(false);
      expect(result.statusCode).toBe(403);
      expect(result.errorMessage).toContain('Malformed OTP timestamp');
    });
  });

  // ── 2. Storage Entry Type Identifier Tests ─────────────────────────────────
  describe('isStorageFolderEntry', () => {
    it('identifies folder entry when id is null', () => {
      expect(isStorageFolderEntry({ name: 'subfolder', id: null, metadata: null })).toBe(true);
    });

    it('identifies folder entry when id is undefined', () => {
      expect(isStorageFolderEntry({ name: 'subfolder' })).toBe(true);
    });

    it('identifies file entry when id is present', () => {
      expect(isStorageFolderEntry({ name: 'avatar.png', id: 'id-123', metadata: { size: 100 } })).toBe(false);
    });

    it('treats .emptyFolderPlaceholder as a file to delete, never a folder to recurse', () => {
      expect(isStorageFolderEntry({ name: '.emptyFolderPlaceholder', id: null, metadata: null })).toBe(false);
      expect(isStorageFolderEntry({ name: '.emptyFolderPlaceholder', id: 'placeholder-id', metadata: null })).toBe(false);
    });
  });

  // ── 3. Recursive Storage Prefix Cleaner Tests ──────────────────────────────
  describe('Recursive Storage Prefix Cleaner: cleanStoragePrefix', () => {
    it('returns success: true when prefix is empty without making API calls', async () => {
      const mockClient = { storage: { from: vi.fn() } };
      const res = await cleanStoragePrefix(mockClient, 'bucket', '');
      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(0);
      expect(mockClient.storage.from).not.toHaveBeenCalled();
    });

    it('handles a fully empty prefix cleanly', async () => {
      const virtual = createVirtualStorageClient([]);
      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-empty');
      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(0);
    });

    it('cleans a flat prefix with more than 500 files across multiple pagination batches', async () => {
      const initialFiles = Array.from({ length: 550 }, (_, i) => `user-large/file_${i}.png`);
      const virtual = createVirtualStorageClient(initialFiles);

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-large');

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(550);
      expect(virtual.files.size).toBe(0);
    });

    it('cleans a nested folder with multiple levels (e.g. prefix/docs/tax/2024/w2.pdf)', async () => {
      const initialFiles = [
        'user-nested/root_file.txt',
        'user-nested/docs/doc1.pdf',
        'user-nested/docs/tax/summary.txt',
        'user-nested/docs/tax/2024/w2.pdf',
      ];
      const virtual = createVirtualStorageClient(initialFiles);

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-nested');

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(4);
      expect(virtual.files.size).toBe(0);
    });

    it('cleans a directory listing containing both files and folders', async () => {
      const initialFiles = [
        'user-mixed/profile.jpg',
        'user-mixed/banner.png',
        'user-mixed/notes/lecture1.pdf',
        'user-mixed/notes/lecture2.pdf',
      ];
      const virtual = createVirtualStorageClient(initialFiles);

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-mixed');

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(4);
      expect(virtual.files.size).toBe(0);
    });

    it('aborts and returns success: false on file removal error', async () => {
      const virtual = createVirtualStorageClient(['user-err/file1.png']);
      virtual.methods.remove.mockResolvedValueOnce({
        data: null,
        error: { message: 'S3 DeleteObject permission denied' },
      });

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-err');

      expect(res.success).toBe(false);
      expect(res.error).toContain('S3 DeleteObject permission denied');
      expect(virtual.files.has('user-err/file1.png')).toBe(true);
    });

    it('aborts and returns success: false on nested folder cleanup error', async () => {
      const virtual = createVirtualStorageClient(['user-err/sub/file1.png']);
      virtual.methods.list.mockImplementation(async (prefix: string) => {
        if (prefix === 'user-err/sub') {
          return { data: null, error: { message: 'Subfolder S3 read error' } };
        }
        return { data: [{ name: 'sub', id: null, metadata: null }], error: null };
      });

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-err');

      expect(res.success).toBe(false);
      expect(res.error).toContain('Subfolder S3 read error');
    });

    it('returns success: false when prefix cannot be verified empty after deletion', async () => {
      const virtual = createVirtualStorageClient(['user-stubborn/file.txt']);
      let listCount = 0;
      virtual.methods.list.mockImplementation(async (prefix: string) => {
        listCount++;
        if (listCount === 1) {
          return { data: [{ name: 'file.txt', id: 'id-1', metadata: { size: 10 } }], error: null };
        }
        return { data: [{ name: 'ghost_file.txt', id: 'id-ghost', metadata: { size: 10 } }], error: null };
      });

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'user-stubborn');

      expect(res.success).toBe(false);
      expect(res.error).toContain('is not empty after cleanup');
    });

    it('supports safe retries after successful cleanup (idempotent)', async () => {
      const virtual = createVirtualStorageClient(['user-retry/avatar.png']);

      // 1. First cleanup run deletes the file
      const firstRes = await cleanStoragePrefix(virtual, 'test-bucket', 'user-retry');
      expect(firstRes.success).toBe(true);
      expect(firstRes.deletedCount).toBe(1);
      expect(virtual.files.size).toBe(0);

      // 2. Retry run on now-empty prefix reports success with 0 deletions
      const retryRes = await cleanStoragePrefix(virtual, 'test-bucket', 'user-retry');
      expect(retryRes.success).toBe(true);
      expect(retryRes.deletedCount).toBe(0);
    });
  });

  // ── 4. Full HTTP Handler: handleUserAccountDelete ──────────────────────────
  describe('Full HTTP Handler: handleUserAccountDelete', () => {
    it('1. returns 200 for CORS preflight OPTIONS request', async () => {
      const req = new Request('https://test.supabase.co/functions/v1/user-account-delete', {
        method: 'OPTIONS',
      });
      const res = await handleUserAccountDelete(req);
      expect(res.status).toBe(200);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('*');
      expect(res.headers.get('Access-Control-Allow-Methods')).toContain('POST');
    });

    it('2. rejects non-POST requests with HTTP 405', async () => {
      const req = new Request('https://test.supabase.co/functions/v1/user-account-delete', {
        method: 'GET',
      });
      const res = await handleUserAccountDelete(req);
      expect(res.status).toBe(405);
      const body = await res.json();
      expect(body.error).toContain('Method not allowed');
    });

    it('3. rejects requests missing Authorization header with HTTP 401', async () => {
      const req = createDeleteRequest(null);
      const res = await handleUserAccountDelete(req);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Authentication required');
    });

    it('4. rejects invalid or expired Bearer token with HTTP 401', async () => {
      const { deps } = createMockEnvironment({
        authError: { message: 'Token is expired or invalid' },
        authUser: null,
      });
      const req = createDeleteRequest('Bearer invalid.jwt.token');
      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(401);
      const body = await res.json();
      expect(body.error).toContain('Invalid or expired authentication token');
    });

    it('5. rejects valid JWT without OTP (password-only sign-in) with HTTP 403', async () => {
      const passwordOnlyClaims = createValidOtpClaims({
        amr: [{ method: 'password', timestamp: referenceNowSec - 100 }],
      });
      const token = createTestJwt(passwordOnlyClaims);
      const { deps, spies } = createMockEnvironment();
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Account deletion requires verified OTP authentication');
      expect(spies.rpcSpy).not.toHaveBeenCalled();
    });

    it('6. rejects stale OTP authentication (>300s old) with HTTP 403', async () => {
      const staleClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 301 }],
      });
      const token = createTestJwt(staleClaims);
      const { deps, spies } = createMockEnvironment();
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('OTP authentication has expired');
      expect(spies.rpcSpy).not.toHaveBeenCalled();
    });

    it('7. accepts a recent verified OTP authentication with HTTP 200 and completes deletion', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 25 }],
      });
      const token = createTestJwt(freshOtpClaims);
      const { deps, spies } = createMockEnvironment();
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.userId).toBe(testUserId);
      expect(spies.rpcSpy).toHaveBeenCalledWith('delete_user_account_data', {
        p_target_profile_id: testUserId,
      });
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    it('8. rejects request when token sub does not match authenticated user id with HTTP 403', async () => {
      const mismatchedClaims = createValidOtpClaims({ sub: victimUserId });
      const token = createTestJwt(mismatchedClaims);
      const { deps, spies } = createMockEnvironment();
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Token subject does not match authenticated user');
      expect(spies.rpcSpy).not.toHaveBeenCalled();
    });

    it('9. guarantees rejected requests NEVER invoke storage, RPC, or Auth admin deletion', async () => {
      const expiredClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 500 }],
      });
      const token = createTestJwt(expiredClaims);
      const { deps, spies, mockAdminClient } = createMockEnvironment();
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(403);
      expect(spies.storageListSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
      expect(mockAdminClient.from).not.toHaveBeenCalled();
    });

    it('10. verifies legitimate mobile OTP deletion flow compatibility', async () => {
      const mobileOtpClaims = createValidOtpClaims({
        sub: testUserId,
        phone: '+919876543210',
        amr: [
          { method: 'password', timestamp: referenceNowSec - 7200 },
          { method: 'otp', timestamp: referenceNowSec - 2 },
        ],
      });
      const mobileToken = createTestJwt(mobileOtpClaims);
      const { deps, spies } = createMockEnvironment();
      const req = createDeleteRequest(`Bearer ${mobileToken}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(spies.rpcSpy).toHaveBeenCalledWith('delete_user_account_data', {
        p_target_profile_id: testUserId,
      });
    });

    it('11. verifies legitimate web OTP deletion flow compatibility', async () => {
      const webOtpClaims = createValidOtpClaims({
        sub: testUserId,
        phone: '+919876543210',
        amr: [{ method: 'otp', timestamp: referenceNowSec - 5 }],
      });
      const webToken = createTestJwt(webOtpClaims);
      const { deps, spies } = createMockEnvironment({
        claimsOverride: webOtpClaims,
      });
      const req = createDeleteRequest(`Bearer ${webToken}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    it('12. asserts execution order: auth & OTP verification strictly precede destructive operations', async () => {
      const executionOrder: string[] = [];
      const { deps, spies } = createMockEnvironment();
      spies.getUserSpy.mockImplementation(async () => {
        executionOrder.push('auth.getUser');
        return { data: { user: { id: testUserId } }, error: null };
      });
      spies.rpcSpy.mockImplementation(async () => {
        executionOrder.push('adminClient.rpc.delete_user_account_data');
        return { data: { success: true }, error: null };
      });
      spies.deleteUserAdminSpy.mockImplementation(async () => {
        executionOrder.push('adminClient.auth.admin.deleteUser');
        return { data: { user: null }, error: null };
      });

      const freshToken = createTestJwt(createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      }));
      const req = createDeleteRequest(`Bearer ${freshToken}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(200);
      expect(executionOrder).toEqual([
        'auth.getUser',
        'adminClient.rpc.delete_user_account_data',
        'adminClient.auth.admin.deleteUser',
      ]);
    });

    it('13. enforces strict operational sequence: DB RPC -> storage cleanup -> Auth admin deletion', async () => {
      const detailedExecutionOrder: string[] = [];
      const { deps, spies } = createMockEnvironment();
      spies.getUserSpy.mockImplementation(async () => {
        detailedExecutionOrder.push('auth.getUser');
        return { data: { user: { id: testUserId } }, error: null };
      });
      spies.rpcSpy.mockImplementation(async () => {
        detailedExecutionOrder.push('db.rpc.delete_user_account_data');
        return { data: { success: true, student_id: 'student-1234' }, error: null };
      });
      spies.storageRemoveSpy.mockImplementation(async () => {
        detailedExecutionOrder.push('storage.remove');
        return { data: [{ name: 'file.png' }], error: null };
      });
      spies.deleteUserAdminSpy.mockImplementation(async () => {
        detailedExecutionOrder.push('auth.admin.deleteUser');
        return { data: { user: null }, error: null };
      });

      const freshToken = createTestJwt(createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 15 }],
      }));
      const req = createDeleteRequest(`Bearer ${freshToken}`);

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(200);

      const rpcIndex = detailedExecutionOrder.indexOf('db.rpc.delete_user_account_data');
      const storageIndex = detailedExecutionOrder.indexOf('storage.remove');
      const authDeleteIndex = detailedExecutionOrder.indexOf('auth.admin.deleteUser');

      expect(rpcIndex).toBeGreaterThan(-1);
      expect(storageIndex).toBeGreaterThan(rpcIndex);
      expect(authDeleteIndex).toBeGreaterThan(storageIndex);
    });
  });

  // ── 5. Scenarios A–F: Partial-Failure & Durable Retry Recovery Suite ────────
  describe('Durable Partial-Failure Recovery & Retry Scenarios A–F', () => {
    // SCENARIO A: Database RPC fails or times out
    it('Scenario A: Database RPC fails or times out -> halts immediately without touching storage or Auth deletion', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const token = createTestJwt(freshOtpClaims);
      const { deps, spies } = createMockEnvironment({
        rpcError: { message: 'canceling statement due to statement timeout', code: '57014' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to delete database records');
      expect(body.error).toContain('statement timeout');

      // Crucial: RPC was executed, but storage cleanup and Auth deletion were NEVER attempted!
      expect(spies.rpcSpy).toHaveBeenCalledTimes(1);
      expect(spies.storageListSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    // SCENARIO B: Database RPC succeeds, but storage cleanup fails
    it('Scenario B: Database RPC succeeds, but storage cleanup fails -> records storage_failed in outbox and DOES NOT delete Auth user', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const token = createTestJwt(freshOtpClaims);
      const { deps, spies } = createMockEnvironment({
        storageRemoveError: { message: 'Storage bucket S3 connection timeout' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to complete storage file cleanup');
      expect(body.error).toContain('Storage bucket S3 connection timeout');

      // Database RPC succeeded
      expect(spies.rpcSpy).toHaveBeenCalledTimes(1);

      // Outbox status was durably updated to 'storage_failed'
      expect(spies.outboxUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'storage_failed',
          storage_clean: false,
          error_message: expect.stringContaining('Storage bucket S3 connection timeout'),
        }),
      );

      // CRITICAL SAFETY REQUIREMENT: Auth user MUST NOT be deleted while storage cleanup is incomplete!
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    // SCENARIO B.2: Storage succeeds, but durably recording storage_completed fails
    it('Scenario B.2: Storage succeeds, but outbox update to storage_completed fails -> halts immediately and DOES NOT delete Auth user', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const token = createTestJwt(freshOtpClaims);
      const { deps, spies } = createMockEnvironment({
        storageCompletedUpdateError: { message: 'Database connection dropped during outbox write' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('durably recording state failed');
      expect(body.details).toContain('Database connection dropped during outbox write');

      // CRITICAL: Auth deletion MUST NOT proceed if the durable storage_completed state could not be confirmed!
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    // SCENARIO C: Database RPC and storage cleanup succeed, but Auth deletion fails
    it('Scenario C: DB RPC and storage succeed, but Auth deletion fails -> records auth_failed in outbox and returns 500', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const token = createTestJwt(freshOtpClaims);
      const { deps, spies } = createMockEnvironment({
        deleteUserError: { message: 'Auth service rate limit exceeded' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('removing the authentication record failed');
      expect(body.error).toContain('Auth service rate limit exceeded');

      // Outbox was updated to storage_completed first, then auth_failed
      expect(spies.outboxUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'storage_completed',
          storage_clean: true,
        }),
      );
      expect(spies.outboxUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'auth_failed',
          storage_clean: true,
          auth_deleted: false,
          error_message: 'Auth service rate limit exceeded',
        }),
      );
    });

    // SCENARIO C.2: Auth deletion succeeds, but finalizing account_deletion_records fails
    it('Scenario C.2: Auth delete succeeds, but finalizing outbox fails -> returns 500 with diagnostic message without exposing tokens', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const token = createTestJwt(freshOtpClaims);
      const { deps, spies } = createMockEnvironment({
        finalUpdateError: { message: 'Outbox deadlock on final update' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('finalizing the deletion record encountered a database error');
      expect(body.details).toContain('Outbox deadlock on final update');
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    // SCENARIO D & E: Subsequent retry occurs after profile, student_details, or teacher_details records were already deleted
    // and in-memory local variables have been lost
    it('Scenario D & E: Retry when profile is already deleted -> recovers student_id & teacher_id from outbox, cleans storage, completes Auth deletion', async () => {
      const freshOtpClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const token = createTestJwt(freshOtpClaims);

      const cleanedBucketPrefixes: string[] = [];

      // Notice: profileRow is NULL (already deleted in DB RPC on initial attempt), but outbox row exists with status: 'storage_failed'
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'storage_failed',
        outboxRole: 'student',
        studentId: null,
        teacherId: null,
        onStorageList: (bucket, prefix) => {
          cleanedBucketPrefixes.push(`${bucket}/${prefix}`);
        },
      });

      // The DB RPC reads student_id and teacher_id from account_deletion_records outbox and returns them!
      spies.rpcSpy.mockResolvedValue({
        data: {
          success: true,
          profile_id: testUserId,
          student_id: 'recovered-student-uuid-8888',
          teacher_id: 'recovered-teacher-uuid-9999',
          message: 'Profile row already deleted or does not exist.',
        },
        error: null,
      });

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify storage was cleaned using the RECOVERED child identifiers from the outbox!
      expect(cleanedBucketPrefixes).toContain('student-submissions/recovered-student-uuid-8888');
      expect(cleanedBucketPrefixes).toContain('teacher-documents/recovered-teacher-uuid-9999');

      // Auth deletion was completed successfully
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);

      // Outbox was finalized as completed
      expect(spies.outboxUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          storage_clean: true,
          auth_deleted: true,
        }),
      );
    });

    // SCENARIO F: Retry occurs after original OTP authentication event is no longer recent enough to pass F-02
    it('Scenario F: Stale OTP on retry (>300s old) is rejected with 403; fresh OTP required to resume cleanup', async () => {
      // 1. Initial retry attempt with stale OTP (320s old)
      const staleRetryClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 320 }],
      });
      const staleToken = createTestJwt(staleRetryClaims);
      const { deps, spies } = createMockEnvironment();
      const staleReq = createDeleteRequest(`Bearer ${staleToken}`);

      const staleRes = await handleUserAccountDelete(staleReq, deps);
      expect(staleRes.status).toBe(403);
      const staleBody = await staleRes.json();
      expect(staleBody.error).toContain('OTP authentication has expired');
      expect(staleBody.error).toContain('320s old, maximum 300s allowed');

      // No destructive operations invoked with stale OTP
      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();

      // 2. User re-authenticates with fresh OTP (10s old)
      const freshRetryClaims = createValidOtpClaims({
        amr: [{ method: 'otp', timestamp: referenceNowSec - 10 }],
      });
      const freshToken = createTestJwt(freshRetryClaims);
      const freshReq = createDeleteRequest(`Bearer ${freshToken}`);

      const freshRes = await handleUserAccountDelete(freshReq, deps);
      expect(freshRes.status).toBe(200);
      const freshBody = await freshRes.json();
      expect(freshBody.success).toBe(true);
      expect(spies.rpcSpy).toHaveBeenCalledTimes(1);
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledTimes(1);
    });
  });

  // ============================================================================
  // Mutation-Safe Storage Pagination & Safety Limits Suite
  // ============================================================================
  describe('Mutation-Safe Storage Pagination & Safety Limits Suite', () => {
    it('drains 150 items across multiple batches safely when items shift as they are removed (offset: 0 drain test)', async () => {
      // Create 150 items: file_000 to file_149
      const allFileNames = Array.from({ length: 150 }, (_, i) => `file_${String(i).padStart(3, '0')}.txt`);
      const store = new Set<string>(allFileNames);

      const listCalls: { prefix: string; limit: number; offset: number }[] = [];
      const removeCalls: string[][] = [];

      const virtualStorage = {
        storage: {
          from: vi.fn(() => ({
            list: vi.fn(async (prefix: string, options: { limit?: number; offset?: number } = {}) => {
              const limit = options.limit || 100;
              const offset = options.offset || 0;
              listCalls.push({ prefix, limit, offset });

              // Emulate real storage list behavior: entries are returned from the current remaining set
              const remaining = Array.from(store.values());
              const page = remaining.slice(offset, offset + limit).map((name) => ({
                name,
                id: `id-${name}`,
                metadata: { size: 100 },
              }));
              return { data: page, error: null };
            }),
            remove: vi.fn(async (paths: string[]) => {
              removeCalls.push(paths);
              for (const p of paths) {
                const name = p.replace(/^user-150\//, '');
                store.delete(name);
              }
              return { data: paths.map((p) => ({ name: p })), error: null };
            }),
          })),
        },
      };

      const res = await cleanStoragePrefix(virtualStorage, 'test-bucket', 'user-150');

      expect(res.success).toBe(true);
      expect(res.deletedCount).toBe(150);
      expect(store.size).toBe(0);

      // Verify that EVERY listing call used offset: 0 (the safe drain pattern)
      for (const call of listCalls) {
        expect(call.offset).toBe(0);
      }

      // First batch drained 100 items, second batch drained remaining 50 items
      expect(removeCalls.length).toBe(2);
      expect(removeCalls[0].length).toBe(100);
      expect(removeCalls[1].length).toBe(50);
    });

    it('detects stubborn files that survive removal and returns success: false', async () => {
      // Storage remove reports success, but files remain in the bucket on subsequent list
      const virtualStorage = {
        storage: {
          from: vi.fn(() => ({
            list: vi.fn(async () => {
              return {
                data: [
                  { name: 'stubborn_1.dat', id: 'id-s1', metadata: { size: 100 } },
                  { name: 'stubborn_2.dat', id: 'id-s2', metadata: { size: 100 } },
                ],
                error: null,
              };
            }),
            remove: vi.fn(async (paths: string[]) => {
              // Fake removal report: reports success but does not remove files
              return { data: paths.map((p) => ({ name: p })), error: null };
            }),
          })),
        },
      };

      const res = await cleanStoragePrefix(virtualStorage, 'test-bucket', 'user-stubborn-files');

      expect(res.success).toBe(false);
      expect(res.error).toContain('Storage removal reported success but files remain undeleted');
      expect(res.error).toContain('is not empty after cleanup');
    });

    it('aborts with success: false when folder nesting exceeds MAX_STORAGE_RECURSION_DEPTH (10)', async () => {
      // Build an 11-level deep virtual storage path
      const deepPath = 'level1/level2/level3/level4/level5/level6/level7/level8/level9/level10/level11/file.txt';
      const virtual = createVirtualStorageClient([deepPath]);

      const res = await cleanStoragePrefix(virtual, 'test-bucket', 'level1');

      expect(res.success).toBe(false);
      expect(res.error).toContain(`Storage cleanup exceeded maximum folder recursion depth (${MAX_STORAGE_RECURSION_DEPTH})`);
    });

    it('aborts with success: false when pagination exceeds MAX_STORAGE_PAGES_PER_FOLDER (200)', async () => {
      let pageCount = 0;
      const virtualStorage = {
        storage: {
          from: vi.fn(() => ({
            list: vi.fn(async () => {
              pageCount++;
              // Each page returns distinct new files indefinitely
              return {
                data: [
                  { name: `infinite_${pageCount}_a.txt`, id: `id-${pageCount}a`, metadata: { size: 10 } },
                  { name: `infinite_${pageCount}_b.txt`, id: `id-${pageCount}b`, metadata: { size: 10 } },
                ],
                error: null,
              };
            }),
            remove: vi.fn(async (paths: string[]) => {
              return { data: paths.map((p) => ({ name: p })), error: null };
            }),
          })),
        },
      };

      const res = await cleanStoragePrefix(virtualStorage, 'test-bucket', 'user-infinite');

      expect(res.success).toBe(false);
      expect(res.error).toContain(`Storage cleanup exceeded maximum pagination batches (${MAX_STORAGE_PAGES_PER_FOLDER})`);
    });
  });

  // ============================================================================
  // Service-Role Administrative Recovery Suite (recoverAccountDeletionJobs & /recover)
  // ============================================================================
  describe('Service-Role Administrative Recovery Suite (recoverAccountDeletionJobs & /recover Endpoint)', () => {
    function createMockRecoveryAdmin(options: {
      jobs?: any[];
      profileExists?: boolean;
      rpcError?: any;
      storageError?: any;
      authUser?: any;
      authError?: any;
      deleteUserError?: any;
      outboxUpdateError?: any;
    } = {}) {
      const defaultJob = {
        profile_id: 'user-recover-1111',
        student_id: 'student-recover-2222',
        teacher_id: null,
        user_role: 'student',
        status: 'storage_completed',
        storage_clean: true,
        auth_deleted: false,
        created_at: new Date(Date.now() - 60000).toISOString(),
      };

      const jobsList = options.jobs !== undefined ? options.jobs : [defaultJob];
      const outboxUpdates: any[] = [];

      const adminMock = {
        from: vi.fn((table: string) => {
          if (table === 'account_deletion_records') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn((field: string, val: any) => {
                  const filtered = jobsList.filter((j) => j[field] === val);
                  return Promise.resolve({ data: filtered, error: null });
                }),
                neq: vi.fn(() => ({
                  order: vi.fn(() => ({
                    limit: vi.fn(() => Promise.resolve({ data: jobsList, error: null })),
                  })),
                })),
              })),
              update: vi.fn((payload: any) => {
                outboxUpdates.push(payload);
                return {
                  eq: vi.fn(async () => {
                    if (options.outboxUpdateError) {
                      return { data: null, error: options.outboxUpdateError };
                    }
                    return { data: null, error: null };
                  }),
                };
              }),
            };
          }
          if (table === 'profiles') {
            return {
              select: vi.fn(() => ({
                eq: vi.fn(() => ({
                  maybeSingle: vi.fn(async () => {
                    if (options.profileExists) {
                      return { data: { profile_id: defaultJob.profile_id }, error: null };
                    }
                    return { data: null, error: null };
                  }),
                })),
              })),
            };
          }
          return {
            select: vi.fn(() => ({
              eq: vi.fn(() => ({
                maybeSingle: vi.fn(async () => ({ data: null, error: null })),
              })),
            })),
          };
        }),
        rpc: vi.fn(async (rpcName: string, args: any) => {
          if (options.rpcError) {
            return { data: null, error: options.rpcError };
          }
          return {
            data: {
              success: true,
              profile_id: args.p_target_profile_id,
              student_id: 'student-recover-2222',
              teacher_id: null,
            },
            error: null,
          };
        }),
        storage: {
          from: vi.fn(() => ({
            list: vi.fn(async () => {
              if (options.storageError) {
                return { data: null, error: options.storageError };
              }
              return { data: [], error: null }; // Already empty
            }),
            remove: vi.fn(async (paths: string[]) => ({
              data: paths.map((p) => ({ name: p })),
              error: null,
            })),
          })),
        },
        auth: {
          admin: {
            getUserById: vi.fn(async (id: string) => {
              if (options.authError) {
                return { data: null, error: options.authError };
              }
              if (options.authUser !== undefined) {
                return { data: { user: options.authUser }, error: null };
              }
              // Default: user is not found (404), simulating user already deleted in Auth
              return { data: null, error: { status: 404, message: 'User not found' } };
            }),
            deleteUser: vi.fn(async (id: string) => {
              if (options.deleteUserError) {
                return { data: null, error: options.deleteUserError };
              }
              return { data: { user: null }, error: null };
            }),
          },
        },
      };

      return { adminMock, outboxUpdates };
    }

    it('Scenario C.2 Recovery: recovers job where Auth user was already deleted but outbox remained incomplete', async () => {
      const { adminMock, outboxUpdates } = createMockRecoveryAdmin({
        profileExists: false,
        authError: { status: 404, message: 'User not found' },
      });

      const res = await recoverAccountDeletionJobs(adminMock);

      expect(res.success).toBe(true);
      expect(res.totalJobsFound).toBe(1);
      expect(res.jobsRecovered).toBe(1);
      expect(res.jobsFailed).toBe(0);

      const jobDetail = res.details[0];
      expect(jobDetail.profileId).toBe('user-recover-1111');
      expect(jobDetail.dbClean).toBe(true);
      expect(jobDetail.storageClean).toBe(true);
      expect(jobDetail.authDeleted).toBe(true);
      expect(jobDetail.newStatus).toBe('completed');

      // Outbox was finalized as completed with timestamps
      expect(outboxUpdates).toContainEqual(
        expect.objectContaining({
          status: 'completed',
          storage_clean: true,
          auth_deleted: true,
          completed_at: expect.any(String),
        }),
      );
    });

    it('recovers job where Auth user still exists in auth.users and deletes it safely', async () => {
      const { adminMock, outboxUpdates } = createMockRecoveryAdmin({
        profileExists: false,
        authUser: { id: 'user-recover-1111', email: 'deleted@example.com' },
      });

      const res = await recoverAccountDeletionJobs(adminMock);

      expect(res.success).toBe(true);
      expect(res.jobsRecovered).toBe(1);
      expect(adminMock.auth.admin.deleteUser).toHaveBeenCalledWith('user-recover-1111');
      expect(outboxUpdates).toContainEqual(
        expect.objectContaining({
          status: 'completed',
          auth_deleted: true,
        }),
      );
    });

    it('recovers job where database profile still exists -> runs RPC, cleans storage, deletes Auth user', async () => {
      const { adminMock, outboxUpdates } = createMockRecoveryAdmin({
        profileExists: true,
        authUser: { id: 'user-recover-1111' },
      });

      const res = await recoverAccountDeletionJobs(adminMock);

      expect(res.success).toBe(true);
      expect(adminMock.rpc).toHaveBeenCalledWith('delete_user_account_data', {
        p_target_profile_id: 'user-recover-1111',
      });
      expect(adminMock.auth.admin.deleteUser).toHaveBeenCalledWith('user-recover-1111');
      expect(outboxUpdates).toContainEqual(
        expect.objectContaining({
          status: 'completed',
        }),
      );
    });

    it('halts recovery safely without deleting Auth user when storage cleanup encounters an error', async () => {
      const { adminMock, outboxUpdates } = createMockRecoveryAdmin({
        profileExists: false,
        authUser: { id: 'user-recover-1111' },
        storageError: { message: 'Storage connection timeout' },
      });

      const res = await recoverAccountDeletionJobs(adminMock);

      expect(res.success).toBe(false);
      expect(res.jobsFailed).toBe(1);
      expect(adminMock.auth.admin.deleteUser).not.toHaveBeenCalled();
      expect(outboxUpdates).toContainEqual(
        expect.objectContaining({
          status: 'storage_failed',
          storage_clean: false,
        }),
      );
    });

    it('repeated recovery attempts on completed jobs are idempotent', async () => {
      const { adminMock } = createMockRecoveryAdmin({
        jobs: [
          {
            profile_id: 'already-completed-uuid',
            status: 'completed',
            storage_clean: true,
            auth_deleted: true,
          },
        ],
      });

      const res = await recoverAccountDeletionJobs(adminMock);

      expect(res.success).toBe(true);
      expect(res.jobsRecovered).toBe(1);
      expect(adminMock.rpc).not.toHaveBeenCalled();
      expect(adminMock.auth.admin.deleteUser).not.toHaveBeenCalled();
    });

    it('rejects recovery requests with ordinary user JWT with HTTP 403 Forbidden', async () => {
      const userClaims = createValidOtpClaims();
      const userToken = createTestJwt(userClaims);
      const { deps } = createMockEnvironment();

      const req = new Request('https://test.supabase.co/functions/v1/user-account-delete/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${userToken}`,
        },
        body: JSON.stringify({ action: 'recover' }),
      });

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Administrative recovery requires service-role authorization');
    });

    it('rejects recovery requests with anon key with HTTP 403 Forbidden', async () => {
      const { deps } = createMockEnvironment();

      const req = new Request('https://test.supabase.co/functions/v1/user-account-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-anon-key',
          'x-action': 'recover',
        },
      });

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.error).toContain('Administrative recovery requires service-role authorization');
    });

    it('rejects recovery requests missing Authorization header with HTTP 401 Unauthorized', async () => {
      const { deps } = createMockEnvironment();

      const req = new Request('https://test.supabase.co/functions/v1/user-account-delete/recover', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
      });

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(401);
    });

    it('accepts recovery requests with valid service-role key and returns HTTP 200 with recovery report', async () => {
      const { deps, mockAdminClient } = createMockEnvironment();

      // Configure admin client in mock environment to return empty jobs list
      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'account_deletion_records') {
          return {
            select: vi.fn(() => ({
              neq: vi.fn(() => ({
                order: vi.fn(() => ({
                  limit: vi.fn(() => Promise.resolve({ data: [], error: null })),
                })),
              })),
            })),
          };
        }
        return { select: vi.fn() };
      });

      const req = new Request('https://test.supabase.co/functions/v1/user-account-delete', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer test-service-role-key',
        },
        body: JSON.stringify({ action: 'recover' }),
      });

      const res = await handleUserAccountDelete(req, deps);
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);
      expect(body.totalJobsFound).toBe(0);
      expect(body.jobsRecovered).toBe(0);
    });
  });

  describe('Server-Side Student-Only Role Authorization Suite', () => {
    it('1. permits an existing student profile to proceed after valid OTP verification', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRole: 'student',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(spies.rpcSpy).toHaveBeenCalledWith('delete_user_account_data', {
        p_target_profile_id: testUserId,
      });
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    it('2. rejects an existing teacher profile with HTTP 403 Forbidden before destructive operations', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRole: 'teacher',
        teacherId: 'teacher-999',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/only available for student accounts/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('3. rejects an existing admin profile with HTTP 403 Forbidden before destructive operations', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRole: 'admin',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/only available for student accounts/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('4. rejects any non-student role (e.g. super_admin) with HTTP 403 Forbidden before destructive operations', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRole: 'super_admin',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('5. rejects a missing profile without a valid student deletion record with HTTP 404 Not Found', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxRow: null,
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(404);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/profile not found|already deleted/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('6. permits student retry when profile is already deleted but outbox has incomplete student deletion record (status: storage_failed)', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'storage_failed',
        outboxRole: 'student',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(spies.rpcSpy).toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    it('7. permits student retry when profile is already deleted but outbox has status: db_completed', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'db_completed',
        outboxRole: 'student',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(200);
      expect(body.success).toBe(true);
      expect(spies.rpcSpy).toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    it('8. rejects retry with HTTP 403 Forbidden when profile does not exist but outbox record has non-student role (teacher)', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'storage_failed',
        outboxRole: 'teacher',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/only available for student accounts/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('9. rejects retry with HTTP 403 Forbidden when profile does not exist but outbox record has non-student role (admin)', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'storage_failed',
        outboxRole: 'admin',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/only available for student accounts/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('10. rejects retry with HTTP 410 when profile does not exist and outbox record is already completed', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'completed',
        outboxRole: 'student',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(410);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/already been completed and finalized/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('11. rejects retry with HTTP 400 when profile does not exist and outbox record has unrecognized status', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'corrupted_state',
        outboxRole: 'student',
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(400);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/invalid deletion status/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('12. fails closed with HTTP 500 when profile lookup encounters a database error', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileError: { message: 'Database connection timeout' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Failed to verify account authorization/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('13. fails closed with HTTP 500 when outbox recovery lookup encounters a database error', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRow: null,
        outboxLookupError: { message: 'Outbox query deadlock' },
      });
      const req = createDeleteRequest(`Bearer ${token}`);

      const res = await handleUserAccountDelete(req, deps);
      const body = await res.json();

      expect(res.status).toBe(500);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/Failed to verify account deletion recovery state/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('14. cannot bypass role restriction via caller-supplied body or client payload', async () => {
      // Attacker supplies a body claiming role is 'student', but their actual DB profile is 'teacher'
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies } = createMockEnvironment({
        profileRole: 'teacher',
      });

      const spoofedReq = new Request('https://test.supabase.co/functions/v1/user-account-delete', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role: 'student', userId: testUserId }),
      });

      const res = await handleUserAccountDelete(spoofedReq, deps);
      const body = await res.json();

      expect(res.status).toBe(403);
      expect(body.success).toBe(false);
      expect(body.error).toMatch(/only available for student accounts/i);

      expect(spies.rpcSpy).not.toHaveBeenCalled();
      expect(spies.storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });
  });

  // ── 7. Durable Doubt-Attachment Storage Cleanup & Multi-Batch Verification Suite ─
  describe('Durable Doubt-Attachment Storage Cleanup & Multi-Batch Verification Suite', () => {
    it('1. deletes a doubt attachment stored under {institute_id}/{doubt_id}/{filename}', async () => {
      const removedFiles: string[] = [];
      const testDoubtPath = 'inst-uuid-1111/doubt-uuid-2222/1000073584.jpg';

      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies, mockAdminClient } = createMockEnvironment({
        profileRole: 'student',
        doubtAttachments: [
          {
            bucket: 'doubt-attachments',
            storage_path: testDoubtPath,
            doubt_id: 'doubt-uuid-2222',
            uploaded_by: testUserId,
          },
        ],
      });

      // Mock storage remove & list verification
      mockAdminClient.storage.from = vi.fn((bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          removedFiles.push(...paths);
          return { data: paths.map((p) => ({ name: p })), error: null };
        }),
        list: vi.fn(async (folder: string) => {
          // Empty folder verifies successful cleanup
          return { data: [], error: null };
        }),
      }));

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify the EXACT doubt attachment path was passed to remove
      expect(removedFiles).toContain(testDoubtPath);

      // Verify Auth user deletion was finalized
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
    });

    it('2. cleanup does not depend on student_id being the leading folder', async () => {
      const removedFiles: string[] = [];
      const nonStudentPrefixPath = 'e97ebfd2-ca4d-4637-a583-1078568f1b2f/218151db-a96f-4910-a33b-bc357f59106d/doubt_image.png';

      const token = createTestJwt(createValidOtpClaims());
      const { deps, mockAdminClient } = createMockEnvironment({
        profileRole: 'student',
        studentId: '9538ffa2-9dc3-4063-8566-473bd2e5b9af',
        pendingStoragePaths: [
          { bucket: 'doubt-attachments', storage_path: nonStudentPrefixPath },
        ],
      });

      mockAdminClient.storage.from = vi.fn((bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          removedFiles.push(...paths);
          return { data: paths.map((p) => ({ name: p })), error: null };
        }),
        list: vi.fn(async () => ({ data: [], error: null })),
      }));

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(200);
      // Confirmed removed despite path starting with institute_id rather than student_id
      expect(removedFiles).toContain(nonStudentPrefixPath);
      expect(nonStudentPrefixPath.startsWith('9538ffa2-9dc3-4063-8566-473bd2e5b9af')).toBe(false);
    });

    it('3. exact paths are preserved before database deletion removes their metadata', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const attachmentPath = 'inst-9999/doubt-8888/attachment.pdf';

      const executionOrder: string[] = [];

      const { deps, mockAdminClient, spies } = createMockEnvironment({
        profileRole: 'student',
        studentId: 'student-3333',
        doubtAttachments: [
          { bucket: 'doubt-attachments', storage_path: attachmentPath, uploaded_by: testUserId, doubt_id: 'doubt-8888' },
        ],
      });

      // Track execution order between doubt_attachments select and DB RPC
      const originalFrom = mockAdminClient.from;
      mockAdminClient.from = vi.fn((table: string) => {
        if (table === 'doubt_attachments') {
          executionOrder.push('doubt_attachments.select');
        }
        return originalFrom(table);
      });

      const originalRpc = mockAdminClient.rpc;
      mockAdminClient.rpc = vi.fn(async (...args: any[]) => {
        executionOrder.push('rpc.delete_user_account_data');
        return originalRpc(...args);
      });

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(200);
      // Verified: doubt_attachments pre-capture occurs BEFORE the destructive DB RPC
      expect(executionOrder.indexOf('doubt_attachments.select')).toBeLessThan(
        executionOrder.indexOf('rpc.delete_user_account_data')
      );
    });

    it('4. a database transaction failure does not falsely finalize deletion', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const storageRemoveSpy = vi.fn();

      const { deps, spies, mockAdminClient } = createMockEnvironment({
        profileRole: 'student',
        rpcError: new Error('PostgreSQL 40P01: deadlock detected'),
        pendingStoragePaths: [{ bucket: 'doubt-attachments', storage_path: 'inst-1/d-1/f.jpg' }],
      });

      mockAdminClient.storage.from = vi.fn(() => ({
        remove: storageRemoveSpy,
        list: vi.fn(async () => ({ data: [], error: null })),
      }));

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to delete database records');

      // Crucial: No storage objects removed and Auth user NOT deleted
      expect(storageRemoveSpy).not.toHaveBeenCalled();
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('5. a Storage deletion failure preserves a retryable state and prevents Auth deletion', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const { deps, spies, mockAdminClient } = createMockEnvironment({
        profileRole: 'student',
        pendingStoragePaths: [{ bucket: 'doubt-attachments', storage_path: 'inst-1/d-1/f.jpg' }],
      });

      // Storage remove returns network error
      mockAdminClient.storage.from = vi.fn((bucket: string) => ({
        remove: vi.fn(async () => ({
          data: null,
          error: { message: '503 Service Unavailable: Storage Gateway Timeout' },
        })),
        list: vi.fn(async () => ({ data: [], error: null })),
      }));

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(500);
      const body = await res.json();
      expect(body.success).toBe(false);
      expect(body.error).toContain('Failed to complete storage file cleanup');

      // Crucial: Outbox updated to storage_failed, storage_clean remains false, Auth deletion NEVER called
      expect(spies.outboxUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'storage_failed',
          storage_clean: false,
        })
      );
      expect(spies.deleteUserAdminSpy).not.toHaveBeenCalled();
    });

    it('6. a retry after profile deletion still has the necessary attachment paths', async () => {
      const token = createTestJwt(createValidOtpClaims());
      const removedFiles: string[] = [];
      const orphanPath = 'inst-retry-111/doubt-retry-222/attachment-retry.jpg';

      // Profile is null (already deleted in previous attempt)
      // Outbox row has status: storage_failed with pending_storage_paths preserved!
      const { deps, spies, mockAdminClient } = createMockEnvironment({
        profileRow: null,
        outboxStatus: 'storage_failed',
        outboxRole: 'student',
        outboxPendingPaths: [
          { bucket: 'doubt-attachments', storage_path: orphanPath },
        ],
      });

      mockAdminClient.storage.from = vi.fn((bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          removedFiles.push(...paths);
          return { data: paths.map((p) => ({ name: p })), error: null };
        }),
        list: vi.fn(async () => ({ data: [], error: null })),
      }));

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.success).toBe(true);

      // Verify the retry cleaned the pending path recovered from the outbox
      expect(removedFiles).toContain(orphanPath);

      // Verify Auth deletion completed and outbox finalized
      expect(spies.deleteUserAdminSpy).toHaveBeenCalledWith(testUserId);
      expect(spies.outboxUpdateSpy).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'completed',
          storage_clean: true,
          auth_deleted: true,
        })
      );
    });

    it('7. more than one removal batch is handled correctly by cleanExplicitStoragePaths', async () => {
      // Generate 120 paths (exceeding standard batch size of 50)
      const testPaths: string[] = [];
      for (let i = 1; i <= 120; i++) {
        testPaths.push(`inst-batch-1/doubt-${i}/image-${i}.jpg`);
      }

      const batchesReceived: string[][] = [];

      const mockClient = {
        storage: {
          from: vi.fn(() => ({
            remove: vi.fn(async (batch: string[]) => {
              batchesReceived.push([...batch]);
              return { data: batch.map((p) => ({ name: p })), error: null };
            }),
            list: vi.fn(async () => ({ data: [], error: null })),
          })),
        },
      };

      const result = await cleanExplicitStoragePaths(
        mockClient,
        testPaths,
        'doubt-attachments',
        50 // batchSize
      );

      expect(result.success).toBe(true);
      expect(result.totalPaths).toBe(120);
      expect(result.deletedCount).toBe(120);

      // Verify chunking: 50 + 50 + 20 = 3 batches
      expect(batchesReceived.length).toBe(3);
      expect(batchesReceived[0].length).toBe(50);
      expect(batchesReceived[1].length).toBe(50);
      expect(batchesReceived[2].length).toBe(20);
    });

    it('8. one student cleanup cannot delete other students attachments in the same institute', async () => {
      const removedFiles: string[] = [];

      const studentAAttachment = 'inst-shared-4444/doubt-student-a/student-a-doubt.png';
      const studentBAttachment = 'inst-shared-4444/doubt-student-b/student-b-doubt.png';

      const token = createTestJwt(createValidOtpClaims());
      const { deps, mockAdminClient } = createMockEnvironment({
        profileRole: 'student',
        // Student A only has studentAAttachment
        pendingStoragePaths: [
          { bucket: 'doubt-attachments', storage_path: studentAAttachment },
        ],
      });

      mockAdminClient.storage.from = vi.fn((bucket: string) => ({
        remove: vi.fn(async (paths: string[]) => {
          removedFiles.push(...paths);
          return { data: paths.map((p) => ({ name: p })), error: null };
        }),
        list: vi.fn(async (folder: string) => {
          // Folder list for student A's doubt returns empty
          return { data: [], error: null };
        }),
      }));

      const req = createDeleteRequest(`Bearer ${token}`);
      const res = await handleUserAccountDelete(req, deps);

      expect(res.status).toBe(200);

      // Student A's file was removed
      expect(removedFiles).toContain(studentAAttachment);

      // Student B's file in the same institute folder was NEVER passed to remove!
      expect(removedFiles).not.toContain(studentBAttachment);
      expect(removedFiles.length).toBe(1);
    });

    it('9. storage_clean = true cannot be recorded when a required object remains', async () => {
      const stubbornPath = 'inst-stubborn/doubt-stubborn/file.jpg';
      const mockClient = {
        storage: {
          from: vi.fn(() => ({
            remove: vi.fn(async (batch: string[]) => {
              // Pretends remove succeeded
              return { data: batch.map((p) => ({ name: p })), error: null };
            }),
            list: vi.fn(async (folder: string) => {
              // But list confirms the file is still present!
              return {
                data: [{ name: 'file.jpg', id: 'stubborn-id' }],
                error: null,
              };
            }),
          })),
        },
      };

      const result = await cleanExplicitStoragePaths(
        mockClient,
        [stubbornPath],
        'doubt-attachments'
      );

      // Must fail with stubborn file detection
      expect(result.success).toBe(false);
      expect(result.error).toContain('remain undeleted after removal');
      expect(result.remainingPaths).toContain(stubbornPath);
    });
  });

});
