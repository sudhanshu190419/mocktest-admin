'use client';

/**
 * useLiveClass — Teacher Live Class Lifecycle Hook
 *
 * Manages the complete lifecycle of a live class session:
 *   1. Create or load an active live class from the DB
 *   2. Generate a LiveKit token via the Edge Function
 *   3. Track connection state (idle → loading → live → ending → ended)
 *   4. Update DB when class starts and ends
 *
 * The actual LiveKit connection is handled by `<LiveKitRoom>` in the UI.
 * This hook only orchestrates the business logic and token provisioning.
 *
 * @module hooks/useLiveClass
 */

import { useState, useCallback, useRef } from 'react';
import { supabase } from '@/config/supabase';
import { teacherService } from '@/services/teacherService';
import { teacherLiveClassService } from '@/services/teacherLiveClassService';
import { getLiveKitToken } from '@/lib/livekit/tokenService';

// ─── Types ─────────────────────────────────────────────────────────────────

export type LiveClassStatus =
  | 'idle'        // Not started, showing preview
  | 'loading'     // Fetching class + token
  | 'live'        // LiveKit connected, broadcasting
  | 'ending'      // End requested, disconnecting
  | 'ended';      // Class ended, ready to close

export interface LiveClassState {
  /** Current lifecycle status. */
  status: LiveClassStatus;
  /** ID of the live_classes row. */
  classId: string | null;
  /** Title of the live class from DB. */
  title: string;
  /** LiveKit room name. */
  roomName: string | null;
  /** JWT token for LiveKit authentication. */
  token: string | null;
  /** LiveKit WebSocket URL. */
  serverUrl: string | null;
  /** Display name sent to LiveKit. */
  teacherName: string;
  /** Human-readable error message. */
  error: string | null;
}

// ─── Room Name Helpers ─────────────────────────────────────────────────────

/**
 * Generates a deterministic LiveKit room name from a class ID.
 *
 * Pattern:  `class-{classIdPrefix}`
 *
 * Kept deliberately simple for Phase 1.  The SDD's longer pattern
 * (`{institute_slug}-{teacher_id_short}-{class_id_short}`) can be
 * adopted in a later phase.
 */
function buildRoomName(classId: string): string {
  const short = classId.replace(/-/g, '').slice(0, 8);
  return `class-${short}`;
}

// ─── Default State ─────────────────────────────────────────────────────────

function createInitialState(teacherName: string): LiveClassState {
  return {
    status: 'idle',
    classId: null,
    title: 'Live Class',
    roomName: null,
    token: null,
    serverUrl: null,
    teacherName,
    error: null,
  };
}

// ─── Hook ──────────────────────────────────────────────────────────────────

/**
 * Hook for orchestrating a teacher's live class session.
 *
 * @param teacherId  - The teacher's ID (teacher_details.teacher_id).
 * @param teacherName - Display name sent to LiveKit participants.
 */
