// ============================================================================
// Core Account Deletion & OTP Re-authentication Verification Logic
//
// Shared, testable runtime implementation for Supabase Edge Function user-account-delete.
// Enforces F-02 security requirement: Server-side OTP re-authentication within 300s.
// Enforces Safe Deletion Sequencing: Database RPC -> Storage Cleanup -> Auth Deletion.
// Durable Recovery Outbox: Tracks progress in account_deletion_records to ensure
// retries and service-role recovery processes verify actual DB, Storage, and Auth
// states and finalize incomplete jobs without relying on the deleted user's JWT.
//
// @module edge-functions/user-account-delete/accountDeleteCore
// ============================================================================

export const MAX_OTP_REAUTH_AGE_SECONDS = 300; // 5 minutes maximum freshness window
export const CLOCK_SKEW_TOLERANCE_SECONDS = 10; // 10 seconds allowable clock skew
export const MAX_STORAGE_PAGE_LIMIT = 100;
export const MAX_STORAGE_PAGES_PER_FOLDER = 200; // Up to 20,000 files per directory level
export const MAX_STORAGE_RECURSION_DEPTH = 10; // Up to 10 nested directory levels

export interface AmrEntry {
  method: string;
  timestamp: number;
}

export interface UserJwtClaims {
  sub?: string;
  email?: string;
  phone?: string;
  role?: string;
  amr?: AmrEntry[];
  iat?: number;
  exp?: number;
  [key: string]: unknown;
}

export interface OtpVerificationResult {
  authorized: boolean;
  statusCode: number;
  errorMessage?: string;
  claims?: UserJwtClaims;
  otpTimestamp?: number;
}

export interface StorageCleanResult {
  bucket: string;
  prefix: string;
  success: boolean;
  deletedCount: number;
  error?: string;
}

export interface AccountDeletionRecoveryOptions {
  targetProfileId?: string;
  batchSize?: number;
}

export interface AccountDeletionRecoveryJobResult {
  profileId: string;
  success: boolean;
  previousStatus: string;
  newStatus: string;
  dbClean: boolean;
  storageClean: boolean;
  authDeleted: boolean;
  error?: string;
}

export interface AccountDeletionRecoveryResult {
  [key: string]: unknown;
  success: boolean;
  totalJobsFound: number;
  jobsRecovered: number;
  jobsFailed: number;
  details: AccountDeletionRecoveryJobResult[];
  error?: string;
}

export interface UserAccountDeleteDependencies {
  createSupabaseClient?: (url: string, key: string, options?: any) => any;
  nowMs?: () => number;
  env?: {
    SUPABASE_URL?: string;
    SUPABASE_ANON_KEY?: string;
    SUPABASE_SERVICE_ROLE_KEY?: string;
  };
}

/**
 * Decodes JWT payload without verifying signature.
 * IMPORTANT: MUST only be called on tokens that have ALREADY been authoritatively
 * verified by Supabase Auth (e.g. via auth.getUser()).
 */
export function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const base64Url = parts[1];
    const base64 = base64Url.replace(/-/g, '+').replace(/_/g, '/');
    const padded = base64.padEnd(base64.length + ((4 - (base64.length % 4)) % 4), '=');
    const jsonStr = typeof atob === 'function'
      ? atob(padded)
      : Buffer.from(padded, 'base64').toString('utf8');
    return JSON.parse(jsonStr);
  } catch {
    return null;
  }
}

/**
 * Validates that an authenticated caller has verified an OTP within the allowable freshness window (300 seconds).
 *
 * Requirements:
 * 1. Verified amr claim must be present and contain an OTP entry (method === 'otp' or 'sms').
 * 2. OTP timestamp must be numeric, finite, and positive.
 * 3. OTP timestamp must not be in the future beyond CLOCK_SKEW_TOLERANCE_SECONDS (10s).
 * 4. OTP timestamp must not be older than MAX_OTP_REAUTH_AGE_SECONDS (300s).
 * 5. Token subject (sub) must be present, must be a string, and must match verified user id.
 */
export function validateOtpReauthentication(
  claims: UserJwtClaims | null | undefined,
  verifiedUserId: string,
  nowMs: number = Date.now(),
  maxAgeSec: number = MAX_OTP_REAUTH_AGE_SECONDS,
  skewSec: number = CLOCK_SKEW_TOLERANCE_SECONDS,
): OtpVerificationResult {
  if (!claims || typeof claims !== 'object') {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Recent OTP re-authentication required. Unverifiable session claims.',
    };
  }

  // 1. Verify that claims subject is present, is a non-empty string, and strictly matches authenticated user id
  if (!claims.sub || typeof claims.sub !== 'string' || claims.sub.trim() === '') {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Forbidden: Missing or malformed token subject (sub).',
    };
  }

  if (claims.sub !== verifiedUserId) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Forbidden: Token subject does not match authenticated user.',
    };
  }

  // 2. Extract and inspect amr (Authentication Methods References)
  const amr = claims.amr;
  if (!Array.isArray(amr) || amr.length === 0) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Recent OTP re-authentication required. Missing authentication method references (amr).',
    };
  }

  // 3. Find OTP entries in amr (standard 'otp' or 'sms')
  const otpEntries = amr.filter((entry) => {
    if (!entry || typeof entry !== 'object') return false;
    const method = entry.method;
    return typeof method === 'string' && (method.toLowerCase() === 'otp' || method.toLowerCase() === 'sms');
  });

  if (otpEntries.length === 0) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Recent OTP re-authentication required. Account deletion requires verified OTP authentication.',
    };
  }

  const nowSec = Math.floor(nowMs / 1000);

  // 4. Find the most recent valid OTP entry
  let mostRecentOtp: AmrEntry | null = null;
  for (const entry of otpEntries) {
    const rawTs = entry.timestamp;
    if (typeof rawTs !== 'number' || !Number.isFinite(rawTs) || rawTs <= 0) {
      return {
        authorized: false,
        statusCode: 403,
        errorMessage: 'Recent OTP re-authentication required. Malformed OTP timestamp.',
      };
    }
    const tsSec = rawTs > 1e11 ? Math.floor(rawTs / 1000) : rawTs;
    if (
      !mostRecentOtp ||
      tsSec > (mostRecentOtp.timestamp > 1e11 ? Math.floor(mostRecentOtp.timestamp / 1000) : mostRecentOtp.timestamp)
    ) {
      mostRecentOtp = { method: entry.method, timestamp: tsSec };
    }
  }

  if (!mostRecentOtp) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Recent OTP re-authentication required. Malformed OTP entry in amr.',
    };
  }

  const otpTsSec = mostRecentOtp.timestamp;
  const ageSec = nowSec - otpTsSec;

  // 5. Check future timestamp beyond clock-skew tolerance
  if (ageSec < -skewSec) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: 'Recent OTP re-authentication required. OTP timestamp is in the future beyond allowable clock skew.',
    };
  }

  // 6. Check freshness window (no more than 300 seconds old)
  if (ageSec > maxAgeSec) {
    return {
      authorized: false,
      statusCode: 403,
      errorMessage: `Recent OTP re-authentication required. OTP authentication has expired (${Math.floor(ageSec)}s old, maximum ${maxAgeSec}s allowed). Please re-verify.`,
    };
  }

  return {
    authorized: true,
    statusCode: 200,
    claims,
    otpTimestamp: otpTsSec,
  };
}

