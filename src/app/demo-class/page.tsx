import type { Metadata } from 'next';
import { Suspense } from 'react';
import { DemoClassPicker } from '@/components/marketing/DemoClassPicker';
import { getPublishedDemoClasses } from '@/services/demoClassService';
import { getCourses } from '@/services/courseCatalogService';
import { FreeDemoSection } from '@/components/marketing/FreeDemoSection';

export const metadata: Metadata = {
  title: 'Demo Classes — MakeMeTopper',
  description:
    'Sample the MakeMeTopper teaching experience. Watch free demo classes across NEET, JEE, CUET, and Foundation.',
};

export default async function DemoClassPage() {
  const [initialClasses, courses] = await Promise.all([
    getPublishedDemoClasses(),
    getCourses().catch((err) => {
      console.warn('Could not fetch courses for demo class filters:', err);
      return [];
    }),
  ]);

  return (
    <main id="store-main" className="pt-4 sm:pt-6">
      {/* ── 1. Reused Homepage Demo Classes Banner (Hero) ── */}
      <FreeDemoSection primaryHref="#demo-catalog" secondaryHref="#demo-catalog" />

      {/* ── 2. Demo Classes Catalog & Filters Section ── */}
      <section id="demo-catalog" className="store-container store-catalog-section scroll-mt-6">
        <Suspense fallback={<div className="store-container py-16 text-center text-slate-400 font-medium">Loading demo classes…</div>}>
          <DemoClassPicker initialClasses={initialClasses} courses={courses} />
        </Suspense>
      </section>

      {/* ── 3. Why Watch Demo Classes Section Preserved ── */}
      <section className="store-container store-choice-section" aria-label="Why watch demo classes">
        <div>
          <p className="store-eyebrow">YOUR LEARNING. YOUR CHOICE.</p>
          <h2>
            Confidence in every step.
            <br />
            <span>Discover why thousands of aspirants choose MakeMeTopper.</span>
          </h2>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number">01</span>
          <h3>Concept-First Methodology</h3>
          <p>Our educators focus on fundamental problem solving and intuitive frameworks, not rote memorization.</p>
        </div>
        <div className="store-choice-item">
          <span className="store-choice-number">02</span>
          <h3>Full Batch Continuity</h3>
          <p>Loved the demo? Jump straight into live scheduled batches with doubt resolution and daily practice.</p>
        </div>
      </section>
    </main>
  );
}
