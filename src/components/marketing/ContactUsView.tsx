'use client';

import React, { useState } from 'react';
import Link from 'next/link';
import {
  PhoneCall,
  WhatsappLogo,
  EnvelopeSimple,
  MapPin,
  Clock,
  CheckCircle,
  PaperPlaneTilt,
  CaretDown,
  Sparkle,
  Question,
  ShieldCheck,
  Headset,
} from '@phosphor-icons/react';

interface ContactFormData {
  fullName: string;
  email: string;
  phone: string;
  targetExam: string;
  queryCategory: string;
  message: string;
}

const initialFormState: ContactFormData = {
  fullName: '',
  email: '',
  phone: '',
  targetExam: 'NEET',
  queryCategory: 'Admissions & Course Guidance',
  message: '',
};

const FAQS = [
  {
    q: 'How can I enroll in a course or test series?',
    a: 'You can explore our complete catalog at our Courses page, select your desired program, and complete enrollment online. If you need assistance, our admissions team is available via call or WhatsApp.',
  },
  {
    q: 'How do I access my live classes and recorded lectures?',
    a: 'Once enrolled, log in to your Student Portal. Your active curriculum, schedule, upcoming live classes, and past recordings will be available under My Courses and Live Classes.',
  },
  {
    q: 'Can I request a demo class before making a purchase?',
    a: 'Yes! We offer free masterclass demo recordings across NEET, JEE, CUET, and Foundation subjects. Visit our Demo Class section to start watching right away.',
  },
  {
    q: 'How do I ask doubts to mentors?',
    a: 'Enrolled students can use the Ask Doubts feature inside their student portal to submit questions with screenshots and receive detailed step-by-step explanations from subject matter experts.',
  },
  {
    q: 'What is the refund and cancellation policy?',
    a: 'We maintain a student-first approach. For detailed terms regarding fee adjustments, course transfers, and refund timelines, please review our Refund Policy or contact our support team.',
  },
];

