import type { Metadata } from 'next';
import { DemoClassPicker } from '@/components/marketing/DemoClassPicker';
import { CourseArtwork } from '@/components/marketing/StoreCourseCard';
import { getPublishedDemoClasses } from '@/services/demoClassService';

export const metadata: Metadata = {
  title: 'Demo Classes — MakeMeTopper',
  description:
    'Sample the MakeMeTopper teaching experience. Watch free demo classes across NEET, JEE, CUET, and Foundation.',
};

export default async function DemoClassPage() {
  const initialClasses = await getPublishedDemoClasses();

  return (
    <main id="store-main">
      <section className="store-container store-hero store-reveal">
        <div className="store-hero-copy">
          <p className="store-eyebrow">
            <span className="store-status-dot" aria-hidden="true" /> EXPERIENCE MAKEMETOPPER
          </p>
          <h1>
            Try a class.
            <br />
            <span>Before you choose.</span>
          </h1>
          <p>
            Experience our pedagogy firsthand. Explore sample classes by subject, see how our mentors
            explain complex ideas, and take your first step with confidence.
          </p>
          <a className="store-hero-link" href="#demo-catalog">
            Browse demo classes <span aria-hidden="true">↓</span>
          </a>
          <div className="store-hero-caption">
            <span className="store-caption-rule" /> 100% FREE ACCESS · REAL CLASSROOM RECORDINGS · EXPERT MENTORS
          </div>
        </div>
        <div className="store-hero-visual" aria-hidden="true">
          <div className="store-visual-label">FREE DEMO COLLECTION</div>
          <div className="store-book book-back">
            <span>MASTERCLASS SERIES</span>
            <strong>
              sample
              <br />
              the craft.
            </strong>
            <div className="book-line" />
            <span>EXPERIENCE EXCELLENCE</span>
          </div>
          <div className="store-book book-front">
            <span>MAKE ME TOPPER</span>
            <strong>
              Watch &amp;
              <br />
              learn<span>.</span>
            </strong>
            <CourseArtwork stream="NEET" title="" />
            <span className="book-footer">FREE PREVIEWS AVAILABLE</span>
          </div>
          <div className="store-orbit-label">
            <span>▶</span>Instant free access
            <br />
            <b>No login required.</b>
          </div>
          <div className="store-visual-bottom">
            <span>01 / INTERACTIVE LEARNING</span>
            <span>✳</span>
          </div>
        </div>
      </section>

      <section className="store-benefits" aria-label="Demo class highlights">
        <div className="store-container">
          <span>
            <b aria-hidden="true">▶</b> Instant free playback
          </span>
          <span>
            <b aria-hidden="true">◎</b> Real lecture recordings
          </span>
          <span>
            <b aria-hidden="true">↗</b> All major exam streams
          </span>
          <span>
            <b aria-hidden="true">✓</b> Verified faculty
          </span>
        </div>
      </section>

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
