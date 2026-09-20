import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseArtwork, StoreCourseCard } from '@/components/marketing/StoreCourseCard';
import { CoursePricing } from '@/components/marketing/CoursePricing';
import { getCourseById, getCourses } from '@/services/courseCatalogService';

interface PageProps {
  params: Promise<{ courseId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { courseId } = await params;
  const course = await getCourseById(courseId);
  return {
    title: course?.presentation.displayTitle ?? 'Course not found',
    description: course?.shortDescription,
  };
}

export default async function CourseDetailPage({ params }: PageProps) {
  const { courseId } = await params;
  const course = await getCourseById(courseId);
  if (!course) notFound();

  const allCourses = await getCourses();
  const related = allCourses
    .filter((item) => item.streamCode === course.streamCode && item.courseId !== course.courseId)
    .slice(0, 2);

  return (
    <main id="store-main">
      <section className="store-container store-detail-hero store-reveal">
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/courses">All courses</Link>
          <span aria-hidden="true">/</span>
          <span>{course.streamName}</span>
        </nav>
        <div className="store-detail-heading">
          <div>
            <p className="store-eyebrow">
              {course.streamName} <span> / </span> A NEW CHAPTER STARTS HERE
            </p>
            <h1>{course.presentation.displayTitle}</h1>
            <p className="store-detail-lead">{course.shortDescription}</p>
            <div className="store-detail-meta">
              <span>
                <b aria-hidden="true">◷</b>{' '}
                <span className="tabular-nums">{course.duration}</span> days of learning
              </span>
              <span>
                <b aria-hidden="true">◎</b> {course.presentation.languageLabel}
              </span>
              <span className="capitalize">
                <b aria-hidden="true">↗</b> {course.difficultyLevel}
              </span>
            </div>
          </div>
          <div className="store-detail-stamp" aria-hidden="true">
            <span>YOUR GOAL.</span>
            <strong>↗</strong>
            <span>OUR STARTING POINT.</span>
          </div>
        </div>
      </section>
      <div className="store-container store-detail-grid">
        <div className="store-detail-content">
          <CourseArtwork stream={course.streamCode} large />
          <nav className="store-section-nav" aria-label="Course sections">
            <a href="#overview">Overview</a>
            <a href="#curriculum">Curriculum</a>
            <a href="#faculty">Faculty</a>
            <a href="#course-faq">FAQs</a>
          </nav>
          <section id="overview" className="store-detail-section">
            <p className="store-eyebrow">THE BIG PICTURE</p>
            <h2>
              Understanding comes first.
              <br />
              <span>Confidence follows.</span>
            </h2>
            <p>{course.description}</p>
            <div className="store-detail-highlights">
              {course.presentation.highlights.map((highlight) => (
                <div key={highlight}>
                  <span aria-hidden="true">✓</span>
                  <p>{highlight}</p>
                </div>
              ))}
            </div>
            <div className="store-audience">
              <div>
                <span className="store-small-label">WHO IT’S FOR</span>
                <p>{course.presentation.audience}</p>
              </div>
              <div>
                <span className="store-small-label">YOUR LEARNING RHYTHM</span>
                <p>{course.presentation.schedule}</p>
              </div>
            </div>
          </section>
          {course.presentation.curriculum.length > 0 && (
            <section id="curriculum" className="store-detail-section">
              <div className="store-detail-section-title">
                <div>
                  <p className="store-eyebrow">ONE CONCEPT AT A TIME</p>
                  <h2>What you’ll explore.</h2>
                </div>
                <span className="store-small-label tabular-nums">
                  {course.presentation.curriculum.length} subject outlines
                </span>
              </div>
              <p>A roadmap from core ideas to confident practice.</p>
              <div className="store-curriculum">
                {course.presentation.curriculum.map((module, index) => (
                  <details key={module.title} open={index === 0}>
                    <summary>
                      <span className="store-module-index tabular-nums">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <span>{module.title}</span>
                      <span className="store-details-toggle" aria-hidden="true">
                        +
                      </span>
                    </summary>
                    <ul>
                      {module.topics.map((topic) => (
                        <li key={topic}>
                          <span aria-hidden="true">↳</span>
                          {topic}
                        </li>
                      ))}
                    </ul>
                  </details>
                ))}
              </div>
            </section>
          )}
          {course.presentation.faculty.length > 0 && (
            <section id="faculty" className="store-detail-section">
              <p className="store-eyebrow">THE HUMAN SIDE OF LEARNING</p>
              <h2>Meet your learning guides.</h2>
              <div className="store-faculty-grid">
                {course.presentation.faculty.map((member) => (
                  <article
                    key={`${member.name}-${member.subject}`}
                    className="store-faculty"
                  >
                    <div
                      className={`store-faculty-avatar tag-${course.streamCode.toLowerCase()}`}
                      aria-hidden="true"
                    >
                      {member.initials}
                      <span>↗</span>
                    </div>
                    <div>
                      <span className="store-small-label">{member.subject}</span>
                      <h3>{member.name}</h3>
                      <p>{member.description}</p>
                    </div>
                  </article>
                ))}
              </div>
            </section>
          )}
          <section id="course-faq" className="store-detail-section">
            <p className="store-eyebrow">A LITTLE MORE CLARITY</p>
            <h2>Good questions. Clear answers.</h2>
            <div className="store-faq">
              {course.presentation.faqs.map((faq) => (
                <details key={faq.question}>
                  <summary>
                    {faq.question}
                    <span className="store-details-toggle" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
        <aside
          id="course-pricing"
          className="store-pricing-column"
          aria-label="Course pricing and subscription plans"
        >
          <CoursePricing course={course} />
          <div className="store-sidebar-note">
            <span aria-hidden="true">↗</span>
            <p>
              Your pace.
              <br />
              Your path.
              <br />
              <b>Your possibility.</b>
            </p>
          </div>
        </aside>
      </div>
      {related.length > 0 && (
        <section className="store-container store-related">
          <div className="store-section-heading">
            <div>
              <p className="store-eyebrow">KEEP YOUR CURIOSITY GOING</p>
              <h2>More ways to move forward.</h2>
            </div>
            <Link className="store-text-link" href="/courses">
              See all courses ↗
            </Link>
          </div>
          <div className="store-related-grid">
            {related.map((item) => (
              <StoreCourseCard key={item.courseId} course={item} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
