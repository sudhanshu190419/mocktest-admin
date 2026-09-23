'use client';

import React from 'react';
import Link from 'next/link';
import Image from 'next/image';
import {
  ArrowUp,
  InstagramLogo,
  YoutubeLogo,
  LinkedinLogo,
  XLogo,
} from '@phosphor-icons/react';

export function SiteFooter() {
  const currentYear = new Date().getFullYear();

  const scrollToTop = () => {
    if (typeof window !== 'undefined') {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    }
  };

  return (
    <footer className="w-full bg-[#f8fafc] border-t border-slate-200/70 pt-12 mt-16 font-sans">
      <div className="w-full max-w-[1480px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-16">
        {/* ── 1. Main 5-Column Grid (Horizontally Stretched) ──────────── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-12 gap-8 lg:gap-10 pb-12">
          {/* Column 1: Brand Info (lg:col-span-4) */}
          <div className="sm:col-span-2 lg:col-span-4 pr-0 lg:pr-8">
            <Link href="/" className="inline-block mb-3.5" aria-label="Make Me Topper Home">
              <Image
                src="/brand/logo-primary-horizontal.svg"
                alt="Make Me Topper"
                width={180}
                height={42}
                className="h-9 w-auto object-contain"
              />
            </Link>
            <p className="text-xs text-slate-500 leading-relaxed mb-6 max-w-sm">
              Make Me Topper is your complete learning platform for NEET, JEE and other competitive exams. Learn from expert faculty, practice with real exam papers, and move closer to your dreams.
            </p>
            {/* Social Icons */}
            <div className="flex items-center gap-2.5">
              <a
                href="https://instagram.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="Instagram"
                className="w-8 h-8 rounded-full border border-slate-200 hover:border-sky-300 hover:text-sky-600 text-slate-600 flex items-center justify-center transition-colors bg-white shadow-2xs"
              >
                <InstagramLogo size={16} weight="bold" />
              </a>
              <a
                href="https://youtube.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="YouTube"
                className="w-8 h-8 rounded-full border border-slate-200 hover:border-sky-300 hover:text-sky-600 text-slate-600 flex items-center justify-center transition-colors bg-white shadow-2xs"
              >
                <YoutubeLogo size={16} weight="bold" />
              </a>
              <a
                href="https://linkedin.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="LinkedIn"
                className="w-8 h-8 rounded-full border border-slate-200 hover:border-sky-300 hover:text-sky-600 text-slate-600 flex items-center justify-center transition-colors bg-white shadow-2xs"
              >
                <LinkedinLogo size={16} weight="bold" />
              </a>
              <a
                href="https://twitter.com"
                target="_blank"
                rel="noopener noreferrer"
                aria-label="X"
                className="w-8 h-8 rounded-full border border-slate-200 hover:border-sky-300 hover:text-sky-600 text-slate-600 flex items-center justify-center transition-colors bg-white shadow-2xs"
              >
                <XLogo size={15} weight="bold" />
              </a>
            </div>
            <p className="text-[11px] text-slate-400 mt-4 italic">
              — Together for a brighter tomorrow.
            </p>
          </div>

          {/* Column 2: Quick Links (lg:col-span-2) */}
          <div className="lg:col-span-2">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 mb-3.5">Quick Links</h4>
            <ul className="space-y-2.5 text-xs text-slate-600">
              <li><Link href="/" className="hover:text-sky-600 transition-colors">Home</Link></li>
              <li><Link href="/courses" className="hover:text-sky-600 transition-colors">Courses</Link></li>
              <li><Link href="/student/tests" className="hover:text-sky-600 transition-colors">Mock Tests</Link></li>
              <li><Link href="/courses" className="hover:text-sky-600 transition-colors">PYQ Packages</Link></li>
              <li><Link href="/student/classes" className="hover:text-sky-600 transition-colors">Live Classes</Link></li>
              <li><Link href="#" className="hover:text-sky-600 transition-colors">Blog</Link></li>
              <li><Link href="/student/overview" className="hover:text-sky-600 transition-colors">My Learning</Link></li>
            </ul>
          </div>

          {/* Column 3: Popular Exams (lg:col-span-2) */}
          <div className="lg:col-span-2">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 mb-3.5">Popular Exams</h4>
            <ul className="space-y-2.5 text-xs text-slate-600">
              <li><Link href="/courses?stream=NEET" className="hover:text-sky-600 transition-colors">NEET</Link></li>
              <li><Link href="/courses?stream=JEE" className="hover:text-sky-600 transition-colors">JEE</Link></li>
              <li><Link href="/courses?stream=CUET" className="hover:text-sky-600 transition-colors">CUET</Link></li>
              <li><Link href="/courses?stream=UPSC" className="hover:text-sky-600 transition-colors">UPSC</Link></li>
              <li><Link href="/courses?stream=Foundation" className="hover:text-sky-600 transition-colors">Foundation (Class 8–10)</Link></li>
              <li><Link href="/courses" className="hover:text-sky-600 transition-colors">All Exams</Link></li>
            </ul>
          </div>

          {/* Column 4: Support (lg:col-span-2) */}
          <div className="lg:col-span-2">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 mb-3.5">Support</h4>
            <ul className="space-y-2.5 text-xs text-slate-600">
              <li><Link href="/student/doubts" className="hover:text-sky-600 transition-colors">Help Center</Link></li>
              <li><Link href="/contact" className="hover:text-sky-600 transition-colors">Contact Us</Link></li>
              <li><Link href="/courses#faq" className="hover:text-sky-600 transition-colors">FAQs</Link></li>
              <li><Link href="#" className="hover:text-sky-600 transition-colors">Privacy Policy</Link></li>
              <li><Link href="#" className="hover:text-sky-600 transition-colors">Terms & Conditions</Link></li>
              <li><Link href="#" className="hover:text-sky-600 transition-colors">Refund Policy</Link></li>
            </ul>
          </div>

          {/* Column 5: Download Our App (lg:col-span-2) */}
          <div className="sm:col-span-2 lg:col-span-2">
            <h4 className="text-xs sm:text-sm font-bold text-slate-900 mb-1.5">Download Our App</h4>
            <p className="text-xs text-slate-500 leading-relaxed mb-4">
              Learn on the go. Available now on Android.
            </p>
            {/* Google Play Only */}
            <div>
              <a
                href="#"
                className="inline-flex items-center gap-2.5 px-3.5 py-2 rounded-xl bg-black text-white hover:bg-slate-800 transition-colors shadow-2xs"
              >
                <svg className="w-5 h-5 fill-current shrink-0" viewBox="0 0 24 24">
                  <path d="M3.609 1.814L13.792 12 3.61 22.186a2.38 2.38 0 0 1-.61-.986V2.8a2.38 2.38 0 0 1 .61-.986zm11.3 9.066l2.36-2.36-12.43-7.17a2.23 2.23 0 0 1 1.15-.31c.6 0 1.2.22 1.69.5l7.23 4.18 0-.01.03.02 0 .01 0 .01.03.02 0 .01-.06.01-.01.08zm2.36 4.62l-2.36-2.36.06.07-.03.02 0 .01-.03.02 0 .01-7.23 4.18c-.49.28-1.09.5-1.69.5a2.23 2.23 0 0 1-1.15-.31l12.43-7.17zm1.13-1.13l2.87-1.66a1.65 1.65 0 0 0 0-2.86l-2.87-1.66-2.57 2.59 2.57 2.59z" />
                </svg>
                <div className="text-left leading-none">
                  <div className="text-[8px] uppercase tracking-wider text-slate-300 font-medium">GET IT ON</div>
                  <div className="text-xs font-bold font-sans mt-0.5">Google Play</div>
                </div>
              </a>
            </div>
          </div>
        </div>

        {/* ── 2. Bottom Copyright & Utility Bar ──────────────────────── */}
        <div className="border-t border-slate-200/80 py-6 flex flex-col sm:flex-row items-center justify-between gap-4 text-xs text-slate-500">
          <p>© {currentYear} Make Me Topper. All rights reserved.</p>

          <div className="flex flex-wrap items-center gap-4 sm:gap-6">
            <div className="flex items-center gap-2 font-medium text-slate-500 text-[11px] sm:text-xs">
              <span>Dream</span>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
              <span>Learn</span>
              <span className="w-1.5 h-1.5 rounded-full bg-sky-500" />
              <span>Practice</span>
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
              <span>Achieve</span>
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
            </div>

            <div className="hidden sm:block w-px h-3.5 bg-slate-300" />

            <button
              type="button"
              onClick={scrollToTop}
              className="inline-flex items-center gap-1.5 font-semibold text-slate-700 hover:text-sky-600 transition-colors cursor-pointer"
            >
              <ArrowUp size={13} weight="bold" />
              <span>Back to top</span>
            </button>
          </div>
        </div>
      </div>
    </footer>
  );
}
