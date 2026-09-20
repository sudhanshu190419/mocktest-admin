'use client';

import React, { useEffect, useState, useMemo } from 'react';
import Link from 'next/link';
import {
  VideoCamera,
  BookOpen,
  Exam,
  ArrowRight,
  CalendarCheck,
  Lightning,
  Play,
  GraduationCap,
  WarningCircle,
  CheckCircle,
  CalendarBlank,
  ChatCircleDots,
  PlayCircle,
  ListChecks,
} from '@phosphor-icons/react';
import { useAuth } from '@/context/AuthContext';
import { useOpenDoubtCount } from '@/hooks/student/useNavBadgeCounts';
import { TestStateCard } from '@/components/student/TestStateCard';
import { isDueThisWeek } from '@/lib/testCardState';
import {
  fetchCompleteStudentDashboard,
  type StudentDashboardSummary,
  type StudentEnrolledCourse,
} from '@/services/student/studentDashboardWebService';
import type { TimetableSessionItem } from '@/services/student/studentTimetableWebService';

// ─── Helpers ────────────────────────────────────────────────────────────────

function getGreeting(now: Date): string {
  const h = now.getHours();
  if (h < 5) return 'Burning the midnight oil';
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

function titleCase(raw: string): string {
  return raw
    .split(/[\s._-]+/)
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join(' ');
}

function formatClock(time: string): string {
  // "HH:MM:SS" or "HH:MM" → locale short time
  const [hStr, mStr] = time.split(':');
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return time;
  return new Date(2000, 0, 1, h, m).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

function courseResumeHref(course: StudentEnrolledCourse, summary: unknown): string {
  const firstBatchSubjectId =
    Array.isArray(summary) && summary.length > 0
      ? (summary[0]?.batchSubjectId || summary[0]?.batch_subject_id || null)
      : null;
  return firstBatchSubjectId
    ? `/student/courses/${course.course_id}/subjects/${firstBatchSubjectId}`
    : `/student/courses/${course.course_id}`;
}

// ─── Page ───────────────────────────────────────────────────────────────────

export default function StudentOverviewPage() {
  const { user, teacherProfile } = useAuth();
  const [data, setData] = useState<StudentDashboardSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [retryToken, setRetryToken] = useState(0);
  const openDoubts = useOpenDoubtCount();

  const todayTimetable = useMemo(() => data?.todayTimetable || [], [data]);
  const nextSession: TimetableSessionItem | null = useMemo(() => {
    if (todayTimetable.length === 0) return null;
    return (
      todayTimetable.find((s) => s.status === 'live') ||
      todayTimetable.find((s) => s.status === 'upcoming' || s.status === 'scheduled') ||
      null
    );
  }, [todayTimetable]);

  useEffect(() => {
    let cancelled = false;
    fetchCompleteStudentDashboard()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : 'Failed to load dashboard data');
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [retryToken]);

  const retry = () => setRetryToken((t) => t + 1);

  // ── SKELETON (reference shape per §6) ─────────────────────────────────────
  if (loading) {
    return (
      <div className="store-container space-y-6">
        <div className="skeleton skeleton-text" style={{ width: '40%', height: 28 }} />
        <div className="today-resume-strip">
          {[1, 2, 3].map((i) => (
            <div key={i} className="skeleton today-resume-card" style={{ height: 112 }} />
          ))}
        </div>
        <div className="skeleton student-card" style={{ height: 120 }} />
        <div className="skeleton student-card" style={{ height: 180 }} />
        <div className="skeleton student-card" style={{ height: 220 }} />
      </div>
    );
  }

  // ── ERROR STATE ───────────────────────────────────────────────────────────
  if (error && !data) {
    return (
      <div className="store-container">
        <div className="p-8 rounded-3xl bg-paper border border-line text-center max-w-lg mx-auto my-12">
          <WarningCircle size={40} className="text-apricot-ink mx-auto mb-3" weight="duotone" style={{ color: 'var(--color-apricot-ink)' }} />
          <h3 className="text-base font-bold text-ink mb-1">Couldn&apos;t load your day</h3>
          <p className="text-xs text-ink-secondary mb-4 leading-relaxed">{error}</p>
          <button
            onClick={retry}
            className="px-4 py-2 rounded-xl text-white font-bold text-xs hover:opacity-90 transition-opacity shadow-xs"
            style={{ backgroundColor: 'var(--color-brand)' }}
          >
            Try Again
          </button>
        </div>
      </div>
    );
  }

  // ── Derived data ──────────────────────────────────────────────────────────
  const now = new Date();
  const rawName =
    data?.profile?.name ||
    teacherProfile?.name ||
    user?.user_metadata?.full_name ||
    user?.email?.split('@')[0] ||
    'Student';
  const firstName = titleCase(rawName).split(' ')[0] || 'Student';
  const activeBatch =
    data?.activeBatches && data.activeBatches.length > 0
      ? data.activeBatches[0].name
      : 'Active Enrolled Batch';

  const enrolledCourses = data?.enrolledCourses || [];
  const weakChapters = data?.weakChapters || [];
  const assignedTests = data?.assignedMockTests || [];
  const liveClass = data?.liveClass;

  // Resume strip: in-progress test beats next class beats last course.
  const resumeTest = assignedTests.find(
    (t) => t.attemptSummary?.attemptState === 'in_progress',
  );
  const resumeCourse = enrolledCourses[0] || null;

  const hasAnyResumePoint = Boolean(resumeTest || nextSession || resumeCourse || liveClass);
  const weekTests = assignedTests.filter((t) => isDueThisWeek(t, now)).slice(0, 4);
  const liveNow = liveClass?.status === 'live';

  const analytics = data?.analytics;

  return (
    <div className="store-container space-y-7 pb-12">

      {/* ═══ 1 — Greeting (compact, time-of-day aware) ═══ */}
      <header className="today-greeting">
        <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight text-ink">
          {getGreeting(now)}, {firstName}.
        </h1>
        <div className="today-greeting-meta">
          <span>{now.toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })}</span>
          <span className="opacity-40">•</span>
          <span>{activeBatch}</span>
        </div>
      </header>

      {/* ═══ 2 — Resume strip (up to 3 one-tap cards) ═══ */}
      <section aria-label="Pick up where you left off" className="today-resume-strip">
        {resumeTest && (
          <Link href={`/student/tests/${resumeTest.testId}`} className="today-resume-card is-primary">
            <span className="today-resume-kicker">
              <ListChecks size={14} weight="bold" />
              <span>Test in progress</span>
            </span>
            <span className="today-resume-title">{resumeTest.title}</span>
            <span className="today-resume-cta">
              Resume now <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
        )}

        {!resumeTest && liveClass && (
          <Link href="/student/classes" className={`today-resume-card ${liveNow ? 'is-live' : ''}`}>
            <span className="today-resume-kicker">
              <VideoCamera size={14} weight="bold" />
              <span>{liveNow ? 'Live now' : 'Next class today'}</span>
            </span>
            <span className="today-resume-title">{liveClass.subject_name}</span>
            <span className="today-resume-cta">
              {liveNow
                ? 'Join classroom'
                : new Date(liveClass.scheduled_at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}{' '}
              <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
        )}

        {!resumeTest && !liveClass && nextSession && (
          <Link href="/student/timetable" className="today-resume-card">
            <span className="today-resume-kicker">
              <VideoCamera size={14} weight="bold" />
              <span>Next class today</span>
            </span>
            <span className="today-resume-title">{nextSession.subject}</span>
            <span className="today-resume-cta">
              {nextSession.timeSlot} <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
        )}

        {!resumeTest && !liveClass && !nextSession && resumeCourse && (
          <Link
            href={courseResumeHref(resumeCourse, data?.courseContentSummary?.[resumeCourse.course_id])}
            className="today-resume-card is-primary"
          >
            <span className="today-resume-kicker">
              <PlayCircle size={14} weight="bold" />
              <span>Continue learning</span>
            </span>
            <span className="today-resume-title">{resumeCourse.title}</span>
            <span className="today-resume-cta">
              Pick up where you left off <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
        )}

        {!resumeTest && (liveClass || nextSession) && resumeCourse && (
          <Link
            href={courseResumeHref(resumeCourse, data?.courseContentSummary?.[resumeCourse.course_id])}
            className="today-resume-card"
          >
            <span className="today-resume-kicker">
              <PlayCircle size={14} weight="bold" />
              <span>Continue learning</span>
            </span>
            <span className="today-resume-title">{resumeCourse.title}</span>
            <span className="today-resume-cta">
              Pick up <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
        )}

        {!resumeTest && !hasAnyResumePoint && (
          <Link href="/courses" className="today-resume-card is-primary">
            <span className="today-resume-kicker">
              <GraduationCap size={14} weight="bold" />
              <span>Start your day</span>
            </span>
            <span className="today-resume-title">Explore courses & mock tests</span>
            <span className="today-resume-cta">
              Browse catalog <ArrowRight size={14} weight="bold" />
            </span>
          </Link>
        )}
      </section>

      {/* ═══ Live interrupt banner (only when a class is actually live) ═══ */}
      {liveNow && liveClass && (
        <section className="student-live-hero border-emerald-300">
          <div className="flex items-start sm:items-center gap-4">
            <div
              className="flex h-12 w-12 items-center justify-center rounded-2xl shrink-0 text-white shadow-md"
              style={{ backgroundColor: 'var(--color-success)' }}
            >
              <VideoCamera size={24} weight="duotone" />
            </div>
            <div className="space-y-1">
              <span className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-caption font-extrabold text-white uppercase tracking-wider" style={{ backgroundColor: 'var(--color-success)' }}>
                <span className="h-1.5 w-1.5 rounded-full bg-white animate-ping" />
                Live Class Active
              </span>
              <h2 className="text-base font-extrabold text-ink tracking-tight">
                {liveClass.subject_name}: {liveClass.title}
              </h2>
              <p className="text-xs text-ink-secondary">
                {liveClass.teacher_name} • {new Date(liveClass.scheduled_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
              </p>
            </div>
            <div className="ml-auto shrink-0">
              <Link
                href="/student/classes"
                className="w-full sm:w-auto px-5 py-3 rounded-xl font-extrabold text-xs tracking-wide shadow-md flex items-center justify-center gap-2 text-white transition-all"
                style={{ backgroundColor: 'var(--color-success)' }}
              >
                <Play size={16} weight="fill" />
                <span>Join Now</span>
              </Link>
            </div>
          </div>
        </section>
      )}

      {/* ═══ 3 — Today's schedule ═══ */}
      <section>
        <div className="student-section-header">
          <h2 className="flex items-center gap-2">
            <CalendarBlank size={18} weight="bold" style={{ color: 'var(--color-brand)' }} />
            <span>Today&apos;s schedule</span>
          </h2>
          <Link href="/student/timetable" className="text-xs font-bold hover:underline" style={{ color: 'var(--color-brand)' }}>
            Full timetable &rarr;
          </Link>
        </div>

        {todayTimetable.length > 0 ? (
          <div className="student-card today-schedule">
            {todayTimetable.map((s) => (
              <div key={s.id} className="today-schedule-row">
                <span className="today-schedule-time tabular-nums">{formatClock(s.startTime)}</span>
                <div className="today-schedule-info">
                  <span className="today-schedule-subject">{s.subject}</span>
                  {s.teacher && <span className="today-schedule-teacher">{s.teacher}</span>}
                </div>
                <span className={`today-schedule-chip chip-${s.status}`}>
                  {s.status === 'live' ? 'Live now' : s.status === 'completed' ? 'Done' : s.status === 'upcoming' ? 'Upcoming' : formatClock(s.startTime)}
                </span>
              </div>
            ))}
          </div>
        ) : (
          <div className="student-card flex items-center justify-between">
            <div className="flex items-center gap-3.5">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl" style={{ background: 'var(--color-sky-tint)', color: 'var(--color-sky-ink)' }}>
                <CalendarCheck size={22} weight="duotone" />
              </div>
              <div>
                <p className="text-xs font-bold text-ink">Nothing scheduled today</p>
                <p className="text-caption text-ink-secondary">A good day for a mock test or catching up on lectures.</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ═══ 4 — This week's tests (state-card system §7.3) ═══ */}
      <section>
        <div className="student-section-header">
          <h2 className="flex items-center gap-2">
            <Exam size={18} weight="bold" style={{ color: 'var(--color-brand)' }} />
            <span>This week&apos;s tests</span>
          </h2>
          <Link href="/student/tests" className="text-xs font-bold hover:underline" style={{ color: 'var(--color-brand)' }}>
            All tests &rarr;
          </Link>
        </div>

        {weekTests.length > 0 ? (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {weekTests.map((test) => (
              <TestStateCard key={test.testId} test={test} />
            ))}
          </div>
        ) : (
          <div className="student-card text-center p-8">
            <CheckCircle size={36} className="mx-auto mb-2" weight="duotone" style={{ color: 'var(--color-mint-ink)' }} />
            <h3 className="text-sm font-bold text-ink mb-1">No tests due this week</h3>
            <p className="text-caption text-ink-secondary">
              New tests assigned to your batch will show up here.
            </p>
          </div>
        )}
      </section>

      {/* ═══ 5 — Momentum, compact (2–3 stats, "—" for zero) ═══ */}
      <section>
        <div className="student-section-header">
          <h2 className="flex items-center gap-2">
            <Lightning size={18} weight="bold" style={{ color: 'var(--color-brand)' }} />
            <span>Momentum</span>
          </h2>
          <Link href="/student/analytics" className="text-xs font-bold hover:underline" style={{ color: 'var(--color-brand)' }}>
            Full analytics &rarr;
          </Link>
        </div>

        <div className="today-momentum">
          <div className="today-momentum-stat">
            <span className="today-momentum-value tabular-nums">
              {analytics?.testsAttempted ? analytics.testsAttempted : '—'}
            </span>
            <span className="today-momentum-label">Tests you&apos;ve taken</span>
          </div>
          <div className="today-momentum-stat">
            <span className="today-momentum-value tabular-nums">
              {analytics?.averageScore ? `${analytics.averageScore}%` : '—'}
            </span>
            <span className="today-momentum-label">Average score</span>
          </div>
          <div className="today-momentum-stat">
            <span className="today-momentum-value tabular-nums">
              {openDoubts > 0 ? openDoubts : '—'}
            </span>
            <span className="today-momentum-label">Doubts waiting on faculty</span>
          </div>
        </div>
      </section>

      {/* ═══ 6 — Worth practicing (focus areas, coach voice, one rubric) ═══ */}
      <section>
        <div className="student-section-header">
          <h2 className="flex items-center gap-2">
            <BookOpen size={18} weight="bold" style={{ color: 'var(--color-brand)' }} />
            <span>Worth practicing</span>
          </h2>
        </div>

        <div className="student-card space-y-4" style={{ background: 'linear-gradient(135deg, var(--color-sand) 0%, var(--color-store-white) 70%)' }}>
          <p className="text-xs text-ink-secondary leading-relaxed">
            Chapters scoring under 60% on recent tests. Steady is 60–80%, mastered is 80%+ — lift these and your total moves.
          </p>

          {weakChapters.length > 0 ? (
            <div className="space-y-2.5">
              {weakChapters.map((chap) => (
                <div
                  key={chap.chapter_id}
                  className="p-3 rounded-2xl bg-white/90 border border-line flex items-center justify-between"
                >
                  <div>
                    <span className="text-caption font-bold uppercase text-ink-muted tracking-wider block">
                      {chap.subject_name}
                    </span>
                    <h4 className="text-xs font-bold text-ink">{chap.chapter_name}</h4>
                  </div>
                  <div className="text-right">
                    <span className="text-xs font-black text-ink block tabular-nums">{chap.accuracy}%</span>
                    <Link
                      href="/student/tests"
                      className="text-caption font-bold hover:underline"
                      style={{ color: 'var(--color-brand)' }}
                    >
                      Practice &rarr;
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="p-4 rounded-2xl bg-white/70 border border-line text-center space-y-1.5">
              <p className="text-xs font-bold text-ink">No weak areas identified yet</p>
              <p className="text-caption text-ink-secondary leading-normal">
                Take a mock test and we&apos;ll point out exactly what to practice.
              </p>
            </div>
          )}

          <div className="flex items-center justify-between pt-1">
            <span className="text-caption text-ink-secondary flex items-center gap-1.5">
              <ChatCircleDots size={14} />
              Stuck on a topic?
            </span>
            <Link
              href="/student/doubts?new=true"
              className="text-xs font-bold hover:underline"
              style={{ color: 'var(--color-brand)' }}
            >
              Ask a doubt &rarr;
            </Link>
          </div>
        </div>
      </section>

    </div>
  );
}