export function ContactUsView() {
  const [formData, setFormData] = useState<ContactFormData>(initialFormState);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isSubmitted, setIsSubmitted] = useState(false);
  const [openFaq, setOpenFaq] = useState<number | null>(0);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setIsSubmitting(true);

    // Simulate reliable API submission
    setTimeout(() => {
      setIsSubmitting(false);
      setIsSubmitted(true);
      setFormData(initialFormState);
    }, 900);
  };

  return (
    <main className="min-h-screen bg-[#f8fafc] text-slate-800 pb-20">
      {/* ── 1. Hero Section ────────────────────────────────────────── */}
      <section className="relative overflow-hidden bg-white border-b border-slate-200/70 pt-10 pb-16 lg:pt-14 lg:pb-20">
        <div className="absolute top-0 right-0 w-96 h-96 bg-gradient-to-bl from-sky-100/60 via-sky-50/30 to-transparent rounded-full -mr-28 -mt-28 pointer-events-none" />
        <div className="absolute bottom-0 left-0 w-80 h-80 bg-gradient-to-tr from-sky-100/40 via-transparent to-transparent rounded-full -ml-24 -mb-24 pointer-events-none" />

        <div className="w-full max-w-[1480px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-16 relative z-10">
          {/* Breadcrumb */}
          <nav className="flex items-center gap-2 text-xs text-slate-500 mb-6 font-medium">
            <Link href="/" className="hover:text-sky-600 transition-colors">
              Home
            </Link>
            <span>/</span>
            <span className="text-slate-900 font-semibold">Contact Us</span>
          </nav>

          <div className="max-w-3xl">
            <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-sky-50 border border-sky-200/60 text-sky-700 text-xs font-bold tracking-wide mb-4">
              <Sparkle size={14} weight="fill" className="text-sky-600" />
              GET IN TOUCH
            </div>
            <h1 className="text-3xl sm:text-4xl lg:text-5xl font-extrabold text-slate-900 tracking-tight leading-tight font-display mb-4">
              We&apos;re Here to Guide <br />
              <span className="text-sky-600">Your Learning Journey.</span>
            </h1>
            <p className="text-sm sm:text-base text-slate-600 leading-relaxed max-w-2xl">
              Have questions about courses, mock test packages, admission counseling, or technical support? Our academic and support advisors are ready to help you every step of the way.
            </p>
          </div>
        </div>
      </section>

      {/* ── 2. Direct Channels (4 Cards Grid) ──────────────────────── */}
      <section className="w-full max-w-[1480px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-16 -mt-8 relative z-20">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 sm:gap-5">
          {/* Card 1: Call Us */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:shadow-md hover:border-sky-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-sky-50 text-sky-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <PhoneCall size={22} weight="fill" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Admissions Helpline</h3>
              <p className="text-xs text-slate-500 mb-3">Speak directly with our counseling experts.</p>
              <a
                href="tel:+919876543210"
                className="text-sm font-extrabold text-sky-600 hover:text-sky-700 block tracking-tight"
              >
                +91 98765 43210
              </a>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
              <Clock size={13} />
              <span>Mon–Sat: 9 AM – 8 PM IST</span>
            </div>
          </div>

          {/* Card 2: WhatsApp */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:shadow-md hover:border-emerald-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <WhatsappLogo size={22} weight="fill" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">WhatsApp Support</h3>
              <p className="text-xs text-slate-500 mb-3">Instant chat guidance for quick solutions.</p>
              <a
                href="https://wa.me/919876543210?text=Hi%20MakeMeTopper%20Team%2C%20I%20need%20assistance%20with%20courses."
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 hover:text-emerald-700"
              >
                <span>Chat on WhatsApp →</span>
              </a>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-md w-fit mt-4">
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
              <span>Replies within 15 mins</span>
            </div>
          </div>

          {/* Card 3: Email Support */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:shadow-md hover:border-purple-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-purple-50 text-purple-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <EnvelopeSimple size={22} weight="fill" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Email Support</h3>
              <p className="text-xs text-slate-500 mb-3">Send detailed inquiries &amp; documents.</p>
              <a
                href="mailto:support@makemetopper.com"
                className="text-xs font-bold text-purple-600 hover:text-purple-700 break-all block"
              >
                support@makemetopper.com
              </a>
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
              <ShieldCheck size={13} />
              <span>24/7 Ticket Resolution</span>
            </div>
          </div>

          {/* Card 4: Office Center */}
          <div className="p-5 sm:p-6 rounded-2xl bg-white border border-slate-200/80 shadow-xs hover:shadow-md hover:border-amber-300 transition-all group flex flex-col justify-between">
            <div>
              <div className="w-10 h-10 rounded-xl bg-amber-50 text-amber-600 flex items-center justify-center mb-4 group-hover:scale-105 transition-transform">
                <MapPin size={22} weight="fill" />
              </div>
              <h3 className="text-sm font-bold text-slate-900 mb-1">Headquarters</h3>
              <p className="text-xs text-slate-500 leading-relaxed mb-1">
                Make Me Topper Learning Hub, Sector 62, Noida, Uttar Pradesh, India
              </p>
            </div>
            <div className="text-[11px] text-slate-400 mt-4 pt-3 border-t border-slate-100">
              <span>Visitor hours: 10 AM – 6 PM</span>
            </div>
          </div>
        </div>
      </section>

      {/* ── 3. Main Form & FAQ Section ─────────────────────────────── */}
      <section className="w-full max-w-[1480px] mx-auto px-6 sm:px-10 lg:px-14 xl:px-16 mt-14">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-10 items-start">
          {/* Left Column: Interactive Contact Form (lg:col-span-7) */}
          <div className="lg:col-span-7 bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-8 lg:p-10 shadow-xs">
            <div className="mb-6">
              <span className="text-[10px] font-extrabold uppercase tracking-widest text-sky-600 block mb-1">
                SEND A MESSAGE
              </span>
              <h2 className="text-2xl sm:text-3xl font-extrabold text-slate-900 font-display">
                How Can We Help You?
              </h2>
              <p className="text-xs sm:text-sm text-slate-500 mt-1">
                Fill out the form below and an academic counselor will contact you shortly.
              </p>
            </div>

            {isSubmitted ? (
              <div className="py-12 text-center bg-sky-50/50 rounded-2xl border border-sky-100 p-8">
                <div className="w-14 h-14 rounded-full bg-sky-100 text-sky-600 flex items-center justify-center mx-auto mb-4">
                  <CheckCircle size={32} weight="fill" />
                </div>
                <h3 className="text-xl font-bold text-slate-900 mb-2">Thank you! Your message is received.</h3>
                <p className="text-xs sm:text-sm text-slate-600 max-w-md mx-auto mb-6">
                  Our academic counselor will get in touch with you via phone / email within 2–4 business hours.
                </p>
                <button
                  type="button"
                  onClick={() => setIsSubmitted(false)}
                  className="px-5 py-2.5 rounded-xl bg-sky-600 text-white text-xs font-bold hover:bg-sky-500 transition-colors"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4 sm:space-y-5">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Full Name */}
                  <div>
                    <label htmlFor="contact-name" className="block text-xs font-bold text-slate-700 mb-1.5">
                      Full Name <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="contact-name"
                      type="text"
                      required
                      placeholder="e.g. Rahul Sharma"
                      value={formData.fullName}
                      onChange={(e) => setFormData({ ...formData, fullName: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                    />
                  </div>

                  {/* Phone Number */}
                  <div>
                    <label htmlFor="contact-phone" className="block text-xs font-bold text-slate-700 mb-1.5">
                      Phone Number <span className="text-rose-500">*</span>
                    </label>
                    <div className="relative">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xs font-semibold text-slate-400">
                        +91
                      </span>
                      <input
                        id="contact-phone"
                        type="tel"
                        required
                        placeholder="9876543210"
                        value={formData.phone}
                        onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                        className="w-full pl-12 pr-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {/* Email */}
                  <div>
                    <label htmlFor="contact-email" className="block text-xs font-bold text-slate-700 mb-1.5">
                      Email Address <span className="text-rose-500">*</span>
                    </label>
                    <input
                      id="contact-email"
                      type="email"
                      required
                      placeholder="rahul@example.com"
                      value={formData.email}
                      onChange={(e) => setFormData({ ...formData, email: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all"
                    />
                  </div>

                  {/* Target Exam */}
                  <div>
                    <label htmlFor="contact-exam" className="block text-xs font-bold text-slate-700 mb-1.5">
                      Target Exam
                    </label>
                    <select
                      id="contact-exam"
                      value={formData.targetExam}
                      onChange={(e) => setFormData({ ...formData, targetExam: e.target.value })}
                      className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all bg-white"
                    >
                      <option value="NEET">NEET UG</option>
                      <option value="JEE">JEE (Main &amp; Advanced)</option>
                      <option value="CUET">CUET (UG)</option>
                      <option value="UPSC">UPSC Civil Services</option>
                      <option value="Foundation">Foundation (Class 8–10)</option>
                      <option value="Other">Other Examination</option>
                    </select>
                  </div>
                </div>

                {/* Query Category */}
                <div>
                  <label htmlFor="contact-category" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Topic / Query Category
                  </label>
                  <select
                    id="contact-category"
                    value={formData.queryCategory}
                    onChange={(e) => setFormData({ ...formData, queryCategory: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all bg-white"
                  >
                    <option value="Admissions & Course Guidance">Admissions &amp; Course Guidance</option>
                    <option value="Mock Tests & PYQ Series">Mock Tests &amp; PYQ Series</option>
                    <option value="Technical & App Login Support">Technical &amp; App Login Support</option>
                    <option value="Fee Payment & Billing">Fee Payment &amp; Billing</option>
                    <option value="Faculty & Mentorship Inquiry">Faculty &amp; Mentorship Inquiry</option>
                    <option value="General Query">General Query</option>
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label htmlFor="contact-message" className="block text-xs font-bold text-slate-700 mb-1.5">
                    Your Message <span className="text-rose-500">*</span>
                  </label>
                  <textarea
                    id="contact-message"
                    rows={4}
                    required
                    placeholder="Tell us what you would like assistance with..."
                    value={formData.message}
                    onChange={(e) => setFormData({ ...formData, message: e.target.value })}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 text-xs sm:text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500 focus:border-transparent transition-all resize-none"
                  />
                </div>

                {/* Submit Button */}
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 px-8 py-3 rounded-xl bg-sky-600 hover:bg-sky-500 active:bg-sky-700 text-white text-xs sm:text-sm font-bold shadow-xs hover:shadow-md transition-all disabled:opacity-60 cursor-pointer"
                >
                  {isSubmitting ? (
                    <span>Sending message...</span>
                  ) : (
                    <>
                      <span>Submit Inquiry</span>
                      <PaperPlaneTilt size={16} weight="bold" />
                    </>
                  )}
                </button>
              </form>
            )}
          </div>

          {/* Right Column: FAQs & Assurance Info (lg:col-span-5) */}
          <div className="lg:col-span-5 space-y-6">
            {/* Quick Assurance Box */}
            <div className="p-6 rounded-3xl bg-sky-50/70 border border-sky-100 flex items-start gap-4">
              <div className="w-10 h-10 rounded-xl bg-sky-600 text-white flex items-center justify-center shrink-0 shadow-xs">
                <Headset size={22} weight="fill" />
              </div>
              <div>
                <h3 className="text-sm font-bold text-slate-900 mb-1">Dedicated Student Counseling</h3>
                <p className="text-xs text-slate-600 leading-relaxed">
                  Our academic counselors provide personalized roadmap guidance tailored to your target exam year, strengths, and study plan.
                </p>
              </div>
            </div>

            {/* Quick FAQs */}
            <div className="bg-white rounded-3xl border border-slate-200/80 p-6 sm:p-7 shadow-xs">
              <div className="flex items-center gap-2 mb-4">
                <Question size={18} weight="bold" className="text-sky-600" />
                <h3 className="text-base font-bold text-slate-900">Frequently Asked Questions</h3>
              </div>

              <div className="divide-y divide-slate-100">
                {FAQS.map((faq, idx) => {
                  const isOpen = openFaq === idx;
                  return (
                    <div key={faq.q} className="py-3">
                      <button
                        type="button"
                        onClick={() => setOpenFaq(isOpen ? null : idx)}
                        className="w-full flex items-center justify-between gap-3 text-left group cursor-pointer"
                      >
                        <span className="text-xs sm:text-[13px] font-bold text-slate-800 group-hover:text-sky-600 transition-colors">
                          {faq.q}
                        </span>
                        <CaretDown
                          size={14}
                          weight="bold"
                          className={`text-slate-400 shrink-0 transition-transform duration-200 ${
                            isOpen ? 'rotate-180 text-sky-600' : ''
                          }`}
                        />
                      </button>
                      {isOpen && (
                        <p className="text-xs text-slate-600 leading-relaxed mt-2 pl-0.5 pr-2 animate-fadeIn">
                          {faq.a}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </div>
      </section>
    </main>
  );
}
