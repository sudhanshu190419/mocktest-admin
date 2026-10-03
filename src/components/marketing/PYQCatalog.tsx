'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import Image from 'next/image';
import { Card } from './Card';
import { CourseArtwork } from './StoreCourseCard';
import {
  IconArrowRight,
  IconCalendar,
  IconPyq,
  IconTest,
  IconCheck,
  IconSearch,
  IconFileText,
  IconLayers,
  IconChartBar,
  IconTarget,
} from '@/components/icons/student-icons';
import { useAuth } from '@/context/AuthContext';
import { useStudentPyqPurchases } from '@/hooks/student/useStudentPyqPurchases';
import { formatCoursePrice } from '@/services/courseCatalogService';
import type { PYQPackage } from '@/types/pyqCatalog';
import type { ExamStreamCode } from '@/types/learnerGoal';

export function PYQPackageCard({
  item,
  isPurchased = false,
}: {
  item: PYQPackage;
  isPurchased?: boolean;
}) {
  const streamCode = item.streamCode?.toUpperCase();
  const isNeet = streamCode === 'NEET' || item.title?.toUpperCase().includes('NEET');
  const topImage = isNeet ? '/pyq/pyq.png' : null;

  return (
    <Card className="store-course-card" interactive>
      <Link href={isPurchased ? '/student/tests' : `/pyq/${item.packageId}`} tabIndex={-1} aria-hidden="true">
        <CourseArtwork
          stream={item.streamCode}
          title={item.subjectBreakdown.map((entry) => entry.subject).slice(0, 2).join('\n')}
          imageUrl={topImage}
        />
      </Link>
      <div className="store-course-card-body">
        <div className="store-card-meta">
          <span className={`store-stream-tag tag-${item.streamCode.toLowerCase()}`}>
            {item.streamCode === 'FOUNDATION' ? 'Foundation' : item.streamCode}
          </span>
          {isPurchased ? (
            <span className="px-2 py-0.5 rounded text-caption font-bold bg-emerald-100 text-emerald-800">
              Purchased ✓
            </span>
          ) : (
            <span>Previous year papers</span>
          )}
        </div>
        <h3>
          <Link href={isPurchased ? `/pyq/${item.packageId}` : `/pyq/${item.packageId}`}>{item.title}</Link>
        </h3>
        <p className="store-card-description">{item.shortDescription}</p>
        <div className="store-course-facts">
          <span className="store-fact-item">
            <IconCalendar size={13} className="store-fact-icon shrink-0" />
            <span className="tabular-nums">{item.yearRange}</span>
          </span>
          <span className="store-fact-item">
            <IconPyq size={13} className="store-fact-icon shrink-0" />
            <span className="tabular-nums">{item.totalPapers} papers</span>
          </span>
          <span className="store-fact-item">
            <IconTest size={13} className="store-fact-icon shrink-0" />
            <span className="tabular-nums">{item.totalQuestions} questions</span>
          </span>
        </div>
        <div className="store-card-price">
          <div className="store-card-price-info">
            <span className="store-small-label">{isPurchased ? 'Access Status' : 'One-time purchase'}</span>
            <div className="store-card-price-row">
              {isPurchased ? (
                <strong className="text-emerald-700 text-base">Active Package</strong>
              ) : (
                <>
                  <strong className="tabular-nums">
                    {formatCoursePrice(item.discountedPrice, item.currency)}
                  </strong>
                  {item.originalPrice > item.discountedPrice && (
                    <del className="tabular-nums">
                      {formatCoursePrice(item.originalPrice, item.currency)}
                    </del>
                  )}
                </>
              )}
            </div>
            <p className="store-monthly-line">
              <b>{item.accessType}</b> · Online practice
            </p>
          </div>
          <Link
            href={isPurchased ? `/pyq/${item.packageId}` : `/pyq/${item.packageId}`}
            className={`store-card-cta ${isPurchased ? 'store-card-cta-enrolled' : 'store-card-cta-explore'}`}
          >
            <span className="store-card-cta-text">
              {isPurchased ? 'Continue Practice' : 'View Package'}
            </span>
            <span className="store-card-cta-arrow" aria-hidden="true">
              <IconArrowRight size={13} />
            </span>
          </Link>
        </div>
      </div>
    </Card>
  );
}

const STREAMS: { code: ExamStreamCode | 'ALL'; label: string }[] = [
  { code: 'ALL', label: 'All exams' },
  { code: 'NEET', label: 'NEET' },
  { code: 'JEE', label: 'JEE' },
  { code: 'CUET', label: 'CUET' },
  { code: 'FOUNDATION', label: 'Foundation' },
];

