'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from './Card';
import { Button } from './Button';
import { CourseArtwork } from './StoreCourseCard';
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
  const [stream, setStream] = useState<ExamStreamCode | 'ALL'>('ALL');
  const [search, setSearch] = useState('');
  const [classes, setClasses] = useState<DemoClass[]>(initialClasses);
  const [loading, setLoading] = useState(initialClasses.length === 0);
  const [activeVideoClass, setActiveVideoClass] = useState<DemoClass | null>(null);
  const [signedUrl, setSignedUrl] = useState<string | null>(null);
  const [videoLoading, setVideoLoading] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  useEffect(() => {
    let isMounted = true;
    if (initialClasses.length === 0) {
      setLoading(true);
    }
    getPublishedDemoClasses()
      .then((data) => {
        if (isMounted) {
          setClasses(data);
        }
      })
      .catch((err) => {
        console.error('Failed to load demo classes:', err);
      })
      .finally(() => {
        if (isMounted) setLoading(false);
      });

    return () => {
      isMounted = false;
    };
  }, [initialClasses.length]);

  // Handle video modal opening and signed URL fetching
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
        setVideoError('Unable to generate video preview link. Please try again later.');
      }
    } catch (err) {
      console.error('Error fetching signed video URL:', err);
      setVideoError('Could not load the demo video stream.');
    } finally {
      setVideoLoading(false);
    }
  };

  const handleCloseVideo = () => {
    setActiveVideoClass(null);
    setSignedUrl(null);
    setVideoError(null);
  };

  // Close modal on Escape key
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleCloseVideo();
      }
    };
    if (activeVideoClass) {
      window.addEventListener('keydown', onKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      document.body.style.overflow = 'unset';
    };
  }, [activeVideoClass]);

  const filtered = useMemo(() => {
    const text = search.trim().toLowerCase();
    return classes.filter((c) => {
      const streamNameUpper = (c.streamName || c.streamCode || '').toUpperCase();
      if (stream !== 'ALL') {
        if (!streamNameUpper.includes(stream)) return false;
      }
      if (!text) return true;
      return (
        c.title.toLowerCase().includes(text) ||
        (c.description && c.description.toLowerCase().includes(text)) ||
        streamNameUpper.toLowerCase().includes(text)
      );
    });
  }, [classes, stream, search]);

  return (
    <div className="store-demo-picker-section">
      <div className="store-section-heading">
        <div>
          <p className="store-eyebrow">FREE INTERACTIVE SAMPLES</p>
          <h2>Experience our teaching firsthand.</h2>
        </div>
        <p>
          Watch full sample lessons across all streams before making any enrollment decision.
        </p>
      </div>

      <div className="store-catalog-controls">
        <div className="store-stream-filters" role="group" aria-label="Filter demo classes by stream">
          {STREAMS.map((item) => {
            const count =
              item.code === 'ALL'
                ? classes.length
                : classes.filter((c) =>
                    (c.streamName || c.streamCode || '').toUpperCase().includes(item.code)
                  ).length;
            return (
              <button
                key={item.code}
                onClick={() => setStream(item.code)}
                aria-pressed={stream === item.code}
                className={stream === item.code ? 'selected' : ''}
              >
                {item.label}
                <span className="tabular-nums">{count}</span>
              </button>
            );
          })}
        </div>

        <label className="store-search">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
            <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.7" />
            <path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.7" />
          </svg>
          <span className="sr-only">Search demo classes</span>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search demo classes or topics…"
          />
        </label>
      </div>

      <div className="store-results-bar">
        <p role="status">
          <b className="tabular-nums">{filtered.length}</b> demo class
          {filtered.length === 1 ? '' : 'es'} available
        </p>
      </div>

      {loading ? (
        <div className="store-empty">
          <span aria-hidden="true">◷</span>
          <h3>Loading demo classes...</h3>
          <p>Connecting to secure MakeMeTopper video repository.</p>
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
