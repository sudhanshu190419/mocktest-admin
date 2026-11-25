import { supabase } from '@/config/supabase';
import type { Course, CourseBatchItem, CourseInstallmentPlan } from '@/types/courseCatalog';

export interface NavStreamItem {
  streamId: string;
  name: string;
  code: string;
  displayOrder: number;
}

/**
 * Fetches active academic streams directly from `public.streams` for main navigation.
 * Uses public anonymous client and respects RLS policies.
 */
export async function getPublicNavStreams(): Promise<NavStreamItem[]> {
  try {
    const { data, error } = await supabase
      .from('streams')
      .select('stream_id, name, code, is_active, display_order')
      .eq('is_active', true)
      .order('display_order', { ascending: true })
      .order('name', { ascending: true });

    if (error || !data) {
      console.warn('Could not fetch public navigation streams:', error?.message);
      return [];
    }

    return data.map((s: any) => ({
      streamId: s.stream_id,
      name: s.name,
      code: (s.code || '').toUpperCase(),
      displayOrder: s.display_order ?? 0,
    }));
  } catch (err) {
    console.warn('Error in getPublicNavStreams:', err);
    return [];
  }
}

export function formatCoursePrice(amount: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
}


export interface InstallmentScheduleBreakdown {
  totalFee: number;
  numberOfInstallments: number;
  intervalMonths: number;
  standardTranche: number;
  finalTranche: number;
  hasRoundingAdjustment: boolean;
  schedule: Array<{
    index: number;
    amount: number;
    isFinal: boolean;
  }>;
}

/**
 * Calculates the installment schedule using exact remainder absorption matching Migration 221.
 * Standard tranches 1..(N-1) are rounded to 2 decimals, and the final tranche N absorbs the remainder
 * so that the sum of all installments equals totalFee exactly.
 */
export function calculateInstallmentSchedule(
  totalFee: number,
  numberOfInstallments: number,
  intervalMonths: number = 1
): InstallmentScheduleBreakdown {
  if (numberOfInstallments <= 0) {
    return {
      totalFee,
      numberOfInstallments: 0,
      intervalMonths,
      standardTranche: 0,
      finalTranche: 0,
      hasRoundingAdjustment: false,
      schedule: [],
    };
  }

  const standardTranche = Math.round((totalFee / numberOfInstallments) * 100) / 100;
  const finalTranche = Math.round((totalFee - standardTranche * (numberOfInstallments - 1)) * 100) / 100;
  const hasRoundingAdjustment = finalTranche !== standardTranche;

  const schedule = [];
  for (let i = 1; i <= numberOfInstallments; i++) {
    const isFinal = i === numberOfInstallments;
    schedule.push({
      index: i,
      amount: isFinal ? finalTranche : standardTranche,
      isFinal,
    });
  }

  return {
    totalFee,
    numberOfInstallments,
    intervalMonths,
    standardTranche,
    finalTranche,
    hasRoundingAdjustment,
    schedule,
  };
}

/**
 * Fetches active installment plans for a course directly from `course_installment_plans`.
 * Filters strictly by course_id and is_active = true.
 */
