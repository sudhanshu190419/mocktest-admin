'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from './Card';
import { Button } from './Button';
import { CourseArtwork } from './StoreCourseCard';
import { IconArrowRight } from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import {
  getPublishedDemoClasses,
  getDemoClassVideoSignedUrl,
  getDemoClassThumbnailUrl,
} from '@/services/demoClassService';
import type { DemoClass } from '@/types/demoClass';
import type { ExamStreamCode } from '@/types/learnerGoal';

const STREAMS: { code: ExamStreamCode | 'ALL'; label: string }[] = [
  { code: 'ALL', label: 'All demo classes' },
  { code: 'NEET', label: 'NEET' },
  { code: 'JEE', label: 'JEE' },
  { code: 'CUET', label: 'CUET' },
  { code: 'FOUNDATION', label: 'Foundation' },
  { code: 'UPSC', label: 'UPSC' },
  { code: 'K12', label: 'K12' },
];

export function DemoClassPicker({ initialClasses = [] }: { initialClasses?: DemoClass[] }) {
  const { user, loading: authLoading } = useAuth();
  const [stream, setStream] = useState<ExamStreamCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState<DemoClass[]>(initialClasses);
  const [loading, setLoading] = useState(false);

  // Video preview modal state
  const [activeVideoClass, setActiveVideoClass] = useState<DemoClass | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    // If user is logged in, refresh demo classes list
    if (user && initialClasses.length === 0) {
      setLoading(true);
      getPublishedDemoClasses()
        .then((res) => setClasses(res))
        .finally(() => setLoading(false));
    }
  }, [user, initialClasses.length]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classes.filter((item) => {
      if (stream !== 'ALL') {
        const itemStream = (item.streamCode || item.streamName || '').toUpperCase();
        if (itemStream !== stream) return false;
      }
      if (!q) return true;
      return (
        item.title.toLowerCase().includes(q) ||
        (item.description && item.description.toLowerCase().includes(q)) ||
        (item.streamName && item.streamName.toLowerCase().includes(q))
      );
    });
  }, [classes, stream, search]);

  const handleOpenVideo = async (demo: DemoClass) => {
    setActiveVideoClass(demo);
    setSignedUrl(null);
    setVideoError(null);
    setVideoLoading(true);

    try {
      const res = await getDemoClassVideoSignedUrl(demo);
      if (res?.signedUrl) {
        setSignedUrl(res.signedUrl);
      } else {
        setVideoError('Unable to load video stream. Please verify storage permissions.');
      }
    } catch {
      setVideoError('An unexpected error occurred while loading the video.');
    } finally {
      setVideoLoading(false);
    }
  };

  const handleCloseVideo = () => {
    setActiveVideoClass(null);
    setSignedUrl(null);
    setVideoError(null);
    setVideoLoading(false);
  };

  // ── Auth Loading State ──────────────────────────────────────────
  if (authLoading) {
    return (
      <div className="store-demo-picker py-16 text-center">
        <div className="inline-block h-7 w-7 animate-spin rounded-full border-2 border-blue-600 border-t-transparent mb-2.5" />
        <p className="text-xs font-medium text-slate-500">Checking account status...</p>
      </div>
    );
  }

  // ── Login Required State when user is not logged in ─────────────
  if (!user) {
    return (
      <div className="store-demo-picker">
        <div className="mx-auto max-w-xl text-center py-8 sm:py-12 px-4">
          {/* Refined Compact Lock Icon */}
          <div className="inline-flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-blue-50 text-blue-600 shadow-2xs border border-blue-100/90 mb-3.5">
            <svg
              xmlns="http://www.w3.org/2000/svg"
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              className="sm:w-5 sm:h-5"
            >
              <rect width="18" height="11" x="3" y="11" rx="2" ry="2" />
              <path d="M7 11V7a5 5 0 0 1 10 0v4" />
            </svg>
          </div>

          {/* Eyebrow badge */}
          <div className="inline-flex items-center gap-1.5 rounded-full border border-blue-200/90 bg-blue-50/90 px-3 py-0.5 text-[10px] sm:text-[11px] font-extrabold tracking-wider text-blue-700 uppercase shadow-2xs mb-3">
            <span>LOGIN REQUIRED</span>
          </div>

          {/* Heading */}
          <h2 className="text-xl sm:text-3xl font-black text-slate-900 tracking-tight leading-snug mb-2.5">
            Please log in to watch <br className="hidden sm:block" />
            <span className="text-blue-600">Free Demo Classes</span>
          </h2>

          {/* Description */}
          <p className="text-slate-600 text-xs sm:text-sm max-w-md mx-auto leading-relaxed mb-6">
            Experience our pedagogy firsthand with full interactive masterclass recordings across NEET, JEE, CUET, and Foundation. Sign in to your account for instant free access.
          </p>

          {/* Action Buttons using Header "Get Started" Blue */}
          <div className="flex flex-col sm:flex-row items-center justify-center gap-2.5 sm:gap-3.5 max-w-sm mx-auto mb-8">
            <Link
              href="/login"
              className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center gap-2 rounded-full bg-blue-600 hover:bg-blue-700 active:scale-95 px-7 text-xs sm:text-sm font-semibold text-white shadow-xs transition-all"
            >
              <span>Log In to Continue</span>
              <IconArrowRight size={14} />
            </Link>

            <Link
              href="/signup"
              className="inline-flex min-h-[44px] w-full sm:w-auto items-center justify-center rounded-full border border-slate-200 bg-white hover:bg-slate-50 active:scale-95 px-6 text-xs sm:text-sm font-semibold text-slate-800 shadow-xs transition-all"
            >
              Create Free Account
            </Link>
          </div>

          {/* Feature Highlights with Blue Accents */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5 pt-5 border-t border-slate-100 text-left">
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/80 border border-slate-100">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">✓</span>
              <span className="text-[11.5px] font-semibold text-slate-700">100% Free Access</span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/80 border border-slate-100">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">✓</span>
              <span className="text-[11.5px] font-semibold text-slate-700">HD Video Lectures</span>
            </div>
            <div className="flex items-center gap-2 p-2.5 rounded-xl bg-slate-50/80 border border-slate-100">
              <span className="flex h-5 w-5 items-center justify-center rounded-full bg-blue-100 text-blue-700 text-[10px] font-bold">✓</span>
              <span className="text-[11.5px] font-semibold text-slate-700">Expert Faculty</span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // ── Logged-in State: Full Demo Classes Catalog ──────────────────
  return (
    <div className="store-demo-picker">
      <div className="store-section-heading">
        <div>
          <p className="store-eyebrow">PREVIEW OUR TEACHING</p>
          <h2>Free demo classes for every exam stream.</h2>
        </div>
        <p>
          Stream actual masterclass sessions.
          <br />
          Experience interactive problem solving & concept clarity.
        </p>
      </div>

      <div className="store-catalog-controls">
        <div className="store-stream-filters" role="group" aria-label="Filter demo classes by exam stream">
          {STREAMS.map((item) => (
            <button
              key={item.code}
              onClick={() => setStream(item.code)}
              aria-pressed={stream === item.code}
              className={stream === item.code ? 'selected' : ''}
            >
              {item.label}
              {item.code === 'ALL' && <span className="tabular-nums">{classes.length}</span>}
            </button>
          ))}
        </div>
        <div className="store-search">
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search demo classes or topics…"
            aria-label="Search demo classes"
          />
        </div>
      </div>

      <div className="store-results-bar">
        <div>
          <span>
            <b className="tabular-nums">{filtered.length}</b> demo class
            {filtered.length === 1 ? '' : 'es'} available
          </span>
        </div>
      </div>

      {loading ? (
        <div className="store-empty">
          <p>Loading demo classes…</p>
        </div>
      ) : filtered.length > 0 ? (
        <div className="store-course-grid">
          {filtered.map((entry) => {
            const minutes = entry.durationSeconds ? Math.round(entry.durationSeconds / 60) : 45;
            const streamCodeVal = (entry.streamCode || entry.streamName || 'NEET').toUpperCase();
            const validStream = (
              ['NEET', 'JEE', 'CUET', 'FOUNDATION', 'UPSC', 'K12'].includes(streamCodeVal)
                ? streamCodeVal
                : 'NEET'
            ) as ExamStreamCode;
            const thumbnailUrl = getDemoClassThumbnailUrl(entry);

            return (
              <Card key={entry.demoClassId} className="store-course-card store-demo-card" interactive>
                <div
                  className="store-demo-thumb-wrapper"
                  onClick={() => handleOpenVideo(entry)}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      handleOpenVideo(entry);
                    }
                  }}
                  aria-label={`Watch ${entry.title}`}
                >
                  {thumbnailUrl ? (
                    <img
                      src={thumbnailUrl}
                      alt={entry.title}
                      className="store-demo-thumb-img"
                      loading="lazy"
                    />
                  ) : (
                    <CourseArtwork stream={validStream} title={entry.title} />
                  )}
                  <div className="store-demo-play-overlay" aria-hidden="true">
                    <span className="store-demo-play-icon">▶</span>
                  </div>
                </div>

                <div className="store-course-card-body">
                  <div className="store-card-meta">
                    <span className={`store-stream-tag tag-${validStream.toLowerCase()}`}>
                      {entry.streamName || validStream}
                    </span>
                    <span className="store-demo-duration tabular-nums">
                      {minutes} min · Free Preview
                    </span>
                  </div>

                  <h3>
                    <button
                      type="button"
                      className="store-demo-title-button text-left"
                      onClick={() => handleOpenVideo(entry)}
                    >
                      {entry.title}
                    </button>
                  </h3>

                  <p className="store-card-description">
                    {entry.description ||
                      'Join this masterclass session to experience our interactive problem-solving and conceptual clarity methods.'}
                  </p>

                  <div className="store-course-facts">
                    <span>Interactive Session</span>
                    <span>HD 1080p Video</span>
                    <span>Direct Access</span>
                  </div>

                  <Button
                    className="store-card-button store-demo-watch-button"
                    onClick={() => handleOpenVideo(entry)}
                  >
                    Watch free preview <span aria-hidden="true">▶</span>
                  </Button>
                </div>
              </Card>
            );
          })}
        </div>
      ) : (
        <div className="store-empty">
          <span aria-hidden="true">✳</span>
          <h3>No demo classes found for {stream === 'ALL' ? 'this search' : stream}.</h3>
          <p>
            {stream !== 'ALL'
              ? `We are adding more sample classes for ${stream}. Try exploring all available demo classes or search for another topic.`
              : 'Try clearing your search query to see all available demo classes.'}
          </p>
          <Button
            onClick={() => {
              setStream('ALL');
              setSearch('');
            }}
          >
            Show all demo classes ↗
          </Button>
        </div>
      )}

      {/* ── Video Preview Modal ─────────────────────────────────────── */}
      {activeVideoClass && (
        <div
          className="store-modal-backdrop"
          onClick={handleCloseVideo}
          role="dialog"
          aria-modal="true"
          aria-label={activeVideoClass.title}
        >
          <div
            className="store-modal-dialog"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="store-modal-header">
              <div className="flex items-center gap-3">
                <span className="store-stream-tag tag-neet">
                  {activeVideoClass.streamName || 'Demo Class'}
                </span>
                <h3 className="text-base font-bold text-gray-900 line-clamp-1">
                  {activeVideoClass.title}
                </h3>
              </div>
              <button
                type="button"
                className="store-modal-close"
                onClick={handleCloseVideo}
                aria-label="Close video preview"
              >
                ✕
              </button>
            </div>

            <div className="store-modal-video-container">
              {videoLoading ? (
                <div className="flex flex-col items-center justify-center p-12 text-white">
                  <div className="w-8 h-8 border-2 border-white border-t-transparent rounded-full animate-spin mb-3" />
                  <p className="text-xs text-gray-300">Loading secure video stream…</p>
                </div>
              ) : videoError ? (
                <div className="p-8 text-center text-rose-300">
                  <p className="text-sm font-semibold mb-2">Video Preview Unavailable</p>
                  <p className="text-xs text-gray-400 mb-4">{videoError}</p>
                  <Button
                    variant="secondary"
                    onClick={() => handleOpenVideo(activeVideoClass)}
                  >
                    Try Again ↻
                  </Button>
                </div>
              ) : signedUrl ? (
                <video
                  src={signedUrl}
                  controls
                  autoPlay
                  controlsList="nodownload"
                  poster={getDemoClassThumbnailUrl(activeVideoClass) ?? undefined}
                  className="w-full max-h-[65vh] bg-black"
                >
                  Your browser does not support video playback.
                </video>
              ) : null}
            </div>

            <div className="store-modal-body">
              <div className="flex items-start justify-between gap-4 mb-3">
                <div>
                  <h4 className="text-lg font-bold text-gray-900 mb-1">
                    {activeVideoClass.title}
                  </h4>
                  <p className="text-xs text-gray-500">
                    Duration:{' '}
                    {activeVideoClass.durationSeconds
                      ? Math.round(activeVideoClass.durationSeconds / 60)
                      : 45}{' '}
                    minutes · High Definition
                  </p>
                </div>
              </div>
              <p className="text-xs leading-relaxed text-gray-600">
                {activeVideoClass.description ||
                  'Sample lesson giving you a direct look into our classroom experience, mentor approach, and depth of explanation.'}
              </p>
            </div>

            <div className="store-modal-footer">
              <div className="text-xs text-gray-600">
                <span>Like what you see? Join the complete course batch today.</span>
              </div>
              <div className="flex items-center gap-3">
                <Button variant="secondary" onClick={handleCloseVideo}>
                  Close
                </Button>
                <Link href="/courses" className="store-modal-cta-btn">
                  Explore Full Courses →
                </Link>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
