'use client';

/**
 * Student Recording HTML5 Video Player
 *
 * High-performance, native HTML5 video player tailored for student live-class recordings.
 *
 * Key Capabilities:
 *   - Native HTML5 <video> with fully custom, responsive dark-mode controls.
 *   - URL Refresh Architecture:
 *       • Proactive refresh scheduled 45s before presigned Cloudflare R2 expiry (~5 min TTL).
 *       • Reactive refresh / retry on 403 / Forbidden / token-expired playback errors.
 *       • Sub-second playback position preservation across URL swaps.
 *   - Viewing History & Resume Playback:
 *       • Automatically resumes from student_viewing_history with visual toast indicator.
 *       • Throttled progress persistence (~10s intervals during active playback).
 *       • Flushes progress on pause, seek, ended, pagehide, and visibilitychange.
 *       • Auto-marks completed at >=90% playback or on video end.
 *   - Rich Controls:
 *       • Play/Pause, ±10s jump, interactive progress scrubber with hover timestamp preview.
 *       • Volume control with mute toggle.
 *       • Multi-speed playback (0.5x, 0.75x, 1.0x, 1.25x, 1.5x, 1.75x, 2.0x).
 *       • Fullscreen toggle with cross-browser fullscreen API support.
 *       • Comprehensive keyboard navigation (Space, K, J, L, Arrows, M, F).
 *       • Autohiding controls overlay on mouse inactivity.
 *
 * @module components/student/recordings/player/StudentRecordingPlayer
 */

import React, {
  useEffect,
  useRef,
  useState,
  useCallback,
} from 'react';
import {
  Play,
  Pause,
  ArrowCounterClockwise,
  ArrowClockwise,
  SpeakerHigh,
  SpeakerLow,
  SpeakerSlash,
  ArrowsOut,
  ArrowsIn,
  WarningCircle,
  ArrowsClockwise,
  CheckCircle,
  Spinner,
} from '@phosphor-icons/react';
import {
  saveStudentRecordingProgress,
  markStudentRecordingCompleted,
} from '@/services/student/studentRecordingProgressWebService';
import {
  StudentPlaybackRefreshController,
  calculateRefreshDelayMs,
  isPlaybackExpiryError,
  isUrlExpiredOrExpiringSoon,
} from '@/services/student/studentRecordingPlaybackManager';

// ═══════════════════════════════════════════════════════════════════════════
//  Types & Props
// ═══════════════════════════════════════════════════════════════════════════

export interface StudentRecordingPlayerProps {
  recordingId: string;
  title: string;
  initialPlaybackUrl?: string | null;
  initialExpiresAt?: string | null;
  initialDurationSeconds?: number;
  initialPositionSeconds?: number;
  isCompleted?: boolean;
  studentId?: string;
  thumbnailUrl?: string | null;
  onProgressUpdate?: (position: number, isCompleted: boolean) => void;
}

const PLAYBACK_SPEEDS = [0.5, 0.75, 1.0, 1.25, 1.5, 1.75, 2.0] as const;

// ═══════════════════════════════════════════════════════════════════════════
//  Helpers
// ═══════════════════════════════════════════════════════════════════════════

