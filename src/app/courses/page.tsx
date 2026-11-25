import type { Metadata } from 'next';
import { Suspense } from 'react';
import { CourseCatalog } from '@/components/marketing/CourseCatalog';
import { getCourses } from '@/services/courseCatalogService';

export const metadata: Metadata = {
  title: 'Explore Batches — MakeMeTopper',
  description:
    'Explore MakeMeTopper comprehensive courses and batches for NEET, JEE, CUET, and Foundation with flexible pricing and live interactive classes.',
};

export default async function CoursesPage() {
  const courses = await getCourses();
  return (
    <Suspense fallback={<div className="store-container py-16 text-center text-slate-400 font-medium">Loading batches…</div>}>
      <CourseCatalog courses={courses} />
    </Suspense>
  );
}
