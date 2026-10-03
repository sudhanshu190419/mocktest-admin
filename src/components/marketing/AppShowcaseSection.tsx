'use client';

import React from 'react';
import {
  IconGraduationCap,
  IconFileText,
  IconMicrophone,
  IconSpark,
} from '@/components/icons/student-icons';

export function AppShowcaseSection() {
  const features = [
    {
      icon: <IconGraduationCap size={22} className="text-blue-600" />,
      bg: 'bg-blue-50 border-blue-100/60',
      title: 'Expert-Led Courses',
      desc: 'Learn concepts with structured, focused courses.',
    },
    {
      icon: <IconFileText size={22} className="text-emerald-500" />,
      bg: 'bg-emerald-50 border-emerald-100/60',
      title: 'Mock Tests',
      desc: 'Practice under exam-like conditions and track your score.',
    },
    {
      icon: <IconFileText size={22} className="text-amber-500" />,
      bg: 'bg-amber-50 border-amber-100/60',
      title: 'PYQ Practice',
      desc: 'Solve previous-year questions and understand every mistake.',
    },
    {
      icon: <IconMicrophone size={22} className="text-rose-500" />,
      bg: 'bg-rose-50 border-rose-100/60',
      title: 'Live Classes',
      desc: 'Learn directly from teachers and ask questions in real time.',
    },
  ];

  return (
    <section className="max-w-6xl mx-auto px-4 sm:px-6 py-8 sm:py-16 lg:py-20 overflow-hidden">
      <div className="grid lg:grid-cols-2 gap-8 sm:gap-12 lg:gap-16 items-center">
        {/* Text, Heading, Feature Cards & Download Action */}
        <div className="order-1 lg:order-1 space-y-4 sm:space-y-6">
          {/* Eyebrow with blue dash */}
          <div className="flex items-center gap-2.5 sm:gap-3">
            <span className="w-6 sm:w-7 h-[2.5px] bg-blue-600 rounded-full shrink-0" aria-hidden="true" />
            <span className="text-[11px] sm:text-xs font-bold tracking-[0.14em] text-slate-500 uppercase">
              Your preparation, all in one place
            </span>
          </div>

          {/* Heading */}
          <h2 className="text-[26px] xs:text-[30px] sm:text-4xl lg:text-[38px] font-black text-slate-900 tracking-tight leading-[1.2] sm:leading-[1.15]">
            Everything you need to <br className="hidden sm:block" />
            prepare smarter.
          </h2>

          {/* Subtitle */}
          <p className="text-slate-500 text-[13px] xs:text-sm sm:text-[15px] font-normal leading-relaxed max-w-lg">
            Courses, mock tests, PYQs and live classes — built to help you learn, practice and improve in one place.
          </p>

          {/* 4 Feature Cards */}
          <div className="space-y-2.5 sm:space-y-3 pt-1">
            {features.map((item) => (
              <div
                key={item.title}
                className="flex items-center gap-3.5 sm:gap-4 p-3.5 sm:px-5 sm:py-3.5 bg-white rounded-2xl border border-slate-100 shadow-[0_2px_8px_rgba(0,0,0,0.03)] hover:shadow-md transition-all active:scale-[0.99]"
              >
                <div
                  className={`w-10 h-10 sm:w-12 sm:h-12 rounded-xl border flex items-center justify-center shrink-0 ${item.bg}`}
                >
                  {item.icon}
                </div>
                <div className="min-w-0">
                  <h3 className="font-bold text-slate-900 text-[14.5px] sm:text-[16.5px] leading-tight truncate xs:whitespace-normal">
                    {item.title}
                  </h3>
                  <p className="text-slate-500 text-[11.5px] sm:text-[13px] font-normal leading-relaxed mt-0.5">
                    {item.desc}
                  </p>
                </div>
              </div>
            ))}
          </div>

          {/* Bottom Download Action */}
          <div className="flex flex-col sm:flex-row sm:items-center gap-3.5 sm:gap-4 pt-1 sm:pt-2">
            <a
              href="https://play.google.com"
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center justify-center sm:justify-start gap-3 bg-black text-white px-5 py-2.5 rounded-xl hover:bg-neutral-900 active:scale-[0.98] transition-all shadow-md shrink-0 w-full sm:w-fit"
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
            <div className="text-slate-500 text-xs sm:text-sm leading-snug text-center sm:text-left">
              Download the <span className="font-semibold text-slate-800">MakeMeTopper</span> app <br className="hidden xs:inline" />
              and start your preparation today.
            </div>
          </div>
        </div>

        {/* Right Column: Phone Mockup with concentric rings & glow (Desktop identical, mobile optimized) */}
        <div className="order-2 lg:order-2 relative flex justify-center mt-4 sm:mt-8 lg:mt-0">
          {/* Subtle Glow Backdrop */}
          <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-52 h-52 sm:w-80 sm:h-80 bg-orange-100 rounded-full blur-2xl -z-10" />

          <div className="relative flex justify-center items-center">
            {/* Concentric Decorative Rings */}
            <div className="absolute w-[210px] h-[210px] sm:w-[320px] sm:h-[320px] rounded-full border border-orange-200 pointer-events-none" />
            <div className="absolute w-[280px] h-[280px] sm:w-[440px] sm:h-[440px] rounded-full border border-orange-100 hidden sm:block pointer-events-none" />
            <div className="absolute w-[130px] h-[130px] sm:w-[200px] sm:h-[200px] rounded-full bg-orange-300/30 blur-3xl pointer-events-none" />

            {/* Realistic iPhone Device Frame */}
            <div className="relative w-[210px] h-[420px] sm:w-[250px] sm:h-[500px] md:w-[270px] md:h-[540px] rounded-[34px] sm:rounded-[40px] md:rounded-[44px] p-[8px] sm:p-[9px] md:p-[10px] bg-gradient-to-br from-stone-800 to-stone-950 shadow-[0_20px_40px_rgba(0,0,0,0.2)] sm:shadow-[0_40px_80px_rgba(0,0,0,0.35)] transform-gpu animate-[float_5s_ease-in-out_infinite]">
              {/* Inner Screen Display */}
              <div className="w-full h-full rounded-[28px] sm:rounded-[36px] overflow-hidden bg-black relative">
                <img
                  src="/phone.png"
                  alt="App Preview"
                  className="w-full h-full object-cover object-top"
                />
                <div className="absolute inset-0 bg-gradient-to-br from-white/10 to-transparent pointer-events-none" />
              </div>

              {/* Dynamic Island / Top Notch */}
              <div className="absolute top-[8px] sm:top-[10px] left-1/2 -translate-x-1/2 w-[80px] sm:w-[110px] h-[18px] sm:h-[22px] bg-stone-950 rounded-b-2xl z-20" />

              {/* Side Buttons (Power & Volume) */}
              <div className="absolute right-[-3px] top-[80px] sm:top-[100px] w-[3px] h-[40px] sm:h-[56px] bg-stone-800 rounded-r-md" />
              <div className="absolute left-[-3px] top-[70px] sm:top-[88px] w-[3px] h-[26px] sm:h-[36px] bg-stone-800 rounded-l-md" />
              <div className="absolute left-[-3px] top-[105px] sm:top-[136px] w-[3px] h-[26px] sm:h-[36px] bg-stone-800 rounded-l-md" />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
