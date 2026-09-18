'use client';

/**
 * Student Live Classroom Route (/student/classes/[classId])
 *
 * Dedicated Next.js Page for the Interactive Student LiveKit Classroom.
 *
 * Connection Lifecycle:
 *   1. Authorize: Validates student enrollment and class assignment.
 *   2. Token: Obtains ephemeral signed LiveKit JWT from livekit-token Edge Function.
 *   3. Connect: Mounts LiveKit room with WebRTC video, audio, chat & raise-hand.
 *
 * @module app/student/classes/[classId]/page
 */

import React, { useEffect, useState, useCallback, use } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/context/AuthContext';
import {
  fetchStudentAuthorizedLiveClass,
  requestStudentLiveKitToken,
  checkLiveClassStatus,
  type AuthorizedLiveClassRoomData,
} from '@/services/student/studentLiveClassRoomWebService';
import { StudentLiveClassroom } from '@/components/student/live-classroom/StudentLiveClassroom';
import { ClassConnectionState } from '@/components/student/live-classroom/ClassConnectionState';
import { ClassEndedState } from '@/components/student/live-classroom/ClassEndedState';
import { TeacherNotStartedState } from '@/components/student/live-classroom/TeacherNotStartedState';

type PageLifecycle =
  | 'authorizing'
  | 'requesting_token'
  | 'waiting_for_teacher'
  | 'connecting'
  | 'ready'
  | 'ended'
  | 'cancelled'
  | 'error';

interface PageProps {
  params: Promise<{ classId: string }>;
}

export default function StudentLiveClassroomPage({ params }: PageProps) {
  const resolvedParams = use(params);
  const classId = resolvedParams.classId;

  const router = useRouter();
  const { user } = useAuth();

  const [lifecycle, setLifecycle] = useState<PageLifecycle>('authorizing');
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [classData, setClassData] = useState<AuthorizedLiveClassRoomData | null>(null);
  const [livekitToken, setLivekitToken] = useState<string | null>(null);
  const [livekitUrl, setLivekitUrl] = useState<string | null>(null);
  const [isCheckingStatus, setIsCheckingStatus] = useState<boolean>(false);

  // Initialize and authorize classroom access
  const initializeClassroom = useCallback(async () => {
    if (!classId) return;

    setLifecycle('authorizing');
    setErrorMessage(null);

    try {
      // Step 1: Authorize student entitlement
      const authRes = await fetchStudentAuthorizedLiveClass(classId, user?.id);

      if (authRes.error || !authRes.data) {
        setLifecycle('error');
        setErrorMessage(authRes.error || 'You do not have permission to join this live class.');
        return;
      }

      const data = authRes.data;
      setClassData(data);

      // Check lifecycle status
      if (data.status === 'cancelled') {
        setLifecycle('cancelled');
        return;
      }

      if (data.status === 'completed') {
        setLifecycle('ended');
        return;
      }

      if (data.status === 'scheduled' && data.sessionStatus !== 'live') {
        setLifecycle('waiting_for_teacher');
        return;
      }

      // Step 2: Request LiveKit token from server
      setLifecycle('requesting_token');
      const tokenRes = await requestStudentLiveKitToken(classId);

      if (tokenRes.error || !tokenRes.data) {
        setLifecycle('error');
        setErrorMessage(tokenRes.error || 'Failed to acquire classroom access credentials.');
        return;
      }

      setLivekitToken(tokenRes.data.token);
      setLivekitUrl(tokenRes.data.url);
      setLifecycle('ready');
    } catch (err: any) {
      console.error('[StudentLiveClassroomPage] initialization exception:', err);
      setLifecycle('error');
      setErrorMessage(err?.message || 'An unexpected error occurred while preparing classroom.');
    }
  }, [classId, user?.id]);

  // Initial load
  useEffect(() => {
    initializeClassroom();
  }, [initializeClassroom]);

  // Background poll when in waiting_for_teacher state
  useEffect(() => {
    if (lifecycle !== 'waiting_for_teacher' || !classId) return;

    const interval = setInterval(async () => {
      setIsCheckingStatus(true);
      const { status, sessionStatus } = await checkLiveClassStatus(classId);
      setIsCheckingStatus(false);

      if (status === 'live' || sessionStatus === 'live') {
        // Teacher has started! Re-run initialization to get token
        initializeClassroom();
      } else if (status === 'completed') {
        setLifecycle('ended');
      } else if (status === 'cancelled') {
        setLifecycle('cancelled');
      }
    }, 10000);

    return () => clearInterval(interval);
  }, [lifecycle, classId, initializeClassroom]);

  // Render respective state
  if (lifecycle === 'authorizing') {
    return <ClassConnectionState type="authorizing" />;
  }

  if (lifecycle === 'requesting_token' || lifecycle === 'connecting') {
    return <ClassConnectionState type="connecting" />;
  }

  if (lifecycle === 'error') {
    return (
      <ClassConnectionState
        type="error"
        errorMessage={errorMessage || undefined}
        onRetry={initializeClassroom}
      />
    );
  }

  if (lifecycle === 'cancelled') {
    return (
      <ClassConnectionState
        type="error"
        errorMessage="This live class session has been cancelled by the institute."
      />
    );
  }

  if (lifecycle === 'ended') {
    return (
      <ClassEndedState
        title={classData?.title || 'Live Class Session'}
        subjectName={classData?.subjectName || 'Subject'}
        teacherName={classData?.teacherName}
        hasRecording={classData?.isRecorded}
      />
    );
  }

  if (lifecycle === 'waiting_for_teacher' && classData) {
    return (
      <TeacherNotStartedState
        title={classData.title}
        subjectName={classData.subjectName}
        teacherName={classData.teacherName}
        scheduledAt={classData.scheduledAt}
        durationMin={classData.durationMin}
        onRefresh={() => initializeClassroom()}
        isChecking={isCheckingStatus}
      />
    );
  }

  if (lifecycle === 'ready' && classData && livekitToken && livekitUrl) {
    return (
      <StudentLiveClassroom
        classData={classData}
        token={livekitToken}
        serverUrl={livekitUrl}
      />
    );
  }

  return <ClassConnectionState type="connecting" />;
}
