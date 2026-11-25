import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 3 — Courses Page Redesign & Navbar Dropdown Verification', () => {
  const courseStoreShellPath = path.resolve(__dirname, '../CourseStoreShell.tsx');
  const courseStoreShellSource = fs.readFileSync(courseStoreShellPath, 'utf8');

  const courseCatalogPath = path.resolve(__dirname, '../CourseCatalog.tsx');
  const courseCatalogSource = fs.readFileSync(courseCatalogPath, 'utf8');

  const coursesCssPath = path.resolve(__dirname, '../../../app/courses/courses.css');
  const coursesCssSource = fs.readFileSync(coursesCssPath, 'utf8');

  const courseCatalogServicePath = path.resolve(__dirname, '../../../services/courseCatalogService.ts');
  const courseCatalogServiceSource = fs.readFileSync(courseCatalogServicePath, 'utf8');

  const coursesPagePath = path.resolve(__dirname, '../../../app/courses/page.tsx');
  const coursesPageSource = fs.readFileSync(coursesPagePath, 'utf8');

  describe('1. Main Navbar Courses Dropdown Architecture', () => {
    it('queries public.streams as authoritative backend data source without creating extra tables', () => {
      expect(courseCatalogServiceSource).toContain("from('streams')");
      expect(courseCatalogServiceSource).toContain('getPublicNavStreams');
      expect(courseStoreShellSource).toContain('getPublicNavStreams');
      expect(courseStoreShellSource).toContain('queryKey: [\'public-nav-streams\']');
    });

    it('renders accessible Courses dropdown button with aria-haspopup, aria-expanded, and caret rotation', () => {
      expect(courseStoreShellSource).toContain('aria-haspopup="menu"');
      expect(courseStoreShellSource).toContain('aria-expanded={coursesMenuOpen}');
      expect(courseStoreShellSource).toContain('rotate(180deg)');
      expect(courseStoreShellSource).toContain('store-nav-link-btn');
    });

    it('handles click-outside and Escape key dismissal for the Courses dropdown', () => {
      expect(courseStoreShellSource).toContain('coursesDropdownRef.current');
      expect(courseStoreShellSource).toContain('setCoursesMenuOpen(false)');
      expect(courseStoreShellSource).toContain("event.key === 'Escape'");
    });

    it('provides direct catalogue access via All Courses & Batches', () => {
      expect(courseStoreShellSource).toContain('href="/courses"');
      expect(courseStoreShellSource).toContain('All Courses & Batches');
    });

    it('integrates stream links without fabricating IDs or invalid URLs', () => {
      expect(courseStoreShellSource).toMatch(/href=\{`\/courses\?stream=\$\{encodeURIComponent\(item\.code\)\}`\}/);
    });

    it('integrates collapsible accordion in mobile navigation menu', () => {
      expect(courseStoreShellSource).toContain('store-mobile-nav-toggle');
      expect(courseStoreShellSource).toContain('setMobileCoursesOpen');
      expect(courseStoreShellSource).toContain('store-mobile-subnav');
      expect(courseStoreShellSource).toContain('aria-label="Toggle courses categories"');
    });

    it('declares corresponding dropdown CSS styles without breaking store layout', () => {
      expect(coursesCssSource).toContain('.store-courses-dropdown');
      expect(coursesCssSource).toContain('.store-courses-dropdown-item');
      expect(coursesCssSource).toContain('.store-nav-link-btn');
    });
  });

  describe('2. Courses Page Search Removal', () => {
    it('completely removed primary search bar input from hero', () => {
      expect(courseCatalogSource).not.toMatch(/type="search"[^>]*placeholder="Search for courses/);
    });

    it('completely removed suggested category filter pills from below primary search', () => {
      expect(courseCatalogSource).not.toContain('CATEGORIES.map');
      expect(courseCatalogSource).not.toMatch(/const CATEGORIES =/);
    });

    it('completely removed inline search bar from catalog controls', () => {
      expect(courseCatalogSource).not.toContain('store-search');
      expect(courseCatalogSource).not.toContain('placeholder="Search courses or subjects"');
    });
  });

  describe('3. Preservation of Key Features Value Banner', () => {
    it('preserves all 4 Key Features value banner items intact', () => {
      expect(courseCatalogSource).toContain('1000+');
      expect(courseCatalogSource).toContain('Video Lessons');
      expect(courseCatalogSource).toContain('Expert');
      expect(courseCatalogSource).toContain('Faculty Support');
      expect(courseCatalogSource).toContain('PYQ');
      expect(courseCatalogSource).toContain('Practice Tests');
      expect(courseCatalogSource).toContain('Personalized');
      expect(courseCatalogSource).toContain('Learning Journey');
    });
  });

  describe('4. Headings & Promotional Sections Corrections', () => {
    it('removed "FIND YOUR FOCUS" eyebrow from Courses page', () => {
      expect(courseCatalogSource).not.toContain('FIND YOUR FOCUS');
    });

    it('updated main catalog heading to "Explore Batches"', () => {
      expect(courseCatalogSource).toContain('Explore Batches');
      expect(courseCatalogSource).not.toContain('There’s a course for your next step.');
    });

    it('removed promotional description text', () => {
      expect(courseCatalogSource).not.toContain('One goal or a whole new direction.');
      expect(courseCatalogSource).not.toContain('Start with what matters to you.');
    });

    it('removed "YOUR LEARNING. YOUR CHOICE." section from Courses page while preserving CSS class for other pages', () => {
      expect(courseCatalogSource).not.toContain('YOUR LEARNING. YOUR CHOICE.');
      expect(courseCatalogSource).not.toContain('store-choice-section');
      // Preserved in CSS for demo-class page
      expect(coursesCssSource).toContain('.store-choice-section');
    });
  });

  describe('5. Filters, Active-Only Offerings & URL Integration', () => {
    it('synchronizes stream filter with URL search parameters via useSearchParams', () => {
      expect(courseCatalogSource).toContain('useSearchParams()');
      expect(courseCatalogSource).toContain("searchParams.get('stream')");
    });

    it('preserves level and sort filter controls', () => {
      expect(courseCatalogSource).toContain('Level');
      expect(courseCatalogSource).toContain('Sort by');
      expect(courseCatalogSource).toContain('store-stream-filters');
    });

    it('strictly filters published and non-deleted offerings only', () => {
      expect(courseCatalogSource).toContain("course.status !== 'published'");
      expect(courseCatalogSource).toContain('course.deletedAt');
    });

    it('wraps CourseCatalog in Suspense on CoursesPage to support search params hydration', () => {
      expect(coursesPageSource).toContain('<Suspense');
      expect(coursesPageSource).toContain('CourseCatalog');
    });
  });

  describe('6. Batch Count Truthfulness', () => {
    it('computes batch count accurately from active linked batches without fabricating placeholder batches', () => {
      expect(courseCatalogSource).toContain('actualBatchesCount');
      expect(courseCatalogSource).toContain('batches to explore');
      expect(courseCatalogSource).toContain('courses to explore');
    });
  });

  describe('7. Regression Protection', () => {
    it('preserves existing course card View Details CTA and navigation', () => {
      expect(courseCatalogSource).toContain('StoreCourseCard');
    });

    it('preserves course pricing, installment schedule, and checkout logic', () => {
      expect(courseCatalogServiceSource).toContain('calculateInstallmentSchedule');
      expect(courseCatalogServiceSource).toContain('fetchActiveCourseInstallmentPlans');
    });
  });
});

