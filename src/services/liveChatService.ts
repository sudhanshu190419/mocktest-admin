/**
 * Live Chat Service (Teacher Dashboard)
 *
 * Reusable service layer for the Teacher ↔ Student Live Chat module.
 *
 * Communicates with the existing Supabase backend (conversations and messages
 * tables) via the anon-key client — all queries run within the authenticated
 * user's context and are enforced by existing RLS policies.
 *
 * ## Architecture
 *
 * - **Conversations** are created server-side (via the `get_or_create_conversation`
 *   SECURITY DEFINER RPC). Students initiate conversations; teachers read/write
 *   to existing ones.
 * - **Messages** are append-only. Once inserted, they are never updated or
 *   deleted by students or teachers.
 * - **Realtime** subscriptions use the existing Supabase Realtime configuration.
 *   Only one channel per conversation is created.
 * - **No UI logic** — this service is purely a data-access layer.
 *
 * @module services/liveChatService
 */

import { supabase } from '@/config/supabase';
import { extractErrorMessage } from '@/utils/supabase';
import type {
  Conversation,
  ConversationWithDetails,
  Message,
  TeacherConversationItem,
  SendMessageInput,
  MessageSubscriptionCallback,
  MessageSubscription,
} from '@/types/liveChat';

// ═══════════════════════════════════════════════════════════════════════════
//  Error Types
// ═══════════════════════════════════════════════════════════════════════════

export class LiveChatValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveChatValidationError';
  }
}

export class LiveChatNotFoundError extends Error {
  constructor(resource: string, id: string) {
    super(`${resource} not found: ${id}`);
    this.name = 'LiveChatNotFoundError';
  }
}

export class LiveChatPermissionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LiveChatPermissionError';
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  Internal Response Type
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Structured response type for service operations.
 * Every function returns this shape so consumers never need to handle
 * raw Supabase exceptions.
 */