/**
 * Distinguishes folder entries from file entries in Supabase Storage.
 * Supabase Storage list() returns folder entries with id === null (or undefined) and no metadata.
 * Note: .emptyFolderPlaceholder is treated as a file so it can be deleted to allow virtual folders to unmount.
 */
export function isStorageFolderEntry(item: { name: string; id?: string | null; metadata?: any }): boolean {
  if (!item || typeof item !== 'object') return false;
  if (item.name === '.emptyFolderPlaceholder') {
    return false; // Treat as a file to delete, not a subfolder
  }
  return item.id === null || item.id === undefined || (!item.id && !item.metadata);
}

/**
 * Remove all files and recursively clean nested subfolders under a prefix in a storage bucket.
 * Drains all pages using safe offset: 0 draining, handles arbitrary depths (up to safety limit),
 * verifies emptiness, and returns an explicit structured result indicating success or failure.
 */
export async function cleanStoragePrefix(
  adminClient: any,
  bucket: string,
  prefix: string,
): Promise<StorageCleanResult> {
  const normalizedPrefix = (prefix || '').replace(/^\/+|\/+$/g, '');
  if (!normalizedPrefix) {
    return { bucket, prefix: '', success: true, deletedCount: 0 };
  }

  let totalDeletedCount = 0;

  async function cleanFolder(currentPath: string, depth: number): Promise<{ success: boolean; error?: string }> {
    if (depth > MAX_STORAGE_RECURSION_DEPTH) {
      return {
        success: false,
        error: `Storage cleanup exceeded maximum folder recursion depth (${MAX_STORAGE_RECURSION_DEPTH}) at ${currentPath}`,
      };
    }

    let page = 0;
    let lastAttemptedFileSignature = '';

    while (page < MAX_STORAGE_PAGES_PER_FOLDER) {
      page++;

      // DRAIN PATTERN: Always query offset: 0 because deleting files shifts remaining entries forward.
      const { data: items, error: listError } = await adminClient.storage
        .from(bucket)
        .list(currentPath, { limit: MAX_STORAGE_PAGE_LIMIT, offset: 0 });

      if (listError) {
        return {
          success: false,
          error: `Storage list error in ${bucket}/${currentPath}: ${listError.message || String(listError)}`,
        };
      }

      if (!items || items.length === 0) {
        break; // Directory is completely drained at this level
      }

      const folderEntries: typeof items = [];
      const filePathsToDelete: string[] = [];

      for (const item of items) {
        if (!item || !item.name) continue;
        if (isStorageFolderEntry(item)) {
          folderEntries.push(item);
        } else {
          filePathsToDelete.push(currentPath ? `${currentPath}/${item.name}` : item.name);
        }
      }

      // Check progress: if list returned items but none could be categorized as folder or file
      if (filePathsToDelete.length === 0 && folderEntries.length === 0) {
        return {
          success: false,
          error: `Storage cleanup could not make progress in ${bucket}/${currentPath}`,
        };
      }

      // Detect stubborn files: if list returned the exact same files that we attempted to delete in the previous iteration,
      // removal did not actually delete them from the bucket.
      const currentSignature = filePathsToDelete.slice().sort().join('|');
      if (filePathsToDelete.length > 0 && currentSignature === lastAttemptedFileSignature) {
        return {
          success: false,
          error: `Storage removal reported success but files remain undeleted in ${bucket}/${currentPath}; directory is not empty after cleanup`,
        };
      }

      // 1. Recursively clean all nested subfolders first
      for (const folder of folderEntries) {
        const subfolderPath = currentPath ? `${currentPath}/${folder.name}` : folder.name;
        const subfolderResult = await cleanFolder(subfolderPath, depth + 1);
        if (!subfolderResult.success) {
          return subfolderResult;
        }
      }

      // 2. Remove all file paths collected in this batch
      if (filePathsToDelete.length > 0) {
        const { error: removeError } = await adminClient.storage
          .from(bucket)
          .remove(filePathsToDelete);

        if (removeError) {
          return {
            success: false,
            error: `Storage remove error in ${bucket}/${currentPath}: ${removeError.message || String(removeError)}`,
          };
        }

        totalDeletedCount += filePathsToDelete.length;
        lastAttemptedFileSignature = currentSignature;
      }
    }

    if (page >= MAX_STORAGE_PAGES_PER_FOLDER) {
      return {
        success: false,
        error: `Storage cleanup exceeded maximum pagination batches (${MAX_STORAGE_PAGES_PER_FOLDER}) in ${bucket}/${currentPath}`,
      };
    }

    // Verify this folder level is empty
    const { data: folderVerifyItems, error: folderVerifyErr } = await adminClient.storage
      .from(bucket)
      .list(currentPath, { limit: 1, offset: 0 });

    if (folderVerifyErr) {
      return {
        success: false,
        error: `Storage verification list error in ${bucket}/${currentPath}: ${folderVerifyErr.message || String(folderVerifyErr)}`,
      };
    }

    if (folderVerifyItems && folderVerifyItems.length > 0) {
      return {
        success: false,
        error: `Directory ${bucket}/${currentPath} is not empty after cleanup (${folderVerifyItems.length} items remain)`,
      };
    }

    return { success: true };
  }

  try {
    // Execute recursive cleanup
    const cleanResult = await cleanFolder(normalizedPrefix, 1);
    if (!cleanResult.success) {
      console.error(`[user-account-delete] Storage cleanup failed for ${bucket}/${normalizedPrefix}:`, cleanResult.error);
      return {
        bucket,
        prefix: normalizedPrefix,
        success: false,
        deletedCount: totalDeletedCount,
        error: cleanResult.error,
      };
    }

    // Final top-level verification: confirm that the target prefix is empty
    const { data: verificationItems, error: verifyError } = await adminClient.storage
      .from(bucket)
      .list(normalizedPrefix, { limit: 1, offset: 0 });

    if (verifyError) {
      const errMsg = `Verification listing failed in ${bucket}/${normalizedPrefix}: ${verifyError.message || String(verifyError)}`;
      console.error(`[user-account-delete] ${errMsg}`);
      return {
        bucket,
        prefix: normalizedPrefix,
        success: false,
        deletedCount: totalDeletedCount,
        error: errMsg,
      };
    }

    if (verificationItems && verificationItems.length > 0) {
      const errMsg = `Prefix ${normalizedPrefix} in bucket ${bucket} is not empty after cleanup (${verificationItems.length} items remain)`;
      console.error(`[user-account-delete] ${errMsg}`);
      return {
        bucket,
        prefix: normalizedPrefix,
        success: false,
        deletedCount: totalDeletedCount,
        error: errMsg,
      };
    }

    return {
      bucket,
      prefix: normalizedPrefix,
      success: true,
      deletedCount: totalDeletedCount,
    };
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : String(err);
    console.error(`[user-account-delete] Storage exception in ${bucket}/${normalizedPrefix}:`, errorMsg);
    return {
      bucket,
      prefix: normalizedPrefix,
      success: false,
      deletedCount: totalDeletedCount,
      error: errorMsg,
    };
  }
}

