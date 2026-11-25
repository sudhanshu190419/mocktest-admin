import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 4 PYQ Page Redesign & Architectural Contracts', () => {
  const pyqCatalogPath = path.resolve(__dirname, '../PYQCatalog.tsx');
  const pyqCatalogSource = fs.readFileSync(pyqCatalogPath, 'utf8');

  const pyqPagePath = path.resolve(__dirname, '../../../app/pyq/page.tsx');
  const pyqPageSource = fs.readFileSync(pyqPagePath, 'utf8');

  const shellPath = path.resolve(__dirname, '../CourseStoreShell.tsx');
  const shellSource = fs.readFileSync(shellPath, 'utf8');

  const courseCatalogPath = path.resolve(__dirname, '../CourseCatalog.tsx');
  const courseCatalogSource = fs.readFileSync(courseCatalogPath, 'utf8');

  const heroSectionPath = path.resolve(__dirname, '../HeroSection.tsx');
  const heroSectionSource = fs.readFileSync(heroSectionPath, 'utf8');

  it('1. PYQ page displays "PYQ & Mock Test" in metadata, navbar, and hero badge', () => {
    // Page metadata title
    expect(pyqPageSource).toContain("title: 'PYQ & Mock Test — MakeMeTopper'");

    // Shared navbar item
    expect(shellSource).toContain("{ key: 'nav-pyq', href: '/pyq', label: 'PYQ & Mock Test', current: pathname.startsWith('/pyq') }");

    // Hero eyebrow badge
    expect(pyqCatalogSource).toContain('<span>PYQ & MOCK TEST</span>');
    expect(pyqCatalogSource).not.toContain('<span>PREVIOUS YEAR QUESTIONS</span>');
  });

  it('2. Existing CTA button displays "Explore Mock Test"', () => {
    expect(pyqCatalogSource).toContain('Explore Mock Test');
    expect(pyqCatalogSource).not.toContain('View Sample Questions');
  });

  it('3. CTA button preserves original destination, href="#pyq-catalog", and anchor structure', () => {
    const ctaMatch = pyqCatalogSource.match(/<a\s+href="#pyq-catalog"[^>]*>[\s\S]*?Explore Mock Test[\s\S]*?<\/a>/);
    expect(ctaMatch).not.toBeNull();
    expect(ctaMatch![0]).toContain('href="#pyq-catalog"');
  });

  it('4. Key Features displays "Subject-wise PYQs" on both desktop and mobile layouts', () => {
    expect(pyqCatalogSource).toContain('Subject-wise PYQs');
    expect(pyqCatalogSource).not.toContain('Chapter-wise PYQs');
    // Verifies desktop card heading
    expect(pyqCatalogSource).toContain('<h4 className="text-[13.5px] xl:text-[14px] font-bold text-slate-900 leading-tight">Subject-wise PYQs</h4>');
    // Verifies mobile card heading
    expect(pyqCatalogSource).toMatch(/<h4[^>]*>\s*Subject-wise PYQs\s*<\/h4>/);
  });

  it('5. Pick Your Paper section and eyebrow are completely removed from DOM rendering', () => {
    expect(pyqCatalogSource).not.toContain('PICK YOUR PAPERS');
    expect(pyqCatalogSource).not.toContain('Official previous year question packages.');
  });

  it('6. PYQ package listing section heading displays "Explore PYQ Packages"', () => {
    expect(pyqCatalogSource).toContain('<h2>Explore PYQ Packages</h2>');
  });

  it('7. PYQ bundle cards do not display question counts', () => {
    // PYQPackageCard facts row should NOT contain totalQuestions or "questions" fact
    expect(pyqCatalogSource).not.toMatch(/item\.totalQuestions\s*questions/);
    expect(pyqCatalogSource).not.toContain('{item.totalQuestions} questions');
    // Preserves year range and paper count
    expect(pyqCatalogSource).toContain('{item.yearRange}');
    expect(pyqCatalogSource).toContain('{item.totalPapers} papers');
  });

  it('8. PYQ bundle cards do not display "Lifetime Access"', () => {
    // Monthly line should simply display "Online practice" without item.accessType
    expect(pyqCatalogSource).not.toMatch(/<b>\{item\.accessType\}<\/b>\s*·\s*Online practice/);
    expect(pyqCatalogSource).toMatch(/<p className="store-monthly-line">\s*Online practice\s*<\/p>/);
  });

  it('9. Non-bundle course cards remain unaffected in StoreCourseCard', () => {
    const storeCourseCardPath = path.resolve(__dirname, '../StoreCourseCard.tsx');
    const storeCourseCardSource = fs.readFileSync(storeCourseCardPath, 'utf8');
    expect(storeCourseCardSource).toContain('{course.duration} days');
    expect(storeCourseCardSource).toContain('View Details');
  });

  it('10. Existing PYQ package pricing, currency, and discounts remain intact', () => {
    expect(pyqCatalogSource).toContain('formatCoursePrice(item.discountedPrice, item.currency)');
    expect(pyqCatalogSource).toContain('formatCoursePrice(item.originalPrice, item.currency)');
    expect(pyqCatalogSource).toContain("isPurchased ? 'Continue Practice' : 'View Package'");
  });

  it('11. Existing PYQ purchase and entitlement functionality remains intact', () => {
    expect(pyqCatalogSource).toContain('useStudentPyqPurchases');
    expect(pyqCatalogSource).toContain('purchasedPackageIds.includes(item.packageId)');
    expect(pyqCatalogSource).toContain("isPurchased ? '/student/tests' : `/pyq/${item.packageId}`");
  });

  it('12. Excluded requirement: No new PYQ filters (year-wise, subject-wise, bundle-package filters) were added', () => {
    expect(pyqCatalogSource).not.toContain('yearFilter');
    expect(pyqCatalogSource).not.toContain('subjectFilter');
    expect(pyqCatalogSource).not.toContain('bundleFilter');
    // Retains standard stream filters
    expect(pyqCatalogSource).toContain("STREAMS: { code: ExamStreamCode | 'ALL'; label: string }[]");
  });

  it('13. Approved requirement: Two separate catalogue sections exist on the page', () => {
    expect(pyqCatalogSource).toContain('<h2>Explore PYQ Packages</h2>');
    expect(pyqCatalogSource).toContain('<h2>Explore Mock Tests</h2>');
    expect(pyqCatalogSource).not.toContain('MockTestCatalog');
  });

  it('14. Homepage and Courses page remain strictly preserved', () => {
    // Homepage HeroSection preserves existing primary and secondary CTAs
    expect(heroSectionSource).toContain('Browse Courses');
    expect(heroSectionSource).toContain('Explore PYQ Packages');

    // CourseCatalog preserves Phase 3 Explore Batches header
    expect(courseCatalogSource).toContain('Explore Batches');
  });

  it('15. Demo Classes and My Learning routing contracts remain preserved in shell', () => {
    expect(shellSource).toContain("{ key: 'nav-live', href: '/demo-class', label: 'Demo'");
    expect(shellSource).toContain("{ key: 'nav-learning', href: '/student/overview', label: 'My Learning'");
  });
});