export interface ChatResponse<T = unknown> {
  success: boolean;
  data?: T;
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Database Row Shapes (Internal)
// ═══════════════════════════════════════════════════════════════════════════

interface DbConversation {
  conversation_id: string;
  class_id: string;
  teacher_id: string;
  student_id: string;
  created_at: string;
  updated_at: string;
}

interface DbMessage {
  message_id: string;
  conversation_id: string;
  sender_profile_id: string;
  message: string;
  created_at: string;
}

interface DbConversationWithJoin {
  conversation_id: string;
  class_id: string;
  teacher_id: string;
  student_id: string;
  created_at: string;
  updated_at: string;
  student_profiles: { name: string } | null;
  teacher_profiles: { name: string } | null;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Mapping Helpers
// ═══════════════════════════════════════════════════════════════════════════

function mapConversation(db: DbConversation): Conversation {
  return {
    conversationId: db.conversation_id,
    classId: db.class_id,
    teacherId: db.teacher_id,
    studentId: db.student_id,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
  };
}

function mapMessage(db: DbMessage): Message {
  return {
    messageId: db.message_id,
    conversationId: db.conversation_id,
    senderProfileId: db.sender_profile_id,
    message: db.message,
    createdAt: db.created_at,
  };
}

function mapConversationWithDetails(db: DbConversationWithJoin): ConversationWithDetails {
  return {
    conversationId: db.conversation_id,
    classId: db.class_id,
    teacherId: db.teacher_id,
    studentId: db.student_id,
    createdAt: db.created_at,
    updatedAt: db.updated_at,
    teacherName: db.teacher_profiles?.name ?? 'Unknown Teacher',
    studentName: db.student_profiles?.name ?? 'Unknown Student',
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  Shared Helpers
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Resolves the current authenticated user's teacher_id from teacher_details.
 *
 * @returns The teacher_id, or null if the user is not a teacher.
 */
async function resolveTeacherId(): Promise<string | null> {
  try {
    const { data: userData } = await supabase.auth.getUser();
    if (!userData?.user) return null;

    const { data } = await supabase
      .from('teacher_details')
      .select('teacher_id')
      .eq('profile_id', userData.user.id)
      .maybeSingle<{ teacher_id: string }>();

    return data?.teacher_id ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolves student display names from profiles via student_details.
 *
 * Uses a two-query pattern to avoid depending on PostgREST embedded
 * resource FK resolution (which can fail silently if FK constraints
 * aren't inferred correctly by PostgREST).
 *
 * @param studentDetailIds - Array of student_details.student_id values.
 * @returns A Map keyed by student_id → display name.
 */
async function bulkFetchStudentNames(
  studentDetailIds: string[],
): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (studentDetailIds.length === 0) {
    console.log('[DEBUG bulkFetchStudentNames] Input IDs array empty — returning empty map');
    return names;
  }

  console.log('[DEBUG bulkFetchStudentNames] Step 1 — Input student_detail_ids:', studentDetailIds);

  // 1. Fetch profile_id from student_details
  const { data: details, error: detailsError } = await supabase
    .from('student_details')
    .select('student_id, profile_id')
    .in('student_id', studentDetailIds);

  console.log('[DEBUG bulkFetchStudentNames] Step 2 — student_details query result:', {
    error: detailsError?.message ?? null,
    rowCount: details?.length ?? 0,
    rows: details ?? [],
  });

  if (detailsError) {
    console.log('[DEBUG bulkFetchStudentNames] ❌ student_details query error:', detailsError.message);
    return names;
  }

  if (!details || details.length === 0) {
    console.log('[DEBUG bulkFetchStudentNames] ❌ No rows returned from student_details for the given IDs');
    return names;
  }

  // 2. Fetch display names from profiles using the resolved profile_ids
  const profileIds = details.map((d) => d.profile_id).filter((id): id is string => id !== null);
  
  console.log('[DEBUG bulkFetchStudentNames] Step 3 — Resolved profile_ids from student_details:', {
    totalDetails: details.length,
    nonNullProfileIds: profileIds.length,
    nullProfileIds: details.filter((d) => d.profile_id === null).length,
    profileIds,
  });

  if (profileIds.length === 0) {
    console.log('[DEBUG bulkFetchStudentNames] ❌ All profile_ids are NULL in student_details — cannot resolve names');
    return names;
  }

  const { data: profiles, error: profilesError } = await supabase
    .from('profiles')
    .select('profile_id, name')
    .in('profile_id', profileIds);

  console.log('[DEBUG bulkFetchStudentNames] Step 4 — profiles query result:', {
    error: profilesError?.message ?? null,
    queryProfileIds: profileIds,
    rowCount: profiles?.length ?? 0,
    rows: profiles ?? [],
  });

  if (profilesError) {
    console.log('[DEBUG bulkFetchStudentNames] ❌ profiles query error:', profilesError.message);
    return names;
  }

  if (!profiles || profiles.length === 0) {
    console.log('[DEBUG bulkFetchStudentNames] ❌ No rows returned from profiles for the given profile_ids');
    return names;
  }

  const profileNameMap = new Map(
    profiles.map((p) => [p.profile_id, p.name]),
  );

  console.log('[DEBUG bulkFetchStudentNames] Step 5 — Profiles name map:', Object.fromEntries(profileNameMap));

  for (const d of details) {
    if (!d.profile_id) {
      console.log(`[DEBUG bulkFetchStudentNames] ⚠️ Skipping student_detail_id=${d.student_id} — profile_id is NULL`);
      continue;
    }
    const name = profileNameMap.get(d.profile_id);
    if (name) {
      console.log(`[DEBUG bulkFetchStudentNames] ✅ Resolved: student_detail_id=${d.student_id} → name="${name}"`);
      names.set(d.student_id, name);
    } else {
      console.log(`[DEBUG bulkFetchStudentNames] ❌ profile_id=${d.profile_id} (from student_detail_id=${d.student_id}) NOT FOUND in profiles table`);
    }
  }

  console.log('[DEBUG bulkFetchStudentNames] Step 6 — Final name map:', Object.fromEntries(names));
  return names;
}

/**
 * Fetches the most recent message for each conversation in bulk.
 * Uses a single query with DISTINCT ON semantics to avoid N+1.
 *
 * @param conversationIds - Array of conversation UUIDs.
 * @returns A Map keyed by conversation_id → { message, created_at }.
 */
async function bulkFetchLatestMessages(
  conversationIds: string[],
): Promise<Map<string, { message: string; created_at: string }>> {
  const latest = new Map<string, { message: string; created_at: string }>();

  if (conversationIds.length === 0) return latest;

  const { data: msgData } = await supabase
    .from('messages')
    .select('conversation_id, message, created_at')
    .in('conversation_id', conversationIds)
    .order('created_at', { ascending: false })
    .limit(conversationIds.length);

  if (msgData) {
    for (const msg of msgData) {
      if (!latest.has(msg.conversation_id)) {
        latest.set(msg.conversation_id, {
          message: msg.message,
          created_at: msg.created_at,
        });
      }
    }
  }

  return latest;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Live Chat Service
// ═══════════════════════════════════════════════════════════════════════════

export const liveChatService = {
  // ────────────────────────────────────────────────────────────────────────
  //  Teacher Conversation Listing
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Fetch every student conversation for the selected live class.
   *
   * Returns conversations with the student's display name, latest message
   * preview, and timestamp — sorted by most recent activity first.
   *
   * Uses a two-query pattern to avoid N+1:
   *   1. Fetch conversations with student names (single join query).
   *   2. Bulk-fetch latest message for all matched conversation IDs.
   *
   * @param classId - UUID of the live class.
   * @returns Array of conversation items sorted by latest activity.
   */
  async getTeacherConversations(
    classId: string,
  ): Promise<ChatResponse<TeacherConversationItem[]>> {
    try {
      // ── Resolve the current teacher ──────────────────────────────
      const teacherId = await resolveTeacherId();
      if (!teacherId) {
        return {
          success: false,
          error: 'Teacher profile not found. Only teachers can access conversations.',
        };
      }

      // ── Fetch conversations ──────────────────────────────────────
      // NOTE: We intentionally do NOT use a nested PostgREST join to
      // resolve student names because PostgREST may fail to infer the
      // FK path conversations → student_details → profiles, returning
      // null for student_profiles. Instead we fetch names separately.
      const { data, error } = await supabase
        .from('conversations')
        .select('conversation_id, student_id, updated_at')
        .eq('class_id', classId)
        .eq('teacher_id', teacherId)
        .order('updated_at', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      if (!data || data.length === 0) {
        return { success: true, data: [] };
      }

      // ── Resolve student display names separately ──────────────────
      const studentDetailIds = data.map((r) => r.student_id);
      
      console.log('[DEBUG getTeacherConversations] conversations query returned:', {
        classId,
        teacherId,
        rowCount: data.length,
        rows: data.map((r) => ({
          conversation_id: r.conversation_id,
          student_id: r.student_id,
          updated_at: r.updated_at,
        })),
      });

      const nameMap = await bulkFetchStudentNames(studentDetailIds);

      // ── Bulk-fetch latest messages ───────────────────────────────
      const conversationIds = data.map((r) => r.conversation_id);
      const latestMessages = await bulkFetchLatestMessages(conversationIds);

      // ── Build response items ─────────────────────────────────────
      const items: TeacherConversationItem[] = data.map((row) => {
        const studentName = nameMap.get(row.student_id);
        if (!studentName) {
          console.log('[DEBUG getTeacherConversations] ❌ nameMap has NO entry for student_id:', row.student_id, '- nameMap keys:', Array.from(nameMap.keys()));
        }
        const last = latestMessages.get(row.conversation_id);
        return {
          conversationId: row.conversation_id,
          studentId: row.student_id,
          studentName: studentName ?? 'Unknown Student',
          lastMessage: last?.message ?? null,
          lastMessageAt: last?.created_at ?? row.updated_at,
          updatedAt: row.updated_at,
        };
      });

      console.log('[DEBUG getTeacherConversations] Final items:', items.map((i) => ({
        conversationId: i.conversationId,
        studentId: i.studentId,
        studentName: i.studentName,
      })));

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Search Students
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Search conversations by student name within a specific live class.
   *
   * Performs a case-insensitive search (ILIKE) across the student's
   * display name as stored in the profiles table. Returns matching
   * conversations sorted by latest activity.
   *
   * @param classId    - UUID of the live class to search within.
   * @param searchTerm - The search string (minimum 2 characters).
   * @returns Filtered conversation items matching the search term.
   */
  async searchStudents(
    classId: string,
    searchTerm: string,
  ): Promise<ChatResponse<TeacherConversationItem[]>> {
    try {
      const trimmed = searchTerm?.trim() ?? '';
      if (trimmed.length < 2) {
        return {
          success: false,
          error: 'Search term must be at least 2 characters.',
        };
      }

      // ── Resolve the current teacher ──────────────────────────────
      const teacherId = await resolveTeacherId();
      if (!teacherId) {
        return {
          success: false,
          error: 'Teacher profile not found. Only teachers can search conversations.',
        };
      }

      // ── Fetch conversations filtered by student name ─────────────
      // NOTE: We resolve student names via a separate two-query fetch
      // instead of a nested PostgREST join, because PostgREST may fail
      // to infer the FK path for the embedded resource.
      const { data, error } = await supabase
        .from('conversations')
        .select('conversation_id, student_id, updated_at')
        .eq('class_id', classId)
        .eq('teacher_id', teacherId)
        .order('updated_at', { ascending: false });

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      if (!data || data.length === 0) {
        return { success: true, data: [] };
      }

      // ── Resolve student display names separately ──────────────────
      const studentDetailIds = data.map((r) => r.student_id);
      const nameMap = await bulkFetchStudentNames(studentDetailIds);

      // ── Filter by search term (client-side, case-insensitive) ─────
      const searchLower = trimmed.toLowerCase();
      const filteredIds = new Set<string>();
      for (const row of data) {
        const name = nameMap.get(row.student_id);
        if (name && name.toLowerCase().includes(searchLower)) {
          filteredIds.add(row.conversation_id);
        }
      }

      const filteredData = data.filter((r) =>
        filteredIds.has(r.conversation_id),
      );

      if (filteredData.length === 0) {
        return { success: true, data: [] };
      }

      // ── Bulk-fetch latest messages ───────────────────────────────
      const conversationIds = filteredData.map((r) => r.conversation_id);
      const latestMessages = await bulkFetchLatestMessages(conversationIds);

      // ── Build response items ─────────────────────────────────────
      const items = filteredData.map((row) => {
        const last = latestMessages.get(row.conversation_id);
        return {
          conversationId: row.conversation_id,
          studentId: row.student_id,
          studentName: nameMap.get(row.student_id) ?? 'Unknown Student',
          lastMessage: last?.message ?? null,
          lastMessageAt: last?.created_at ?? row.updated_at,
          updatedAt: row.updated_at,
        };
      });

      return { success: true, data: items };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Get Single Conversation
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Fetch a single conversation by ID, including resolved teacher and
   * student display names.
   *
   * Requires the authenticated user to have access via RLS (teacher can
   * see conversations for their classes; admin can see all).
   *
   * @param conversationId - UUID of the conversation.
   * @returns The conversation with teacher and student profile names.
   */
  async getConversation(
    conversationId: string,
  ): Promise<ChatResponse<ConversationWithDetails>> {
    try {
      const { data, error } = await supabase
        .from('conversations')
        .select(
          `*,
            teacher_profiles:teacher_details!inner(profiles!inner(name)),
            student_profiles:student_details!inner(profiles!inner(name))`,
        )
        .eq('conversation_id', conversationId)
        .single<DbConversationWithJoin>();

      if (error) {
        if (error.code === 'PGRST116') {
          return { success: false, error: 'Conversation not found.' };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapConversationWithDetails(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Get Conversation Messages
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Load the complete message history for a conversation.
   *
   * Returns messages ordered oldest → newest, suitable for rendering
   * in a chat UI. Supports cursor-based pagination for efficient
   * chat history loading.
   *
   * @param conversationId - UUID of the conversation.
   * @param pagination     - Optional pagination (page, pageSize).
   *                          Defaults to page 1, pageSize 50.
   * @returns Messages array ordered chronologically (oldest first).
   */
  async getConversationMessages(
    conversationId: string,
    pagination?: { page?: number; pageSize?: number },
  ): Promise<ChatResponse<Message[]>> {
    try {
      const page = pagination?.page ?? 1;
      const pageSize = pagination?.pageSize ?? 50;
      const from = (page - 1) * pageSize;
      const to = from + pageSize - 1;

      const { data, error } = await supabase
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: true })
        .range(from, to);

      if (error) {
        return { success: false, error: extractErrorMessage(error) };
      }

      return {
        success: true,
        data: (data ?? []).map(mapMessage),
      };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Send Message
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Send a plain text message to a conversation.
   *
   * Validates that the message is not empty after trimming whitespace.
   * The caller must have INSERT permission via RLS (teacher can insert
   * into any conversation for their classes; student can only insert
   * into their own conversation).
   *
   * @param input - The conversation ID and message body.
   * @returns The inserted message.
   */
  async sendMessage(input: SendMessageInput): Promise<ChatResponse<Message>> {
    try {
      // ── Validate input ───────────────────────────────────────────
      if (!input.conversationId) {
        return { success: false, error: 'Conversation ID is required.' };
      }

      const trimmedMessage = input.message?.trim() ?? '';
      if (trimmedMessage.length === 0) {
        return { success: false, error: 'Message cannot be empty.' };
      }

      // ── Resolve sender profile ───────────────────────────────────
      const { data: userData, error: userError } = await supabase.auth.getUser();
      if (userError || !userData?.user) {
        return { success: false, error: 'Authentication required.' };
      }

      // ── Insert the message ───────────────────────────────────────
      const { data, error } = await supabase
        .from('messages')
        .insert({
          conversation_id: input.conversationId,
          sender_profile_id: userData.user.id,
          message: trimmedMessage,
        })
        .select()
        .single<DbMessage>();

      if (error) {
        if (error.code === '23503') {
          return {
            success: false,
            error: 'Cannot send message. The conversation does not exist or you do not have access.',
          };
        }
        return { success: false, error: extractErrorMessage(error) };
      }

      return { success: true, data: mapMessage(data) };
    } catch (err) {
      return { success: false, error: extractErrorMessage(err) };
    }
  },

  // ────────────────────────────────────────────────────────────────────────
  //  Realtime Subscription
  // ────────────────────────────────────────────────────────────────────────

  /**
   * Subscribe to new messages in a conversation via Supabase Realtime.
   *
   * The callback is invoked for every INSERT event on the `messages`
   * table that matches the given conversation_id. The returned
   * `unsubscribe` function removes the listener.
   *
   * Important: Only one subscription should be active per conversation
   * at any time. Call `unsubscribe()` on component unmount or when
   * switching conversations to prevent duplicate subscriptions.
   *
   * @param conversationId - UUID of the conversation to listen to.
   * @param callback       - Invoked with the new Message on each INSERT.
   * @returns An object with an `unsubscribe` function.
   */
  subscribeToMessages(
    conversationId: string,
    callback: MessageSubscriptionCallback,
  ): MessageSubscription {
    const channel = supabase
      .channel(`chat:${conversationId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload: { new: Record<string, unknown> }) => {
          callback(mapMessage(payload.new as unknown as DbMessage));
        },
      )
      .subscribe();

    return {
      unsubscribe: () => {
        supabase.removeChannel(channel);
      },
    };
  },
};
