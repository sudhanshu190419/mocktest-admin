'use client';

import { useEffect, useState, useSyncExternalStore } from 'react';
import { Button, ButtonLink } from './Button';
import { useAuth } from '@/context/AuthContext';

const SLIDES = [
  {
    key: 'demo',
    label: 'Demo class',
    eyebrow: 'DEMO CLASS · EXPERIENCE',
    title: 'Big ambitions.\nA small first step.',
    copy: 'Get a feel for your next chapter. Explore the demo-class preview, then find a course that fits your direction.',
    href: '/login?next=%2Fdemo-class',
    cta: 'Explore demo-class preview',
    note: 'Sign in to access interactive live preview',
    subject: 'The curiosity notebook',
    lesson: 'It starts with a question.',
    annotation: 'Understand the why.',
  },
  {
    key: 'NEET',
    label: 'NEET',
    eyebrow: 'NEET · MEDICAL PREPARATION',
    title: 'Think life.\nThink bigger.',
    copy: 'From the smallest cell to the bigger picture. Explore Physics, Chemistry, and Biology pathways for your medical entrance preparation.',
    href: '/?stream=NEET#home-courses',
    cta: 'Explore NEET courses',
    note: 'Structured batches & test series',
    subject: 'Biology / field notes',
    lesson: 'Small structures. Big ideas.',
    annotation: 'Look a little closer.',
  },
  {
    key: 'JEE',
    label: 'JEE',
    eyebrow: 'JEE · ENGINEERING ENTRANCE',
    title: 'A problem today.\nA possibility tomorrow.',
    copy: 'Make space for a different way of thinking. Discover science and mathematics courses for JEE Main and Advanced preparation.',
    href: '/?stream=JEE#home-courses',
    cta: 'Explore JEE courses',
    note: 'Concept clarity & advanced problem solving',
    subject: 'Physics / working notes',
    lesson: 'Find the shape of an idea.',
    annotation: 'Sketch. Solve. Revisit.',
  },
  {
    key: 'CUET',
    label: 'CUET',
    eyebrow: 'CUET · UNIVERSITY ENTRANCE',
    title: 'Your interests.\nYour next chapter.',
    copy: 'Connect what you enjoy with what comes next. Browse language, general aptitude, and domain-subject pathways for CUET.',
    href: '/?stream=CUET#home-courses',
    cta: 'Explore CUET courses',
    note: 'Full syllabus coverage & mock tests',
    subject: 'Language / connections',
    lesson: 'More than one way forward.',
    annotation: 'Connect the ideas.',
  },
  {
    key: 'FOUNDATION',
    label: 'Foundation',
    eyebrow: 'FOUNDATION · CLASSES 8–10',
    title: 'Strong roots.\nRoom to grow.',
    copy: 'Give the fundamentals the attention they deserve. Explore foundation courses designed to build concept clarity early.',
    href: '/?stream=FOUNDATION#home-courses',
    cta: 'Explore Foundation courses',
    note: 'Build strong fundamentals',
    subject: 'Mathematics / first principles',
    lesson: 'Build from what you know.',
    annotation: 'One idea at a time.',
  },
] as const;

function subscribeToMotion(callback: () => void) {
  const media = window.matchMedia('(prefers-reduced-motion: reduce)');
  media.addEventListener('change', callback);
  return () => media.removeEventListener('change', callback);
}

function getReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function subscribeToVisibility(callback: () => void) {
  document.addEventListener('visibilitychange', callback);
  return () => document.removeEventListener('visibilitychange', callback);
}

function getHidden() {
  return document.hidden;
}

function getServerPaused() {
  return true;
}

