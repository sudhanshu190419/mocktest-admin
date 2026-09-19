'use client';

import { useMemo, useState } from 'react';
import { Button } from './Button';
import { CourseArtwork, StoreCourseCard } from './StoreCourseCard';
import type { Course } from '@/types/courseCatalog';

export function CourseCatalog({ courses }: { courses: Course[] }) {
  const [stream, setStream] = useState('ALL');
  const [search, setSearch] = useState('');
  const [level, setLevel] = useState('all');
  const [sort, setSort] = useState('featured');
  const streams = ['ALL', 'NEET', 'JEE', 'CUET', 'FOUNDATION'];

  const filtered = useMemo(
    () =>
      courses
        .filter(
          (course) =>
            (stream === 'ALL' || course.streamCode === stream) &&
            (level === 'all' || course.difficultyLevel.toLowerCase() === level.toLowerCase()) &&
            `${course.title} ${course.presentation.subjects.join(' ')}`
              .toLowerCase()
              .includes(search.trim().toLowerCase())
        )
        .sort((a, b) =>
          sort === 'price-low'
            ? (a.discountedPrice ?? a.originalPrice) - (b.discountedPrice ?? b.originalPrice)
            : sort === 'price-high'
            ? (b.discountedPrice ?? b.originalPrice) - (a.discountedPrice ?? a.originalPrice)
            : Number(b.featured) - Number(a.featured) || a.sortOrder - b.sortOrder
        ),
    [courses, stream, search, level, sort]
  );

  function resetFilters() {
    setStream('ALL');
    setSearch('');
    setLevel('all');
    setSort('featured');
  }

  return (
    <main id="store-main">
      <section className="store-hero store-container store-reveal">
        <div className="store-hero-copy">
          <p className="store-eyebrow">
            <span className="store-status-dot" /> YOUR AMBITION. YOUR NEXT STEP.
          </p>
          <h1>
            Big dreams.
            <br />A clear <span>way forward.</span>
          </h1>
          <p>
            Find the course that meets you where you are.
            <br className="store-desktop-break" /> Build understanding, find your rhythm, and go further.
          </p>
          <a className="store-hero-link" href="#course-catalog">
            Find your course <span aria-hidden="true">↓</span>
          </a>
          <div className="store-hero-caption">
            <span className="store-caption-rule" /> Learn live. Revisit anytime. Practise with purpose.
          </div>
        </div>
        <div className="store-hero-visual" aria-hidden="true">
          <div className="store-visual-label">A LITTLE CURIOSITY GOES A LONG WAY.</div>
          <div className="store-book book-back">
            <span>THE ART OF</span>
            <strong>
              thinking
              <br />
              bigger.
            </strong>
            <div className="book-line" />
            <span>YOUR FUTURE STARTS HERE</span>
          </div>
          <div className="store-book book-front">
            <span>MAKEMETOPPER / ACADEMY</span>
            <strong>
              One step
              <br />
              closer<span>.</span>
            </strong>
            <CourseArtwork stream="NEET" title="" />
            <span className="book-footer">IDEAS → UNDERSTANDING → POSSIBILITIES</span>
          </div>
          <div className="store-orbit-label">
            <span>↗</span>Made for your
            <br />
            <b>next chapter.</b>
          </div>
          <div className="store-visual-bottom">
            <span>01 / LEARN WITHOUT LIMITING YOURSELF</span>
            <span>✳</span>
          </div>
        </div>
      </section>
      <div className="store-benefits">
        <div className="store-container">
          <span>
            <b aria-hidden="true">↗</b> Learn with a plan
          </span>
          <span>
            <b aria-hidden="true">◷</b> Make room for revision
          </span>
          <span>
            <b aria-hidden="true">◎</b> Practise with purpose
          </span>
          <span>
            <b aria-hidden="true">◇</b> Choose how you pay
          </span>
        </div>
      </div>
      <section id="course-catalog" className="store-container store-catalog-section">
        <div className="store-section-heading">
          <div>
            <p className="store-eyebrow">FIND YOUR FOCUS</p>
            <h2>There’s a course for your next step.</h2>
          </div>
          <p>
            One goal or a whole new direction.
            <br />
            Start with what matters to you.
          </p>
        </div>
        <div className="store-catalog-controls">
          <div className="store-stream-filters" role="group" aria-label="Filter by exam">
            {streams.map((item) => (
              <button
                key={item}
                onClick={() => setStream(item)}
                aria-pressed={stream === item}
                className={stream === item ? 'selected' : ''}
              >
                {item === 'ALL' ? 'All courses' : item === 'FOUNDATION' ? 'Foundation' : item}
                {item === 'ALL' && <span className="tabular-nums">{courses.length}</span>}
              </button>
            ))}
          </div>
          <label className="store-search">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
              <circle cx="10" cy="10" r="6" stroke="currentColor" strokeWidth="1.7" />
              <path d="m15 15 5 5" stroke="currentColor" strokeWidth="1.7" />
            </svg>
            <span className="sr-only">Search courses or subjects</span>
            <input
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search courses or subjects"
            />
          </label>
        </div>
        <div className="store-results-bar">
          <p role="status">
            <b className="tabular-nums">{filtered.length}</b> courses to explore
          </p>
          <div>
            <label>
              Level{' '}
              <select value={level} onChange={(event) => setLevel(event.target.value)}>
                <option value="all">All levels</option>
                <option value="beginner">Beginner</option>
                <option value="intermediate">Intermediate</option>
                <option value="advanced">Advanced</option>
              </select>
            </label>
            <label>
              Sort by{' '}
              <select value={sort} onChange={(event) => setSort(event.target.value)}>
                <option value="featured">Featured</option>
                <option value="price-low">Price: low to high</option>
                <option value="price-high">Price: high to low</option>
              </select>
            </label>
          </div>
        </div>
        {filtered.length ? (
          <div className="store-course-grid">
            {filtered.map((course) => (
              <StoreCourseCard key={course.courseId} course={course} />
            ))}
          </div>
        ) : (
          <div className="store-empty">
            <span aria-hidden="true">⌕</span>
            <h3>No courses found.</h3>
            <p>Try clearing your filters to see all available courses.</p>
            <Button onClick={resetFilters}>Clear filters</Button>
          </div>
        )}
      </section>
      <section className="store-container store-choice-section">
        <div>
          <p className="store-eyebrow">YOUR LEARNING. YOUR CHOICE.</p>
          <h2>
            A commitment to learning.
            <br />
            <span>Structured batches, live mentors, and mock tests.</span>
          </h2>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number">01</span>
          <h3>Live and recorded classes</h3>
          <p>Interactive sessions on LiveKit with session recordings available on demand.</p>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number">02</span>
          <h3>Examination readiness</h3>
          <p>Full-length test engine with timer, analytics, and chapter-wise performance drilldown.</p>
        </div>
      </section>
    </main>
  );
}
