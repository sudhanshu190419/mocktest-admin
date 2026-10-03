'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  IconLibrary,
  IconTest,
  IconPyq,
  IconVideo,
  IconArrowRight,
  IconSpark,
} from '@/components/icons/student-icons';

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden bg-white pt-3 pb-24 sm:pt-8 sm:pb-16 lg:pt-10 lg:pb-20"
      aria-labelledby="hero-title"
    >
      {/* Subtle background ambient glow on the left */}
      <div
        className="pointer-events-none absolute -left-20 top-1/3 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-blue-50/70 blur-3xl"
        aria-hidden="true"
      />

      {/* Right-hand graphic attached flush to the right edge of screen & bottom of navbar (Desktop >= lg) */}
      <div
        className="pointer-events-none absolute right-0 top-0 lg:-top-1 hidden lg:flex w-[42vw] xl:w-[44vw] 2xl:w-[46vw] max-w-[880px] items-start justify-end z-0"
        aria-hidden="true"
      >
        <Image
          src="/home-desktop.webp"
          alt="Learn Today. Score a Brighter Tomorrow."
          width={1009}
          height={895}
          priority
          sizes="(min-width: 1536px) 46vw, (min-width: 1280px) 44vw, (min-width: 1024px) 42vw, 0vw"
          className="h-auto w-full object-contain select-none"
          style={{ objectPosition: 'right top' }}
        />
      </div>

      {/* Mobile Right-hand graphic anchored to top right (Mobile < lg) */}
      <div
        className="pointer-events-none absolute right-0 top-1 w-[48vw] xs:w-[46vw] sm:w-[42vw] max-w-[210px] xs:max-w-[240px] sm:max-w-[280px] flex justify-end z-0 lg:hidden"
        aria-hidden="true"
      >
        <Image
          src="/home-mobile.webp"
          alt="Learn Today. Score a Brighter Tomorrow."
          width={640}
          height={670}
          priority
          sizes="(max-width: 640px) 48vw, (max-width: 1023px) 42vw, 0vw"
          className="h-auto w-full object-contain select-none"
          style={{ objectPosition: 'right top' }}
        />
      </div>

      <div className="store-container relative z-10 px-4 sm:px-6 lg:px-8">
        <div className="grid items-center gap-8 lg:min-h-[500px] xl:min-h-[540px] lg:grid-cols-12 lg:gap-8">
          {/* Left Column: Copy, CTAs, Features */}
          <div className="lg:col-span-7 xl:col-span-7 2xl:col-span-7">
            {/* Top Badge (compact on mobile so it doesn't overlap student image) */}
            <div className="inline-flex items-center gap-1 sm:gap-1.5 mb-3 sm:mb-4 px-2.5 sm:px-3 py-0.5 sm:py-1 rounded-full bg-sky-50 border border-sky-100 text-blue-700 text-[10px] xs:text-[11px] sm:text-xs font-bold tracking-[0.1em] sm:tracking-[0.12em] uppercase shadow-2xs">
              <IconSpark size={12} className="text-blue-600 sm:w-3.5 sm:h-3.5" />
              <span>THE ALL-IN-ONE PREPARATION PLATFORM</span>
            </div>

            {/* Main Headline */}
            <h1
              id="hero-title"
              className="mb-2 sm:mb-5 text-[26px] xs:text-[29px] sm:text-4xl lg:text-[54px] xl:text-[62px] font-extrabold leading-[1.14] sm:leading-[1.15] tracking-[0.01em] text-slate-900 font-display max-w-[49vw] xs:max-w-[50vw] sm:max-w-[52vw] lg:max-w-none"
            >
              Learn Today.
              <br />
              Score a{' '}
              <span className="text-blue-600">
                Brighter
              </span>
              <br />
              <span className="relative inline-block text-blue-600 pb-1">
                Tomorrow.
                {/* Highlight underline matching demo image */}
                <svg
                  className="absolute -bottom-1 sm:-bottom-1.5 lg:-bottom-2 left-0 w-[104%] h-[7px] sm:h-[11px] lg:h-[13px] pointer-events-none"
                  viewBox="0 0 250 14"
                  fill="none"
                  xmlns="http://www.w3.org/2000/svg"
                  preserveAspectRatio="none"
                >
                  <path
                    d="M3 8.5C55 4 155 3 247 9.5"
                    stroke="#93C5FD"
                    strokeWidth="5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h1>

            {/* Subtitle / Paragraph */}
            <p className="mt-4 sm:mt-5 mb-6 sm:mb-8 max-w-[95%] sm:max-w-[540px] text-[13px] sm:text-base font-normal leading-relaxed text-slate-600 sm:text-lg">
              Mock tests, expert courses, PYQ practice and live classes — all in one place to help
              you crack your goals.
            </p>

            {/* CTAs (Full width on mobile like the screenshot) */}
            <div className="mb-8 flex flex-col sm:flex-row items-stretch sm:items-center gap-3 sm:gap-4 lg:mb-12 w-full max-w-[340px] sm:max-w-none">
              <Link
                href="/courses"
                className="group relative inline-flex items-center justify-center gap-3 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 px-7 py-3.5 text-[14px] sm:text-[15px] font-semibold text-white shadow-[0_10px_25px_-4px_rgba(37,99,235,0.4),0_6px_10px_-4px_rgba(37,99,235,0.2)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-6px_rgba(37,99,235,0.48),0_8px_14px_-6px_rgba(37,99,235,0.3)] hover:brightness-105 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/35 w-full sm:w-auto text-center"
              >
                {/* Specular top edge highlight */}
                <span
                  className="pointer-events-none absolute inset-x-0 top-0 h-[1px] bg-gradient-to-r from-transparent via-white/40 to-transparent"
                  aria-hidden="true"
                />

                {/* Subtle hover sheen */}
                <span
                  className="pointer-events-none absolute inset-0 bg-gradient-to-r from-white/0 via-white/15 to-white/0 opacity-0 transition-opacity duration-300 group-hover:opacity-100"
                  aria-hidden="true"
                />

                <span className="relative z-10 font-semibold tracking-tight">Explore Courses</span>

                {/* Sleek pill arrow container with smooth hover glide */}
                <span className="relative z-10 flex h-6 w-6 items-center justify-center rounded-full bg-white/20 text-white backdrop-blur-sm transition-all duration-300 ease-out group-hover:translate-x-1 group-hover:bg-white group-hover:text-blue-600">
                  <IconArrowRight size={13} />
                </span>
              </Link>

              <Link
                href="/courses"
                className="group inline-flex items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-7 py-3.5 text-[14px] sm:text-[15px] font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50/90 hover:shadow-md hover:shadow-slate-200/50 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300/50 w-full sm:w-auto text-center"
              >
                <span>Try a Free Mock Test</span>
              </Link>
            </div>

            {/* 4 Feature Row */}
            <div className="grid grid-cols-4 gap-1.5 xs:gap-2 sm:gap-5 pt-1 max-w-[620px]">
              {/* Expert-Led Courses */}
              <Link href="/courses" className="flex flex-col items-center sm:items-start text-center sm:text-left group transition-transform hover:-translate-y-0.5">
                <div className="mb-2 sm:mb-3 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600 shadow-sm transition-colors group-hover:bg-indigo-100">
                  <IconLibrary size={22} />
                </div>
                <span className="text-[10px] xs:text-[11px] sm:text-[14px] font-bold leading-tight text-slate-900">
                  Expert-Led Courses
                </span>
                <span className="mt-0.5 text-[9px] sm:text-[12px] leading-tight text-slate-500">
                  Learn from the best
                </span>
              </Link>

              {/* Mock Tests */}
              <Link href="/courses#home-courses" className="flex flex-col items-center sm:items-start text-center sm:text-left group transition-transform hover:-translate-y-0.5">
                <div className="mb-2 sm:mb-3 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-amber-50 text-amber-600 shadow-sm transition-colors group-hover:bg-amber-100">
                  <IconTest size={22} />
                </div>
                <span className="text-[10px] xs:text-[11px] sm:text-[14px] font-bold leading-tight text-slate-900">
                  Mock Tests
                </span>
                <span className="mt-0.5 text-[9px] sm:text-[12px] leading-tight text-slate-500">
                  Practice. Analyze. Improve.
                </span>
              </Link>

              {/* PYQ Packages */}
              <Link href="/pyq" className="flex flex-col items-center sm:items-start text-center sm:text-left group transition-transform hover:-translate-y-0.5">
                <div className="mb-2 sm:mb-3 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-sky-50 text-sky-600 shadow-sm transition-colors group-hover:bg-sky-100">
                  <IconPyq size={22} />
                </div>
                <span className="text-[10px] xs:text-[11px] sm:text-[14px] font-bold leading-tight text-slate-900">
                  PYQ Packages
                </span>
                <span className="mt-0.5 text-[9px] sm:text-[12px] leading-tight text-slate-500">
                  Past papers, bigger possibilities.
                </span>
              </Link>

              {/* Live Classes */}
              <Link href="/demo-class" className="flex flex-col items-center sm:items-start text-center sm:text-left group transition-transform hover:-translate-y-0.5">
                <div className="mb-2 sm:mb-3 flex h-11 w-11 sm:h-12 sm:w-12 items-center justify-center rounded-2xl bg-emerald-50 text-emerald-600 shadow-sm transition-colors group-hover:bg-emerald-100">
                  <IconVideo size={22} />
                </div>
                <span className="text-[10px] xs:text-[11px] sm:text-[14px] font-bold leading-tight text-slate-900">
                  Live Classes
                </span>
                <span className="mt-0.5 text-[9px] sm:text-[12px] leading-tight text-slate-500">
                  Interact. Ask. Learn.
                </span>
              </Link>
            </div>

          </div>

          {/* Spacer column on desktop so grid layout respects right image */}
          <div className="hidden lg:block lg:col-span-5 xl:col-span-5" aria-hidden="true" />
        </div>

      </div>
    </section>
  );
}
