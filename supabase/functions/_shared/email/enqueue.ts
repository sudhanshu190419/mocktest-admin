/**
 * Make Me Topper — Safe Transactional Email Enqueue Service
 *
 * Implements:
 * 1. Resilient email job submission to public.email_queue via public.enqueue_email_job RPC.
 * 2. Automatic server-side profile resolution (email, name) from profile_id or student_id.
 * 3. Graceful missing-email bypass (does NOT throw or fail).
 * 4. Strict error isolation: email enqueue failures NEVER crash or rollback caller transactions.
 * 5. Structured logging with event type and idempotency keys.
 */

export interface EnqueueEmailOptions {
  recipientEmail?: string | null;
  recipientProfileId?: string | null;
  recipientName?: string | null;
  studentId?: string | null;
  eventType: string; // e.g. 'PAY-01', 'INS-01'
  subject: string;
  templateId: string;
  payload: Record<string, unknown>;
  priority?: 'critical' | 'high' | 'normal' | 'low';
  idempotencyKey?: string | null;
  maxAttempts?: number;
}

export interface EnqueueEmailResult {
  success: boolean;
  queueId?: string;
  status?: string;
  skipped?: boolean;
  skipReason?: string;
  error?: string;
}

export interface MinimalSupabaseClient {
  from(table: string): {
    select(columns: string): {
      eq(column: string, value: unknown): {
        maybeSingle(): Promise<{ data: any; error: any }>;
        single(): Promise<{ data: any; error: any }>;
      };
    };
  };
  rpc(
    fn: string,
    args: Record<string, unknown>
  ): Promise<{ data: any; error: any }>;
}

/**
 * Enqueue an email notification with strict error containment.
 * NEVER throws; returns a result object and logs diagnostic information.
 */
export async function enqueueEmailSafe(
  client: MinimalSupabaseClient,
  options: EnqueueEmailOptions
): Promise<EnqueueEmailResult> {
  try {
    let resolvedEmail = options.recipientEmail?.trim() || null;
    let resolvedName = options.recipientName?.trim() || null;
    let resolvedProfileId = options.recipientProfileId || null;

    // 1. Resolve profile info if recipientEmail is not directly provided
    if (!resolvedEmail && resolvedProfileId) {
      try {
        const { data: profile } = await client
          .from('profiles')
          .select('email, name')
          .eq('profile_id', resolvedProfileId)
          .maybeSingle();

        if (profile?.email) {
          resolvedEmail = String(profile.email).trim();
          if (!resolvedName && profile.name) {
            resolvedName = String(profile.name).trim();
          }
        }
      } catch (profileErr) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'EMAIL_ENQUEUE_PROFILE_LOOKUP_FAILED',
            profileId: resolvedProfileId,
            error:
              profileErr instanceof Error
                ? profileErr.message
                : String(profileErr),
          })
        );
      }
    }

    // 2. If still missing email, attempt resolution via studentId
    if (!resolvedEmail && options.studentId) {
      try {
        const { data: student } = await client
          .from('student_details')
          .select('profile_id')
          .eq('student_id', options.studentId)
          .maybeSingle();

        if (student?.profile_id) {
          resolvedProfileId = student.profile_id;
          const { data: profile } = await client
            .from('profiles')
            .select('email, name')
            .eq('profile_id', student.profile_id)
            .maybeSingle();

          if (profile?.email) {
            resolvedEmail = String(profile.email).trim();
            if (!resolvedName && profile.name) {
              resolvedName = String(profile.name).trim();
            }
          }
        }
      } catch (studentErr) {
        console.warn(
          JSON.stringify({
            level: 'warn',
            event: 'EMAIL_ENQUEUE_STUDENT_LOOKUP_FAILED',
            studentId: options.studentId,
            error:
              studentErr instanceof Error
                ? studentErr.message
                : String(studentErr),
          })
        );
      }
    }

    // 3. Graceful missing recipient bypass (no throw, caller transaction preserved)
    if (!resolvedEmail || !resolvedEmail.includes('@')) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'EMAIL_ENQUEUE_SKIPPED_NO_RECIPIENT_EMAIL',
          eventType: options.eventType,
          recipientProfileId: resolvedProfileId,
          studentId: options.studentId,
          reason: 'No valid recipient email address could be resolved',
        })
      );
      return {
        success: true,
        skipped: true,
        skipReason: 'No valid recipient email address could be resolved',
      };
    }

    // 4. Submit to public.email_queue via database RPC
    const { data: rpcData, error: rpcError } = await client.rpc(
      'enqueue_email_job',
      {
        p_recipient_email: resolvedEmail.toLowerCase(),
        p_subject: options.subject,
        p_template_id: options.templateId,
        p_payload: options.payload || {},
        p_recipient_profile_id: resolvedProfileId || null,
        p_recipient_name: resolvedName || null,
        p_event_type: options.eventType,
        p_priority: options.priority || 'high',
        p_idempotency_key: options.idempotencyKey || null,
        p_max_attempts: options.maxAttempts || 5,
      }
    );

    if (rpcError) {
      console.warn(
        JSON.stringify({
          level: 'warn',
          event: 'EMAIL_ENQUEUE_RPC_ERROR',
          eventType: options.eventType,
          idempotencyKey: options.idempotencyKey,
          error: rpcError.message,
        })
      );
      return {
        success: false,
        error: rpcError.message,
      };
    }

    if (rpcData?.success) {
      console.log(
        JSON.stringify({
          level: 'info',
          event: 'EMAIL_ENQUEUED',
          eventType: options.eventType,
          queueId: rpcData.queue_id,
          status: rpcData.status,
          idempotencyKey: options.idempotencyKey,
        })
      );
      return {
        success: true,
        queueId: rpcData.queue_id,
        status: rpcData.status,
      };
    }

    console.warn(
      JSON.stringify({
        level: 'warn',
        event: 'EMAIL_ENQUEUE_REJECTED',
        eventType: options.eventType,
        code: rpcData?.code,
        message: rpcData?.message,
        idempotencyKey: options.idempotencyKey,
      })
    );
    return {
      success: false,
      error: rpcData?.message || rpcData?.code || 'Enqueue rejected by database',
    };
  } catch (err) {
    console.error(
      JSON.stringify({
        level: 'error',
        event: 'EMAIL_ENQUEUE_UNEXPECTED_EXCEPTION',
        eventType: options.eventType,
        idempotencyKey: options.idempotencyKey,
        error: err instanceof Error ? err.message : String(err),
      })
    );
    return {
      success: false,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}

