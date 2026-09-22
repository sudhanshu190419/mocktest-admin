'use client';

import React from 'react';
import { GraduationCap, FileText, UserSound } from '@phosphor-icons/react';

export function AppShowcaseSection() {
  const features = [
    {
      icon: <GraduationCap size={23} weight="fill" className="text-blue-600" />,
      bg: 'bg-blue-50',
      title: 'Expert-Led Courses',
      desc: 'Learn concepts with structured, focused courses.',
    },
    {
      icon: <FileText size={23} weight="fill" className="text-emerald-500" />,
      bg: 'bg-emerald-50',
      title: 'Mock Tests',
      desc: 'Practice under exam-like conditions and track your score.',
    },
    {
      icon: <FileText size={23} weight="fill" className="text-amber-500" />,
      bg: 'bg-amber-50',
      title: 'PYQ Practice',
      desc: 'Solve previous-year questions and understand every mistake.',
    },
    {
      icon: <UserSound size={23} weight="fill" className="text-rose-500" />,
      bg: 'bg-rose-50',
      title: 'Live Classes',
      desc: 'Learn directly from teachers and ask questions in real time.',
    },
  ];

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 sm:py-16 lg:py-20 overflow-hidden">
      <div className="grid lg:grid-cols-2 gap-10 lg:gap-16 items-center">
        {/* Left Column: Eyebrow, Heading, Description, Feature Cards & Download Action */}
        <div className="order-2 lg:order-1 space-y-5 sm:space-y-6">
          {/* Eyebrow with blue dash */}
          <div className="flex items-center gap-3">
            <span className="w-7 h-[2.5px] bg-blue-600 rounded-full shrink-0" aria-hidden="true" />
            <span className="text-[11px] sm:text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
              Your preparation, all in one place
            </span>
          </div>

          {/* Heading */}
          <h2 className="text-3xl sm:text-4xl lg:text-[38px] font-black text-slate-900 tracking-tight leading-[1.15]">
            Everything you need to <br className="hidden sm:block" />
            prepare smarter.
          </h2>

          {/* Subtitle */}
          <p className="text-slate-500 text-sm sm:text-[15px] font-normal leading-relaxed max-w-lg">
            Courses, mock tests, PYQs and live classes — built to help you learn, practice and improve in one place.
          </p>

          {/* 4 Feature Cards */}
          <div className="space-y-3 pt-1">
            {features.map((item) => (
              <div
                key={item.title}
                className="flex items-center gap-4 px-4 py-3 sm:px-5 sm:py-3.5 bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md transition-all"
              >
                <div
                  className={`w-11 h-11 sm:w-12 sm:h-12 rounded-xl flex items-center justify-center shrink-0 ${item.bg}`}
                >
                  {item.icon}
                </div>
                <div>
                  <h3 className="font-bold text-slate-900 text-base sm:text-[16.5px] leading-tight">{item.title}</h3>
                  <p className="text-slate-500 text-xs sm:text-[13px] font-normal leading-relaxed mt-0.5">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom Download Action */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-4 pt-1">
            <a
              href="https://play.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-3 bg-black text-white px-5 py-2.5 rounded-xl hover:bg-neutral-900 transition-all shadow-md shrink-0 w-fit"
            >
              <svg className="w-6 h-6 shrink-0" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M3.61 1.81L13.1 11.3 3.61 20.79c-.36-.37-.61-.91-.61-1.57V3.38c0-.66.25-1.2.61-1.57z"
                />
                <path
                  fill="#0F9D58"
                  d="M16.48 14.68l-3.38-3.38-9.49 9.49c.47.16 1 .1 1.48-.17l11.39-5.94z"
                />
                <path
                  fill="#FFCA28"
                  d="M20.21 11.16l-3.73-1.95-3.38 3.39 3.38 3.38 3.73-1.95c.78-.41.78-1.46 0-1.87z"
                />
                <path
                  fill="#DB4437"
                  d="M3.61 1.81l9.49 9.49 3.38-3.38-11.39-5.94c-.48-.27-1.01-.33-1.48-.17z"
                />
              </svg>
              <div className="text-left leading-none">
                <div className="text-[9px] uppercase tracking-wider text-slate-300 font-medium">
                  GET IT ON
                </div>
                <div className="text-[15px] font-bold text-white tracking-tight mt-0.5">
                  Google Play
                </div>
              </div>
            </a>
            <div className="text-slate-500 text-xs sm:text-sm leading-snug">
              Download the <span className="font-semibold text-slate-800">MakeMeTopper</span> app <br />
              and start your preparation today.
            </div>
          </div>
        </div>

        {/* Right Column: Phone Mockup with concentric rings & glow (Untouched) */}
        <div className="order-1 lg:order-2 relative flex justify-center mt-8 lg:mt-0">
          {/* Subtle Glow Backdrop */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-64 h-64 sm:w-80 sm:h-80 bg-orange-100 rounded-full blur-2xl -z-10" />

          <div className="relative flex justify-center items-center">
            {/* Concentric Decorative Rings */}
            <div className="absolute w-[240px] h-[240px] sm:w-[320px] sm:h-[320px] rounded-full border border-orange-200 pointer-events-none" />
            <div className="absolute w-[300px] h-[300px] sm:w-[440px] sm:h-[440px] rounded-full border border-orange-100 hidden sm:block pointer-events-none" />
            <div className="absolute w-[140px] h-[140px] sm:w-[200px] sm:h-[200px] rounded-full bg-orange-300/30 blur-3xl pointer-events-none" />

            {/* Realistic iPhone Device Frame */}
            <div className="relative w-[220px] h-[440px] sm:w-[250px] sm:h-[500px] md:w-[270px] md:h-[540px] rounded-[36px] sm:rounded-[40px] md:rounded-[44px] p-[8px] sm:p-[9px] md:p-[10px] bg-gradient-to-br from-stone-800 to-stone-950 shadow-[0_30px_60px_rgba(0,0,0,0.25)] sm:shadow-[0_40px_80px_rgba(0,0,0,0.35)] animate-[float_5s_ease-in-out_infinite]">
              {/* Inner Screen Display */}
              <div className="w-full h-full rounded-[30px] sm:rounded-[36px] overflow-hidden bg-black relative">
                <img
                  src="/phone.png"
                  alt="App Preview"
                  className="w-full h-full object-cover object-top"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
              </div>

              {/* Dynamic Island / Top Notch */}
              <div className="absolute top-[10px] left-1/2 -translate-x-1/2 w-[90px] sm:w-[110px] h-[20px] sm:h-[22px] bg-stone-950 rounded-b-2xl z-20" />

              {/* Side Buttons (Power & Volume) */}
              <div className="absolute right-[-3px] top-[90px] sm:top-[100px] w-[3px] h-[46px] sm:h-[56px] bg-stone-800 rounded-r-md" />
              <div className="absolute left-[-3px] top-[80px] sm:top-[88px] w-[3px] h-[30px] sm:h-[36px] bg-stone-800 rounded-l-md" />
              <div className="absolute left-[-3px] top-[120px] sm:top-[136px] w-[3px] h-[30px] sm:h-[36px] bg-stone-800 rounded-l-md" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