export async function fetchActiveCourseInstallmentPlans(
  courseId: string
): Promise<CourseInstallmentPlan[]> {
  try {
    const { data, error } = await supabase
      .from('course_installment_plans')
      .select(`
        plan_id,
        course_id,
        plan_name,
        total_fee,
        number_of_installments,
        interval_months,
        is_active,
        created_at,
        updated_at
      `)
      .eq('course_id', courseId)
      .eq('is_active', true)
      .order('number_of_installments', { ascending: true });

    if (error) {
      console.warn('Could not fetch course installment plans:', error.message);
      return [];
    }

    return (data || []).map((p: any) => ({
      planId: p.plan_id,
      courseId: p.course_id,
      planName: p.plan_name,
      totalFee: Number(p.total_fee),
      numberOfInstallments: Number(p.number_of_installments),
      intervalMonths: Number(p.interval_months),
      isActive: p.is_active ?? true,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));
  } catch (err) {
    console.warn('Error in fetchActiveCourseInstallmentPlans:', err);
    return [];
  }
}

function mapDbCourseRow(row: any): Course {
  const stream = row.streams || {};
  const streamCode = (stream.code || 'NEET').toUpperCase();

  const installmentPlans: CourseInstallmentPlan[] = (row.course_installment_plans || [])
    .filter((p: any) => p.is_active ?? true)
    .map((p: any) => ({
      planId: p.plan_id,
      courseId: p.course_id,
      planName: p.plan_name,
      totalFee: Number(p.total_fee),
      numberOfInstallments: Number(p.number_of_installments),
      intervalMonths: Number(p.interval_months),
      isActive: p.is_active ?? true,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    }));

  const rawBatches = Array.isArray(row.course_batches) ? row.course_batches : [];
  const batches: CourseBatchItem[] = rawBatches
    .map((cb: any) => {
      const b = Array.isArray(cb.batches) ? cb.batches[0] : cb.batches;
      if (!b) return null;
      const isActive = !b.deleted_at && b.status !== 'completed' && b.status !== 'archived';
      return {
        id: b.batch_id,
        name: b.name,
        code: b.batch_code || null,
        isActive,
        status: b.status || 'upcoming',
      };
    })
    .filter((b: CourseBatchItem | null): b is CourseBatchItem => b !== null && b.isActive);

  return {
    courseId: row.course_id,
    slug: row.slug || row.course_id,
    streamId: row.stream_id,
    streamCode,
    streamName: stream.name || streamCode,
    title: row.title,
    shortDescription: row.short_description || '',
    description: row.description || '',
    language: row.language || 'en',
    duration: row.duration || 0,
    difficultyLevel: row.difficulty_level || 'Medium',
    originalPrice: row.original_price || 0,
    discountedPrice: row.discounted_price ?? null,
    currency: row.currency || 'INR',
    thumbnailBucket: row.thumbnail_bucket,
    thumbnailPath: row.thumbnail_path,
    bannerBucket: row.banner_bucket,
    bannerPath: row.banner_path,
    featured: !!row.featured,
    trending: !!row.trending,
    status: row.status,
    deletedAt: row.deleted_at,
    publishedAt: row.published_at ?? null,
    sortOrder: row.sort_order || 0,
    presentation: {
      eyebrow: `${stream.name || streamCode} Course`,
      displayTitle: row.title,
      languageLabel: row.language === 'hi' ? 'Hindi' : 'English',
      format: 'Live + Recorded Batch',
      subjects: [],
      schedule: 'Daily interactive classes',
      audience: 'Aspirants',
      highlights: [
        'Live interactive classes with faculty',
        'Curated study material & chapter notes',
        'Periodic full-length mock tests with analysis',
        'Doubts resolution with academic mentors',
      ],
      faculty: [],
      curriculum: [],
      faqs: [
        {
          question: 'Will I get access to class recordings?',
          answer: 'Yes, full session recordings are available in your student portal after each live class.',
        },
        {
          question: 'What study materials are included?',
          answer: 'You receive downloadable PDFs, practice sheets, and revision notes.',
        },
      ],
    },
    installmentPlans,
    batches,
  };
}

export async function getCourses(): Promise<Course[]> {
  try {
    const defaultInstituteId = process.env.NEXT_PUBLIC_INSTITUTE_ID;
    let queryBuilder = supabase
      .from('courses')
      .select(`
        course_id,
        slug,
        stream_id,
        institute_id,
        title,
        short_description,
        description,
        language,
        duration,
        difficulty_level,
        original_price,
        discounted_price,
        currency,
        thumbnail_bucket,
        thumbnail_path,
        banner_bucket,
        banner_path,
        featured,
        trending,
        status,
        published_at,
        deleted_at,
        sort_order,
        streams:stream_id (
          stream_id,
          name,
          code
        ),
        course_installment_plans (
          plan_id,
          course_id,
          plan_name,
          total_fee,
          number_of_installments,
          interval_months,
          is_active
        ),
        course_batches (
          batch_id,
          batches (
            batch_id,
            name,
            batch_code,
            status,
            deleted_at
          )
        )
      `)
      .eq('status', 'published')
      .is('deleted_at', null);

    if (defaultInstituteId) {
      queryBuilder = queryBuilder.eq('institute_id', defaultInstituteId);
    }

    let rows: any[] = [];
    const { data, error } = await queryBuilder.order('sort_order', { ascending: true });

    if (error) {
      console.warn('Attempting fallback query for courses without nested batches:', error.message);
      let fallbackBuilder = supabase
        .from('courses')
        .select(`
          course_id,
          slug,
          stream_id,
          institute_id,
          title,
          short_description,
          description,
          language,
          duration,
          difficulty_level,
          original_price,
          discounted_price,
          currency,
          thumbnail_bucket,
          thumbnail_path,
          banner_bucket,
          banner_path,
          featured,
          trending,
          status,
          published_at,
          deleted_at,
          sort_order,
          streams:stream_id (
            stream_id,
            name,
            code
          ),
          course_installment_plans (
            plan_id,
            course_id,
            plan_name,
            total_fee,
            number_of_installments,
            interval_months,
            is_active
          )
        `)
        .eq('status', 'published')
        .is('deleted_at', null);

      if (defaultInstituteId) {
        fallbackBuilder = fallbackBuilder.eq('institute_id', defaultInstituteId);
      }

      const fallbackRes = await fallbackBuilder.order('sort_order', { ascending: true });
      if (fallbackRes.error || !fallbackRes.data) {
        if (fallbackRes.error) console.error('Failed to fetch courses fallback from Supabase:', fallbackRes.error.message);
        return [];
      }
      rows = fallbackRes.data;
    } else {
      rows = data || [];
    }

    return rows.map(mapDbCourseRow);
  } catch (err) {
    console.error('Error in getCourses:', err);
    return [];
  }
}

/**
 * Fetch published trending courses strictly for the Homepage Course Collection.
 *
 * Enforces exact mobile selection & priority rules:
 * - status = 'published'
 * - deleted_at IS NULL
 * - trending = true
 * - ordered by featured DESC, published_at DESC NULLS LAST
 */
export async function getHomepageTrendingCourses(): Promise<Course[]> {
  try {
    const defaultInstituteId = process.env.NEXT_PUBLIC_INSTITUTE_ID;
    let queryBuilder = supabase
      .from('courses')
      .select(`
        course_id,
        slug,
        stream_id,
        institute_id,
        title,
        short_description,
        description,
        language,
        duration,
        difficulty_level,
        original_price,
        discounted_price,
        currency,
        thumbnail_bucket,
        thumbnail_path,
        banner_bucket,
        banner_path,
        featured,
        trending,
        status,
        published_at,
        deleted_at,
        sort_order,
        streams:stream_id (
          stream_id,
          name,
          code
        ),
        course_installment_plans (
          plan_id,
          course_id,
          plan_name,
          total_fee,
          number_of_installments,
          interval_months,
          is_active
        ),
        course_batches (
          batch_id,
          batches (
            batch_id,
            name,
            batch_code,
            status,
            deleted_at
          )
        )
      `)
      .eq('status', 'published')
      .is('deleted_at', null)
      .eq('trending', true);

    if (defaultInstituteId) {
      queryBuilder = queryBuilder.eq('institute_id', defaultInstituteId);
    }

    let rows: any[] = [];
    const { data, error } = await queryBuilder
      .order('featured', { ascending: false })
      .order('published_at', { ascending: false, nullsFirst: false });

    if (error) {
      console.warn('Attempting fallback query for homepage trending courses without nested batches:', error.message);
      let fallbackBuilder = supabase
        .from('courses')
        .select(`
          course_id,
          slug,
          stream_id,
          institute_id,
          title,
          short_description,
          description,
          language,
          duration,
          difficulty_level,
          original_price,
          discounted_price,
          currency,
          thumbnail_bucket,
          thumbnail_path,
          banner_bucket,
          banner_path,
          featured,
          trending,
          status,
          published_at,
          deleted_at,
          sort_order,
          streams:stream_id (
            stream_id,
            name,
            code
          ),
          course_installment_plans (
            plan_id,
            course_id,
            plan_name,
            total_fee,
            number_of_installments,
            interval_months,
            is_active
          )
        `)
        .eq('status', 'published')
        .is('deleted_at', null)
        .eq('trending', true);

      if (defaultInstituteId) {
        fallbackBuilder = fallbackBuilder.eq('institute_id', defaultInstituteId);
      }

      const fallbackRes = await fallbackBuilder
        .order('featured', { ascending: false })
        .order('published_at', { ascending: false, nullsFirst: false });

      if (fallbackRes.error || !fallbackRes.data) {
        if (fallbackRes.error) console.error('Failed to fetch homepage trending courses fallback from Supabase:', fallbackRes.error.message);
        return [];
      }
      rows = fallbackRes.data;
    } else {
      rows = data || [];
    }

    return rows.map(mapDbCourseRow);
  } catch (err) {
    console.error('Error in getHomepageTrendingCourses:', err);
    return [];
  }
}

export async function getCourseById(courseId: string): Promise<Course | null> {
  const courses = await getCourses();
  return courses.find((c) => c.courseId === courseId || c.slug === courseId) || null;
}
