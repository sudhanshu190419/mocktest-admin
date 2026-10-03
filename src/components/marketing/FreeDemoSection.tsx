'use client';

import React from 'react';
import Link from 'next/link';
import {
  IconVideo,
  IconArrowRight,
  IconCheckCircle,
  IconUser,
  IconClock,
  IconSpark,
  IconLifeBuoy,
} from '@/components/icons/student-icons';

const FEATURES = [
  {
    icon: <IconUser size={18} />,
    title: 'Top Institute Faculty',
    box: 'bg-emerald-50 text-[#166534]',
  },
  {
    icon: <IconSpark size={18} />,
    title: 'Full Interactive Experience',
    box: 'bg-blue-50 text-[#0284c7]',
  },
  {
    icon: <IconLifeBuoy size={18} />,
    title: 'Live Q&A with Teacher',
    box: 'bg-amber-50 text-[#d97706]',
  },
  {
    icon: <IconClock size={18} />,
    title: 'No Credit Card Needed',
    box: 'bg-purple-50 text-[#7c3aed]',
  },
];

const CHECKLIST = [
  'Free class materials',
  'Ask questions live',
  '100% Free · No card',
];

const HAND_FONT = {
  fontFamily:
    'Caveat, "Brush Script MT", "Comic Sans MS", cursive, sans-serif',
};

