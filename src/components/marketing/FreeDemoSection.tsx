'use client';

import React from 'react';
import Link from 'next/link';
import {
  VideoCamera,
  Broadcast,
  Exam,
  ChatCircleDots,
  BookOpen,
  CheckCircle,
  ArrowRight,
} from '@phosphor-icons/react';

const FEATURES = [
  {
    title: 'Live Teaching Experience',
    icon: <Broadcast size={18} weight="fill" />,
    box: 'bg-sky-50 text-[#0284c7]',
  },
  {
    title: 'Real Exam Questions',
    icon: <Exam size={18} weight="fill" />,
    box: 'bg-amber-50 text-amber-500',
  },
  {
    title: 'Doubt Solving in Real Time',
    icon: <ChatCircleDots size={18} weight="fill" />,
    box: 'bg-rose-50 text-rose-500',
  },
  {
    title: 'Understand Our Teaching Style',
    icon: <BookOpen size={18} weight="fill" />,
    box: 'bg-emerald-50 text-[#166534]',
  },
];

const CHECKLIST = ['Live Classes', 'Real Doubt Solving', 'Actual Study Material'];

const HAND_FONT = {
  fontFamily: '"Segoe Script", "Bradley Hand", "Comic Sans MS", cursive',
} as const;

export function FreeDemoSection() {
  return (
    <section
      className="store-container mb-[72px] mt-4"
      aria-labelledby="home-demo-title"
    >
      <div className="overflow-hidden rounded-[26px] border border-[#d9e3ed] bg-white shadow-[0_20px_50px_-24px_rgba(21,43,69,0.22)]">
        <div className="grid items-stretch lg:grid-cols-[1.05fr_1fr]">
          {/* ── Left: copy, features & actions ─────────────────────────── */}
          <div className="flex flex-col justify-center px-6 py-10 sm:px-10 sm:py-12 lg:py-16 lg:pl-14 lg:pr-10">
            <span className="inline-flex w-fit items-center gap-2 rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1.5 text-[10px] font-bold tracking-[0.16em] text-[#166534] sm:text-[11px]">
              <VideoCamera size={14} weight="fill" aria-hidden="true" />
              FREE DEMO CLASSES
            </span>

            <h2
              id="home-demo-title"
              className="mt-5 text-[27px] font-black leading-[1.14] tracking-[-0.03em] text-[#152b45] sm:text-[33px] lg:text-[38px]"
            >
              Experience Our
              <br />
              Teaching, <span className="text-[#166534]">Before You Buy.</span>
            </h2>

            <p className="mt-4 max-w-[460px] text-[13.5px] leading-relaxed text-[#5e7084] sm:text-[14.5px]">
              Sit in on a free demo class and see the teaching quality for yourself —
              real faculty, real questions, real doubt solving. No payment, no
              commitment. Just walk in and learn.
            </p>

            {/* Feature items */}
            <ul className="mt-7 grid gap-3 sm:grid-cols-2">
              {FEATURES.map((feature) => (
                <li
                  key={feature.title}
                  className="group flex items-center gap-3 rounded-2xl border border-transparent px-1 py-1 transition-colors duration-200 hover:border-[#d9e3ed] hover:bg-[#f3f8fc]"
                >
                  <span
                    className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-transform duration-200 group-hover:scale-105 ${feature.box}`}
                    aria-hidden="true"
                  >
                    {feature.icon}
                  </span>
                  <span className="text-[13px] font-semibold leading-snug text-[#152b45] sm:text-[13.5px]">
                    {feature.title}
                  </span>
                </li>
              ))}
            </ul>

            {/* Action */}
            <div className="mt-8">
              <Link
                href="/demo-class"
                className="inline-flex min-h-[48px] w-full items-center justify-center gap-3 rounded-[10px] bg-[#0284c7] px-6 text-[13.5px] font-semibold text-white shadow-[0_10px_24px_-10px_rgba(2,132,199,0.7)] transition-all duration-200 hover:bg-[#0369a1] hover:shadow-[0_14px_28px_-10px_rgba(2,132,199,0.75)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#0284c7] sm:w-auto"
              >
                Get Free Demo Class
                <ArrowRight size={15} weight="bold" aria-hidden="true" />
              </Link>
            </div>
          </div>

          {/* ── Right: visual, floating cards & annotations ────────────── */}
          <div className="relative min-h-[380px] overflow-hidden border-t border-[#eef4f9] bg-gradient-to-br from-[#f3f8fc] via-white to-[#eef7f2] px-5 py-10 sm:min-h-[440px] sm:px-8 sm:py-12 lg:min-h-[540px] lg:border-l lg:border-t-0 lg:px-6 lg:py-0">
            {/* soft decorative glows */}
            <div
              className="pointer-events-none absolute -right-10 -top-10 h-56 w-56 rounded-full bg-emerald-100/50 blur-3xl"
              aria-hidden="true"
            />
            <div
              className="pointer-events-none absolute -bottom-12 -left-10 h-56 w-56 rounded-full bg-blue-100/50 blur-3xl"
              aria-hidden="true"
            />

            <div className="relative flex h-full items-center justify-center">
              <img
                src="/demo.png"
                alt="A live MakeMeTopper demo class in progress"
                className="h-[80%] w-[86%] max-w-[430px] rounded-2xl object-contain drop-shadow-[0_24px_40px_rgba(21,43,69,0.18)]"
                loading="lazy"
              />
            </div>

            {/* Floating card — Live Demo Class */}
            <div className="absolute left-4 top-6 flex items-center gap-3 rounded-2xl border border-[#e4ecf3] bg-white/95 px-3.5 py-3 shadow-[0_12px_28px_-14px_rgba(21,43,69,0.35)] backdrop-blur transition-transform duration-300 hover:-translate-y-1 sm:left-6 sm:top-8">
              <span className="relative flex h-2.5 w-2.5 shrink-0" aria-hidden="true">
                <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-400/60" />
                <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-[#166534]" />
              </span>
              <div>
                <p className="text-[11.5px] font-bold leading-tight text-[#152b45] sm:text-[12.5px]">
                  Live Demo Class
                </p>
                <p className="text-[10px] leading-tight text-[#5e7084] sm:text-[10.5px]">
                  Learn · Experience · Decide
                </p>
              </div>
            </div>

            {/* Floating checklist card */}
            <ul className="absolute bottom-8 right-4 w-[178px] space-y-2.5 rounded-2xl border border-[#e4ecf3] bg-white/95 px-4 py-3.5 shadow-[0_16px_34px_-16px_rgba(21,43,69,0.4)] backdrop-blur transition-transform duration-300 hover:-translate-y-1 sm:right-6 sm:bottom-10 sm:w-[196px]">
              {CHECKLIST.map((item) => (
                <li
                  key={item}
                  className="flex items-center gap-2 text-[11px] font-medium text-[#152b45] sm:text-[12px]"
                >
                  <CheckCircle
                    size={15}
                    weight="fill"
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
