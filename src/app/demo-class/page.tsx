import type { Metadata } from 'next';
import { DemoClassPicker } from '@/components/marketing/DemoClassPicker';
import { getPublishedDemoClasses } from '@/services/demoClassService';

export const metadata: Metadata = {
  title: 'Demo Classes — MakeMeTopper',
  description:
    'Sample the MakeMeTopper teaching experience. Watch free demo classes across NEET, JEE, CUET, and Foundation.',
};

export default async function DemoClassPage() {
  const initialClasses = await getPublishedDemoClasses();

  return (
    <main id="store-main" className="pt-6 sm:pt-10">
      <section id="demo-catalog" className="store-container store-catalog-section">
        <DemoClassPicker initialClasses={initialClasses} />
      </section>

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