function LessonDrawing({ topic }: { topic: (typeof SLIDES)[number]['key'] }) {
  return (
    <svg
      className="store-lesson-drawing"
      viewBox="0 0 360 210"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {topic === 'demo' ? (
        <>
          <path d="M50 38c49-10 91-3 130 18 39-21 81-28 130-18v128c-46-9-89-2-130 20-41-22-84-29-130-20Z" />
          <path
            d="M180 56v130M65 177c40-3 78 3 115 20 37-17 75-23 115-20M75 68l72 12M75 86l59 10M75 104l67 11"
            opacity=".6"
          />
          <circle cx="246" cy="108" r="28" />
          <path d="M237 99c0-13 21-13 21 0 0 9-12 8-12 17M246 126v1M22 66h14M29 59v14M320 125h16M328 117v16" />
        </>
      ) : topic === 'NEET' ? (
        <>
          <path d="M78 75C98 13 221 18 268 67c54 56 4 121-64 120-59-1-117-16-133-58-8-19-5-37 7-54Z" />
          <path
            d="M88 80C107 29 216 31 260 76c44 46 0 100-56 101-55 0-109-17-123-51-6-16-3-29 7-46Z"
            opacity=".5"
          />
          <ellipse cx="173" cy="107" rx="38" ry="32" />
          <circle cx="178" cy="106" r="12" />
          <path d="m165 74-9-20m-20 64-27 7m99-22 26-8M108 63c-15 14-6 30 4 18s17-24-4-18ZM229 134c-16 0-23 18-8 19s28-18 8-19Z" />
          <path d="m207 106 91-52h31M115 143l-57 37H27" strokeDasharray="4 5" />
          <text x="289" y="41" className="store-drawing-label">
            nucleus
          </text>
          <text x="14" y="199" className="store-drawing-label">
            cell membrane
          </text>
        </>
      ) : topic === 'JEE' ? (
        <>
          <path d="M42 175h270M62 188V28m-6 10 6-10 6 10m234 131 10 6-10 6" opacity=".6" />
          <path d="M64 171C117 5 224 6 283 172" strokeWidth="3" />
          <path d="M174 48v127M64 171l69-78m-4 15 4-15-15 5" strokeDasharray="5 6" />
          <circle cx="174" cy="48" r="6" fill="currentColor" />
          <path d="M85 174a30 30 0 0 0-8-21" />
          <text x="187" y="41" className="store-drawing-label">
            the turning point
          </text>
          <text x="228" y="207" className="store-drawing-label">
            trajectory →
          </text>
          <text x="21" y="27" className="store-drawing-label">
            y
          </text>
        </>
      ) : topic === 'CUET' ? (
        <>
          <rect x="116" y="69" width="128" height="65" rx="32" />
          <text x="148" y="107" className="store-drawing-word">
            IDEAS
          </text>
          <path d="m116 90-39-43m0 0h16m-16 0v16m167 27 39-43m0 0h-16m16 0v16M180 134v39m-7-8 7 8 7-8" />
          <text x="12" y="30" className="store-drawing-label">
            language
          </text>
          <text x="260" y="30" className="store-drawing-label">
            reasoning
          </text>
          <text x="137" y="197" className="store-drawing-label">
            your domain
          </text>
          <circle cx="52" cy="130" r="20" strokeDasharray="3 6" />
          <path d="m295 126 11-20 11 20-11 20Z" />
        </>
      ) : (
        <>
          <path d="M35 175h290M60 175V31" opacity=".6" />
          <path d="M68 166h48v-41h48V84h48V43h48" strokeWidth="4" />
          <path d="m93 81 93-54m-18-1 18 1-9 15" />
          <circle cx="263" cy="44" r="7" fill="currentColor" />
          <text x="82" y="199" className="store-drawing-label">
            concept → practice → clarity
          </text>
          <path d="M290 89h26M303 76v26M271 128h17" />
        </>
      )}
    </svg>
  );
}

