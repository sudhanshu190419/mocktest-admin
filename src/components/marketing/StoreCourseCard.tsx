'use client';

import Link from 'next/link';
import { Card } from './Card';
import {
  IconArrowRight,
  IconCalendar,
} from '@/components/icons/student-icons';
import { formatCoursePrice } from '@/services/courseCatalogService';
import type { Course, CourseBatchItem } from '@/types/courseCatalog';

export function CourseArtwork({
  stream,
  title,
  large = false,
  imageUrl,
}: {
  stream: Course['streamCode'];
  title?: string;
  large?: boolean;
  imageUrl?: string | null;
}) {
  if (imageUrl) {
    return (
      <div className={`store-course-card-thumb ${large ? 'store-course-card-thumb-large' : ''} relative overflow-hidden`}>
        <img
          src={imageUrl}
          alt={title || `${stream} Course`}
          className="store-course-thumb-img"
          loading="lazy"
        />
        {title && (
          <div className="absolute inset-0 bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent flex items-end p-3.5 sm:p-4 z-[2] pointer-events-none">
            <span className="text-white text-sm sm:text-base font-bold font-display leading-snug drop-shadow-sm line-clamp-2">
              {title}
            </span>
          </div>
        )}
      </div>
    );
  }

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
        EXPLORE BATCHES <span>↗</span>
      </span>
    </div>
  );
}

export function StoreCourseCard({
  course,
  batch,
  isEnrolled = false,
}: {
  course: Course;
  batch?: CourseBatchItem | { id: string; name: string; code?: string | null };
  isEnrolled?: boolean;
}) {
  const price = course.discountedPrice ?? course.originalPrice;
  const STREAM_COVER_IMAGES: Record<string, string> = {
    NEET: '/course/neet.png',
    CUET: '/course/cuet.png',
  };
  const streamCode = course.streamCode?.toUpperCase();
  const topImage = STREAM_COVER_IMAGES[streamCode] || course.thumbnailPath || course.bannerPath || null;
  const batchName = batch?.name || course.presentation?.displayTitle || course.title;
  const isDedicatedBatch = Boolean(batch?.name && batch.name !== course.title);
  const courseUrl = isEnrolled ? `/student/courses/${course.courseId}` : `/courses/${course.slug || course.courseId}`;

  return (
    <Card className="store-course-card" interactive>
      <Link href={courseUrl} tabIndex={-1} aria-hidden="true">
        <CourseArtwork
          stream={course.streamCode}
          title={batchName}
          imageUrl={topImage}
        />
      </Link>
      <div className="store-course-card-body">
        <div className="store-card-meta">
          <span className={`store-stream-tag tag-${course.streamCode.toLowerCase()}`}>
            {course.streamCode === 'FOUNDATION' ? 'Foundation' : course.streamCode}
          </span>
          {isEnrolled && (
            <span className="px-2 py-0.5 rounded text-caption font-bold bg-emerald-100 text-emerald-800">
              Enrolled ✓
            </span>
          )}
        </div>
        {isDedicatedBatch && (
          <p className="text-[11px] font-semibold text-slate-500 uppercase tracking-wider mb-1 line-clamp-1">
            {course.title}
          </p>
        )}
        <h3>
          <Link href={courseUrl}>
            {batchName}
          </Link>
        </h3>
        <p className="store-card-description">{course.shortDescription || course.description}</p>
        <div className="store-course-facts">
          <span className="store-fact-item">
            <IconCalendar size={13} className="store-fact-icon shrink-0" />
            <span className="tabular-nums">{course.duration} days</span>
          </span>
        </div>
        <div className="store-card-price">
          <div className="store-card-price-info">
            <span className="store-small-label">{isEnrolled ? 'Access Status' : 'Full course'}</span>
            <div className="store-card-price-row">
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
            {!isEnrolled && course.installmentPlans && course.installmentPlans.length > 0 && (
              <p className="store-monthly-line text-xs text-slate-500">
                Installment plans available
              </p>
            )}
          </div>
          <Link
            href={courseUrl}
            className={`store-card-cta ${isEnrolled ? 'store-card-cta-enrolled' : 'store-card-cta-explore'}`}
          >
            <span className="store-card-cta-text">
              {isEnrolled ? 'Go to Course' : 'View Details'}
            </span>
            <span className="store-card-cta-arrow" aria-hidden="true">
              <IconArrowRight size={13} />
            </span>
          </Link>
        </div>
      </div>
    </Card>
  );
}

