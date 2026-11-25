'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
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
import { getCourses } from '@/services/courseCatalogService';
import type { DemoClass } from '@/types/demoClass';
import type { Course } from '@/types/courseCatalog';
import type { ExamStreamCode } from '@/types/learnerGoal';

export interface DemoCategoryOption {
  code: string;
  label: string;
}

/**
 * Returns user-facing label for stream codes, identical to Explore Batches on Courses page.
 */
export function getStreamLabel(item: string): string {
  if (item === 'ALL') return 'All Batches';
  if (item === '10TH' || item === 'FOUNDATION') return '8–10th Grade';
  if (item === '12TH' || item === 'K12') return '11–12th Grade';
  if (item === 'FOR') return 'Special Batches';
  return item;
}

/**
 * Authoritative check for an active, publicly available course.
 * Must have status 'published' and not be soft-deleted.
 */
export function isCourseActive(c: Course): boolean {
  return c.status === 'published' && !c.deletedAt;
}

/**
 * Determines whether an active course supports a given category code.
 */
export function courseMatchesCategory(c: Course, categoryCode: string): boolean {
  if (!isCourseActive(c)) return false;
  const sc = (c.streamCode || '').toUpperCase();
  const title = (c.title || '').toUpperCase();
  const cat = categoryCode.toUpperCase();

  if (cat === 'NEET') {
    return sc === 'NEET' || sc === 'MEDICAL' || title.includes('NEET');
  }
  if (cat === 'JEE') {
    return sc === 'JEE' || title.includes('JEE');
  }
  if (cat === 'CUET') {
    return sc === 'CUET' || title.includes('CUET');
  }
  if (cat === 'FOUNDATION' || cat === '10TH') {
    return (
      sc === 'FOUNDATION' ||
      sc === '10TH' ||
      sc === 'CLASS_10' ||
      sc === 'CLASS_9' ||
      title.includes('FOUNDATION') ||
      title.includes('10TH')
    );
  }
  if (cat === 'UPSC') {
    return sc === 'UPSC' || sc === 'GOVERNMENT' || title.includes('UPSC');
  }
  if (cat === 'K12' || cat === '12TH') {
    return (
      sc === 'K12' ||
      sc === '12TH' ||
      sc === 'CLASS_12' ||
      sc === 'CLASS_11' ||
      title.includes('12TH') ||
      title.includes('K12')
    );
  }
  return sc === cat || title.includes(cat);
}

/**
 * Derives distinct verified stream codes from active published courses, exactly matching Explore Batches.
 */
export function deriveStreams(courses: Course[]): string[] {
  const activeCourses = courses.filter(isCourseActive);
  const list = ['ALL'];
  if (activeCourses.some((c) => (c.streamCode as string) === 'NEET' || (c.streamCode as string) === 'MEDICAL')) list.push('NEET');
  if (activeCourses.some((c) => (c.streamCode as string) === '10TH' || (c.streamCode as string) === 'FOUNDATION')) list.push('10TH');
  if (activeCourses.some((c) => (c.streamCode as string) === '12TH' || (c.streamCode as string) === 'K12')) list.push('12TH');
  if (activeCourses.some((c) => (c.streamCode as string) === 'CUET')) list.push('CUET');
  if (activeCourses.some((c) => (c.streamCode as string) === 'JEE' || c.title.toUpperCase().includes('JEE'))) list.push('JEE');

  activeCourses.forEach((c) => {
    const code = (c.streamCode as string)?.toUpperCase();
    if (code && !list.includes(code) && code !== 'NEN') {
      list.push(code);
    }
  });
  return list;
}

/**
 * Backward-compatible helper returning stream options with labels.
 */
export function deriveActiveCategories(activeCourses: Course[]): DemoCategoryOption[] {
  const streamCodes = deriveStreams(activeCourses);
  return streamCodes.map((code) => ({
    code,
    label: getStreamLabel(code),
  }));
}

/**
 * Determines whether a demo class belongs to a selected stream.
 * Exactly matches CourseCatalog stream filter conventions.
 */
