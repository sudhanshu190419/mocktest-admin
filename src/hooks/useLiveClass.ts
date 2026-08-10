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

import { useState, useCallback, useRef, useEffect } from 'react';
import { supabase } from '@/config/supabase';
import { teacherService } from '@/services/teacherService';
import { teacherLiveClassService, buildRoomName } from '@/services/teacherLiveClassService';
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
  /** Batch IDs this class is linked to (for notification audience targeting). */
  batchIds: string[];
  /** Institute ID (for notification dispatch). */
  instituteId: string;
  /** True while the end RPC is in flight — prevents a double End click. */
  isEnding: boolean;
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
    batchIds: [],
    instituteId: '',
    isEnding: false,
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
  /**
   * True while the teacher is actively in a LIVE session and we should keep
   * sending heartbeats. Set false on: manual End, ALREADY_ENDED response,
   * session reset, leaving LiveStudio, or any non-live state. Prevents the
   * 60s interval from firing after the class is no longer live.
   */
  const heartbeatActiveRef = useRef(false);

  // ── Teacher Heartbeat (Phase 2 — abandoned-class recovery) ───────────

  /**
   * Sends a single heartbeat to heartbeat_live_class(), which updates
   * live_sessions.last_teacher_activity_at. Runs every 60s while live and on
   * visibility/refocus (protects against browser timer throttling).
   *
   * Failures are log-only: a temporary network error must NEVER end the
   * class. The server watchdog (15-minute staleness) remains authoritative.
   */
  const sendHeartbeat = useCallback(async (): Promise<void> => {
    const classId = classIdRef.current;
    if (!classId || !heartbeatActiveRef.current) return;

    try {
      const result = await teacherService.heartbeatLiveClass(classId);
      if (result?.code === 'ALREADY_ENDED') {
        // The class is no longer live in the DB (watchdog or another tab
        // ended it). Stop heartbeating — the server is authoritative.
        heartbeatActiveRef.current = false;
      }
    } catch (err) {
      console.warn('[LiveClass] Heartbeat failed (non-fatal):', err);
    }
  }, []);

  // Heartbeat lifecycle effect: runs a 60s interval + immediate beat only
  // while the teacher is live; stops on unmount / non-live state.
  useEffect(() => {
    if (state.status !== 'live') {
      heartbeatActiveRef.current = false;
      return;
    }

    heartbeatActiveRef.current = true;
    void sendHeartbeat(); // immediate beat on entering live

    const intervalId = window.setInterval(() => {
      void sendHeartbeat();
    }, 60_000);

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void sendHeartbeat();
      }
    };
    const onFocus = () => {
      void sendHeartbeat();
    };

    document.addEventListener('visibilitychange', onVisibilityChange);
    window.addEventListener('focus', onFocus);

    return () => {
      heartbeatActiveRef.current = false;
      window.clearInterval(intervalId);
      document.removeEventListener('visibilitychange', onVisibilityChange);
      window.removeEventListener('focus', onFocus);
    };
  }, [state.status, sendHeartbeat]);

  // ── Start Class (Mode A: Instant Go Live) ────────────────────────────

  /**
   * Begins the live class flow for an INSTANT (non-scheduled) class.
   * 1. Creates/loads a live_classes row (status='scheduled')
   * 2. Runs the authoritative start RPC (start_scheduled_live_class) →
   *    status='live' + room persisted + single live_sessions row
   * 3. Generates a LiveKit token (teacher tokens now require status='live')
   *
   * Phase 1: the token is NEVER requested before the start transition.
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
      const { classId, title } = await teacherService.getOrCreateActiveLiveClass(
        teacherId,
        '',          // subjectId — service will auto-pick
        selections.batchId,
        null,        // chapterId — not used
        selections.title,
      );
      classIdRef.current = classId;

      // 2. Authoritative atomic start (Phase 1). The RPC transitions
      //    scheduled → live and persists room_name BEFORE any token is
      //    requested. ALREADY_LIVE is treated like a rejoin and continues.
      const startResult = await teacherLiveClassService.startScheduledClass(classId);
      const roomName = startResult.roomName;

      // 3. Generate LiveKit token (only after the class is live)
      const { token, url } = await getLiveKitToken({
        classId,
        participantName: teacherName,
      });

      setState({
        status: 'live',
        classId,
        title,
        roomName,
        token,
        serverUrl: url,
        teacherName,
        error: null,
        batchIds: [selections.batchId],
        instituteId: startResult.instituteId,
        isEnding: false,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to start live class.';
      console.error('[LiveClass] Start failed:', message);
      setState((prev) => ({ ...prev, status: 'idle', error: message, isEnding: false }));
    }
  }, [teacherId, teacherName]);

  // ── Start Scheduled Class (Mode B: Scheduled → Live) ─────────────────

  /**
   * Starts a PRE-SCHEDULED live class through the authoritative start RPC
   * (start_scheduled_live_class).
   *
   *   STARTED        → continue to the LiveKit token flow
   *   ALREADY_LIVE   → treated as a rejoin; continue to the token flow
   *   TOO_EARLY / WINDOW_EXPIRED / NOT_AUTHORIZED / CLASS_COMPLETED /
   *   CLASS_CANCELLED → clean error message; the class is never started.
   *
   * Does NOT create a new live_classes record.
   */
  const startScheduledClass = useCallback(async (classId: string): Promise<void> => {
    setState((prev) => ({ ...prev, status: 'loading', error: null }));

    try {
      // 1. Authoritative start (Phase 1) — enforces window, ownership,
      //    status and assignment server-side, atomically. No auto-retry:
      //    the backend is idempotent, so a manual retry is always safe.
      const result = await teacherLiveClassService.startScheduledClass(classId);
      classIdRef.current = result.classId;

      // 2. Generate LiveKit token (only after the start RPC succeeded)
      const { token, url } = await getLiveKitToken({
        classId: result.classId,
        participantName: teacherName,
      });

      // 3. Resolve batch IDs for this class (for notification audience targeting)
      let batchIds: string[] = [];
      try {
        const { data: classBS } = await supabase
          .from('batch_subject_live_classes')
          .select('batch_subject_id, batch_subjects!inner (batch_id)')
          .eq('class_id', result.classId);
        if (classBS && classBS.length > 0) {
          batchIds = [...new Set((classBS as any[]).map((item: any) => item.batch_subjects?.batch_id))].filter(Boolean);
        }
      } catch {
        // Non-critical — batch IDs are only used for the notification audience.
      }

      // 4. Set state to 'live' — LiveKitRoom will auto-connect
      setState({
        status: 'live',
        classId: result.classId,
        title: result.title,
        roomName: result.roomName,
        token,
        serverUrl: url,
        teacherName,
        error: null,
        batchIds,
        instituteId: result.instituteId,
        isEnding: false,
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Failed to start scheduled class.';
      console.error('[SCHEDULED CLASS] Start failed:', message);
      setState((prev) => ({ ...prev, status: 'idle', error: message, isEnding: false }));
    }
  }, [teacherName]);

  // ── End Class (explicit teacher action only) ──────────────────────────

  /**
   * Ends the live class via the idempotent end RPC.
   *
   * CRITICAL ORDER PRESERVED (Phase 1): the DB transition must complete
   * BEFORE the local state leaves 'live'. status stays 'live' while
   * isEnding=true (LiveKitRoom stays mounted), so the room_finished webhook
   * can never race the DB update.
   *
   *   1. teacherService.endLiveClass(classId)  ← idempotent RPC
   *      (ALREADY_ENDED is a no-op success for double-click / two tabs /
   *       retries / webhook racing the teacher's End)
   *   2. setState({ status: 'ended' })         ← then LiveKitRoom unmounts
   *
   * Attendance finalization runs inside endLiveClass ONLY when the RPC
   * reports a real live → completed transition (never on ALREADY_ENDED).
   */
  const endClass = useCallback(async (): Promise<void> => {
    const classId = classIdRef.current;
    if (!classId) return;

    // Disable the End button while the RPC is in flight (prevents double End).
    setState((prev) => ({ ...prev, isEnding: true }));

    try {
      await teacherService.endLiveClass(classId);
    } catch (err) {
      console.error('[LiveClass] End class DB update failed:', err);
      // The UI must still close; the error is logged with details by endLiveClass.
    }

    setState((prev) => ({ ...prev, status: 'ended', isEnding: false }));
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
        classId,
        participantName: teacherName,
      });

      classIdRef.current = classId;

      // ── Resolve batch IDs for this class (for notification audience targeting) ─
      let batchIds: string[] = [];
      let instituteId = '';
      try {
        // Resolve batch IDs via batch_subject_live_classes
        const { data: classBSLinks } = await supabase
          .from('batch_subject_live_classes')
          .select(`
            batch_subject_id,
            batch_subjects!inner(batch_id)
          `)
          .eq('class_id', classId);
        if (classBSLinks && classBSLinks.length > 0) {
          batchIds = [...new Set((classBSLinks as any[]).map((item: any) => item.batch_subjects?.batch_id))].filter(Boolean);
        }
        // Also fetch institute_id from the live_classes record
        const { data: cls } = await supabase
          .from('live_classes')
          .select('institute_id')
          .eq('class_id', classId)
          .single();
        if (cls) {
          instituteId = cls.institute_id;
        }
      } catch {
        // Non-critical — batch IDs are only used for notification audience.
        // If resolution fails, no batch-scoped notification will be sent.
      }

      // 4. Set state to 'live' — LiveKitRoom will auto-connect
      setState({
        status: 'live',
        classId,
        title,
        roomName: classDetail?.roomName ?? buildRoomName(classId),
        token,
        serverUrl: url,
        teacherName,
        error: null,
        batchIds,
        instituteId,
        isEnding: false,
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
