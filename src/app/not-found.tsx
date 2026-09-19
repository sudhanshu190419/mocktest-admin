import Link from 'next/link';
import { CourseStoreShell } from '@/components/marketing/CourseStoreShell';
import { ButtonLink } from '@/components/marketing/Button';
import { MagnifyingGlass, House, BookOpen, GraduationCap } from '@phosphor-icons/react/dist/ssr';
import '@/app/courses/courses.css';

export default function NotFound() {
  return (
    <div className="course-store store-home min-h-screen flex flex-col justify-between">
      <CourseStoreShell>
        <main id="store-main" className="store-container py-16 lg:py-24">
          <div className="max-w-2xl mx-auto text-center bg-white border border-slate-200/80 rounded-3xl p-8 sm:p-12 shadow-sm">
            <div className="w-16 h-16 rounded-2xl bg-blue-50 border border-blue-100 flex items-center justify-center text-blue-600 mx-auto mb-6">
              <MagnifyingGlass size={32} weight="duotone" />
            </div>

            <p className="text-xs font-mono font-bold text-blue-600 tracking-wider uppercase mb-2">
              404 · PAGE NOT FOUND
            </p>
            <h1 className="text-2xl sm:text-4xl font-extrabold text-slate-900 tracking-tight font-display mb-4">
              We couldn&apos;t find that page.
            </h1>
            <p className="text-sm text-slate-600 leading-relaxed max-w-md mx-auto mb-8">
              The page or course you are looking for might have been moved, unpublished, or doesn&apos;t exist yet in the catalog.
            </p>

            <div className="flex flex-wrap items-center justify-center gap-3 mb-8">
              <ButtonLink href="/" className="store-enroll-button !mt-0 !w-auto inline-flex items-center gap-2 text-xs font-bold">
                <House size={15} weight="bold" />
                <span>Return to Home</span>
              </ButtonLink>
              <ButtonLink
                href="/courses"
                variant="secondary"
                className="!w-auto inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <BookOpen size={15} weight="bold" />
                <span>Explore Courses</span>
              </ButtonLink>
              <ButtonLink
                href="/pyq"
                variant="secondary"
                className="!w-auto inline-flex items-center gap-2 text-xs font-semibold px-4 py-2.5 rounded-xl border border-slate-200 text-slate-700 hover:bg-slate-50"
              >
                <GraduationCap size={15} weight="bold" />
                <span>PYQ Packages</span>
              </ButtonLink>
            </div>

            <div className="pt-6 border-t border-slate-100 text-xs text-slate-500">
              Need help? <Link href="/demo-class" className="text-blue-600 font-semibold hover:underline">Watch a free demo class</Link> or visit your <Link href="/student/overview" className="text-blue-600 font-semibold hover:underline">Student Dashboard</Link>.
            </div>
          </div>
        </main>
      </CourseStoreShell>
    </div>
  );
}
