'use client';

import React from 'react';
import Link from 'next/link';
import {
  IconVideo,
  IconArrowRight,
  IconCheckCircle,
  IconWifi,
  IconTest,
  IconDoubt,
  IconLibrary,
} from '@/components/icons/student-icons';

const FEATURES = [
  {
    title: 'Live Teaching Experience',
    icon: (
      <svg className="h-6 w-6 text-emerald-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M2 3h20v13H2z" />
        <path d="M8 21h8" />
        <path d="M12 16v5" />
        <circle cx="8" cy="8" r="1.5" />
        <path d="M6 12a2 2 0 0 1 4 0" />
        <path d="M13 7h5" />
        <path d="M13 10h3" />
      </svg>
    ),
    box: 'bg-emerald-50 text-emerald-600 border border-emerald-100/80',
  },
  {
    title: 'Real Exam Questions',
    icon: (
      <svg className="h-6 w-6 text-blue-600" viewBox="0 0 24 24" fill="currentColor">
        <circle cx="12" cy="12" r="10" />
        <polygon points="10 8 16 12 10 16 10 8" fill="white" />
      </svg>
    ),
    box: 'bg-blue-50 text-blue-600 border border-blue-100/80',
  },
  {
    title: 'Doubt Solving in Real Time',
    icon: (
      <svg className="h-6 w-6 text-amber-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M6 2a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6H6z" />
        <path d="M14 2v6h6" fill="#fde68a" />
        <line x1="8" y1="12" x2="14" y2="12" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="8" y1="15" x2="16" y2="15" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
        <line x1="8" y1="18" x2="13" y2="18" stroke="white" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    ),
    box: 'bg-amber-50 text-amber-500 border border-amber-100/80',
  },
  {
    title: 'Understand Our Teaching Style',
    icon: (
      <svg className="h-6 w-6 text-rose-500" viewBox="0 0 24 24" fill="currentColor">
        <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
        <circle cx="9" cy="7" r="4" />
        <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
        <path d="M16 3.13a4 4 0 0 1 0 7.75" />
      </svg>
    ),
    box: 'bg-rose-50 text-rose-500 border border-rose-100/80',
  },
];

