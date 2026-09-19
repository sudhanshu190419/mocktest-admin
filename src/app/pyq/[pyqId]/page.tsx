import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { CourseArtwork } from '@/components/marketing/StoreCourseCard';
import { PYQPackageCard } from '@/components/marketing/PYQCatalog';
import { PYQPricing } from '@/components/marketing/PYQPricing';
import { getPYQPackageById, getPYQPackages } from '@/services/pyqCatalogService';

interface PageProps {
  params: Promise<{ pyqId: string }>;
}

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { pyqId } = await params;
  const item = await getPYQPackageById(pyqId);
  return {
    title: item?.displayTitle ?? 'Package not found',
    description: item?.shortDescription,
  };
}

export default async function PYQDetailPage({ params }: PageProps) {
  const { pyqId } = await params;
  const item = await getPYQPackageById(pyqId);
  if (!item) notFound();

  const allPackages = await getPYQPackages();
  const related = allPackages
    .filter((entry) => entry.streamCode === item.streamCode && entry.packageId !== item.packageId)
    .slice(0, 2);

  return (
    <main id="store-main">
      <section className="store-container store-detail-hero store-reveal">
        <nav className="store-breadcrumb" aria-label="Breadcrumb">
          <Link href="/pyq">All PYQ packages</Link>
          <span aria-hidden="true">/</span>
          <span>{item.streamName}</span>
        </nav>
        <div className="store-detail-heading">
          <div>
            <p className="store-eyebrow">
              {item.streamName} <span> / </span> OFFICIAL EXAM ARCHIVES
            </p>
            <h1>{item.displayTitle}</h1>
            <p className="store-detail-lead">{item.shortDescription}</p>
            <div className="store-detail-meta">
              <span>
                <b aria-hidden="true">◷</b> <span className="tabular-nums">{item.yearRange}</span>
              </span>
              <span>
                <b aria-hidden="true">◎</b>{' '}
                <span className="tabular-nums">{item.totalPapers} papers</span>
              </span>
              <span>
                <b aria-hidden="true">✳</b>{' '}
                <span className="tabular-nums">{item.totalQuestions} questions</span>
              </span>
            </div>
          </div>
          <div className="store-detail-stamp" aria-hidden="true">
            <span>EVERY PAPER.</span>
            <strong>↗</strong>
            <span>EVERY ANSWER.</span>
          </div>
        </div>
      </section>
      <div className="store-container store-detail-grid">
        <div className="store-detail-content">
          <CourseArtwork
            stream={item.streamCode}
            title={item.subjectBreakdown.map((entry) => entry.subject).slice(0, 2).join('\n')}
            large
          />
          <div className="store-art-caption">
            <span>SOLVED. SORTED. OFFICIAL.</span>
            <span>Comprehensive exam archive</span>
          </div>
          <nav className="store-section-nav" aria-label="Package sections">
            <a href="#pyq-overview">Overview</a>
            <a href="#pyq-papers">Included Papers</a>
            <a href="#pyq-how">How it works</a>
            <a href="#pyq-faq">FAQs</a>
          </nav>
          <section id="pyq-overview" className="store-detail-section">
            <p className="store-eyebrow">THE BIG PICTURE</p>
            <h2>
              Practice with the <span>real thing.</span>
            </h2>
            <p>{item.description}</p>
            <div className="store-detail-highlights">
              {item.features.map((feature) => (
                <div key={feature}>
                  <span aria-hidden="true">✓</span>
                  <p>{feature}</p>
                </div>
              ))}
            </div>
            <div className="store-audience">
              <div>
                <span className="store-small-label">BEST FOR</span>
                <p>
                  Aspirants preparing for the {item.streamName} exam who want targeted question practice.
                </p>
              </div>
              <div>
                <span className="store-small-label">ACCESS</span>
                <p>{item.accessType} — lifetime access to all papers in this package.</p>
              </div>
            </div>
          </section>

          {/* Included Exam Papers Section */}
          <section id="pyq-papers" className="store-detail-section">
            <div className="store-detail-section-title">
              <div>
                <p className="store-eyebrow">COMPLETE PACKAGE SYLLABUS</p>
                <h2>Included Exam Papers.</h2>
              </div>
              <span className="store-small-label tabular-nums">
                {item.papers?.length || item.totalPapers} Papers · Full Solutions
              </span>
            </div>
            <p className="text-xs text-slate-500 mb-4 -mt-2">
              All official past papers included in this package are listed below. Every paper unlocks full timed test simulation and step-by-step solutions upon purchase.
            </p>

            <div className="space-y-3">
              {item.papers && item.papers.length > 0 ? (
                item.papers.map((paper, idx) => (
                  <div
                    key={paper.paperId || idx}
                    className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-xs hover:border-slate-300 transition-all"
                  >
                    <div className="flex items-start gap-3">
                      <div
                        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl text-base font-bold shadow-xs"
                        style={{ backgroundColor: 'var(--color-store-sky)', color: 'var(--color-store-blue)' }}
                      >
                        <span>{paper.examYear ? `${String(paper.examYear).slice(-2)}` : 'Q'}</span>
                      </div>
                      <div>
                        <div className="flex items-center gap-2">
                          <h3 className="text-sm font-bold text-slate-900">
                            {paper.title}
                          </h3>
                          {paper.examSession && paper.examSession !== 'Annual Session' && (
                            <span className="rounded-md bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600">
                              {paper.examSession}
                            </span>
                          )}
                        </div>
                        <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
                          {paper.examYear && <span>Exam Year: <strong className="text-slate-700">{paper.examYear}</strong></span>}
                          <span>·</span>
                          <span>{paper.totalQuestions} Questions</span>
                          {paper.durationMin && (
                            <>
                              <span>·</span>
                              <span>{paper.durationMin} Mins</span>
                            </>
                          )}
                          {paper.totalMarks && (
                            <>
                              <span>·</span>
                              <span>{paper.totalMarks} Marks</span>
                            </>
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-2 shrink-0 self-start sm:self-center">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-xs font-semibold text-amber-800">
                        <span className="text-xs" aria-hidden="true">🔒</span>
                        Unlocks on Purchase
                      </span>
                    </div>
                  </div>
                ))
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-slate-50 p-6 text-center text-xs text-slate-500">
                  Detailed papers list is being organized for this package.
                </div>
              )}
            </div>
          </section>
          <section id="pyq-how" className="store-detail-section">
            <p className="store-eyebrow">THREE SIMPLE STEPS</p>
            <h2>
              How it <span>works.</span>
            </h2>
            <ol className="store-steps">
              {item.howItWorks.map((step, index) => (
                <li key={step}>
                  <span className="tabular-nums">{String(index + 1).padStart(2, '0')}</span>
                  <p>{step}</p>
                </li>
              ))}
            </ol>
          </section>
          <section id="pyq-faq" className="store-detail-section">
            <p className="store-eyebrow">A LITTLE MORE CLARITY</p>
            <h2>Good questions. Clear answers.</h2>
            <div className="store-faq">
              {item.faqs.map((faq) => (
                <details key={faq.question}>
                  <summary>
                    {faq.question}
                    <span className="store-details-toggle" aria-hidden="true">
                      +
                    </span>
                  </summary>
                  <p>{faq.answer}</p>
                </details>
              ))}
            </div>
          </section>
        </div>
        <aside
          id="pyq-pricing"
          className="store-pricing-column"
          aria-label="Package price and purchase preview"
        >
          <PYQPricing item={item} />
          <div className="store-sidebar-note">
            <span aria-hidden="true">↗</span>
            <p>
              One price.
              <br />
              One payment.
              <br />
              <b>Yours forever.</b>
            </p>
          </div>
        </aside>
      </div>
      {related.length > 0 && (
        <section className="store-container store-related">
          <div className="store-section-heading">
            <div>
              <p className="store-eyebrow">KEEP PRACTISING</p>
              <h2>More packages.</h2>
            </div>
            <Link className="store-text-link" href="/pyq">
              See all packages ↗
            </Link>
          </div>
          <div className="store-related-grid">
            {related.map((entry) => (
              <PYQPackageCard key={entry.packageId} item={entry} />
            ))}
          </div>
        </section>
      )}
    </main>
  );
}