export interface StoragePathItem {
  bucket: string;
  storage_path: string;
}

export interface ExplicitStorageCleanResult {
  bucket: string;
  prefix?: string;
  storage_path?: string;
  success: boolean;
  totalPaths: number;
  deletedCount: number;
  remainingPaths?: string[];
  error?: string;
}

/**
 * Deduplicates storage path items by bucket and storage_path.
 */
export function deduplicateStoragePaths(
  items: Array<StoragePathItem | string>,
  defaultBucket = 'doubt-attachments',
): StoragePathItem[] {
  const seen = new Set<string>();
  const result: StoragePathItem[] = [];

  for (const item of items) {
    if (!item) continue;
    let b = defaultBucket;
    let p = '';

    if (typeof item === 'string') {
      p = item.trim();
    } else {
      b = item.bucket || defaultBucket;
      p = (item.storage_path || (item as any).path || '').trim();
    }

    if (!p) continue;
    if (p.startsWith('/')) p = p.slice(1);

    const key = `${b}:${p}`;
    if (!seen.has(key)) {
      seen.add(key);
      result.push({ bucket: b, storage_path: p });
    }
  }

  return result;
}

/**
 * Cleans specific explicit storage paths in batches (e.g. doubt attachments
 * stored under {institute_id}/{doubt_id}/{filename}).
 *
 * Verifies that the objects are removed and that no requested files remain.
 * Does NOT touch unrelated files in the same directory.
 */
export async function cleanExplicitStoragePaths(
  adminClient: any,
  items: Array<StoragePathItem | string>,
  defaultBucket = 'doubt-attachments',
  batchSize = 50,
): Promise<ExplicitStorageCleanResult> {
  const normalized = deduplicateStoragePaths(items, defaultBucket);

  if (normalized.length === 0) {
    return {
      bucket: defaultBucket,
      storage_path: 'none',
      success: true,
      totalPaths: 0,
      deletedCount: 0,
    };
  }

  let totalDeleted = 0;

  // Group by bucket
  const byBucket = new Map<string, string[]>();
  for (const item of normalized) {
    if (!byBucket.has(item.bucket)) {
      byBucket.set(item.bucket, []);
    }
    byBucket.get(item.bucket)!.push(item.storage_path);
  }

  for (const [bucket, paths] of byBucket.entries()) {
    // Process in batches
    for (let i = 0; i < paths.length; i += batchSize) {
      const batch = paths.slice(i, i + batchSize);

      const { error: removeError } = await adminClient.storage
        .from(bucket)
        .remove(batch);

      if (removeError) {
        return {
          bucket,
          storage_path: batch[0],
          success: false,
          totalPaths: normalized.length,
          deletedCount: totalDeleted,
          remainingPaths: paths.slice(i),
          error: `Storage removal error in ${bucket}: ${removeError.message || String(removeError)}`,
        };
      }

      // Verification: Check parent folders to confirm target files were actually removed
      const foldersToCheck = new Map<string, Set<string>>();
      for (const p of batch) {
        const lastSlash = p.lastIndexOf('/');
        const folder = lastSlash >= 0 ? p.slice(0, lastSlash) : '';
        const filename = lastSlash >= 0 ? p.slice(lastSlash + 1) : p;

        if (!foldersToCheck.has(folder)) {
          foldersToCheck.set(folder, new Set());
        }
        foldersToCheck.get(folder)!.add(filename);
      }

      for (const [folder, filenames] of foldersToCheck.entries()) {
        const { data: listedItems, error: listError } = await adminClient.storage
          .from(bucket)
          .list(folder, { limit: 100, offset: 0 });

        if (listError) {
          return {
            bucket,
            storage_path: folder,
            success: false,
            totalPaths: normalized.length,
            deletedCount: totalDeleted,
            remainingPaths: Array.from(filenames).map(f => folder ? `${folder}/${f}` : f),
            error: `Storage verification list error in ${bucket}/${folder}: ${listError.message || String(listError)}`,
          };
        }

        if (listedItems && Array.isArray(listedItems)) {
          const stubborn = listedItems.filter((item: any) => item && filenames.has(item.name));
          if (stubborn.length > 0) {
            const stubbornPaths = stubborn.map((s: any) => folder ? `${folder}/${s.name}` : s.name);
            return {
              bucket,
              storage_path: stubbornPaths[0],
              success: false,
              totalPaths: normalized.length,
              deletedCount: totalDeleted,
              remainingPaths: stubbornPaths,
              error: `Storage files remain undeleted after removal in ${bucket}/${folder}: ${stubbornPaths.join(', ')}`,
            };
          }
        }
      }

      totalDeleted += batch.length;
    }
  }

  return {
    bucket: defaultBucket,
    storage_path: normalized.map((n) => n.storage_path).join(', '),
    success: true,
    totalPaths: normalized.length,
    deletedCount: totalDeleted,
  };
}

