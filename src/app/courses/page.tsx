import type { Metadata } from 'next';
import { CourseCatalog } from '@/components/marketing/CourseCatalog';
import { getCourses } from '@/services/courseCatalogService';

export const metadata: Metadata = {
  title: 'Explore Courses — MakeMeTopper',
  description:
    'Explore MakeMeTopper comprehensive courses for NEET, JEE, CUET, and Foundation with flexible pricing and live interactive classes.',
};

export default async function CoursesPage() {
  const courses = await getCourses();
  return <CourseCatalog courses={courses} />;
}
