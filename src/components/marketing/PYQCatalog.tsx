'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Card } from './Card';
import { ButtonLink } from './Button';
import { CourseArtwork } from './StoreCourseCard';
import { formatCoursePrice } from '@/services/courseCatalogService';
import type { PYQPackage } from '@/types/pyqCatalog';
import type { ExamStreamCode } from '@/types/learnerGoal';

export function PYQPackageCard({ item }: { item: PYQPackage }) {
  return (
    <Card className="store-course-card" interactive>
      <Link href={`/pyq/${item.packageId}`} tabIndex={-1} aria-hidden="true">
        <CourseArtwork
          stream={item.streamCode}
          title={item.subjectBreakdown.map((entry) => entry.subject).slice(0, 2).join('\n')}
        />
      </Link>
      <div className="store-course-card-body">
        <div className="store-card-meta">
          <span className={`store-stream-tag tag-${item.streamCode.toLowerCase()}`}>
            {item.streamCode === 'FOUNDATION' ? 'Foundation' : item.streamCode}
          </span>
          <span>Previous year papers</span>
        </div>
        <h3>
          <Link href={`/pyq/${item.packageId}`}>{item.title}</Link>
        </h3>
        <p className="store-card-description">{item.shortDescription}</p>
        <div className="store-course-facts">
          <span className="tabular-nums">{item.yearRange}</span>
          <span className="tabular-nums">{item.totalPapers} papers</span>
          <span className="tabular-nums">{item.totalQuestions} questions</span>
        </div>
        <div className="store-card-price">
          <div>
            <span className="store-small-label">One-time purchase</span>
            <div>
              <strong className="tabular-nums">
                {formatCoursePrice(item.discountedPrice, item.currency)}
              </strong>
              {item.originalPrice > item.discountedPrice && (
                <del className="tabular-nums">
                  {formatCoursePrice(item.originalPrice, item.currency)}
                </del>
              )}
            </div>
          </div>
          <span className="store-card-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
        <p className="store-monthly-line">
          <b>{item.accessType}</b> · Online practice
        </p>
        <ButtonLink
          href={`/pyq/${item.packageId}`}
          variant="secondary"
          className="store-card-button"
        >
          View package <span aria-hidden="true">→</span>
        </ButtonLink>
      </div>
    </Card>
  );
}

const STREAMS: { code: ExamStreamCode | 'ALL'; label: string }[] = [
  { code: 'ALL', label: 'All exams' },
  { code: 'NEET', label: 'NEET' },
  { code: 'JEE', label: 'JEE' },
  { code: 'CUET', label: 'CUET' },
  { code: 'FOUNDATION', label: 'Foundation' },
];

