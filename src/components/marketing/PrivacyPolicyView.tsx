'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  ShieldCheck,
  LockKey,
  UserCheck,
  CreditCard,
  BellSimple,
  Microphone,
  DeviceMobile,
  Database,
  Trash,
  CheckCircle,
  EnvelopeSimple,
  PhoneCall,
  MapPin,
  CaretRight,
  ArrowSquareOut,
  Sparkle,
} from '@phosphor-icons/react';

const SECTIONS = [
  { id: 'introduction', title: '1. Introduction & Academic Scope' },
  { id: 'data-collection', title: '2. Information We Collect & Process' },
  { id: 'realtime-audio', title: '3. Real-Time Audio & Live Classes' },
  { id: 'data-usage', title: '4. How We Use Student Data' },
  { id: 'third-parties', title: '5. Third-Party Service Providers' },
  { id: 'permissions', title: '6. Android Device Permissions' },
  { id: 'security', title: '7. Data Protection & Security' },
  { id: 'retention', title: '8. Data Retention & Financial Records' },
  { id: 'deletion', title: '9. Account & Data Deletion Procedures' },
  { id: 'student-rights', title: '10. Student Rights & Control' },
  { id: 'target-audience', title: '11. Target Audience & Eligibility' },
  { id: 'grievance', title: '12. Grievance Officer & Contact Information' },
];