export function useLiveClass(teacherId: string, teacherName: string) {
  const [state, setState] = useState<LiveClassState>(
    () => createInitialState(teacherName),
  );
  const classIdRef = useRef<string | null>(null);

  // ── Start Class (Mode A: Instant Go Live) ────────────────────────────

  /**
   * Begins the live class flow for an INSTANT (non-scheduled) class.
   * 1. Creates/loads a live_classes row
   * 2. Generates a LiveKit token for the teacher
   * 3. Updates DB status to 'live'
   *
   * On success the caller renders `<LiveKitRoom>` which auto-connects.
   */
  const startClass = useCallback(async (
    selections: {
      batchId: string;
      title: string;
    }
  ): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null, title: selections.title }));

    try {
      // 1. Create or load the active live class with user-provided data
      //    subjectId and chapterId are not passed — the service auto-selects
      //    the first authorized subject (subject selection was removed from
      //    the dialog because there is no admin UI to assign subjects).
      const { classId, title, institute_id } = await teacherService.getOrCreateActiveLiveClass(
        teacherId,
        '',          // subjectId — service will auto-pick
        selections.batchId,
        null,        // chapterId — not used
        selections.title,
      );
      classIdRef.current = classId;

      // 2. Build room name (deterministic from classId)
      const roomName = buildRoomName(classId);

      // 3. Get teacher's profile_id for session_participants
      const profileId = await teacherService.getTeacherProfileId(teacherId);

      // ── [LK-DIAG-WEB] Session diagnostics before getLiveKitToken (Instant Go Live) ──
      try {
        const { data: diagSession } = await supabase.auth.getSession();
        const diagTs = new Date().toISOString();
        console.log(`[${diagTs}] [LK-DIAG-WEB] [useLiveClass.startClass] Pre-token session check:`);
        if (diagSession?.session) {
          console.log(`[${diagTs}] [LK-DIAG-WEB]   session exists        = true`);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   user.id               =`, diagSession.session.user.id);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   email                 =`, diagSession.session.user.email);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   access token length   =`, diagSession.session.access_token?.length ?? 0);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   access token (1st 20) =`, diagSession.session.access_token?.substring(0, 20) ?? 'N/A');
          console.log(`[${diagTs}] [LK-DIAG-WEB]   expires_at            =`, diagSession.session.expires_at ?? 'N/A');
        } else {
          console.log(`[${diagTs}] [LK-DIAG-WEB]   session exists        = false`);
        }
      } catch (diagErr) {
        console.error(`[${new Date().toISOString()}] [LK-DIAG-WEB] [useLiveClass.startClass] Session check error:`, diagErr);
      }

      // 4. Generate LiveKit token
      const { token, url } = await getLiveKitToken({
        roomName,
        participantName: teacherName,
        role: 'teacher',
      });

      // 5. Update DB to 'live' status (status, room_name, live_sessions, session_participants)
      //    institute_id is passed through from live_classes (single source of truth).
      await teacherService.startLiveClass(classId, profileId, roomName, institute_id);

      setState({
        status: 'live',
        classId,
        title,
        roomName,
        token,
        serverUrl: url,
        teacherName,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to start live class.';
      console.error('[LiveClass] Start failed:', message);
      setState((prev) => ({ ...prev, status: 'idle', error: message }));
    }
  }, [teacherId, teacherName]);

  // ── Start Scheduled Class (Mode B: Scheduled → Live) ─────────────────

  /**
   * Starts a PRE-SCHEDULED live class.
   * 1. Validates the teacher owns the class and status is 'scheduled'
   * 2. Generates room_name from existing classId
   * 3. Updates DB: status='live', room_name, creates live_sessions
   * 4. Generates LiveKit token for the existing room
   *
   * Does NOT create a new live_classes record.
   */
  const startScheduledClass = useCallback(async (classId: string): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    try {
      console.log('[GO LIVE] Selected class_id:', classId);

      // 1. Call the scheduling service which validates, builds roomName,
      //    and calls startLiveClass (sets status='live', creates session)
      console.log('[START SCHEDULED] Calling teacherLiveClassService.startScheduledClass()...');
      const result = await teacherLiveClassService.startScheduledClass(classId, teacherId);
      console.log('[START SCHEDULED] ✅ Result:', JSON.stringify(result, null, 2));

      classIdRef.current = result.classId;

      // ── [LK-DIAG-WEB] Session diagnostics before getLiveKitToken (Scheduled Go Live) ──
      try {
        const { data: diagSession } = await supabase.auth.getSession();
        const diagTs = new Date().toISOString();
        console.log(`[${diagTs}] [LK-DIAG-WEB] [useLiveClass.startScheduledClass] Pre-token session check:`);
        if (diagSession?.session) {
          console.log(`[${diagTs}] [LK-DIAG-WEB]   session exists        = true`);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   user.id               =`, diagSession.session.user.id);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   email                 =`, diagSession.session.user.email);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   access token length   =`, diagSession.session.access_token?.length ?? 0);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   access token (1st 20) =`, diagSession.session.access_token?.substring(0, 20) ?? 'N/A');
          console.log(`[${diagTs}] [LK-DIAG-WEB]   expires_at            =`, diagSession.session.expires_at ?? 'N/A');
        } else {
          console.log(`[${diagTs}] [LK-DIAG-WEB]   session exists        = false`);
        }
      } catch (diagErr) {
        console.error(`[${new Date().toISOString()}] [LK-DIAG-WEB] [useLiveClass.startScheduledClass] Session check error:`, diagErr);
      }

      // 2. Generate LiveKit token for the existing room
      console.log('[LIVEKIT] room_name:', result.roomName);
      console.log('[TOKEN] Generating LiveKit token for teacher...');
      const { token, url } = await getLiveKitToken({
        roomName: result.roomName,
        participantName: teacherName,
        role: 'teacher',
      });
      console.log('[TOKEN] ✅ Token generated successfully');

      // 3. Set state to 'live' — LiveKitRoom will auto-connect
      setState({
        status: 'live',
        classId: result.classId,
        title: result.title,
        roomName: result.roomName,
        token,
        serverUrl: url,
        teacherName,
        error: null,
      });

      console.log('[JOIN] ✅ Connected to existing scheduled class:', result.classId);
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to start scheduled class.';
      console.error('[SCHEDULED CLASS] ❌ Start failed:', message);
      setState((prev) => ({ ...prev, status: 'idle', error: message }));
    }
  }, [teacherId, teacherName]);

  // ── End Class (explicit teacher action only) ──────────────────────────

  /**
   * Ends the live class PERMANENTLY.
   *
   * CRITICAL: The DB update (endLiveClass) MUST complete BEFORE the local
   * state changes from 'live'. This order prevents a race condition where
   * LiveKitRoom unmounts (triggering the room_finished webhook) before
   * live_sessions is updated in the database.
   *
   *   ✅ FIXED ORDER:
   *     1. teacherService.endLiveClass(classId)  ← DB updated first
   *     2. setState({ status: 'ended' })         ← then LiveKitRoom unmounts
   *
   *   ❌ OLD ORDER (broken):
   *     1. setState({ status: 'ending' })        ← LiveKitRoom unmounts
   *     2. teacherService.endLiveClass(classId)  ← webhook fires before DB update
   *
   * This is the ONLY function that marks a session as ended in the database.
   * Page refresh, navigation, component unmount, or LiveKit disconnect
   * must NEVER call this function.
   *
   * LiveKitRoom will disconnect when it unmounts (status changes to 'ended').
   */
  const endClass = useCallback(async (): Promise<void> => {
    const classId = classIdRef.current;
    if (!classId) return;

    // ── Step 1: Update database FIRST (live_sessions gets ended_at BEFORE LiveKit disconnects) ─
    try {
      await teacherService.endLiveClass(classId);
    } catch (err) {
      console.error('[LiveClass] End class DB update failed:', err);
      // Continue to set status to 'ended' even if DB fails — the UI must close.
      // The error has already been logged with full details by endLiveClass.
    }

    // ── Step 2: Now it is safe to change status. LiveKitRoom will unmount,
    //    LiveKit will send room_finished, and the webhook will find
    //    live_sessions already updated with status='ended' and ended_at set. ─
    setState((prev) => ({ ...prev, status: 'ended' }));
  }, []);

  // ── Disconnect Only (no DB change) ─────────────────────────────────────

  /**
   * Disconnects from LiveKit WITHOUT ending the session.
   *
   * This is safe to call on:
   * - Component unmount
   * - Modal close (X button)
   * - Page refresh (via cleanup)
   * - LiveKit temporary disconnect
   *
   * The session remains LIVE in the database so the teacher can rejoin later.
   */
  const disconnectOnly = useCallback((): void => {
    classIdRef.current = null;
    setState(createInitialState(teacherName));
  }, [teacherName]);

  // ── Rejoin Existing Live Session ───────────────────────────────────────

  /**
   * Reconnects the teacher to an existing LIVE session.
   *
   * Called when:
   * - Teacher returns to the Live Classes page after a refresh/navigation
   * - Teacher clicks "Rejoin Live Class" on a class with status 'live'
   *
   * Generates a new LiveKit token for the existing room without modifying
   * the database status (which is already 'live').
   */
  const rejoinClass = useCallback(async (classId: string): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    try {
      // 1. Load class details (for title display)
      const classDetail = await teacherLiveClassService.getTeacherClassById(classId);
      const title = classDetail?.title || 'Live Class';

      // 2. Build room name from existing classId (deterministic)
      const roomName = buildRoomName(classId);

      // ── [LK-DIAG-WEB] Session diagnostics before getLiveKitToken (Rejoin) ──
      try {
        const { data: diagSession } = await supabase.auth.getSession();
        const diagTs = new Date().toISOString();
        console.log(`[${diagTs}] [LK-DIAG-WEB] [useLiveClass.rejoinClass] Pre-token session check:`);
        if (diagSession?.session) {
          console.log(`[${diagTs}] [LK-DIAG-WEB]   session exists        = true`);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   user.id               =`, diagSession.session.user.id);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   email                 =`, diagSession.session.user.email);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   access token length   =`, diagSession.session.access_token?.length ?? 0);
          console.log(`[${diagTs}] [LK-DIAG-WEB]   access token (1st 20) =`, diagSession.session.access_token?.substring(0, 20) ?? 'N/A');
          console.log(`[${diagTs}] [LK-DIAG-WEB]   expires_at            =`, diagSession.session.expires_at ?? 'N/A');
        } else {
          console.log(`[${diagTs}] [LK-DIAG-WEB]   session exists        = false`);
        }
      } catch (diagErr) {
        console.error(`[${new Date().toISOString()}] [LK-DIAG-WEB] [useLiveClass.rejoinClass] Session check error:`, diagErr);
      }

      // 3. Generate a new LiveKit token for the existing room
      const { token, url } = await getLiveKitToken({
        roomName,
        participantName: teacherName,
        role: 'teacher',
      });

      classIdRef.current = classId;

      // 4. Set state to 'live' — LiveKitRoom will auto-connect
      setState({
        status: 'live',
        classId,
        title,
        roomName,
        token,
        serverUrl: url,
        teacherName,
        error: null,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to rejoin live class.';
      console.error('[LiveClass] Rejoin failed:', message);
      setState((prev) => ({ ...prev, status: 'idle', error: message }));
    }
  }, [teacherName]);

  // ── Reset ──────────────────────────────────────────────────────────────

  /** Resets the hook to its initial idle state. */
  const reset = useCallback((): void => {
    classIdRef.current = null;
    setState(createInitialState(teacherName));
  }, [teacherName]);

  return { state, startClass, startScheduledClass, endClass, disconnectOnly, rejoinClass, reset } as const;
}