/**
 * Service-role recovery function for incomplete account deletions.
 *
 * Operates independently of user authentication / JWTs.
 * Recovers jobs where the Auth user has already been deleted (or failed to delete),
 * or where database/storage cleanup was interrupted.
 *
 * Verifies actual database, Storage, and Auth state before finalizing any job:
 *   1. Database check: confirms profile is removed from public.profiles. If present, runs delete_user_account_data RPC.
 *   2. Storage check: drains and verifies emptiness of all user-associated buckets.
 *   3. Auth check: checks admin.getUserById(). If 404/not found, Auth deletion already succeeded. If present, deletes user.
 *   4. Finalization: updates account_deletion_records to 'completed' with timestamps.
 */
export async function recoverAccountDeletionJobs(
  adminClient: any,
  options: AccountDeletionRecoveryOptions = {},
): Promise<AccountDeletionRecoveryResult> {
  let query = adminClient
    .from('account_deletion_records')
    .select('*');

  if (options.targetProfileId) {
    query = query.eq('profile_id', options.targetProfileId);
  } else {
    query = query
      .neq('status', 'completed')
      .order('created_at', { ascending: true })
      .limit(options.batchSize || 50);
  }

  const { data: jobs, error: fetchErr } = await query;

  if (fetchErr) {
    console.error('[user-account-delete] Recovery query failed:', fetchErr.message);
    return {
      success: false,
      totalJobsFound: 0,
      jobsRecovered: 0,
      jobsFailed: 0,
      details: [],
      error: `Failed to query incomplete deletion jobs: ${fetchErr.message}`,
    };
  }

  if (!jobs || jobs.length === 0) {
    return {
      success: true,
      totalJobsFound: 0,
      jobsRecovered: 0,
      jobsFailed: 0,
      details: [],
    };
  }

  const details: AccountDeletionRecoveryJobResult[] = [];
  let jobsRecovered = 0;
  let jobsFailed = 0;

  for (const job of jobs) {
    const profileId = job.profile_id;
    const previousStatus = job.status || 'unknown';
    let dbClean = false;
    let storageClean = false;
    let authDeleted = false;

    // If job was already marked completed, treat as already resolved
    if (previousStatus === 'completed') {
      details.push({
        profileId,
        success: true,
        previousStatus,
        newStatus: 'completed',
        dbClean: true,
        storageClean: true,
        authDeleted: true,
      });
      jobsRecovered++;
      continue;
    }

    try {
      // 1. Verify Database State
      const { data: profileRow, error: profileErr } = await adminClient
        .from('profiles')
        .select('profile_id')
        .eq('profile_id', profileId)
        .maybeSingle();

      if (profileErr) {
        throw new Error(`Database profile check error: ${profileErr.message}`);
      }

      let effectiveStudentId = job.student_id;
      let effectiveTeacherId = job.teacher_id;
      let rpcPendingStorage: any[] = [];

      if (profileRow) {
        // Profile still exists; database deletion was interrupted or not committed
        console.log(`[user-account-delete] Recovery: running delete_user_account_data RPC for profile ${profileId}`);
        const { data: rpcData, error: rpcErr } = await adminClient.rpc('delete_user_account_data', {
          p_target_profile_id: profileId,
        });

        if (rpcErr) {
          await adminClient
            .from('account_deletion_records')
            .update({
              status: 'db_in_progress',
              error_message: `Recovery DB cleanup failed: ${rpcErr.message}`,
              updated_at: new Date().toISOString(),
            })
            .eq('profile_id', profileId);
          throw new Error(`Database cleanup RPC failed during recovery: ${rpcErr.message}`);
        }

        dbClean = true;
        if (rpcData && typeof rpcData === 'object') {
          if ((rpcData as any).student_id) effectiveStudentId = (rpcData as any).student_id;
          if ((rpcData as any).teacher_id) effectiveTeacherId = (rpcData as any).teacher_id;
          if (Array.isArray((rpcData as any).pending_storage_paths)) {
            rpcPendingStorage = (rpcData as any).pending_storage_paths;
          }
        }
      } else {
        dbClean = true;
      }

      // 2. Verify Storage State across all potential user prefixes
      const storageTasks: Promise<StorageCleanResult | ExplicitStorageCleanResult>[] = [
        cleanStoragePrefix(adminClient, 'profile-images', profileId),
        cleanStoragePrefix(adminClient, 'certificates', profileId),
      ];

      if (effectiveStudentId) {
        storageTasks.push(
          cleanStoragePrefix(adminClient, 'student-submissions', effectiveStudentId),
          cleanStoragePrefix(adminClient, 'certificates', effectiveStudentId),
        );
      }

      // Recover pending doubt attachment paths from job record and rpcResult
      const rawJobPending: any[] = [];
      if (job?.pending_storage_paths && Array.isArray(job.pending_storage_paths)) {
        rawJobPending.push(...job.pending_storage_paths);
      }
      if (rpcPendingStorage.length > 0) {
        rawJobPending.push(...rpcPendingStorage);
      }
      const jobPendingDoubtPaths = deduplicateStoragePaths(rawJobPending, 'doubt-attachments');

      storageTasks.push(
        cleanExplicitStoragePaths(adminClient, jobPendingDoubtPaths, 'doubt-attachments'),
      );

      if (effectiveTeacherId) {
        storageTasks.push(
          cleanStoragePrefix(adminClient, 'teacher-documents', effectiveTeacherId),
        );
      }

      const storageResults = await Promise.all(storageTasks);
      const failedStorage = storageResults.filter((r) => !r.success);

      if (failedStorage.length > 0) {
        const storageErrorSummary = failedStorage
          .map((f) => `${f.bucket}/${f.prefix}: ${f.error || 'failed'}`)
          .join('; ');

        await adminClient
          .from('account_deletion_records')
          .update({
            status: 'storage_failed',
            storage_clean: false,
            storage_details: storageResults,
            error_message: `Recovery storage cleanup failed: ${storageErrorSummary}`,
            updated_at: new Date().toISOString(),
          })
          .eq('profile_id', profileId);

        throw new Error(`Storage cleanup failed during recovery: ${storageErrorSummary}`);
      }

      storageClean = true;

      // Update storage status before Auth step
      const { error: storageRecErr } = await adminClient
        .from('account_deletion_records')
        .update({
          status: 'storage_completed',
          storage_clean: true,
          pending_storage_paths: [],
          storage_details: storageResults,
          error_message: null,
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', profileId);

      if (storageRecErr) {
        throw new Error(`Failed to update storage_completed in outbox during recovery: ${storageRecErr.message}`);
      }

      // 3. Verify Auth State
      const { data: authUserData, error: authUserErr } = await adminClient.auth.admin.getUserById(profileId);

      if (authUserErr) {
        // Supabase Auth returns status 404 or message with "not found" when user is already deleted
        const isNotFound =
          authUserErr.status === 404 ||
          (authUserErr.message && authUserErr.message.toLowerCase().includes('not found')) ||
          (authUserErr as any).code === 'user_not_found';

        if (isNotFound) {
          // User is ALREADY deleted from Auth! This is the exact scenario where finalization failed previously.
          authDeleted = true;
        } else {
          await adminClient
            .from('account_deletion_records')
            .update({
              status: 'auth_failed',
              storage_clean: true,
              auth_deleted: false,
              error_message: `Recovery Auth verification failed: ${authUserErr.message}`,
              updated_at: new Date().toISOString(),
            })
            .eq('profile_id', profileId);

          throw new Error(`Auth lookup failed during recovery: ${authUserErr.message}`);
        }
      } else if (authUserData?.user) {
        // Auth user still exists, delete via admin API
        const { error: deleteErr } = await adminClient.auth.admin.deleteUser(profileId);
        if (deleteErr) {
          await adminClient
            .from('account_deletion_records')
            .update({
              status: 'auth_failed',
              storage_clean: true,
              auth_deleted: false,
              error_message: `Recovery Auth deletion failed: ${deleteErr.message}`,
              updated_at: new Date().toISOString(),
            })
            .eq('profile_id', profileId);

          throw new Error(`Auth deletion failed during recovery: ${deleteErr.message}`);
        }
        authDeleted = true;
      } else {
        authDeleted = true;
      }

      // 4. Finalize outbox record as 'completed'
      const { error: finalErr } = await adminClient
        .from('account_deletion_records')
        .update({
          status: 'completed',
          storage_clean: true,
          auth_deleted: true,
          error_message: null,
          completed_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', profileId);

      if (finalErr) {
        throw new Error(`Failed to finalize outbox record as completed during recovery: ${finalErr.message}`);
      }

      jobsRecovered++;
      details.push({
        profileId,
        success: true,
        previousStatus,
        newStatus: 'completed',
        dbClean,
        storageClean,
        authDeleted,
      });
      console.log(`[user-account-delete] Recovery successfully finalized job for user: ${profileId}`);
    } catch (jobErr) {
      jobsFailed++;
      const errorMsg = jobErr instanceof Error ? jobErr.message : String(jobErr);
      console.error(`[user-account-delete] Recovery failed for user ${profileId}:`, errorMsg);
      details.push({
        profileId,
        success: false,
        previousStatus,
        newStatus: 'failed',
        dbClean,
        storageClean,
        authDeleted,
        error: errorMsg,
      });
    }
  }

  return {
    success: jobsFailed === 0,
    totalJobsFound: jobs.length,
    jobsRecovered,
    jobsFailed,
    details,
  };
}

/**
 * Main HTTP request handler for user-account-delete.
 * Implements full security pipeline and fails closed before destructive operations:
 *   1. CORS preflight (OPTIONS).
 *   2. Support for administrative recovery calls (strictly requiring SUPABASE_SERVICE_ROLE_KEY).
 *   3. Authorization Bearer header validation.
 *   4. Authoritative Supabase Auth user validation (auth.getUser()).
 *   5. Verified claims retrieval.
 *   6. OTP re-authentication enforcement (F-02): requires verified OTP <= 300s fresh and matching sub.
 *   7. Service-Role client initialization.
 *   8. Server-side Student-Only role verification against public.profiles (or durable outbox recovery for incomplete student deletions).
 *   9. Database cleanup via delete_user_account_data RPC FIRST.
 *      Durably registers student_id and teacher_id in account_deletion_records.
 *      If RPC fails, halts immediately with HTTP 500 (storage & Auth untouched).
 *   9. Recursive storage cleanup across all user buckets.
 *      If any bucket cleanup fails: records 'storage_failed' in account_deletion_records,
 *      halts with HTTP 500, and DOES NOT delete the Auth user.
 *  10. Durably record 'storage_completed' state.
 *      If recording fails: halts with HTTP 500 and DOES NOT delete the Auth user.
 *  11. Supabase Auth user deletion: admin.deleteUser().
 *      Only invoked when storage cleanup is completely verified and durably recorded.
 *  12. Finalize account_deletion_records with status 'completed'.
 *  13. Return success JSON response.
 */
export async function handleUserAccountDelete(
  req: Request,
  deps: UserAccountDeleteDependencies = {},
): Promise<Response> {
  const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-action',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
  };

  const jsonResponse = (body: Record<string, unknown>, status: number = 200) => {
    return new Response(JSON.stringify(body), {
      status,
      headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' },
    });
  };

  const errorResponse = (message: string, status: number = 400, details?: string) => {
    return jsonResponse(
      {
        success: false,
        error: message,
        ...(details ? { details } : {}),
      },
      status,
    );
  };

  // 1. CORS preflight
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: CORS_HEADERS });
  }

  if (req.method !== 'POST') {
    return errorResponse('Method not allowed. Use POST.', 405);
  }

  // 2. Validate Authorization header
  const authHeader = req.headers.get('Authorization');
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return errorResponse('Authentication required. Missing or malformed Bearer token.', 401);
  }

  const token = authHeader.replace(/^Bearer\s+/i, '').trim();
  if (!token) {
    return errorResponse('Authentication required. Missing or malformed Bearer token.', 401);
  }

  const getEnv = (k: string) => {
    if (deps.env && deps.env[k as keyof typeof deps.env] !== undefined) {
      return deps.env[k as keyof typeof deps.env];
    }
    const denoEnv = (globalThis as any).Deno?.env;
    return denoEnv ? denoEnv.get(k) : (typeof process !== 'undefined' && process.env ? process.env[k] : undefined);
  };

  const supabaseUrl = getEnv('SUPABASE_URL');
  const supabaseAnonKey = getEnv('SUPABASE_ANON_KEY');
  const supabaseServiceRoleKey = getEnv('SUPABASE_SERVICE_ROLE_KEY');

  if (!supabaseUrl || !supabaseAnonKey || !supabaseServiceRoleKey) {
    console.error('[user-account-delete] Missing required Supabase environment variables');
    return errorResponse('Server configuration error.', 500);
  }

  const createClientFn = deps.createSupabaseClient || ((url: string, key: string, options?: any) => {
    return (globalThis as any).createClient ? (globalThis as any).createClient(url, key, options) : null;
  });

  // Check if this is an administrative recovery request
  let reqUrl: URL | null = null;
  try {
    reqUrl = new URL(req.url);
  } catch {
    // Relative or mock URL
  }
  const isRecoveryPath = reqUrl?.pathname.endsWith('/recover') || reqUrl?.searchParams.get('action') === 'recover';
  const hasRecoveryHeader = req.headers.get('x-action') === 'recover';

  let reqBody: Record<string, unknown> | null = null;
  try {
    const clonedReq = typeof req.clone === 'function' ? req.clone() : req;
    reqBody = await clonedReq.json();
  } catch {
    // Non-JSON or empty body
  }

  const isRecoveryBody = reqBody && reqBody.action === 'recover';
  const isRecoveryRequest = Boolean(isRecoveryPath || hasRecoveryHeader || isRecoveryBody);

  // Administrative recovery pipeline (strictly service-role only)
  if (isRecoveryRequest) {
    if (token !== supabaseServiceRoleKey) {
      console.warn('[user-account-delete] Unauthorized recovery attempt rejected: non-service-role token provided.');
      return errorResponse('Forbidden: Administrative recovery requires service-role authorization.', 403);
    }

    const adminClient = createClientFn(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    const targetProfileId = typeof reqBody?.targetProfileId === 'string'
      ? reqBody.targetProfileId
      : reqUrl?.searchParams.get('targetProfileId') || undefined;
    const batchSize = typeof reqBody?.batchSize === 'number' ? reqBody.batchSize : undefined;

    const recoveryResult = await recoverAccountDeletionJobs(adminClient, { targetProfileId, batchSize });
    return jsonResponse(recoveryResult, recoveryResult.success ? 200 : 500);
  }

  try {
    // 3. Authenticate caller JWT authoritatively via Supabase Auth
    const callerClient = createClientFn(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
      global: { headers: { Authorization: `Bearer ${token}` } },
    });

    const {
      data: userData,
      error: authError,
    } = await callerClient.auth.getUser();

    const user = userData?.user;

    if (authError || !user || !user.id) {
      return errorResponse('Invalid or expired authentication token.', 401);
    }

    const userId = user.id;

    // 4. Retrieve verified claims (prefer supported getClaims API on client)
    let claims: UserJwtClaims | null = null;
    if (typeof callerClient.auth.getClaims === 'function') {
      try {
        const { data: claimsData, error: claimsError } = await callerClient.auth.getClaims(token);
        if (!claimsError && claimsData?.claims) {
          claims = claimsData.claims as UserJwtClaims;
        }
      } catch (claimsErr) {
        console.warn('[user-account-delete] callerClient.auth.getClaims exception:', claimsErr);
      }
    }

    // Fall back to extracting claims from the cryptographically verified token
    if (!claims) {
      claims = decodeJwtPayload(token) as UserJwtClaims | null;
    }

    // 5. Enforce OTP re-authentication requirement (F-02) BEFORE ANY DESTRUCTIVE OPERATION
    const nowMs = deps.nowMs ? deps.nowMs() : Date.now();
    const otpAuthResult = validateOtpReauthentication(claims, userId, nowMs);

    if (!otpAuthResult.authorized) {
      console.warn(`[user-account-delete] Authorization rejected for user ${userId}: ${otpAuthResult.errorMessage}`);
      return errorResponse(otpAuthResult.errorMessage || 'Recent OTP re-authentication required.', otpAuthResult.statusCode);
    }

    console.log(`[user-account-delete] OTP re-authentication verified for user ${userId} (OTP timestamp: ${otpAuthResult.otpTimestamp}). Proceeding with account deletion.`);

    // 6. Create Service-Role client for administrative cleanup
    const adminClient = createClientFn(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

    // 7. Enforce Student-Only Role Authorization BEFORE any destructive operation.
    // Permanent self-service account deletion is strictly restricted to students.
    // Teachers and administrators are managed via the admin console (deactivation/revocation)
    // and must not be deleted through this pipeline to protect institutional assets
    // (questions, timetables, live classes, recordings, notification templates).
    // Retrieve trusted profile from server-side database; NEVER trust client claims.
    const { data: profileRow, error: profileErr } = await adminClient
      .from('profiles')
      .select('profile_id, role')
      .eq('profile_id', userId)
      .maybeSingle();

    if (profileErr) {
      console.error(`[user-account-delete] Profile query failed for user ${userId}:`, profileErr.message);
      return errorResponse('Failed to verify account authorization.', 500);
    }

    let isAuthorizedStudent = false;
    let existingOutboxRow: any = null;

    if (profileRow) {
      // Profile exists: must be strictly 'student' role
      if (profileRow.role !== 'student') {
        console.warn(`[user-account-delete] Non-student account deletion rejected for user ${userId} with role "${profileRow.role}". Self-service deletion is strictly restricted to students.`);
        return errorResponse('Forbidden: Permanent account deletion is only available for student accounts.', 403);
      }
      isAuthorizedStudent = true;
    } else {
      // Profile does not exist: check if this is an authorized, incomplete student deletion retry
      // (e.g. database profile was deleted on initial attempt, but storage cleanup or auth deletion failed)
      const { data: outboxRow, error: outboxErr } = await adminClient
        .from('account_deletion_records')
        .select('profile_id, user_role, status, pending_storage_paths')
        .eq('profile_id', userId)
        .maybeSingle();

      existingOutboxRow = outboxRow;

      if (outboxErr) {
        console.error(`[user-account-delete] Outbox lookup failed for user ${userId}:`, outboxErr.message);
        return errorResponse('Failed to verify account deletion recovery state.', 500);
      }

      if (!outboxRow) {
        console.warn(`[user-account-delete] Profile and deletion record not found for user ${userId}. Deletion rejected.`);
        return errorResponse('Account profile not found or already deleted.', 404);
      }

      // Prohibit non-students from resuming deletion through an outbox record
      if (outboxRow.user_role !== 'student') {
        console.warn(`[user-account-delete] Non-student deletion resumption rejected for user ${userId} with outbox role "${outboxRow.user_role}".`);
        return errorResponse('Forbidden: Permanent account deletion is only available for student accounts.', 403);
      }

      // Check if the deletion job is already completed
      if (outboxRow.status === 'completed') {
        console.warn(`[user-account-delete] User ${userId} attempted to retry an already completed account deletion.`);
        return errorResponse('Account deletion has already been completed and finalized.', 410);
      }

      // Allowed incomplete states for resuming an authorized student deletion
      const RESUMABLE_OUTBOX_STATUSES = [
        'pending',
        'db_in_progress',
        'db_completed',
        'storage_failed',
        'storage_completed',
        'auth_failed',
      ];

      if (!RESUMABLE_OUTBOX_STATUSES.includes(outboxRow.status)) {
        console.warn(`[user-account-delete] Resumption rejected for user ${userId} with non-resumable outbox status "${outboxRow.status}".`);
        return errorResponse(`Cannot resume account deletion: invalid deletion status "${outboxRow.status}".`, 400);
      }

      console.log(`[user-account-delete] Resuming incomplete student account deletion for user ${userId} (outbox status: "${outboxRow.status}").`);
      isAuthorizedStudent = true;
    }

    if (!isAuthorizedStudent) {
      return errorResponse('Unauthorized account deletion request.', 403);
    }

    // 8. Look up child identifier (student_id) and pre-capture doubt attachment paths before database deletion.
    let preStudentId: string | undefined;
    let preTeacherId: string | undefined;
    let preCapturedDoubtPaths: StoragePathItem[] = [];

    try {
      const { data: student } = await adminClient
        .from('student_details')
        .select('student_id')
        .eq('profile_id', userId)
        .maybeSingle();
      preStudentId = student?.student_id;

      // Pre-capture doubt attachment paths as defense-in-depth before the DB RPC removes metadata
      const { data: uploadedFiles } = await adminClient
        .from('doubt_attachments')
        .select('bucket, storage_path')
        .eq('uploaded_by', userId);
      if (uploadedFiles && uploadedFiles.length > 0) {
        preCapturedDoubtPaths.push(...uploadedFiles);
      }

      if (preStudentId) {
        const { data: studentDoubts } = await adminClient
          .from('student_doubts')
          .select('doubt_id')
          .eq('student_id', preStudentId);
        const doubtIds = (studentDoubts || []).map((d: any) => d.doubt_id);
        if (doubtIds.length > 0) {
          const { data: doubtFiles } = await adminClient
            .from('doubt_attachments')
            .select('bucket, storage_path')
            .in('doubt_id', doubtIds);
          if (doubtFiles && doubtFiles.length > 0) {
            preCapturedDoubtPaths.push(...doubtFiles);
          }
        }
      }
    } catch (lookupErr) {
      console.warn('[user-account-delete] Optional child identity/doubt pre-lookup warning:', lookupErr);
    }

    // 9. Execute PostgreSQL stored procedure FIRST.
    // Database cleanup MUST succeed before any external storage deletion or Auth deletion.
    // If the database transaction fails (e.g. statement timeout, constraint violation),
    // PostgreSQL rolls back atomically and execution halts immediately. No storage files
    // are deleted, preventing partial-deletion corruption and enabling safe retries.
    const { data: rpcResult, error: rpcError } = await adminClient.rpc(
      'delete_user_account_data',
      { p_target_profile_id: userId },
    );

    if (rpcError) {
      console.error('[user-account-delete] DB RPC delete_user_account_data failed:', rpcError);
      return errorResponse('Failed to delete database records: ' + rpcError.message, 500);
    }

    // Combine pre-queried IDs with RPC-returned IDs (retrieved from account_deletion_records on retries)
    const effectiveStudentId = preStudentId || (rpcResult && typeof rpcResult === 'object' ? (rpcResult as any).student_id : undefined);
    const effectiveTeacherId = preTeacherId || (rpcResult && typeof rpcResult === 'object' ? (rpcResult as any).teacher_id : undefined);

    // 10. Clean up user-owned storage files across buckets recursively and exact doubt attachment paths.
    // Executed only after the database transaction has successfully committed.
    const storageTasks: Promise<StorageCleanResult | ExplicitStorageCleanResult>[] = [
      cleanStoragePrefix(adminClient, 'profile-images', userId),
      cleanStoragePrefix(adminClient, 'certificates', userId),
    ];

    if (effectiveStudentId) {
      storageTasks.push(
        cleanStoragePrefix(adminClient, 'student-submissions', effectiveStudentId),
        cleanStoragePrefix(adminClient, 'certificates', effectiveStudentId),
      );
    }

    // Capture durable pending doubt attachment paths from outbox, RPC result, and pre-lookup
    const rawPendingPaths: any[] = [];
    if (existingOutboxRow?.pending_storage_paths && Array.isArray(existingOutboxRow.pending_storage_paths)) {
      rawPendingPaths.push(...existingOutboxRow.pending_storage_paths);
    }
    if (rpcResult && typeof rpcResult === 'object' && Array.isArray((rpcResult as any).pending_storage_paths)) {
      rawPendingPaths.push(...(rpcResult as any).pending_storage_paths);
    }
    if (preCapturedDoubtPaths.length > 0) {
      rawPendingPaths.push(...preCapturedDoubtPaths);
    }
    const pendingDoubtPaths = deduplicateStoragePaths(rawPendingPaths, 'doubt-attachments');

    // Clean exact doubt attachment paths (instead of broken student_id prefix)
    storageTasks.push(
      cleanExplicitStoragePaths(adminClient, pendingDoubtPaths, 'doubt-attachments'),
    );

    if (effectiveTeacherId) {
      storageTasks.push(
        cleanStoragePrefix(adminClient, 'teacher-documents', effectiveTeacherId),
      );
    }

    const storageResults = await Promise.all(storageTasks);
    const failedStorage = storageResults.filter((r) => !r.success);

    if (failedStorage.length > 0) {
      const storageErrorSummary = failedStorage
        .map((f) => `${f.bucket}/${f.prefix}: ${f.error || 'failed'}`)
        .join('; ');

      console.error(`[user-account-delete] Storage cleanup failed for user ${userId}: ${storageErrorSummary}`);

      // Record durable failure in outbox table so recovery knows storage is incomplete
      const { error: updateErr } = await adminClient
        .from('account_deletion_records')
        .update({
          status: 'storage_failed',
          storage_clean: false,
          storage_details: storageResults,
          error_message: storageErrorSummary,
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', userId);

      if (updateErr) {
        console.error(`[user-account-delete] Failed to update account_deletion_records on storage failure for user ${userId}:`, updateErr.message);
      }

      // DO NOT delete the Auth user while storage cleanup remains incomplete!
      return errorResponse('Failed to complete storage file cleanup: ' + storageErrorSummary, 500);
    }

    // Record successful storage cleanup in durable outbox BEFORE Auth deletion
    const { error: storageRecordErr } = await adminClient
      .from('account_deletion_records')
      .update({
        status: 'storage_completed',
        storage_clean: true,
        pending_storage_paths: [],
        storage_details: storageResults,
        error_message: null,
        updated_at: new Date().toISOString(),
      })
      .eq('profile_id', userId);

    if (storageRecordErr) {
      console.error(
        `[user-account-delete] Failed to durably record storage_completed state for user ${userId}:`,
        storageRecordErr.message,
      );
      // DO NOT delete Auth user if durable state update cannot be confirmed!
      return errorResponse(
        'Storage cleanup succeeded, but durably recording state failed. Account deletion halted before Auth deletion.',
        500,
        storageRecordErr.message,
      );
    }

    // 10. Delete the Supabase Auth user via Admin API
    const { error: deleteUserError } = await adminClient.auth.admin.deleteUser(userId);

    if (deleteUserError) {
      console.error(
        `[user-account-delete] Supabase Auth admin.deleteUser failed for user ${userId}:`,
        deleteUserError.message,
      );

      const { error: authRecordErr } = await adminClient
        .from('account_deletion_records')
        .update({
          status: 'auth_failed',
          storage_clean: true,
          auth_deleted: false,
          error_message: deleteUserError.message,
          updated_at: new Date().toISOString(),
        })
        .eq('profile_id', userId);

      if (authRecordErr) {
        console.error(`[user-account-delete] Failed to record auth_failed state for user ${userId}:`, authRecordErr.message);
      }

      return errorResponse(
        'Database and storage records were cleaned, but removing the authentication record failed: ' +
          deleteUserError.message,
        500,
      );
    }

    // 11. Finalize deletion record as completed
    const { error: finalErr } = await adminClient
      .from('account_deletion_records')
      .update({
        status: 'completed',
        storage_clean: true,
        auth_deleted: true,
        completed_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      })
      .eq('profile_id', userId);

    if (finalErr) {
      console.error(
        `[user-account-delete] User data and Auth record were deleted, but finalizing account_deletion_records failed for user ${userId}:`,
        finalErr.message,
      );
      return errorResponse(
        'User data and authentication record were removed, but finalizing the deletion record encountered a database error.',
        500,
        finalErr.message,
      );
    }

    console.log(`[user-account-delete] Account deletion completed successfully for user: ${userId}`);

    return jsonResponse({
      success: true,
      message: 'Your account and personal data have been permanently deleted.',
      userId,
      details: rpcResult,
    });
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : 'Unknown server error';
    console.error('[user-account-delete] Unhandled error:', err);
    return errorResponse('An unexpected error occurred during account deletion.', 500, errorMsg);
  }
}