function formatPlayerTime(seconds: number): string {
  if (!isFinite(seconds) || seconds < 0) return '00:00';
  const totalSecs = Math.floor(seconds);
  const hrs = Math.floor(totalSecs / 3600);
  const mins = Math.floor((totalSecs % 3600) / 60);
  const secs = totalSecs % 60;
  if (hrs > 0) {
    return `${hrs}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
  }
  return `${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Main Component
// ═══════════════════════════════════════════════════════════════════════════

export const StudentRecordingPlayer: React.FC<StudentRecordingPlayerProps> = ({
  recordingId,
  title,
  initialPlaybackUrl = null,
  initialExpiresAt = null,
  initialDurationSeconds = 0,
  initialPositionSeconds = 0,
  isCompleted: initialCompleted = false,
  studentId,
  thumbnailUrl,
  onProgressUpdate,
}) => {
  // ── Player Refs ────────────────────────────────────────────────────────
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const containerRef = useRef<HTMLDivElement | null>(null);
  const controlsTimeoutRef = useRef<NodeJS.Timeout | null>(null);
  const proactiveTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressSaveIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const refreshControllerRef = useRef<StudentPlaybackRefreshController>(
    new StudentPlaybackRefreshController()
  );

  // ── Playback State Refs (for lifecycle handlers & position preservation) ──
  const savedPositionBeforeRefreshRef = useRef<number>(0);
  const wasPlayingBeforeRefreshRef = useRef<boolean>(false);
  const reactiveRetryCountRef = useRef<number>(0);
  const latestPositionRef = useRef<number>(initialPositionSeconds);
  const latestDurationRef = useRef<number>(initialDurationSeconds);
  const isCompletedRef = useRef<boolean>(initialCompleted);
  const studentIdRef = useRef<string | undefined>(studentId);
  studentIdRef.current = studentId;

  // ── Reactive State ─────────────────────────────────────────────────────
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(initialPlaybackUrl);
  const [expiresAt, setExpiresAt] = useState<string | null>(initialExpiresAt);
  const [fetchedAt, setFetchedAt] = useState<number>(Date.now());

  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [currentTime, setCurrentTime] = useState<number>(initialPositionSeconds);
  const [duration, setDuration] = useState<number>(initialDurationSeconds);
  const [bufferedPercent, setBufferedPercent] = useState<number>(0);

  const [volume, setVolume] = useState<number>(1);
  const [isMuted, setIsMuted] = useState<boolean>(false);
  const [playbackSpeed, setPlaybackSpeed] = useState<number>(1.0);
  const [showSpeedMenu, setShowSpeedMenu] = useState<boolean>(false);

  const [isFullscreen, setIsFullscreen] = useState<boolean>(false);
  const [showControls, setShowControls] = useState<boolean>(true);
  const [isBuffering, setIsBuffering] = useState<boolean>(false);
  const [playerError, setPlayerError] = useState<string | null>(null);
  const [isRefreshingUrl, setIsRefreshingUrl] = useState<boolean>(false);

  const [resumeNotification, setResumeNotification] = useState<string | null>(null);
  const [hoverTime, setHoverTime] = useState<{ time: number; xPercent: number } | null>(null);
  const hasAppliedInitialResumeRef = useRef<boolean>(false);

  // ── Progress Persistence Handler ───────────────────────────────────────
  const flushProgress = useCallback(
    async (opts?: { isCompleted?: boolean; keepalive?: boolean }) => {
      const pos = latestPositionRef.current;
      const dur = latestDurationRef.current;
      const completed = opts?.isCompleted ?? isCompletedRef.current;

      if (pos <= 0 && !completed) return;

      try {
        await saveStudentRecordingProgress(recordingId, pos, dur, completed, {
          studentId: studentIdRef.current,
          keepalive: opts?.keepalive ?? false,
        });
        onProgressUpdate?.(pos, completed);
      } catch (err) {
        console.warn('[StudentRecordingPlayer] Progress save error:', err);
      }
    },
    [recordingId, onProgressUpdate]
  );

  // ── URL Refresh Routine ────────────────────────────────────────────────
  const executeUrlRefresh = useCallback(
    async (isReactive = false): Promise<boolean> => {
      if (!recordingId) return false;

      // 1. Capture current position & play state before URL swap
      const video = videoRef.current;
      const currentPos = video ? video.currentTime : latestPositionRef.current;
      const currentPlaying = video ? !video.paused && !video.ended : isPlaying;

      savedPositionBeforeRefreshRef.current = Math.max(0, currentPos);
      wasPlayingBeforeRefreshRef.current = currentPlaying;
      setIsRefreshingUrl(true);

      try {
        const result = await refreshControllerRef.current.refresh(recordingId);

        if (!refreshControllerRef.current.isLatest(result.generation)) {
          return false; // Stale generation discarded
        }

        if (result.error || !result.data?.playbackUrl) {
          console.error('[StudentRecordingPlayer] Refresh failed:', result.error);
          if (isReactive) {
            setPlayerError('Playback link expired and could not be renewed. Please refresh the page.');
          }
          return false;
        }

        // Apply refreshed URL
        setPlaybackUrl(result.data.playbackUrl);
        setExpiresAt(result.data.expiresAt ?? null);
        setFetchedAt(Date.now());
        setPlayerError(null);
        return true;
      } catch (err) {
        console.error('[StudentRecordingPlayer] Unexpected error during refresh:', err);
        return false;
      } finally {
        setIsRefreshingUrl(false);
      }
    },
    [recordingId, isPlaying]
  );

  // ── Proactive Refresh Timer Setup ──────────────────────────────────────
  useEffect(() => {
    if (!playbackUrl) return;

    if (proactiveTimerRef.current) {
      clearTimeout(proactiveTimerRef.current);
      proactiveTimerRef.current = null;
    }

    const delayMs = calculateRefreshDelayMs(expiresAt, fetchedAt);

    proactiveTimerRef.current = setTimeout(() => {
      executeUrlRefresh(false);
    }, delayMs);

    return () => {
      if (proactiveTimerRef.current) {
        clearTimeout(proactiveTimerRef.current);
        proactiveTimerRef.current = null;
      }
    };
  }, [playbackUrl, expiresAt, fetchedAt, executeUrlRefresh]);

  // ── Throttled Progress Persistence Interval (~10s) ─────────────────────
  useEffect(() => {
    if (!isPlaying) {
      if (progressSaveIntervalRef.current) {
        clearInterval(progressSaveIntervalRef.current);
        progressSaveIntervalRef.current = null;
      }
      return;
    }

    progressSaveIntervalRef.current = setInterval(() => {
      flushProgress();
    }, 10000);

    return () => {
      if (progressSaveIntervalRef.current) {
        clearInterval(progressSaveIntervalRef.current);
        progressSaveIntervalRef.current = null;
      }
    };
  }, [isPlaying, flushProgress]);

  // ── Browser Lifecycle & Visibility Handlers ────────────────────────────
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'hidden') {
        flushProgress();
      } else if (document.visibilityState === 'visible') {
        // Check if URL expired or expiring soon while tab was inactive
        if (isUrlExpiredOrExpiringSoon(expiresAt, fetchedAt, 60)) {
          executeUrlRefresh(false);
        }
      }
    };

    const handleBeforeUnload = () => {
      flushProgress({ keepalive: true });
    };

    const handlePageHide = () => {
      flushProgress({ keepalive: true });
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    window.addEventListener('beforeunload', handleBeforeUnload);
    window.addEventListener('pagehide', handlePageHide);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      window.removeEventListener('beforeunload', handleBeforeUnload);
      window.removeEventListener('pagehide', handlePageHide);
      // Final unmount flush
      flushProgress({ keepalive: true });
    };
  }, [expiresAt, fetchedAt, executeUrlRefresh, flushProgress]);

  // ── Fullscreen Change Listener ─────────────────────────────────────────
  useEffect(() => {
    const handleFullscreenChange = () => {
      setIsFullscreen(Boolean(document.fullscreenElement));
    };

    document.addEventListener('fullscreenchange', handleFullscreenChange);
    document.addEventListener('webkitfullscreenchange', handleFullscreenChange);

    return () => {
      document.removeEventListener('fullscreenchange', handleFullscreenChange);
      document.removeEventListener('webkitfullscreenchange', handleFullscreenChange);
    };
  }, []);

  // ── Autohide Controls on Inactivity ───────────────────────────────────
  const resetControlsTimeout = useCallback(() => {
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    if (isPlaying) {
      controlsTimeoutRef.current = setTimeout(() => {
        setShowControls(false);
        setShowSpeedMenu(false);
      }, 3000);
    }
  }, [isPlaying]);

  const handleMouseMove = () => {
    resetControlsTimeout();
  };

  const handleMouseLeave = () => {
    if (isPlaying) {
      setShowControls(false);
      setShowSpeedMenu(false);
    }
  };

  // ── Media Event Handlers ───────────────────────────────────────────────
  const handleLoadedMetadata = () => {
    const video = videoRef.current;
    if (!video) return;

    const vidDuration = isFinite(video.duration) && video.duration > 0 ? video.duration : initialDurationSeconds;
    setDuration(vidDuration);
    latestDurationRef.current = vidDuration;
    setIsBuffering(false);

    // 1. Position restoration from URL Refresh
    if (savedPositionBeforeRefreshRef.current > 0) {
      const targetPos = savedPositionBeforeRefreshRef.current;
      video.currentTime = targetPos;
      latestPositionRef.current = targetPos;
      setCurrentTime(targetPos);
      savedPositionBeforeRefreshRef.current = 0;

      if (wasPlayingBeforeRefreshRef.current) {
        video.play().catch(() => {});
      }
      return;
    }

    // 2. Initial Resume Seek from student_viewing_history
    if (!hasAppliedInitialResumeRef.current && initialPositionSeconds > 0) {
      hasAppliedInitialResumeRef.current = true;
      const targetPos = Math.min(initialPositionSeconds, Math.max(0, vidDuration - 5));
      video.currentTime = targetPos;
      setCurrentTime(targetPos);
      latestPositionRef.current = targetPos;

      setResumeNotification(`Resumed from ${formatPlayerTime(targetPos)}`);
      setTimeout(() => {
        setResumeNotification(null);
      }, 4000);
    }
  };

  const handleTimeUpdate = () => {
    const video = videoRef.current;
    if (!video) return;

    const cur = video.currentTime;
    setCurrentTime(cur);
    latestPositionRef.current = cur;

    // Buffer range calculation
    if (video.buffered.length > 0 && duration > 0) {
      const bufferedEnd = video.buffered.end(video.buffered.length - 1);
      setBufferedPercent(Math.min(100, Math.round((bufferedEnd / duration) * 100)));
    }

    // Automatic completion check (>=90%)
    if (duration > 0 && cur / duration >= 0.9 && !isCompletedRef.current) {
      isCompletedRef.current = true;
      markStudentRecordingCompleted(recordingId, duration, {
        studentId: studentIdRef.current,
      }).catch((e) => console.warn('Auto-completion mark error:', e));
      onProgressUpdate?.(cur, true);
    }
  };

  const handlePlay = () => {
    setIsPlaying(true);
    setPlayerError(null);
    resetControlsTimeout();
  };

  const handlePause = () => {
    setIsPlaying(false);
    setShowControls(true);
    if (controlsTimeoutRef.current) {
      clearTimeout(controlsTimeoutRef.current);
    }
    flushProgress();
  };

  const handleSeeked = () => {
    const video = videoRef.current;
    if (video) {
      setCurrentTime(video.currentTime);
      latestPositionRef.current = video.currentTime;
      flushProgress();
    }
  };

  const handleEnded = () => {
    setIsPlaying(false);
    setShowControls(true);
    isCompletedRef.current = true;
    flushProgress({ isCompleted: true });
  };

  const handleWaiting = () => {
    setIsBuffering(true);
  };

  const handlePlaying = () => {
    setIsBuffering(false);
  };

  const handleVideoError = async (e: React.SyntheticEvent<HTMLVideoElement, Event>) => {
    const video = videoRef.current;
    const err = video?.error || e;
    console.error('[StudentRecordingPlayer] HTML5 Video Error Event:', err);

    setIsBuffering(false);

    // Reactive recovery check for 403 / expired presigned URL
    if (isPlaybackExpiryError(err, expiresAt, fetchedAt) && reactiveRetryCountRef.current < 1) {
      reactiveRetryCountRef.current += 1;
      console.log('[StudentRecordingPlayer] Intercepted playback expiry error. Triggering reactive refresh...');
      const success = await executeUrlRefresh(true);
      if (success) return;
    }

    setPlayerError('Video playback failed. Please check your network connection or try refreshing.');
  };

  // ── User Control Actions ───────────────────────────────────────────────
  const togglePlay = () => {
    const video = videoRef.current;
    if (!video) return;

    if (video.paused || video.ended) {
      video.play().catch((err) => {
        console.warn('Play interrupted:', err);
      });
    } else {
      video.pause();
    }
  };

  const seekRelative = (deltaSeconds: number) => {
    const video = videoRef.current;
    if (!video) return;
    const target = Math.max(0, Math.min(duration, video.currentTime + deltaSeconds));
    video.currentTime = target;
    setCurrentTime(target);
    latestPositionRef.current = target;
    resetControlsTimeout();
  };

  const handleScrubberClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const video = videoRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    if (!video || !rect.width || duration <= 0) return;

    const clickX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = clickX / rect.width;
    const target = percent * duration;

    video.currentTime = target;
    setCurrentTime(target);
    latestPositionRef.current = target;
    resetControlsTimeout();
  };

  const handleScrubberMouseMove = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    if (!rect.width || duration <= 0) return;

    const moveX = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    const percent = moveX / rect.width;
    setHoverTime({
      time: percent * duration,
      xPercent: percent * 100,
    });
  };

  const handleScrubberMouseLeave = () => {
    setHoverTime(null);
  };

  const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = parseFloat(e.target.value);
    setVolume(val);
    if (videoRef.current) {
      videoRef.current.volume = val;
      videoRef.current.muted = val === 0;
      setIsMuted(val === 0);
    }
  };

  const toggleMute = () => {
    if (!videoRef.current) return;
    const newMute = !isMuted;
    setIsMuted(newMute);
    videoRef.current.muted = newMute;
    if (!newMute && volume === 0) {
      setVolume(0.5);
      videoRef.current.volume = 0.5;
    }
  };

  const handleSpeedSelect = (speed: number) => {
    setPlaybackSpeed(speed);
    if (videoRef.current) {
      videoRef.current.playbackRate = speed;
    }
    setShowSpeedMenu(false);
    resetControlsTimeout();
  };

  const toggleFullscreen = () => {
    const container = containerRef.current;
    if (!container) return;

    if (!document.fullscreenElement) {
      container.requestFullscreen?.().catch((err) => {
        console.warn('Fullscreen request error:', err);
      });
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  };

  const restartFromBeginning = () => {
    if (videoRef.current) {
      videoRef.current.currentTime = 0;
      setCurrentTime(0);
      latestPositionRef.current = 0;
      videoRef.current.play().catch(() => {});
    }
    setResumeNotification(null);
  };

  // ── Keyboard Shortcuts ─────────────────────────────────────────────────
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore when user is typing in inputs or textareas
      const target = e.target as HTMLElement;
      if (
        target &&
        (target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT' ||
          target.isContentEditable)
      ) {
        return;
      }

      switch (e.key) {
        case ' ':
        case 'k':
        case 'K':
          e.preventDefault();
          togglePlay();
          break;
        case 'ArrowLeft':
        case 'j':
        case 'J':
          e.preventDefault();
          seekRelative(-5);
          break;
        case 'ArrowRight':
        case 'l':
        case 'L':
          e.preventDefault();
          seekRelative(5);
          break;
        case 'ArrowUp':
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.min(1, Math.round((prev + 0.1) * 10) / 10);
            if (videoRef.current) {
              videoRef.current.volume = next;
              videoRef.current.muted = false;
              setIsMuted(false);
            }
            return next;
          });
          break;
        case 'ArrowDown':
          e.preventDefault();
          setVolume((prev) => {
            const next = Math.max(0, Math.round((prev - 0.1) * 10) / 10);
            if (videoRef.current) {
              videoRef.current.volume = next;
              if (next === 0) {
                videoRef.current.muted = true;
                setIsMuted(true);
              }
            }
            return next;
          });
          break;
        case 'm':
        case 'M':
          e.preventDefault();
          toggleMute();
          break;
        case 'f':
        case 'F':
          e.preventDefault();
          toggleFullscreen();
          break;
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [togglePlay, seekRelative, toggleMute, toggleFullscreen]);

  // ── Render ─────────────────────────────────────────────────────────────
  const playedPercent = duration > 0 ? Math.min(100, (currentTime / duration) * 100) : 0;

  return (
    <div
      ref={containerRef}
      onMouseMove={handleMouseMove}
      onMouseLeave={handleMouseLeave}
      className="relative w-full aspect-video bg-neutral-950 rounded-card overflow-hidden shadow-2xl group select-none border border-neutral-800"
    >
      {/* ── Native HTML5 Video Element ───────────────────────────────── */}
      {playbackUrl ? (
        <video
          ref={videoRef}
          src={playbackUrl}
          poster={thumbnailUrl || undefined}
          preload="metadata"
          playsInline
          onClick={togglePlay}
          onLoadedMetadata={handleLoadedMetadata}
          onTimeUpdate={handleTimeUpdate}
          onPlay={handlePlay}
          onPause={handlePause}
          onSeeked={handleSeeked}
          onEnded={handleEnded}
          onWaiting={handleWaiting}
          onPlaying={handlePlaying}
          onError={handleVideoError}
          className="w-full h-full object-contain cursor-pointer"
        />
      ) : (
        <div className="w-full h-full flex flex-col items-center justify-center text-neutral-400 bg-neutral-900 gap-3">
          <Spinner className="w-8 h-8 animate-spin text-brand" />
          <p className="text-sm font-medium">Securing live-class recording stream...</p>
        </div>
      )}

      {/* ── Top Header Bar (Title & Refresh status) ───────────────────── */}
      <div
        className={`absolute top-0 inset-x-0 p-4 bg-gradient-to-b from-neutral-950/80 via-neutral-950/40 to-transparent transition-opacity duration-300 z-20 flex items-center justify-between ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        <div className="flex items-center gap-2">
          <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold bg-red-600/90 text-white tracking-wide uppercase">
            Recorded Class
          </span>
          <h2 className="text-sm font-semibold text-white truncate max-w-md drop-shadow-sm">
            {title}
          </h2>
        </div>

        {isRefreshingUrl && (
          <div className="flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-neutral-900/80 backdrop-blur-md border border-neutral-700 text-xs text-neutral-300">
            <ArrowsClockwise className="w-3.5 h-3.5 animate-spin text-brand" />
            <span>Renewing token...</span>
          </div>
        )}
      </div>

      {/* ── Resume Notification Banner ───────────────────────────────── */}
      {resumeNotification && (
        <div className="absolute top-16 left-6 z-30 flex items-center gap-3 px-4 py-2.5 rounded-field bg-neutral-900/90 backdrop-blur-md border border-neutral-700 text-white shadow-xl animate-fade-in">
          <CheckCircle className="w-5 h-5 text-emerald-400 shrink-0" weight="fill" />
          <span className="text-xs font-medium">{resumeNotification}</span>
          <button
            onClick={restartFromBeginning}
            className="text-xs font-semibold text-brand hover:text-brand ml-1 underline underline-offset-2 transition-colors"
          >
            Start Over
          </button>
        </div>
      )}

      {/* ── Buffering Spinner Overlay ─────────────────────────────────── */}
      {isBuffering && !playerError && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/30 backdrop-blur-[2px] z-10 pointer-events-none">
          <div className="flex flex-col items-center gap-2 p-4 rounded-card bg-neutral-900/80 border border-neutral-700 shadow-2xl">
            <Spinner className="w-10 h-10 animate-spin text-brand" />
            <span className="text-xs font-medium text-neutral-300">Buffering...</span>
          </div>
        </div>
      )}

      {/* ── Error State Overlay ──────────────────────────────────────── */}
      {playerError && (
        <div className="absolute inset-0 flex flex-col items-center justify-center bg-neutral-950/95 z-40 p-6 text-center">
          <div className="p-3 bg-red-950/50 border border-red-800/80 rounded-card mb-3 text-red-400">
            <WarningCircle className="w-8 h-8" weight="fill" />
          </div>
          <h3 className="text-base font-semibold text-white mb-1">Playback Issue</h3>
          <p className="text-xs text-neutral-400 max-w-sm mb-4 leading-relaxed">
            {playerError}
          </p>
          <button
            onClick={() => executeUrlRefresh(true)}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-field bg-brand hover:bg-brand text-white text-xs font-semibold shadow-lg shadow-card transition-all active:scale-[0.98]"
          >
            <ArrowsClockwise className="w-4 h-4" />
            Retry Playback
          </button>
        </div>
      )}

      {/* ── Center Clickable Play/Pause Overlay ───────────────────────── */}
      {!isPlaying && !isBuffering && !playerError && (
        <button
          onClick={togglePlay}
          aria-label="Play recording"
          className="absolute inset-0 m-auto w-16 h-16 rounded-full bg-brand/90 hover:bg-brand text-white flex items-center justify-center shadow-2xl shadow-card backdrop-blur-sm transition-all transform hover:scale-105 active:scale-[0.98] z-20"
        >
          <Play className="w-7 h-7 ml-1" weight="fill" />
        </button>
      )}

      {/* ── Bottom Custom Controls Bar ───────────────────────────────── */}
      <div
        className={`absolute bottom-0 inset-x-0 bg-gradient-to-t from-neutral-950/95 via-neutral-950/70 to-transparent pt-8 pb-3 px-4 transition-opacity duration-300 z-30 ${
          showControls || !isPlaying ? 'opacity-100' : 'opacity-0 pointer-events-none'
        }`}
      >
        {/* ── Scrubber Bar ────────────────────────────────────────── */}
        <div
          onClick={handleScrubberClick}
          onMouseMove={handleScrubberMouseMove}
          onMouseLeave={handleScrubberMouseLeave}
          className="relative w-full h-3 group/scrubber cursor-pointer flex items-center mb-2"
        >
          {/* Background rail */}
          <div className="w-full h-1.5 bg-neutral-700/80 rounded-full overflow-hidden transition-all group-hover/scrubber:h-2.5">
            {/* Buffered bar */}
            <div
              className="h-full bg-neutral-500/50 transition-all duration-150"
              style={{ width: `${bufferedPercent}%` }}
            />
          </div>

          {/* Played progress bar */}
          <div
            className="absolute left-0 h-1.5 bg-gradient-to-r bg-brand bg-sky-tint rounded-full pointer-events-none transition-all group-hover/scrubber:h-2.5"
            style={{ width: `${playedPercent}%` }}
          />

          {/* Scrubber thumb */}
          <div
            className="absolute w-3.5 h-3.5 bg-white rounded-full shadow-lg pointer-events-none transform -translate-x-1/2 scale-0 group-hover/scrubber:scale-100 transition-transform"
            style={{ left: `${playedPercent}%` }}
          />

          {/* Hover Time Bubble */}
          {hoverTime && (
            <div
              className="absolute -top-7 px-2 py-0.5 rounded bg-neutral-900 border border-neutral-700 text-caption font-mono text-white shadow-lg transform -translate-x-1/2 pointer-events-none"
              style={{ left: `${hoverTime.xPercent}%` }}
            >
              {formatPlayerTime(hoverTime.time)}
            </div>
          )}
        </div>

        {/* ── Controls Row ────────────────────────────────────────── */}
        <div className="flex items-center justify-between gap-2 text-white">
          {/* Left Group: Play/Pause, Rewind, Fast-Forward, Time Display */}
          <div className="flex items-center gap-2">
            <button
              onClick={togglePlay}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors focus:outline-none focus:ring-2 focus:ring-brand"
              title={isPlaying ? 'Pause (Space or K)' : 'Play (Space or K)'}
            >
              {isPlaying ? (
                <Pause className="w-5 h-5" weight="fill" />
              ) : (
                <Play className="w-5 h-5" weight="fill" />
              )}
            </button>

            <button
              onClick={() => seekRelative(-10)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-neutral-300 hover:text-white"
              title="Replay 10 seconds (J or Left Arrow)"
            >
              <ArrowCounterClockwise className="w-5 h-5" />
            </button>

            <button
              onClick={() => seekRelative(10)}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-neutral-300 hover:text-white"
              title="Forward 10 seconds (L or Right Arrow)"
            >
              <ArrowClockwise className="w-5 h-5" />
            </button>

            {/* Volume Control */}
            <div className="flex items-center gap-1.5 ml-1 group/vol">
              <button
                onClick={toggleMute}
                className="p-2 rounded-lg hover:bg-white/10 transition-colors text-neutral-300 hover:text-white"
                title="Mute / Unmute (M)"
              >
                {isMuted || volume === 0 ? (
                  <SpeakerSlash className="w-5 h-5 text-red-400" />
                ) : volume < 0.5 ? (
                  <SpeakerLow className="w-5 h-5" />
                ) : (
                  <SpeakerHigh className="w-5 h-5" />
                )}
              </button>

              <input
                type="range"
                min="0"
                max="1"
                step="0.05"
                value={isMuted ? 0 : volume}
                onChange={handleVolumeChange}
                className="w-16 h-1.5 bg-neutral-700 accent-brand rounded-lg cursor-pointer opacity-80 hover:opacity-100 transition-opacity"
                title="Volume"
              />
            </div>

            {/* Time Display */}
            <div className="text-xs font-mono text-neutral-300 ml-2">
              <span className="text-white font-semibold">{formatPlayerTime(currentTime)}</span>
              <span className="mx-1 text-neutral-500">/</span>
              <span>{formatPlayerTime(duration)}</span>
            </div>
          </div>

          {/* Right Group: Speed Selector, Fullscreen */}
          <div className="flex items-center gap-2">
            {/* Speed Selector Dropdown */}
            <div className="relative">
              <button
                onClick={() => setShowSpeedMenu(!showSpeedMenu)}
                className="px-2.5 py-1 rounded-lg bg-neutral-800/80 hover:bg-neutral-700/80 text-xs font-semibold text-neutral-200 hover:text-white transition-colors border border-neutral-700/80"
                title="Playback Speed"
              >
                {playbackSpeed}x
              </button>

              {showSpeedMenu && (
                <div className="absolute bottom-full right-0 mb-2 py-1 w-24 bg-neutral-900 border border-neutral-700 rounded-field shadow-2xl z-50 overflow-hidden">
                  <div className="px-3 py-1 text-caption uppercase font-bold text-neutral-400 tracking-wider">
                    Speed
                  </div>
                  {PLAYBACK_SPEEDS.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSpeedSelect(s)}
                      className={`w-full px-3 py-1.5 text-xs text-left transition-colors flex items-center justify-between ${
                        playbackSpeed === s
                          ? 'bg-brand text-white font-bold'
                          : 'text-neutral-300 hover:bg-neutral-800 hover:text-white'
                      }`}
                    >
                      <span>{s}x</span>
                      {s === 1.0 && <span className="text-caption text-neutral-400 font-normal">Normal</span>}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Fullscreen Button */}
            <button
              onClick={toggleFullscreen}
              className="p-2 rounded-lg hover:bg-white/10 transition-colors text-neutral-300 hover:text-white"
              title={isFullscreen ? 'Exit Fullscreen (F)' : 'Fullscreen (F)'}
            >
              {isFullscreen ? (
                <ArrowsIn className="w-5 h-5" />
              ) : (
                <ArrowsOut className="w-5 h-5" />
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