export function PYQCatalog({ packages }: { packages: PYQPackage[] }) {
  const { user } = useAuth();
  const profileId = user?.id ?? null;
  const { purchasedPackageIds } = useStudentPyqPurchases(profileId);

  const [stream, setStream] = useState<ExamStreamCode | 'ALL'>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return packages.filter((item) => {
      if (stream !== 'ALL' && item.streamCode !== stream) return false;
      if (!text) return true;
      return (
        item.title.toLowerCase().includes(text) ||
        item.subjectBreakdown.some((entry) => entry.subject.toLowerCase().includes(text))
      );
    });
  }, [packages, stream, query]);

  return (
    <>
      {/* ── 1. PYQ Hero Section Matching Exact Mobile & Desktop Designs ── */}
      <section
        className="relative overflow-hidden bg-white min-h-[560px] xs:min-h-[610px] sm:min-h-[680px] lg:min-h-[640px] flex flex-col justify-between"
        id="store-main"
      >
        {/* Mobile Background Graphic (pyq-mobile.webp) */}
        <div className="pointer-events-none absolute inset-0 block lg:hidden overflow-hidden" aria-hidden="true">
          <Image
            src="/pyq-mobile.webp"
            alt=""
            fill
            priority
            quality={80}
            sizes="(max-width: 1023px) 100vw, 0vw"
            className="object-cover object-top select-none"
          />
        </div>

        {/* Mobile Seamless Radial Soft Glow / Ambient Backdrop: zero straight lines, perfectly feathered behind text */}
        <div
          className="pointer-events-none absolute inset-0 block lg:hidden z-[1]"
          style={{
            background:
              'radial-gradient(ellipse 85% 65% at 0% 0%, rgba(255, 255, 255, 0.98) 0%, rgba(255, 255, 255, 0.92) 30%, rgba(255, 255, 255, 0.6) 50%, rgba(255, 255, 255, 0.2) 65%, transparent 80%)',
          }}
          aria-hidden="true"
        />

        {/* Desktop Background Graphic (pyq-desktop.webp) */}
        <div className="pointer-events-none absolute inset-0 hidden lg:block overflow-hidden" aria-hidden="true">
          <Image
            src="/pyq-desktop.webp"
            alt=""
            fill
            priority
            quality={80}
            sizes="(min-width: 1024px) 100vw, 0vw"
            className="object-cover object-[center_right] select-none"
          />
        </div>

        {/* Desktop left gradient overlay for crisp text contrast */}
        <div
          className="pointer-events-none absolute inset-0 hidden lg:block bg-gradient-to-r from-white via-white/85 to-transparent w-[62%]"
          aria-hidden="true"
        />

        {/* Main Content Area */}
        <div className="store-container relative z-10 w-full pt-3.5 xs:pt-4 sm:pt-8 lg:py-16">
          <div className="max-w-[215px] xs:max-w-[235px] sm:max-w-md lg:max-w-2xl space-y-2.5 xs:space-y-3 sm:space-y-6">
            {/* Eyebrow Badge */}
            <div className="inline-flex items-center gap-1.5 sm:gap-2 rounded-full border border-emerald-200/90 bg-[#e6f7ef] px-2.5 py-0.5 sm:px-3.5 sm:py-1.5 text-[9.5px] xs:text-[10.5px] sm:text-xs font-extrabold tracking-[0.08em] sm:tracking-[0.12em] text-[#047857] uppercase shadow-2xs">
              <IconFileText size={12} className="text-[#047857] sm:w-3.5 sm:h-3.5" />
              <span>PREVIOUS YEAR QUESTIONS</span>
            </div>

            {/* Headline */}
            <h1 className="text-[23px] xs:text-[26px] sm:text-4xl lg:text-[54px] font-black text-slate-900 tracking-tight leading-[1.12]">
              Real Questions. <br />
              <span className="text-[#047857]">Real Exam Experience.</span> <br />
              Real Results.
            </h1>

            {/* Subtitle */}
            <p className="text-slate-600 text-[11px] xs:text-[11.5px] sm:text-base lg:text-[16.5px] font-normal leading-relaxed max-w-[205px] xs:max-w-[225px] sm:max-w-lg">
              Access subject-wise, chapter-wise and year-wise PYQs with detailed solutions, just like the actual exam.
            </p>

            {/* Action Buttons: Vertical stack on mobile, horizontal on desktop */}
            <div className="flex flex-col items-start sm:flex-row sm:items-center gap-1.5 xs:gap-2 sm:gap-3.5 pt-0.5">
              <a
                href="#pyq-catalog"
                className="inline-flex items-center justify-center gap-1.5 rounded-full bg-[#046a38] hover:bg-[#03542c] active:scale-95 px-4 xs:px-5 sm:px-7 py-2 xs:py-2.5 sm:py-3.5 text-[11.5px] xs:text-xs sm:text-[15px] font-bold text-white shadow-sm transition-all w-auto"
              >
                <span>Explore PYQ Packages</span>
                <IconArrowRight size={13} className="sm:w-3.5 sm:h-3.5" />
              </a>

              <a
                href="#pyq-catalog"
                className="inline-flex items-center justify-center rounded-full border border-slate-200/90 bg-white hover:bg-slate-50 active:scale-95 px-4 xs:px-5 sm:px-7 py-2 xs:py-2.5 sm:py-3.5 text-[11.5px] xs:text-xs sm:text-[15px] font-bold text-slate-800 shadow-sm transition-all w-auto"
              >
                View Sample Questions
              </a>
            </div>
          </div>
        </div>

        {/* Desktop 4 Feature Row (Inside hero on desktop, matching reference design with vertical stack) */}
        <div className="relative z-10 w-full mt-auto hidden lg:block">
          <div className="store-container pb-10 xl:pb-12">
            <div className="grid grid-cols-4 gap-6 xl:gap-8 max-w-2xl">
              {/* Card 1: Chapter-wise PYQs */}
              <div className="flex flex-col items-start gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fee2e2] text-[#ef4444] shrink-0 shadow-2xs">
                  <IconFileText size={20} />
                </div>
                <div>
                  <h4 className="text-[13.5px] xl:text-[14px] font-bold text-slate-900 leading-tight">Chapter-wise PYQs</h4>
                  <p className="text-[11.5px] xl:text-xs text-slate-500 font-normal leading-tight mt-1">Practice topic by topic.</p>
                </div>
              </div>

              {/* Card 2: Year-wise Papers */}
              <div className="flex flex-col items-start gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#ede9fe] text-[#7c3aed] shrink-0 shadow-2xs">
                  <IconLayers size={20} />
                </div>
                <div>
                  <h4 className="text-[13.5px] xl:text-[14px] font-bold text-slate-900 leading-tight">Year-wise Papers</h4>
                  <p className="text-[11.5px] xl:text-xs text-slate-500 font-normal leading-tight mt-1">Access past years easily.</p>
                </div>
              </div>

              {/* Card 3: Detailed Solutions */}
              <div className="flex flex-col items-start gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#d1fae5] text-[#10b981] shrink-0 shadow-2xs">
                  <IconChartBar size={20} />
                </div>
                <div>
                  <h4 className="text-[13.5px] xl:text-[14px] font-bold text-slate-900 leading-tight">Detailed Solutions</h4>
                  <p className="text-[11.5px] xl:text-xs text-slate-500 font-normal leading-tight mt-1">Step-by-step explanations.</p>
                </div>
              </div>

              {/* Card 4: Exam-like Practice */}
              <div className="flex flex-col items-start gap-2.5">
                <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-[#fef3c7] text-[#f59e0b] shrink-0 shadow-2xs">
                  <IconTarget size={20} />
                </div>
                <div>
                  <h4 className="text-[13.5px] xl:text-[14px] font-bold text-slate-900 leading-tight">Exam-like Practice</h4>
                  <p className="text-[11.5px] xl:text-xs text-slate-500 font-normal leading-tight mt-1">Boost your confidence.</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* ── 2. Mobile 4 Feature Cards (Directly below image with rounded-t-3xl white sheet container) ── */}
      <section className="block lg:hidden bg-white -mt-6 relative z-20 rounded-t-[28px] border-b border-slate-100 pt-5 pb-5 px-3.5 xs:px-4 shadow-[0_-6px_20px_rgba(0,0,0,0.04)]">
        <div className="grid grid-cols-2 gap-2.5 xs:gap-3">
          {/* Card 1: Chapter-wise PYQs (Rose) */}
          <div className="bg-[#fff1f2] border border-[#ffe4e6] rounded-2xl p-2.5 xs:p-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 xs:h-9 xs:w-9 items-center justify-center rounded-xl bg-[#fee2e2] text-[#ef4444] shrink-0 shadow-2xs">
              <IconFileText size={17} />
            </div>
            <div className="min-w-0">
              <h4 className="text-[11.5px] xs:text-xs font-bold text-slate-900 leading-tight truncate xs:whitespace-normal">
                Chapter-wise PYQs
              </h4>
              <p className="text-[9.5px] xs:text-[10.5px] text-slate-500 font-normal leading-tight mt-0.5 truncate xs:whitespace-normal">
                Practice topic by topic.
              </p>
            </div>
          </div>

          {/* Card 2: Year-wise Papers (Purple) */}
          <div className="bg-[#f5f3ff] border border-[#ede9fe] rounded-2xl p-2.5 xs:p-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 xs:h-9 xs:w-9 items-center justify-center rounded-xl bg-[#ede9fe] text-[#7c3aed] shrink-0 shadow-2xs">
              <IconLayers size={17} />
            </div>
            <div className="min-w-0">
              <h4 className="text-[11.5px] xs:text-xs font-bold text-slate-900 leading-tight truncate xs:whitespace-normal">
                Year-wise Papers
              </h4>
              <p className="text-[9.5px] xs:text-[10.5px] text-slate-500 font-normal leading-tight mt-0.5 truncate xs:whitespace-normal">
                Access past years easily.
              </p>
            </div>
          </div>

          {/* Card 3: Detailed Solutions (Emerald) */}
          <div className="bg-[#f0fdf4] border border-[#dcfce7] rounded-2xl p-2.5 xs:p-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 xs:h-9 xs:w-9 items-center justify-center rounded-xl bg-[#d1fae5] text-[#10b981] shrink-0 shadow-2xs">
              <IconChartBar size={17} />
            </div>
            <div className="min-w-0">
              <h4 className="text-[11.5px] xs:text-xs font-bold text-slate-900 leading-tight truncate xs:whitespace-normal">
                Detailed Solutions
              </h4>
              <p className="text-[9.5px] xs:text-[10.5px] text-slate-500 font-normal leading-tight mt-0.5 truncate xs:whitespace-normal">
                Step-by-step explanations.
              </p>
            </div>
          </div>

          {/* Card 4: Exam-like Practice (Amber) */}
          <div className="bg-[#fffbeb] border border-[#fef3c7] rounded-2xl p-2.5 xs:p-3 flex items-center gap-2.5">
            <div className="flex h-8 w-8 xs:h-9 xs:w-9 items-center justify-center rounded-xl bg-[#fef3c7] text-[#f59e0b] shrink-0 shadow-2xs">
              <IconTarget size={17} />
            </div>
            <div className="min-w-0">
              <h4 className="text-[11.5px] xs:text-xs font-bold text-slate-900 leading-tight truncate xs:whitespace-normal">
                Exam-like Practice
              </h4>
              <p className="text-[9.5px] xs:text-[10.5px] text-slate-500 font-normal leading-tight mt-0.5 truncate xs:whitespace-normal">
                Boost your confidence.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. PYQ Catalog Listing Section ────────────────────────────── */}
      <section className="store-container store-catalog-section" id="pyq-catalog">
        <div className="store-section-heading">
          <div>
            <p className="store-eyebrow">PICK YOUR PAPERS</p>
            <h2>Official previous year question packages.</h2>
          </div>
          <p>
            Topic-wise practice or timed full-length tests.
            <br />
            Choose the package for your stream.
          </p>
        </div>

        <div className="store-catalog-controls">
          <div className="store-stream-filters" role="group" aria-label="Filter by exam stream">
            {STREAMS.map((item) => (
              <button
                key={item.code}
                onClick={() => setStream(item.code)}
                aria-pressed={stream === item.code}
                className={stream === item.code ? 'selected' : ''}
              >
                {item.label}
                {item.code === 'ALL' && <span className="tabular-nums">{packages.length}</span>}
              </button>
            ))}
          </div>
          <label className="store-search">
            <IconSearch size={16} aria-hidden="true" />
            <span className="sr-only">Search PYQ packages</span>
            <input
              type="search"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search by exam or subject..."
            />
          </label>
        </div>

        {filtered.length ? (
          <div className="store-course-grid">
            {filtered.map((item) => (
              <PYQPackageCard
                key={item.packageId}
                item={item}
                isPurchased={purchasedPackageIds.includes(item.packageId)}
              />
            ))}
          </div>
        ) : (
          <div className="store-empty">
            <span aria-hidden="true">⌕</span>
            <h3>No PYQ packages match your filters.</h3>
            <p>Try switching streams or clearing your search.</p>
          </div>
        )}
      </section>
    </>
  );
}