export function demoClassMatchesCategory(item: DemoClass, stream: string): boolean {
  if (stream === 'ALL') return true;
  const itemStream = (item.streamCode || item.streamName || '').toUpperCase();
  const st = stream.toUpperCase();

  return (
    st === 'ALL' ||
    itemStream === st ||
    (st === 'NEET' && (itemStream === 'NEET' || itemStream === 'MEDICAL')) ||
    (st === 'CUET' && (itemStream === 'CUET' || itemStream === 'UPSC' || itemStream === 'GOVERNMENT')) ||
    (st === 'FOUNDATION' && (itemStream === 'FOUNDATION' || itemStream === '10TH' || itemStream === 'CLASS_10' || itemStream === 'CLASS_9')) ||
    (st === '10TH' && (itemStream === '10TH' || itemStream === 'FOUNDATION' || itemStream === 'CLASS_10' || itemStream === 'CLASS_9')) ||
    (st === '12TH' && (itemStream === '12TH' || itemStream === 'K12' || itemStream === 'CLASS_12' || itemStream === 'CLASS_11')) ||
    (st === 'K12' && (itemStream === 'K12' || itemStream === '12TH' || itemStream === 'CLASS_12' || itemStream === 'CLASS_11')) ||
    (st === 'JEE' && (itemStream === 'JEE' || itemStream === 'ENGINEERING' || item.title.toUpperCase().includes('JEE')))
  );
}

export interface DemoClassPickerProps {
  initialClasses?: DemoClass[];
  courses?: Course[];
}

export function DemoClassPicker({
  initialClasses = [],
  courses: initialCourses,
}: DemoClassPickerProps) {
  const { user, loading: authLoading } = useAuth();
  const searchParams = useSearchParams();
  const urlStream = searchParams?.get('stream') || searchParams?.get('goal') || searchParams?.get('category');

  const [stream, setStream] = useState<string>('ALL');
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState<DemoClass[]>(initialClasses);
  const [courses, setCourses] = useState<Course[]>(initialCourses || []);
  const [loading, setLoading] = useState(false);

  // Synchronize stream filter with incoming URL search parameters
  useEffect(() => {
    if (urlStream) {
      setStream(urlStream.toUpperCase());
    } else {
      setStream('ALL');
    }
  }, [urlStream]);

  // Video preview modal state
  const [activeVideoClass, setActiveVideoClass] = useState<DemoClass | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  // Client-side fallback if courses are not pre-fetched
  useEffect(() => {
    if (initialCourses && initialCourses.length > 0) {
      setCourses(initialCourses);
      return;
    }
    getCourses()
      .then((res) => setCourses(res))
      .catch((err) => console.warn('Could not fetch courses in DemoClassPicker:', err));
  }, [initialCourses]);

  useEffect(() => {
    // If user is logged in, refresh demo classes list
    if (user && initialClasses.length === 0) {
      setLoading(true);
      getPublishedDemoClasses()
        .then((res) => setClasses(res))
        .finally(() => setLoading(false));
    }
  }, [user, initialClasses.length]);

  // Distinct verified stream options derived from published courses (matches CourseCatalog)
  const streams = useMemo(() => {
    return deriveStreams(courses);
  }, [courses]);

  // Reset stream to 'ALL' if the selected stream is no longer valid
  useEffect(() => {
    if (
      stream !== 'ALL' &&
      !streams.some((s) => s.toUpperCase() === stream.toUpperCase()) &&
      !(stream.toUpperCase() === 'FOUNDATION' && streams.includes('10TH')) &&
      !(stream.toUpperCase() === 'K12' && streams.includes('12TH'))
    ) {
      setStream('ALL');
    }
  }, [streams, stream]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return classes.filter((item) => {
      if (stream !== 'ALL' && !demoClassMatchesCategory(item, stream)) {
        return false;
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
      {/* ── Section Heading: Explore Demo Classes (Replaces competing redundant hero) ── */}
      <div className="store-section-heading mb-6">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Explore Demo Classes</h2>
        </div>
      </div>

      <div className="store-catalog-controls">
        <div className="store-stream-filters" role="group" aria-label="Filter demo classes by exam stream">
          {streams.map((item) => (
            <button
              key={item}
              type="button"
              onClick={() => setStream(item)}
              aria-pressed={stream === item}
              className={stream === item ? 'selected' : ''}
            >
              {getStreamLabel(item)}
              {item === 'ALL' && <span className="tabular-nums">{classes.length}</span>}
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
          <h3>No demo classes found for {getStreamLabel(stream)}.</h3>
          <p>
            {stream !== 'ALL'
              ? `We are adding more sample classes for ${getStreamLabel(stream)}. Try exploring all available demo classes or search for another topic.`
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