export function PYQCatalog({ packages }: { packages: PYQPackage[] }) {
  const [stream, setStream] = useState<ExamStreamCode | 'ALL'>('ALL');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const text = query.trim().toLowerCase();
    return packages.filter((item) => {
      if (stream !== 'ALL' && item.streamCode !== stream) return false;
      if (!text) return true;
      return (
        item.title.toLowerCase().includes(text) ||
        item.subjectBreakdown.some((entry) => entry.subject.toLowerCase().includes(text))
      );
    });
  }, [packages, stream, query]);

  return (
    <>
      <section className="store-container store-hero" id="store-main">
        <div className="store-hero-copy store-reveal">
          <p className="store-eyebrow">
            <span className="store-status-dot" aria-hidden="true"></span>
            PREVIOUS YEAR QUESTIONS
          </p>
          <h1>
            Learn from the <span>papers that came before.</span>
          </h1>
          <p>
            Solved previous-year question packages for NEET, JEE, CUET, and Foundation. Practice official
            exam papers with timer, answer keys, and detailed explanations.
          </p>
          <a className="store-hero-link" href="#pyq-catalog">
            Browse packages <span aria-hidden="true">↗</span>
          </a>
          <p className="store-hero-caption">
            <span className="store-caption-rule" aria-hidden="true"></span>
            FRESH EYES. PROVEN QUESTIONS. CLEARER NEXT STEPS.
          </p>
        </div>
        <div className="store-hero-visual" aria-hidden="true">
          <span className="store-visual-label">THE PYQ COLLECTION</span>
          <div className="store-book book-back">
            <span>PREVIOUS YEAR QUESTIONS</span>
            <strong>
              2015
              <br />— 2025
            </strong>
            <span className="book-line"></span>
            <span>EXAMINATION ARCHIVES</span>
          </div>
          <div className="store-book book-front">
            <span>MAKE ME TOPPER</span>
            <strong>
              Answers,
              <br />
              step by <span>step.</span>
            </strong>
            <div className="course-art art-jee">
              <div className="art-grid" aria-hidden="true"></div>
              <svg className="art-symbol" viewBox="0 0 200 200" fill="none">
                <circle cx="100" cy="100" r="62" stroke="currentColor" strokeWidth="5" />
                <path d="M60 118 C80 70 120 70 140 118" stroke="currentColor" strokeWidth="6" />
                <circle cx="100" cy="60" r="9" fill="currentColor" />
              </svg>
            </div>
            <span className="book-footer">OFFICIAL PAPERS</span>
          </div>
          <div className="store-orbit-label">
            <span aria-hidden="true">✓</span>
            Official questions across the collection
          </div>
          <div className="store-visual-bottom">
            <span>SOLVED · SORTED · VERIFIED</span>
            <span aria-hidden="true">✳</span>
          </div>
        </div>
      </section>
      <section className="store-benefits" aria-label="Why practise previous year questions">
        <div className="store-container">
          <span>
            <b aria-hidden="true">✓</b> Real exam patterns
          </span>
          <span>
            <b aria-hidden="true">✓</b> Step-by-step solutions
          </span>
          <span>
            <b aria-hidden="true">✓</b> Full-length practice tests
          </span>
          <span>
            <b aria-hidden="true">✓</b> One-time purchase
          </span>
        </div>
      </section>
      <section className="store-container store-catalog-section" id="pyq-catalog">
        <div className="store-section-heading">
          <div>
            <p className="store-eyebrow">PICK YOUR PAPERS</p>
            <h2>Previous year packages.</h2>
          </div>
          <p>Official collections & mock tests</p>
        </div>
        <div className="store-catalog-controls">
          <div className="store-stream-filters" role="group" aria-label="Filter by exam">
            {STREAMS.map((option) => (
              <button
                key={option.code}
                className={stream === option.code ? 'selected' : ''}
                aria-pressed={stream === option.code}
                onClick={() => setStream(option.code)}
              >
                {option.label}
                <span className="tabular-nums">
                  {option.code === 'ALL'
                    ? packages.length
                    : packages.filter((item) => item.streamCode === option.code).length}
                </span>
              </button>
            ))}
          </div>
          <div className="store-search">
            <svg
              aria-hidden="true"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <circle cx="11" cy="11" r="7" />
              <path d="m20 20-3.5-3.5" />
            </svg>
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search packages or subjects…"
              aria-label="Search PYQ packages"
            />
          </div>
        </div>
        <div className="store-results-bar">
          <div>
            <span>
              <b className="tabular-nums">{filtered.length}</b> package
              {filtered.length === 1 ? '' : 's'} available
            </span>
          </div>
        </div>
        {filtered.length === 0 ? (
          <div className="store-empty">
            <span aria-hidden="true">✳</span>
            <h3>Nothing here — yet.</h3>
            <p>No packages match that filter. Try another exam or clear the search.</p>
            <button
              className="store-card-button"
              style={{ maxWidth: 220, margin: '0 auto' }}
              onClick={() => {
                setStream('ALL');
                setQuery('');
              }}
            >
              Show all packages ↗
            </button>
          </div>
        ) : (
          <div className="store-course-grid">
            {filtered.map((item) => (
              <PYQPackageCard key={item.packageId} item={item} />
            ))}
          </div>
        )}
      </section>
      <section
        className="store-container store-choice-section"
        aria-label="How a PYQ purchase works"
      >
        <div>
          <p className="store-eyebrow">SIMPLE BY DESIGN</p>
          <h2>
            One price.
            <br />
            <span>One payment. Yours forever.</span>
          </h2>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number tabular-nums">01</span>
          <h3>Preview the package</h3>
          <p>Open a package to see its paper counts, subject breakdown, and inclusions.</p>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number tabular-nums">02</span>
          <h3>Enroll & practice</h3>
          <p>Get instant access to timed exams, answer keys, and chapter-wise analysis.</p>
        </div>
      </section>
    </>
  );
}