export function FreeDemoSection() {
  return (
    <section
      className="store-container mb-4 sm:mb-[72px] mt-2 sm:mt-4"
      aria-labelledby="home-demo-title"
    >
      <div className="overflow-hidden rounded-[22px] sm:rounded-[28px] border border-[#d9e3ed] bg-white shadow-[0_20px_50px_-24px_rgba(21,43,69,0.22)]">
        <div className="grid items-stretch lg:grid-cols-[1.08fr_1fr]">
          {/* ── Left: copy, 4 feature cards, actions & social proof ── */}
          <div className="flex flex-col justify-center px-5 py-8 sm:px-10 sm:py-12 lg:py-14 lg:pl-12 lg:pr-8">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-[#166534] sm:text-[11px]">
              <IconVideo size={14} aria-hidden="true" />
              FREE DEMO CLASSES
            </span>

            <h2
              id="home-demo-title"
              className="mt-4 sm:mt-5 text-[26px] xs:text-[29px] sm:text-[34px] lg:text-[40px] font-black leading-[1.14] tracking-[-0.03em] text-[#152b45]"
            >
              Experience Our
              <br />
              Teaching,{' '}
              <span className="relative inline-block text-[#16a34a]">
                Before You Buy.
                <svg
                  className="absolute -bottom-1 left-0 h-2 w-full text-[#16a34a]"
                  viewBox="0 0 160 8"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M2 5.5C40 2.5 120 2.5 158 5"
                    stroke="currentColor"
                    strokeWidth="2.5"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
            </h2>

            <p className="mt-3.5 sm:mt-4 max-w-[480px] text-[13px] xs:text-[13.5px] sm:text-[14.5px] leading-relaxed text-[#5e7084]">
              Join our free demo classes and see how Make Me Topper helps you learn better, clear concepts, and score higher.
            </p>

            {/* ── Desktop: 4 Cards in a horizontal row (Matching Design) ── */}
            <div className="hidden sm:grid sm:grid-cols-4 gap-3 lg:gap-4 mt-7">
              {FEATURES.map((feature) => (
                <div key={feature.title} className="group flex flex-col items-center text-center">
                  <div className={`flex h-13 w-13 lg:h-14 lg:w-14 items-center justify-center rounded-2xl shadow-2xs transition-transform duration-200 group-hover:scale-105 ${feature.box}`}>
                    {feature.icon}
                  </div>
                  <span className="mt-2.5 text-[12px] lg:text-[13px] font-bold leading-snug text-[#152b45] max-w-[100px]">
                    {feature.title}
                  </span>
                </div>
              ))}
            </div>

            {/* ── Mobile: 2-column responsive cards (Kept 100% intact) ── */}
            <ul className="mt-6 grid grid-cols-1 xs:grid-cols-2 gap-2.5 sm:hidden">
              {FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="group flex items-center gap-3 rounded-2xl border border-slate-100/80 xs:border-transparent bg-slate-50/50 xs:bg-transparent p-2.5 xs:p-1 transition-colors duration-200 hover:border-[#d9e3ed] hover:bg-[#f3f8fc]"
                >
                  <span
                    className={`flex h-9 w-9 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${feature.box}`}
                    aria-hidden="true"
                  >
                    {feature.icon}
                  </span>
                  <span className="text-[12.5px] font-semibold leading-snug text-[#152b45]">
                    {feature.title}
                  </span>
                </li>
              ))}
            </ul>

            {/* ── Action buttons ── */}
            <div className="mt-7 sm:mt-8 flex flex-col sm:flex-row sm:items-center gap-3 sm:gap-6">
              <Link
                href="/demo-class"
                className="inline-flex min-h-[46px] sm:min-h-[48px] w-full sm:w-auto items-center justify-center gap-2 rounded-xl bg-[#1a56db] px-6 text-[13.5px] sm:text-[14px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(26,86,219,0.7)] transition-all duration-200 hover:bg-[#1546b5] hover:shadow-[0_14px_28px_-10px_rgba(26,86,219,0.75)] active:scale-[0.98] sm:active:scale-100"
              >
                <span>Get Free Demo Class</span>
                <span className="text-base font-bold">→</span>
              </Link>

              <Link
                href="/demo-class"
                className="inline-flex items-center justify-center sm:justify-start gap-2 text-[13px] sm:text-[13.5px] font-semibold text-[#475569] hover:text-[#1a56db] transition-colors"
              >
                <svg className="h-4 w-4 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <rect x="3" y="4" width="18" height="18" rx="2" />
                  <line x1="16" y1="2" x2="16" y2="6" />
                  <line x1="8" y1="2" x2="8" y2="6" />
                  <line x1="3" y1="10" x2="21" y2="10" />
                </svg>
                <span>View Demo Schedule</span>
              </Link>
            </div>
          </div>

          {/* ── Right: visual, floating cards & annotations ── */}
          <div className="relative min-h-[320px] xs:min-h-[360px] sm:min-h-[460px] lg:min-h-[540px] overflow-hidden border-t border-[#eef4f9] bg-gradient-to-br from-[#f3f8fc] via-white to-[#eef7f2] px-4 py-8 xs:px-5 xs:py-10 sm:px-8 sm:py-12 lg:border-l lg:border-t-0 lg:px-6 lg:py-0">
            {/* Soft decorative glows */}
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-emerald-100/50 blur-3xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-12 -left-10 h-56 w-56 rounded-full bg-blue-100/50 blur-3xl"
              aria-hidden="true"
            />

            {/* Sparkle top right */}
            <div className="pointer-events-none absolute top-4 right-8 text-slate-700 hidden sm:block" aria-hidden="true">
              <svg className="w-5 h-5 text-slate-800" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round">
                <line x1="12" y1="2" x2="12" y2="6" />
                <line x1="4.93" y1="4.93" x2="7.76" y2="7.76" />
                <line x1="19.07" y1="4.93" x2="16.24" y2="7.76" />
              </svg>
            </div>

            {/* Main Center Image */}
            <div className="relative flex h-full items-center justify-center py-4 xs:py-6 sm:py-0">
              <img
                src="/demo.png"
                alt="A live MakeMeTopper demo class in progress"
                className="h-auto sm:h-[82%] w-[82%] xs:w-[86%] max-w-[320px] xs:max-w-[380px] sm:max-w-[440px] rounded-2xl object-contain drop-shadow-[0_24px_40px_rgba(21,43,69,0.18)]"
                loading="lazy"
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