export function HeroCarousel() {
  const { user } = useAuth();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const reducedMotion = useSyncExternalStore(subscribeToMotion, getReducedMotion, getServerPaused);
  const hidden = useSyncExternalStore(subscribeToVisibility, getHidden, getServerPaused);
  const playing = !paused && !hovered && !focused && !reducedMotion && !hidden;

  useEffect(() => {
    if (!playing) return;
    const timer = window.setTimeout(
      () => setIndex((current) => (current + 1) % SLIDES.length),
      6000
    );
    return () => window.clearTimeout(timer);
  }, [playing, index]);

  const goTo = (next: number) => setIndex((next + SLIDES.length) % SLIDES.length);

  return (
    <section
      className="store-container store-hero-carousel"
      aria-roledescription="carousel"
      aria-label="Explore MakeMeTopper"
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocusCapture={() => setFocused(true)}
      onBlurCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node)) setFocused(false);
      }}
    >
      <div className="store-carousel-controls">
        <div className="store-carousel-playback">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="store-carousel-play"
            onClick={() => setPaused((current) => !current)}
            disabled={reducedMotion}
            aria-label={
              reducedMotion
                ? 'Autoplay disabled for reduced motion'
                : paused
                ? 'Play slideshow'
                : 'Pause slideshow'
            }
            aria-controls="store-carousel-slides"
          >
            <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
              {paused || reducedMotion ? (
                <path d="m7 4 9 6-9 6Z" fill="currentColor" />
              ) : (
                <path d="M7 4v12M13 4v12" stroke="currentColor" strokeWidth="3" />
              )}
            </svg>
            <span>{reducedMotion ? 'Manual mode' : paused ? 'Play' : 'Pause'}</span>
          </Button>
          <span className="store-carousel-timing">
            {reducedMotion
              ? 'Reduced motion'
              : playing
              ? 'Changes every 6 seconds'
              : paused
              ? 'Autoplay off'
              : 'Paused while you explore'}
          </span>
        </div>
        <div className="store-carousel-dots" role="group" aria-label="Choose a slide">
          {SLIDES.map((slide, i) => (
            <button
              type="button"
              key={slide.key}
              onClick={() => goTo(i)}
              aria-label={`Show ${slide.label} slide`}
              aria-current={i === index ? 'true' : undefined}
              aria-controls={`store-slide-${slide.key}`}
              className="store-carousel-dot"
            >
              <span />
            </button>
          ))}
        </div>
        <div className="store-carousel-navigation">
          <span className="store-carousel-count tabular-nums" aria-hidden="true">
            0{index + 1} <span>/ 05</span>
          </span>
          <button
            type="button"
            className="store-carousel-arrow"
            onClick={() => goTo(index - 1)}
            aria-label="Previous slide"
            aria-controls="store-carousel-slides"
          >
            ←
          </button>
          <button
            type="button"
            className="store-carousel-arrow"
            onClick={() => goTo(index + 1)}
            aria-label="Next slide"
            aria-controls="store-carousel-slides"
          >
            →
          </button>
        </div>
      </div>
      <div
        className="store-carousel-track"
        id="store-carousel-slides"
        aria-live={playing ? 'off' : 'polite'}
        aria-atomic="false"
      >
        {SLIDES.map((slide, i) => (
          <div
            key={slide.key}
            id={`store-slide-${slide.key}`}
            className={`store-carousel-slide slide-${slide.key.toLowerCase()}`}
            data-active={i === index}
            role="group"
            aria-roledescription="slide"
            aria-label={`${slide.label}, ${i + 1} of ${SLIDES.length}`}
            aria-hidden={i !== index}
          >
            <div className="store-carousel-copy">
              <p className="store-eyebrow">{slide.eyebrow}</p>
              <h2>{slide.title}</h2>
              <p className="store-carousel-lead">{slide.copy}</p>
              <ButtonLink
                href={slide.key === 'demo' && user ? '/demo-class' : slide.href}
                className="store-enroll-button"
              >
                {slide.cta} <span aria-hidden="true">↗</span>
              </ButtonLink>
              <p className="store-carousel-note">
                {slide.key === 'demo' && user ? 'Free interactive live preview' : slide.note}
              </p>
            </div>
            <div className="store-carousel-art" aria-hidden="true">
              <div className="store-art-heading">
                <span>MAKE ME TOPPER / STUDY NOTES</span>
                <span className="tabular-nums">NO. 0{i + 1}</span>
              </div>
              <div className="store-lesson-board">
                <div className="store-lesson-topline">
                  <span>{slide.subject}</span>
                  <span>↗</span>
                </div>
                <strong>{slide.lesson}</strong>
                <LessonDrawing topic={slide.key} />
                <div className="store-lesson-bottom">
                  <span>LEARN. QUESTION. REPEAT.</span>
                  <span className="store-chalk" />
                </div>
              </div>
              <div className="store-lesson-note">
                <span>NOTE TO SELF</span>
                <strong>{slide.annotation}</strong>
                <span className="store-note-underline" />
              </div>
              <div className="store-art-caption">
                <span>THE ART OF GETTING THERE.</span>
                <span>LEARNING EDITION</span>
              </div>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}