export function FreeDemoSection() {
  return (
    <section
      className="store-container mb-12 sm:mb-[72px] mt-2 sm:mt-4"
      aria-labelledby="home-demo-title"
    >
      <div className="overflow-hidden rounded-[22px] sm:rounded-[26px] border border-[#d9e3ed] bg-white shadow-[0_20px_50px_-24px_rgba(21,43,69,0.22)]">
        <div className="grid items-stretch lg:grid-cols-[1.05fr_1fr]">
          {/* ── Left: copy, features & actions ─────────────────────────── */}
          <div className="flex flex-col justify-center px-5 py-8 sm:px-10 sm:py-12 lg:py-16 lg:pl-14 lg:pr-10">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-[#166534] sm:text-[11px]">
              <IconVideo size={14} aria-hidden="true" />
              FREE DEMO CLASSES
            </span>

            <h2
              id="home-demo-title"
              className="mt-4 sm:mt-5 text-[24px] xs:text-[27px] font-black leading-[1.18] sm:leading-[1.14] tracking-[-0.03em] text-[#152b45] sm:text-[33px] lg:text-[38px]"
            >
              Experience Our
              <br className="hidden xs:block" />
              {' '}Teaching, <span className="text-[#166534]">Before You Buy.</span>
            </h2>

            <p className="mt-3.5 sm:mt-4 max-w-[460px] text-[13px] xs:text-[13.5px] leading-relaxed text-[#5e7084] sm:text-[14.5px]">
              Sit in on a free demo class and see the teaching quality for yourself —
              real faculty, real questions, real doubt solving. No payment, no
              commitment. Just walk in and learn.
            </p>

            {/* Feature items */}
            <ul className="mt-6 sm:mt-7 grid grid-cols-1 xs:grid-cols-2 gap-2.5 sm:gap-3">
              {FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="group flex items-center gap-3 rounded-2xl border border-slate-100/80 xs:border-transparent bg-slate-50/50 xs:bg-transparent p-2.5 xs:p-1 transition-colors duration-200 hover:border-[#d9e3ed] hover:bg-[#f3f8fc]"
                >
                  <span
                    className={`flex h-9 w-9 sm:h-10 sm:w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${feature.box}`}
                    aria-hidden="true"
                  >
                    {feature.icon}
                  </span>
                  <span className="text-[12.5px] sm:text-[13px] font-semibold leading-snug text-[#152b45] sm:text-[13.5px]">
                    {feature.title}
                  </span>
                </li>
              ))}
            </ul>

            {/* Action */}
            <div className="mt-6 sm:mt-8">
              <Link
                href="/demo-class"
                className="inline-flex min-h-[48px] w-full sm:w-auto items-center justify-center gap-3 rounded-full sm:rounded-[10px] bg-[#0284c7] px-6 text-[13.5px] sm:text-[14px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(2,132,199,0.7)] transition-all duration-200 hover:bg-[#0369a1] hover:shadow-[0_14px_28px_-10px_rgba(2,132,199,0.75)] active:scale-[0.98] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0284c7]"
              >
                Get Free Demo Class
                <IconArrowRight size={15} aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* ── Right: visual, floating cards & annotations ────────────── */}
          <div className="relative min-h-[300px] xs:min-h-[350px] sm:min-h-[440px] lg:min-h-[540px] overflow-hidden border-t border-[#eef4f9] bg-gradient-to-br from-[#f3f8fc] via-white to-[#eef7f2] px-4 py-8 xs:px-5 xs:py-10 sm:px-8 sm:py-12 lg:border-l lg:border-t-0 lg:px-6 lg:py-0">
            {/* soft decorative glows */}
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-emerald-100/50 blur-3xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-12 -left-10 h-56 w-56 rounded-full bg-blue-100/50 blur-3xl"
              aria-hidden="true"
            />

            <div className="relative flex h-full items-center justify-center py-4 xs:py-6 sm:py-0">
              <img
                src="/demo.png"
                alt="A live MakeMeTopper demo class in progress"
                className="h-auto w-[82%] xs:w-[86%] max-w-[320px] xs:max-w-[380px] sm:max-w-[430px] rounded-2xl object-contain drop-shadow-[0_20px_35px_rgba(21,43,69,0.16)]"
                loading="lazy"
              />
            </div>

            {/* Floating card — Live Demo Class */}
            <div className="absolute left-3 top-4 xs:left-4 xs:top-6 sm:left-6 sm:top-8 flex items-center gap-2 xs:gap-3 rounded-xl xs:rounded-2xl border border-[#e4ecf3] bg-white/95 px-2.5 py-2 xs:px-3.5 xs:py-3 shadow-[0_10px_24px_-12px_rgba(21,43,69,0.3)] backdrop-blur transition-transform duration-300 hover:-translate-y-1">
              <span className="relative flex h-2 w-2 xs:h-2.5 xs:w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-2 w-2 xs:h-2.5 xs:w-2.5 rounded-full bg-[#166534]" />
              </span>
              <div>
                <p className="text-[10.5px] xs:text-[11.5px] sm:text-[12.5px] font-bold leading-tight text-[#152b45]">
                  Live Demo Class
                </p>
                <p className="text-[9px] xs:text-[10px] sm:text-[10.5px] leading-tight text-[#5e7084]">
                  Learn · Experience · Decide
                </p>
              </div>
            </div>

            {/* Floating checklist card */}
            <ul className="absolute bottom-4 right-3 xs:bottom-6 xs:right-4 sm:bottom-10 sm:right-6 w-[150px] xs:w-[175px] sm:w-[196px] space-y-2 xs:space-y-2.5 rounded-xl xs:rounded-2xl border border-[#e4ecf3] bg-white/95 px-3 py-2.5 xs:px-4 xs:py-3.5 shadow-[0_14px_30px_-14px_rgba(21,43,69,0.35)] backdrop-blur transition-transform duration-300 hover:-translate-y-1">
              {CHECKLIST.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-1.5 xs:gap-2 text-[10px] xs:text-[11px] sm:text-[12px] font-medium text-[#152b45]"
                >
                  <IconCheckCircle
                    size={14}
                    className="shrink-0 text-[#166534]"
                    aria-hidden="true"
                  />
                  {item}
                </li>
              ))}
            </ul>

            {/* Handwritten annotations */}
            <span
              className="pointer-events-none absolute right-6 top-[42%] hidden max-w-[150px] -rotate-3 text-[15px] leading-snug text-[#166534] sm:block lg:text-[17px]"
              style={HAND_FONT}
            >
              Same Teachers,
              <br />
              Same Quality
              <svg
                className="mt-1 block h-2 w-24 text-[#166534]/60"
                viewBox="0 0 96 8"
                fill="none"
                aria-hidden="true"
              >
                <path
                  d="M1 5c14-4 30-5 46-3 12 1.5 26 2 48 0"
                  stroke="currentColor"
                  strokeWidth="1.6"
                  strokeLinecap="round"
                />
              </svg>
            </span>

            <span
              className="pointer-events-none absolute bottom-6 left-6 hidden max-w-[150px] rotate-2 text-[15px] leading-snug text-[#0284c7] sm:block lg:text-[17px]"
              style={HAND_FONT}
            >
              No Commitment,
              <br />
              Just Learning
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
