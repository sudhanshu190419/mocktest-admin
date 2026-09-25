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
import heroImg from '../../../public/hero.png';

export function HeroSection() {
  return (
    <section
      className="relative overflow-hidden bg-white pt-6 pb-12 sm:pt-10 sm:pb-16 lg:pt-10 lg:pb-20"
      aria-labelledby="hero-title"
    >
      {/* Subtle background ambient glow on the left */}
      <div
        className="pointer-events-none absolute -left-20 top-1/3 h-[500px] w-[500px] -translate-y-1/2 rounded-full bg-blue-50/70 blur-3xl"
        aria-hidden="true"
      />

      {/* Right-hand graphic attached flush to the right edge of screen & bottom of navbar */}
      <div
        className="pointer-events-none absolute right-0 top-0 lg:-top-1 hidden lg:flex w-[42vw] xl:w-[44vw] 2xl:w-[46vw] max-w-[880px] items-start justify-end z-0"
        aria-hidden="true"
      >
        <Image
          src={heroImg}
          alt="Learn Today. Score a Brighter Tomorrow."
          priority
          className="h-auto w-full object-contain select-none"
          style={{ objectPosition: 'right top' }}
        />
      </div>

      <div className="store-container relative z-10">
        <div className="grid items-center gap-8 lg:min-h-[500px] xl:min-h-[540px] lg:grid-cols-12 lg:gap-8">
          {/* Left Column: Copy, CTAs, Features */}
          <div className="lg:col-span-7 xl:col-span-7 2xl:col-span-7">
            <div className="inline-flex items-center gap-1.5 mb-4 px-3 py-1 rounded-full bg-sky-50 border border-blue-100 text-blue-600 text-xs font-bold uppercase tracking-wider sm:mb-5">
              <IconSpark size={13} />
              <span>YOUR EXAM SUCCESS PARTNER</span>
            </div>

            <h1
              id="hero-title"
              className="mb-5 text-4xl font-extrabold leading-[1.1] tracking-[-0.035em] text-slate-900 sm:mb-6 sm:text-5xl lg:text-[54px] xl:text-[62px] font-display"
            >
              Learn Today.
              <br />
              Score a{' '}
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 bg-clip-text text-transparent">
                Brighter
              </span>
              <br />
              <span className="bg-gradient-to-r from-blue-600 via-indigo-600 to-indigo-700 bg-clip-text text-transparent">
                Tomorrow.
              </span>
            </h1>

            <p className="mb-8 max-w-[540px] text-base font-normal leading-relaxed text-slate-600 sm:text-lg">
              Mock tests, expert courses, PYQ practice and live classes — all in one place to help
              you crack your goals.
            </p>

            {/* CTAs */}
            <div className="mb-10 flex flex-wrap items-center gap-3 sm:gap-4 lg:mb-12">
              <Link
                href="/courses"
                className="group relative inline-flex items-center justify-center gap-3 overflow-hidden rounded-full bg-gradient-to-r from-blue-600 via-blue-600 to-indigo-600 px-7 py-3.5 text-sm sm:text-[15px] font-semibold text-white shadow-[0_10px_25px_-4px_rgba(37,99,235,0.4),0_6px_10px_-4px_rgba(37,99,235,0.2)] transition-all duration-300 ease-out hover:-translate-y-0.5 hover:shadow-[0_16px_32px_-6px_rgba(37,99,235,0.48),0_8px_14px_-6px_rgba(37,99,235,0.3)] hover:brightness-105 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-blue-500/35"
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
                className="group inline-flex items-center justify-center gap-2 rounded-full border border-slate-200/90 bg-white/95 px-7 py-3.5 text-sm sm:text-[15px] font-semibold text-slate-800 shadow-sm backdrop-blur-sm transition-all duration-300 ease-out hover:-translate-y-0.5 hover:border-slate-300 hover:bg-slate-50/90 hover:shadow-md hover:shadow-slate-200/50 active:translate-y-0 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-slate-300/50"
              >
                <span>Try a Free Mock Test</span>
              </Link>
            </div>

            {/* 4 Feature Row */}
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 sm:gap-5 pt-2 max-w-[620px]">
              {/* Expert-Led Courses */}
              <Link href="/courses" className="flex flex-col group transition-transform hover:-translate-y-0.5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-indigo-50 text-indigo-600 shadow-sm transition-colors group-hover:bg-indigo-100">
                  <IconLibrary size={22} />
                </div>
                <span className="text-[13px] font-bold leading-snug text-slate-900 sm:text-[14px]">
                  Expert-Led Courses
                </span>
                <span className="mt-1 text-[11px] leading-tight text-slate-500 sm:text-[12px]">
                  Learn from the best
                </span>
              </Link>

              {/* Mock Tests */}
              <Link href="/courses#home-courses" className="flex flex-col group transition-transform hover:-translate-y-0.5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-amber-50 text-amber-600 shadow-sm transition-colors group-hover:bg-amber-100">
                  <IconTest size={22} />
                </div>
                <span className="text-[13px] font-bold leading-snug text-slate-900 sm:text-[14px]">
                  Mock Tests
                </span>
                <span className="mt-1 text-[11px] leading-tight text-slate-500 sm:text-[12px]">
                  Practice. Analyze. Improve.
                </span>
              </Link>

              {/* PYQ Packages */}
              <Link href="/pyq" className="flex flex-col group transition-transform hover:-translate-y-0.5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-sky-50 text-sky-600 shadow-sm transition-colors group-hover:bg-sky-100">
                  <IconPyq size={22} />
                </div>
                <span className="text-[13px] font-bold leading-snug text-slate-900 sm:text-[14px]">
                  PYQ Packages
                </span>
                <span className="mt-1 text-[11px] leading-tight text-slate-500 sm:text-[12px]">
                  Past papers, bigger possibilities.
                </span>
              </Link>

              {/* Live Classes */}
              <Link href="/demo-class" className="flex flex-col group transition-transform hover:-translate-y-0.5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-emerald-50 text-emerald-600 shadow-sm transition-colors group-hover:bg-emerald-100">
                  <IconVideo size={22} />
                </div>
                <span className="text-[13px] font-bold leading-snug text-slate-900 sm:text-[14px]">
                  Live Classes
                </span>
                <span className="mt-1 text-[11px] leading-tight text-slate-500 sm:text-[12px]">
                  Interact. Ask. Learn.
                </span>
              </Link>
            </div>
          </div>

          {/* Spacer column on desktop so grid layout respects right image */}
          <div className="hidden lg:block lg:col-span-5 xl:col-span-5" aria-hidden="true" />

          {/* Mobile/Tablet image (visible below lg breakpoint) */}
          <div className="flex items-center justify-center lg:hidden">
            <div className="relative w-full max-w-[460px]">
              <Image
                src={heroImg}
                alt="Learn Today. Score a Brighter Tomorrow."
                priority
                className="h-auto w-full select-none object-contain drop-shadow-sm"
              />
            </div>
          </div>
        </div>

      </div>
    </section>
  );
}
