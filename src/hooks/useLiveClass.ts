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

  // ── End Class ──────────────────────────────────────────────────────────

  /**
   * Ends the live class:
   * 1. Updates DB status to 'completed'
   * 2. Sets status to 'ended'
   *
   * LiveKitRoom will disconnect when it unmounts (status changes to 'ended').
   */
  const endClass = useCallback(async (): Promise<void> => {
    const classId = classIdRef.current;
    if (!classId) return;

    setState((prev) => ({ ...prev, status: 'ending' }));

    try {
      await teacherService.endLiveClass(classId);
    } catch (err) {
      console.error('[LiveClass] End class DB update failed:', err);
    }

    setState((prev) => ({ ...prev, status: 'ended' }));
  }, []);

  // ── Reset ──────────────────────────────────────────────────────────────

  /** Resets the hook to its initial idle state. */
  const reset = useCallback((): void => {
    classIdRef.current = null;
    setState(createInitialState(teacherName));
  }, [teacherName]);

  return { state, startClass, startScheduledClass, endClass, reset } as const;
}
