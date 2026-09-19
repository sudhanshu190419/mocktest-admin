import { supabase } from '@/config/supabase';
import type { Course, SubscriptionPlan } from '@/types/courseCatalog';

export function formatCoursePrice(amount: number, currency: string = 'INR'): string {
  return new Intl.NumberFormat('en-IN', {
    style: 'currency',
    currency,
    maximumFractionDigits: 0,
  }).format(amount);
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
        deleted_at,
        sort_order,
        streams:stream_id (
          stream_id,
          name,
          code
        ),
        subscription_plans (
          plan_id,
          course_id,
          name,
          slug,
          description,
          price,
          currency_code,
          billing_cycle,
          duration_days,
          trial_days,
          is_featured,
          sort_order,
          is_active
        )
      `)
      .eq('status', 'published')
      .is('deleted_at', null);

    if (defaultInstituteId) {
      queryBuilder = queryBuilder.eq('institute_id', defaultInstituteId);
    }

    const { data, error } = await queryBuilder.order('sort_order', { ascending: true });

    if (error || !data) {
      if (error) console.error('Failed to fetch courses from Supabase:', error.message);
      return [];
    }

    return data.map((row: any): Course => {
      const stream = row.streams || {};
      const streamCode = (stream.code || 'NEET').toUpperCase();
      const plans: SubscriptionPlan[] = (row.subscription_plans || []).map((p: any) => ({
        planId: p.plan_id,
        courseId: p.course_id,
        name: p.name,
        slug: p.slug,
        description: p.description || '',
        price: p.price,
        currencyCode: p.currency_code || 'INR',
        billingCycle: p.billing_cycle,
        durationDays: p.duration_days,
        trialDays: p.trial_days || 0,
        isFeatured: !!p.is_featured,
        sortOrder: p.sort_order || 0,
        isActive: p.is_active ?? true,
        features: [],
      }));

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
        plans,
      };
    });
  } catch (err) {
    console.error('Error in getCourses:', err);
    return [];
  }
}

export async function getCourseById(courseId: string): Promise<Course | null> {
  const courses = await getCourses();
  return courses.find((c) => c.courseId === courseId || c.slug === courseId) || null;
}