export function PrivacyPolicyView() {
  const [activeSection, setActiveSection] = useState('introduction');

  const scrollToSection = (id: string) => {
    setActiveSection(id);
    const element = document.getElementById(id);
    if (element) {
      element.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  };

  return (
    <div className="min-h-screen bg-slate-50/60 pb-20">
      {/* ── Top Hero Header ────────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-gradient-to-b from-sky-900 via-sky-800 to-slate-900 text-white pt-14 pb-16 px-4 sm:px-6 lg:px-8">
        <div className="absolute inset-0 opacity-10 bg-[radial-gradient(#38bdf8_1px,transparent_1px)] [background-size:16px_16px] pointer-events-none" />
        
        <div className="max-w-5xl mx-auto relative z-10 text-center">
          <div className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-full bg-sky-500/20 border border-sky-400/30 text-sky-200 text-xs font-semibold mb-4 backdrop-blur-xs">
            <ShieldCheck size={16} weight="bold" className="text-sky-300" />
            <span>OFFICIAL PRIVACY & DATA GOVERNANCE</span>
          </div>

          <h1 className="text-3xl sm:text-4xl lg:text-5xl font-black tracking-tight text-white mb-4">
            Make Me Topper Privacy Policy
          </h1>

          <p className="text-slate-300 text-sm sm:text-base max-w-2xl mx-auto leading-relaxed">
            Transparent, student-first privacy standards for the Make Me Topper learning platform across Web and Android applications.
          </p>

          <div className="mt-6 flex flex-wrap items-center justify-center gap-4 text-xs text-slate-300">
            <span className="inline-flex items-center gap-1.5 bg-slate-800/80 px-3 py-1 rounded-md border border-slate-700">
              <strong className="text-white">Effective Date:</strong> October 2026
            </span>
            <span className="inline-flex items-center gap-1.5 bg-slate-800/80 px-3 py-1 rounded-md border border-slate-700">
              <strong className="text-white">Canonical URL:</strong> makemetopper.com/privacy-policy
            </span>
            <span className="inline-flex items-center gap-1.5 bg-slate-800/80 px-3 py-1 rounded-md border border-slate-700">
              <strong className="text-white">Package:</strong> com.makemetopper.app
            </span>
          </div>
        </div>
      </section>

      {/* ── Key Highlights Cards ────────────────────────────────────────── */}
      <section className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 -mt-8 relative z-20">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-3">
                <CheckCircle size={22} weight="bold" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Zero Ads & Trackers</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                We do not sell student data, serve third-party ads, or use third-party behavioral ad trackers.
              </p>
            </div>
            <span className="text-[11px] font-semibold text-emerald-700 mt-3 inline-block">
              100% Ad-Free Learning
            </span>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-3">
                <LockKey size={22} weight="bold" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Class 8+ Academic Scope</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Designed for secondary, senior-secondary, and competitive exam aspirants (NEET, JEE, CUET, Foundation).
              </p>
            </div>
            <span className="text-[11px] font-semibold text-sky-700 mt-3 inline-block">
              Age & Level Appropriate
            </span>
          </div>

          <div className="bg-white rounded-2xl p-5 border border-slate-200 shadow-sm flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-3">
                <Trash size={22} weight="bold" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Full Deletion Control</h3>
              <p className="text-xs text-slate-600 leading-relaxed">
                Instant self-service account and academic data deletion available via both the mobile app and public web portal.
              </p>
            </div>
            <Link
              href="/delete-account"
              className="text-[11px] font-semibold text-purple-700 mt-3 inline-flex items-center gap-1 hover:underline"
            >
              <span>View Deletion Portal</span>
              <ArrowSquareOut size={12} weight="bold" />
            </Link>
          </div>
        </div>
      </section>

      {/* ── Main Policy Content + Sidebar Navigation ────────────────────── */}
      <div className="max-w-5xl mx-auto px-4 sm:px-6 lg:px-8 mt-10">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
          {/* Quick Jump Sidebar */}
          <aside className="hidden lg:block lg:col-span-4 sticky top-24 bg-white rounded-2xl border border-slate-200 p-4 shadow-2xs">
            <div className="flex items-center gap-2 pb-3 mb-3 border-b border-slate-100">
              <Sparkle size={16} weight="bold" className="text-sky-600" />
              <h3 className="text-xs font-bold uppercase tracking-wider text-slate-700">
                Table of Contents
              </h3>
            </div>
            <nav className="space-y-1">
              {SECTIONS.map((sec) => (
                <button
                  key={sec.id}
                  onClick={() => scrollToSection(sec.id)}
                  className={
                    'w-full text-left px-3 py-2 rounded-xl text-xs font-medium transition-all flex items-center justify-between group cursor-pointer ' +
                    (activeSection === sec.id
                      ? 'bg-sky-50 text-sky-700 font-bold'
                      : 'text-slate-600 hover:bg-slate-50 hover:text-slate-900')
                  }
                >
                  <span className="truncate pr-2">{sec.title}</span>
                  <CaretRight
                    size={12}
                    weight="bold"
                    className={
                      'shrink-0 transition-transform ' +
                      (activeSection === sec.id
                        ? 'text-sky-600 translate-x-0.5'
                        : 'text-slate-400 group-hover:translate-x-0.5')
                    }
                  />
                </button>
              ))}
            </nav>

            <div className="mt-6 pt-4 border-t border-slate-100 bg-slate-50/70 -mx-4 -mb-4 p-4 rounded-b-2xl">
              <p className="text-[11px] text-slate-500 font-medium">Need immediate assistance?</p>
              <a
                href="mailto:support@inovoxy.com"
                className="text-xs font-bold text-sky-600 hover:underline inline-block mt-0.5"
              >
                support@inovoxy.com
              </a>
            </div>
          </aside>

          {/* Policy Text Articles */}
          <main className="lg:col-span-8 bg-white rounded-2xl border border-slate-200 p-6 sm:p-8 shadow-2xs space-y-10 text-slate-700 text-sm leading-relaxed">
            
            {/* 1. Introduction */}
            <section id="introduction" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  1
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Introduction & Academic Scope
                </h2>
              </div>
              <p>
                <strong>Make Me Topper</strong> (&ldquo;we&rdquo;, &ldquo;our&rdquo;, or &ldquo;us&rdquo;) provides comprehensive digital learning tools, live interactive online lectures, recorded classes, previous years&rsquo; question (PYQ) packages, and computer-based mock test simulations for secondary and senior secondary students.
              </p>
              <div className="p-4 rounded-xl bg-sky-50/70 border border-sky-200 text-sky-950 font-medium text-xs sm:text-sm leading-relaxed">
                <strong>Target Audience:</strong> Make Me Topper is intended for students in Class 8 and above, including students preparing for examinations such as NEET, JEE, CUET, Foundation and other academic/competitive examinations.
              </div>
              <p className="text-xs text-slate-500">
                This Privacy Policy applies to our website (<Link href="https://makemetopper.com" className="text-sky-600 underline">https://makemetopper.com</Link>) and our official Android application (<code>com.makemetopper.app</code>). It governs how student data is collected, stored, processed, and deleted.
              </p>
            </section>

            {/* 2. Information We Collect & Process */}
            <section id="data-collection" className="scroll-mt-24 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  2
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Information We Collect & Process
                </h2>
              </div>
              <p>
                We collect only the information necessary to authenticate students, administer test series, calculate accurate performance analytics, deliver live lecture sessions, and fulfill course enrollments.
              </p>

              <div className="space-y-4">
                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <UserCheck size={16} className="text-sky-600" />
                    <span>A. Account & Authentication Information</span>
                  </h4>
                  <ul className="list-disc list-inside text-xs space-y-1 text-slate-600">
                    <li><strong>Mobile Phone Number:</strong> Primary account identifier (+91 format) used for account creation and login.</li>
                    <li><strong>Password Credentials:</strong> Password authentication securely hashed and encrypted by Supabase Auth (no plain-text passwords stored).</li>
                    <li><strong>SMS One-Time Passwords (OTP):</strong> Transient verification codes sent via SMS for signup validation, password recovery, and account deletion confirmation.</li>
                    <li><strong>Profile Details:</strong> Student full name, optional email address (for course and exam notifications), avatar or initials, target exam stream (NEET, JEE, CUET, Foundation, School Boards), target exam year, and grade/class.</li>
                  </ul>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <Database size={16} className="text-sky-600" />
                    <span>B. Academic, Assessment & Learning Data</span>
                  </h4>
                  <ul className="list-disc list-inside text-xs space-y-1 text-slate-600">
                    <li><strong>Mock Test Attempts & Answers:</strong> Question responses, option choices, numerical answers entered, time spent per question, review marks, and attempt timestamps.</li>
                    <li><strong>Test Results & Analytics:</strong> Calculated total scores, accuracy percentages, subject/chapter breakdown, percentiles, ranking leaderboards, and historical progress.</li>
                    <li><strong>Academic Doubts & Uploads:</strong> Text questions asked in the doubt forum, teacher replies, and student-uploaded photos or PDF documents of questions.</li>
                    <li><strong>Class Attendance:</strong> Participation timestamps and attendance records for live streaming lectures and batches.</li>
                  </ul>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <DeviceMobile size={16} className="text-sky-600" />
                    <span>C. Device & Technical Identifiers</span>
                  </h4>
                  <ul className="list-disc list-inside text-xs space-y-1 text-slate-600">
                    <li><strong>FCM Device Tokens:</strong> Firebase Cloud Messaging tokens used strictly to deliver lecture alerts, timetable updates, test reminders, and security notices.</li>
                    <li><strong>Device Sessions:</strong> Device hardware model, platform OS (Android/Web), and session UUIDs used to manage active logins and protect account security.</li>
                    <li><strong>Local Preferences:</strong> Interface language selection (English/Hindi), theme preferences, and local temporary test state cache.</li>
                  </ul>
                </div>

                <div className="bg-slate-50 rounded-xl p-4 border border-slate-200/80">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider mb-2 flex items-center gap-2">
                    <CreditCard size={16} className="text-sky-600" />
                    <span>D. Payment & Billing Metadata</span>
                  </h4>
                  <p className="text-xs text-slate-600 mb-2">
                    When purchasing courses or PYQ packages, transactions are processed by our RBI-authorized payment partner, <strong>Razorpay</strong>.
                  </p>
                  <ul className="list-disc list-inside text-xs space-y-1 text-slate-600">
                    <li><strong>Stored Metadata:</strong> Razorpay Order ID, Razorpay Payment ID, transaction date, amount paid, currency (INR), purchased tier/plan, and invoice reference.</li>
                    <li><strong>No Card/Banking Data Stored:</strong> Make Me Topper does NOT collect, store, or process credit/debit card numbers, CVVs, expiry dates, net banking passwords, or UPI PINs. All payment credential handling occurs entirely within Razorpay&rsquo;s PCI-DSS compliant infrastructure.</li>
                  </ul>
                </div>
              </div>
            </section>

            {/* 3. Real-Time Audio & Live Classes */}
            <section id="realtime-audio" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  3
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Real-Time Audio & Live Interactive Classes
                </h2>
              </div>
              <p>
                Make Me Topper offers live interactive video classes powered by <strong>LiveKit WebRTC</strong> infrastructure.
              </p>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2">
                <div className="flex items-center gap-2 text-xs font-bold text-slate-800">
                  <Microphone size={16} className="text-sky-600" />
                  <span>Microphone Processing Scope:</span>
                </div>
                <ul className="list-disc list-inside text-xs text-slate-600 space-y-1">
                  <li>Microphone audio is accessed <strong>only</strong> when the student actively unmutes during an interactive live lecture to speak with the teacher or ask questions.</li>
                  <li>Real-time audio is transmitted transiently via WebRTC directly for classroom communication.</li>
                  <li>Student microphone audio is <strong>not recorded, stored, or analyzed</strong> on Make Me Topper servers.</li>
                </ul>
              </div>
            </section>

            {/* 4. How We Use Student Data */}
            <section id="data-usage" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  4
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  How We Use Student Data
                </h2>
              </div>
              <p>We use the collected information exclusively for educational and service operations:</p>
              <ul className="list-disc list-inside space-y-1.5 text-xs text-slate-600 pl-1">
                <li>Authenticating user sessions and securing student accounts with SMS OTP verification.</li>
                <li>Administering computer-based mock exams, computing scores, and providing chapter-wise performance analytics.</li>
                <li>Delivering live interactive lectures, study material PDFs, and class timetables.</li>
                <li>Resolving student doubts, facilitating teacher-student academic discussions, and providing support.</li>
                <li>Transmitting transactional push notifications via FCM for upcoming classes, test schedules, and account security.</li>
                <li>Preventing fraudulent access, multi-device credential sharing violations, and platform abuse.</li>
              </ul>
              <p className="text-xs text-slate-500 italic pt-1">
                We never sell, rent, or trade student personal information to third parties for marketing or advertising purposes.
              </p>
            </section>

            {/* 5. Third-Party Service Providers */}
            <section id="third-parties" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  5
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Third-Party Service Providers
                </h2>
              </div>
              <p>
                We partner with specialized, industry-standard infrastructure providers strictly required to deliver our educational services:
              </p>

              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs border border-slate-200 rounded-xl overflow-hidden">
                  <thead className="bg-slate-100 text-slate-800 font-bold border-b border-slate-200">
                    <tr>
                      <th className="p-3">Partner / Infrastructure</th>
                      <th className="p-3">Purpose & Scope</th>
                      <th className="p-3">Data Processed</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-200 text-slate-600">
                    <tr>
                      <td className="p-3 font-semibold text-slate-900">Supabase</td>
                      <td className="p-3">Primary database, authentication, backend Edge Functions & encrypted file storage</td>
                      <td className="p-3">Account data, profile, test results, doubt attachments</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-slate-900">Google Firebase (FCM)</td>
                      <td className="p-3">Push notifications delivery (no Firebase Analytics or tracking used)</td>
                      <td className="p-3">FCM device push tokens</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-slate-900">Razorpay</td>
                      <td className="p-3">PCI-DSS certified payment aggregator for course purchases</td>
                      <td className="p-3">Transaction order IDs, amounts, payment timestamps</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-slate-900">LiveKit</td>
                      <td className="p-3">WebRTC real-time audio and video engine for live classes</td>
                      <td className="p-3">Transient real-time audio/video streaming during live sessions</td>
                    </tr>
                    <tr>
                      <td className="p-3 font-semibold text-slate-900">Cloudflare R2</td>
                      <td className="p-3">High-speed Content Delivery Network (CDN) for recorded lectures</td>
                      <td className="p-3">Class recording streams and static course assets</td>
                    </tr>
                  </tbody>
                </table>
              </div>

              <div className="p-3 rounded-lg bg-emerald-50 border border-emerald-200 text-emerald-900 text-xs font-medium">
                <strong>No Third-Party Trackers:</strong> Make Me Topper does NOT use third-party analytics trackers, behavioral ad pixels, social media tracking SDKs, or Crashlytics.
              </div>
            </section>

            {/* 6. Android Permissions */}
            <section id="permissions" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  6
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Android Device Permissions
                </h2>
              </div>
              <p>
                Our Android app (<code>com.makemetopper.app</code>) requests only minimal runtime permissions necessary for core educational features:
              </p>

              <div className="space-y-2.5">
                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <BellSimple size={15} className="text-sky-600" />
                    <span>POST_NOTIFICATIONS (Android 13+)</span>
                  </div>
                  <p className="text-slate-600 mt-1">
                    Used to send class timetable reminders, test commencement notices, doubt responses, and account alerts. Users can disable notifications anytime in Android Settings.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <Microphone size={15} className="text-sky-600" />
                    <span>RECORD_AUDIO</span>
                  </div>
                  <p className="text-slate-600 mt-1">
                    Used strictly during interactive live classes when the student clicks to unmute and ask questions verbally to the faculty. Audio is processed transiently in real time and is not stored.
                  </p>
                </div>

                <div className="p-3 rounded-xl bg-slate-50 border border-slate-200 text-xs">
                  <div className="font-bold text-slate-900 flex items-center gap-2">
                    <UserCheck size={15} className="text-sky-600" />
                    <span>READ_MEDIA_IMAGES / CAMERA (Optional)</span>
                  </div>
                  <p className="text-slate-600 mt-1">
                    Requested only when the student chooses to upload a photo of a textbook doubt, question paper question, or a custom profile photo.
                  </p>
                </div>
              </div>
            </section>

            {/* 7. Data Security */}
            <section id="security" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  7
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Data Protection & Security
                </h2>
              </div>
              <p>
                We implement robust technical and architectural safeguards to protect student data against unauthorized access, alteration, or disclosure:
              </p>
              <ul className="list-disc list-inside text-xs text-slate-600 space-y-1 pl-1">
                <li><strong>Encryption in Transit:</strong> All data transmitted between the app/website and our servers is encrypted using TLS 1.3 / HTTPS.</li>
                <li><strong>Row-Level Security (RLS):</strong> Our database enforces strict granular access policies ensuring students can only read and write their own assessment records.</li>
                <li><strong>Password Hashing:</strong> Credentials are cryptographically salted and hashed by Supabase Auth.</li>
                <li><strong>Pre-Signed Secure Storage:</strong> Doubt image attachments and study materials are protected with short-lived, authenticated pre-signed URLs.</li>
                <li><strong>Role-Based Access:</strong> Administrative and teacher tools are isolated through strict server-side role verifications.</li>
              </ul>
            </section>

            {/* 8. Data Retention & Financial Records */}
            <section id="retention" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  8
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Data Retention & Financial Records
                </h2>
              </div>
              <p>
                We retain personal account information and academic test attempts for as long as the student maintains an active account on Make Me Topper.
              </p>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs sm:text-sm text-slate-800 font-medium leading-relaxed">
                Certain financial, accounting, tax, and transaction records may be retained for the period required by applicable law or legitimate accounting requirements. Where an account is deleted, personal identifiers associated with retained financial records are removed or anonymized where appropriate.
              </div>
            </section>

            {/* 9. Account & Data Deletion */}
            <section id="deletion" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-red-100 text-red-700 flex items-center justify-center text-xs font-bold">
                  9
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Account & Data Deletion Procedures
                </h2>
              </div>
              <p>
                Students have the unconditional right to permanently delete their account and associated personal and academic data at any time. We provide two easy, self-service methods:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <DeviceMobile size={15} className="text-sky-600" />
                    <span>In Mobile App</span>
                  </h4>
                  <p className="text-xs text-slate-600">
                    Navigate to:
                  </p>
                  <div className="text-[11px] font-mono bg-white p-2 rounded-lg border border-slate-200 text-slate-800 font-semibold">
                    Profile &rarr; Personal Information &rarr; Danger Zone &rarr; Delete Account
                  </div>
                  <p className="text-[11px] text-slate-500">
                    Verify with SMS OTP sent to registered number to finalize deletion.
                  </p>
                </div>

                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2">
                  <h4 className="text-xs font-bold text-slate-900 uppercase tracking-wider flex items-center gap-1.5">
                    <ArrowSquareOut size={15} className="text-sky-600" />
                    <span>Public Web Portal</span>
                  </h4>
                  <p className="text-xs text-slate-600">
                    Direct web URL:
                  </p>
                  <Link
                    href="/delete-account"
                    className="text-xs font-bold text-sky-600 hover:underline block truncate"
                  >
                    https://makemetopper.com/delete-account
                  </Link>
                  <p className="text-[11px] text-slate-500">
                    Enter mobile number and enter the SMS verification code.
                  </p>
                </div>
              </div>

              <div className="pt-2 text-xs space-y-2 text-slate-600">
                <p className="font-bold text-slate-900">What happens upon account deletion:</p>
                <ul className="list-disc list-inside space-y-1 pl-1">
                  <li>Your user profile, login credentials, and personal information are permanently erased.</li>
                  <li>Mock test attempts, recorded scores, answers, and ranking history are permanently deleted.</li>
                  <li>Course access, PYQ packages, and active test series enrollments are forfeited.</li>
                  <li>Uploaded doubt attachments, bookmarks, and saved notes are removed.</li>
                  <li>Active device sessions are terminated and FCM push tokens are deregistered.</li>
                  <li>Retained statutory financial records are unlinked and anonymized in compliance with accounting regulations.</li>
                </ul>
              </div>
            </section>

            {/* 10. Student Rights & Control */}
            <section id="student-rights" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  10
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Student Rights & Control
                </h2>
              </div>
              <p>Under applicable Indian data protection principles, students have the right to:</p>
              <ul className="list-disc list-inside text-xs text-slate-600 space-y-1.5 pl-1">
                <li><strong>Access & Review:</strong> View personal profile data, course enrollments, and test score history inside the app.</li>
                <li><strong>Correction:</strong> Update personal details, contact email, and target exam stream from the Personal Information screen.</li>
                <li><strong>Erasure:</strong> Request or execute permanent account and academic data deletion.</li>
                <li><strong>Notification Preferences:</strong> Toggle device push notifications on or off in Android system settings.</li>
              </ul>
            </section>

            {/* 11. Target Audience & Eligibility */}
            <section id="target-audience" className="scroll-mt-24 space-y-3">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  11
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Target Audience & Eligibility
                </h2>
              </div>
              <p>
                Make Me Topper is designed specifically for academic learning and competitive examination preparation for students in Class 8 and above.
              </p>
              <div className="p-4 rounded-xl bg-slate-50 border border-slate-200 text-xs text-slate-700 leading-relaxed">
                Make Me Topper is intended for students in Class 8 and above, including students preparing for examinations such as NEET, JEE, CUET, Foundation and other academic/competitive examinations. We do not knowingly collect personal information from individuals below Class 8. If a parent or guardian discovers that a student below Class 8 has created an account without parental guidance, please contact us for immediate account closure.
              </div>
            </section>

            {/* 12. Grievance Officer & Contact Information */}
            <section id="grievance" className="scroll-mt-24 space-y-4">
              <div className="flex items-center gap-2.5 pb-2 border-b border-slate-100">
                <div className="w-7 h-7 rounded-lg bg-sky-100 text-sky-700 flex items-center justify-center text-xs font-bold">
                  12
                </div>
                <h2 className="text-lg sm:text-xl font-bold text-slate-900">
                  Grievance Officer & Contact Information
                </h2>
              </div>
              <p>
                In accordance with the Information Technology Act, 2000 and applicable digital data protection rules, the details of the Grievance Officer and contact address for Make Me Topper are provided below:
              </p>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {/* Organization Details */}
                <div className="p-4 rounded-xl border border-slate-200 bg-slate-50 space-y-2 text-xs">
                  <h4 className="font-bold text-slate-900 text-sm flex items-center gap-1.5">
                    <MapPin size={16} className="text-sky-600" />
                    <span>Make Me Topper</span>
                  </h4>
                  <p className="text-slate-600 leading-relaxed">
                    Floor 5, A-516, Logix Technova,<br />
                    Sector 132, Noida,<br />
                    Gautambuddha Nagar,<br />
                    Uttar Pradesh &ndash; 201301, India
                  </p>
                  <div className="pt-2 border-t border-slate-200 space-y-1">
                    <p className="flex items-center gap-1.5 text-slate-700">
                      <EnvelopeSimple size={14} className="text-sky-600" />
                      <span><strong>Support:</strong> <a href="mailto:support@inovoxy.com" className="text-sky-600 hover:underline">support@inovoxy.com</a></span>
                    </p>
                    <p className="flex items-center gap-1.5 text-slate-700">
                      <PhoneCall size={14} className="text-sky-600" />
                      <span><strong>Phone:</strong> <a href="tel:+919266875126" className="text-sky-600 hover:underline">+91 9266875126</a></span>
                    </p>
                  </div>
                </div>

                {/* Grievance Officer */}
                <div className="p-4 rounded-xl border border-sky-200 bg-sky-50/60 space-y-2 text-xs">
                  <h4 className="font-bold text-sky-950 text-sm flex items-center gap-1.5">
                    <ShieldCheck size={16} className="text-sky-700" />
                    <span>Grievance Officer</span>
                  </h4>
                  <div className="space-y-1 text-slate-700">
                    <p><strong>Name:</strong> Tanya</p>
                    <p><strong>Designation:</strong> Director</p>
                    <p><strong>Email:</strong> <a href="mailto:inovoxy.india@gmail.com" className="text-sky-700 font-bold hover:underline">inovoxy.india@gmail.com</a></p>
                  </div>
                  <p className="text-[11px] text-slate-500 pt-2 border-t border-sky-200">
                    Grievances regarding personal data processing or account issues will be acknowledged within 48 hours and addressed within statutory timelines.
                  </p>
                </div>
              </div>

              <div className="pt-4 flex flex-wrap gap-3">
                <Link
                  href="/delete-account"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-red-50 text-red-700 border border-red-200 hover:bg-red-100 font-bold text-xs transition-colors"
                >
                  <Trash size={14} weight="bold" />
                  <span>Online Account Deletion Portal &rarr;</span>
                </Link>
                <Link
                  href="/contact"
                  className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-slate-900 text-white hover:bg-slate-800 font-bold text-xs transition-colors"
                >
                  <EnvelopeSimple size={14} weight="bold" />
                  <span>Contact Support Team</span>
                </Link>
              </div>
            </section>

          </main>
        </div>
      </div>
    </div>
  );
}
