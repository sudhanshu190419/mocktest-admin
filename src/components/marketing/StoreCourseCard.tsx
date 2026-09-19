import Link from 'next/link';
import { Card } from './Card';
import { ButtonLink } from './Button';
import { formatCoursePrice } from '@/services/courseCatalogService';
import type { Course } from '@/types/courseCatalog';

export function CourseArtwork({
  stream,
  title,
  large = false,
}: {
  stream: Course['streamCode'];
  title?: string;
  large?: boolean;
}) {
  return (
    <div className={`course-art art-${stream.toLowerCase()} ${large ? 'art-large' : ''}`}>
      <div className="art-grid" aria-hidden="true" />
      <span className="art-kicker">
        THE {stream === 'FOUNDATION' ? 'FOUNDATION' : stream} COLLECTION
      </span>
      <div className="art-title">
        {title ||
          ({
            NEET: 'Think life.\nThink bigger.',
            JEE: 'Build your\nbreakthrough.',
            CUET: 'A world of\npossibilities.',
            FOUNDATION: 'Start strong.\nGo further.',
            UPSC: 'Lead with\npurpose.',
            K12: 'Grow your\nfoundations.',
          }[stream] ||
            'Think life.\nThink bigger.')}
      </div>
      <svg className="art-symbol" viewBox="0 0 200 200" fill="none" aria-hidden="true">
        {stream === 'NEET' ? (
          <g stroke="currentColor" strokeWidth="2">
            <ellipse cx="100" cy="100" rx="85" ry="33" transform="rotate(-35 100 100)" />
            <ellipse cx="100" cy="100" rx="85" ry="33" transform="rotate(35 100 100)" />
            <ellipse cx="100" cy="100" rx="85" ry="33" transform="rotate(90 100 100)" />
            <circle cx="100" cy="100" r="12" fill="currentColor" />
            <circle cx="165" cy="53" r="7" fill="currentColor" />
          </g>
        ) : stream === 'JEE' ? (
          <g stroke="currentColor" strokeWidth="2">
            <path d="M100 15 182 62v84l-82 44-82-44V62Z" />
            <path d="m18 62 82 48 82-48M100 110v80M100 15v95M18 146l82-36 82 36" />
            <path d="m60 40 82 48v79M141 39 59 88v79" opacity=".5" />
            <circle cx="100" cy="110" r="9" fill="currentColor" />
          </g>
        ) : stream === 'CUET' ? (
          <g stroke="currentColor" strokeWidth="2">
            <circle cx="100" cy="100" r="79" />
            <ellipse cx="100" cy="100" rx="40" ry="79" />
            <path d="M21 100h158M35 57h130M35 143h130M100 21v158" />
            <path d="m142 34 30-5-3 30" strokeWidth="6" />
          </g>
        ) : (
          <g stroke="currentColor" strokeWidth="2">
            <path d="M20 165h45v-45h45V75h45V30h25" strokeWidth="15" />
            <path d="M20 190h165M20 10v180M45 90l90-70m-28-2 28 2-3 27" />
            <circle cx="47" cy="43" r="20" />
          </g>
        )}
      </svg>
      <span className="art-bottom">
        MAKE ROOM FOR YOUR AMBITION <span>↗</span>
      </span>
    </div>
  );
}

export function StoreCourseCard({ course, isEnrolled = false }: { course: Course; isEnrolled?: boolean }) {
  const price = course.discountedPrice ?? course.originalPrice;
  const monthly = course.plans.find((plan) => plan.billingCycle === 'monthly' && plan.isActive);

  return (
    <Card className="store-course-card" interactive>
      <Link href={isEnrolled ? `/student/courses/${course.courseId}` : `/courses/${course.courseId}`} tabIndex={-1} aria-hidden="true">
        <CourseArtwork stream={course.streamCode} />
      </Link>
      <div className="store-course-card-body">
        <div className="store-card-meta">
          <span className={`store-stream-tag tag-${course.streamCode.toLowerCase()}`}>
            {course.streamCode === 'FOUNDATION' ? 'Foundation' : course.streamCode}
          </span>
          {isEnrolled ? (
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-emerald-100 text-emerald-800">
              Enrolled ✓
            </span>
          ) : (
            <span>Live + recorded</span>
          )}
        </div>
        <h3>
          <Link href={isEnrolled ? `/student/courses/${course.courseId}` : `/courses/${course.courseId}`}>
            {course.presentation.displayTitle}
          </Link>
        </h3>
        <p className="store-card-description">{course.shortDescription}</p>
        <div className="store-course-facts">
          <span>{course.presentation.languageLabel}</span>
          <span className="tabular-nums">{course.duration} days</span>
          <span className="capitalize">{course.difficultyLevel}</span>
        </div>
        <div className="store-card-price">
          <div>
            <span className="store-small-label">{isEnrolled ? 'Access Status' : 'Full course'}</span>
            <div>
              {isEnrolled ? (
                <strong className="text-emerald-700 text-base">Active Enrolled</strong>
              ) : (
                <>
                  <strong className="tabular-nums">{formatCoursePrice(price, course.currency)}</strong>
                  {price < course.originalPrice && (
                    <del className="tabular-nums">
                      {formatCoursePrice(course.originalPrice, course.currency)}
                    </del>
                  )}
                </>
              )}
            </div>
          </div>
          <span className="store-card-arrow" aria-hidden="true">
            ↗
          </span>
        </div>
        {!isEnrolled && monthly && (
          <p className="store-monthly-line">
            or <b className="tabular-nums">{formatCoursePrice(monthly.price, monthly.currencyCode)}</b>{' '}
            / month with a subscription
          </p>
        )}
        <ButtonLink
          href={isEnrolled ? `/student/courses/${course.courseId}` : `/courses/${course.courseId}`}
          variant={isEnrolled ? 'primary' : 'secondary'}
          className="store-card-button"
        >
          {isEnrolled ? 'Go to Classroom' : 'Explore course'} <span aria-hidden="true">→</span>
        </ButtonLink>
      </div>
    </Card>
  );
}
