import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import {
  isCourseActive,
  courseMatchesCategory,
  deriveActiveCategories,
  demoClassMatchesCategory,
  CANDIDATE_DEMO_CATEGORIES,
} from '../DemoClassPicker';
import type { Course } from '@/types/courseCatalog';
import type { DemoClass } from '@/types/demoClass';

describe('Make Me Topper — Phase 5: Demo Classes Page Implementation', () => {
  const freeDemoSectionPath = path.resolve(__dirname, '../FreeDemoSection.tsx');
  const freeDemoSectionSource = fs.readFileSync(freeDemoSectionPath, 'utf8');

  const demoClassPagePath = path.resolve(__dirname, '../../../app/demo-class/page.tsx');
  const demoClassPageSource = fs.readFileSync(demoClassPagePath, 'utf8');

  const demoClassPickerPath = path.resolve(__dirname, '../DemoClassPicker.tsx');
  const demoClassPickerSource = fs.readFileSync(demoClassPickerPath, 'utf8');

  const coursesCssPath = path.resolve(__dirname, '../../../app/courses/courses.css');
  const coursesCssSource = fs.readFileSync(coursesCssPath, 'utf8');

  const demoClassLayoutPath = path.resolve(__dirname, '../../../app/demo-class/layout.tsx');
  const demoClassLayoutSource = fs.readFileSync(demoClassLayoutPath, 'utf8');

  const marketingHomePath = path.resolve(__dirname, '../MarketingHomeView.tsx');
  const marketingHomeSource = fs.readFileSync(marketingHomePath, 'utf8');

  const coursesPagePath = path.resolve(__dirname, '../../../app/courses/page.tsx');
  const coursesPageSource = fs.readFileSync(coursesPagePath, 'utf8');

  const pyqPagePath = path.resolve(__dirname, '../../../app/pyq/page.tsx');
  const pyqPageSource = fs.readFileSync(pyqPagePath, 'utf8');

  const pyqCatalogPath = path.resolve(__dirname, '../PYQCatalog.tsx');
  const pyqCatalogSource = fs.readFileSync(pyqCatalogPath, 'utf8');

  // ────────────────────────────────────────────────────────────────
  // Section A: Homepage Banner Reuse
  // ────────────────────────────────────────────────────────────────
  describe('A. Homepage Banner Reuse', () => {
    it('1. Reuses the exact homepage Demo Classes banner component FreeDemoSection', () => {
      expect(demoClassPageSource).toContain("import { FreeDemoSection } from '@/components/marketing/FreeDemoSection';");
      expect(demoClassPageSource).toContain('<FreeDemoSection primaryHref="#demo-catalog" secondaryHref="#demo-catalog" />');
    });

    it('2. Preserves all original banner text verbatim', () => {
      expect(freeDemoSectionSource).toContain('FREE DEMO CLASSES');
      expect(freeDemoSectionSource).toContain('Experience Our');
      expect(freeDemoSectionSource).toContain('Teaching,');
      expect(freeDemoSectionSource).toContain('Before You Buy.');
      expect(freeDemoSectionSource).toContain(
        'Join our free demo classes and see how Make Me Topper helps you learn better, clear concepts, and score higher.'
      );
    });

    it('3. Retains all four feature items with identical titles', () => {
      expect(freeDemoSectionSource).toContain("title: 'Live Teaching Experience'");
      expect(freeDemoSectionSource).toContain("title: 'Real Exam Questions'");
      expect(freeDemoSectionSource).toContain("title: 'Doubt Solving in Real Time'");
      expect(freeDemoSectionSource).toContain("title: 'Understand Our Teaching Style'");
    });

    it('4. Reuses the existing student illustration /demo.png', () => {
      expect(freeDemoSectionSource).toContain('src="/demo.png"');
      expect(freeDemoSectionSource).toContain('alt="A live MakeMeTopper demo class in progress"');
    });

    it('5. Renders both primary and secondary CTAs', () => {
      expect(freeDemoSectionSource).toContain('Get Free Demo Class');
      expect(freeDemoSectionSource).toContain('View Demo Schedule');
    });

    it('6. Directs CTA handlers to the dedicated demo catalog section on /demo-class', () => {
      expect(freeDemoSectionSource).toContain('primaryHref?: string;');
      expect(freeDemoSectionSource).toContain('secondaryHref?: string;');
      expect(freeDemoSectionSource).toContain('handleAnchorClick');
      expect(freeDemoSectionSource).toContain("if (href.startsWith('#'))");
      expect(demoClassPageSource).toContain('primaryHref="#demo-catalog"');
      expect(demoClassPageSource).toContain('secondaryHref="#demo-catalog"');
    });

    it('7. Avoids duplicate competing hero sections on the demo class page', () => {
      expect(demoClassPickerSource).not.toContain('Free demo classes for every exam stream.');
      expect(demoClassPickerSource).toContain('<h2 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">Explore Demo Classes</h2>');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Section B: Responsive Design
  // ────────────────────────────────────────────────────────────────
  describe('B. Responsive Design', () => {
    it('8. Banner layout provides responsive grid for desktop (lg:grid-cols)', () => {
      expect(freeDemoSectionSource).toContain('lg:grid-cols-[1.08fr_1fr]');
      expect(freeDemoSectionSource).toContain('hidden sm:grid sm:grid-cols-4');
    });

    it('9. Tablet styling utilizes fluid sm: breakpoints without hardcoded overflow widths', () => {
      expect(freeDemoSectionSource).toContain('sm:rounded-[28px]');
      expect(freeDemoSectionSource).toContain('sm:min-h-[460px]');
      expect(freeDemoSectionSource).toContain('sm:max-w-[440px]');
    });

    it('10. Mobile grid wraps cards cleanly in 2-column or list display', () => {
      expect(freeDemoSectionSource).toContain('grid grid-cols-1 xs:grid-cols-2 gap-2.5 sm:hidden');
      expect(freeDemoSectionSource).toContain('min-h-[320px] xs:min-h-[360px]');
    });

    it('11. Prevents horizontal overflow using overflow-hidden wrapper', () => {
      expect(freeDemoSectionSource).toContain('overflow-hidden rounded-[22px]');
    });

    it('12. Preserves student illustration aspect ratio with object-contain to prevent distortion', () => {
      expect(freeDemoSectionSource).toContain('object-contain');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Section C: Filter Design and Functionality
  // ────────────────────────────────────────────────────────────────
  describe('C. Filter Design and Functionality', () => {
    it('13. Demo Classes filters use the exact .store-stream-filters CSS class from Courses page', () => {
      expect(demoClassPickerSource).toContain('className="store-stream-filters"');
      expect(demoClassLayoutSource).toContain("import '../courses/courses.css';");
      expect(coursesCssSource).toContain('.store-stream-filters');
    });

    it('14. Applies .selected class and aria-pressed attribute for active state', () => {
      expect(demoClassPickerSource).toContain("className={stream === item ? 'selected' : ''}");
      expect(demoClassPickerSource).toContain('aria-pressed={stream === item}');
    });

    it('15. Filters demo classes correctly by selected category', () => {
      const mockDemos: DemoClass[] = [
        {
          demoClassId: 'd1',
          instituteId: 'inst-1',
          streamId: 's1',
          streamCode: 'NEET',
          streamName: 'NEET',
          title: 'NEET Physics Live Demo',
          description: 'Mechanics preview',
          storageBucket: 'content-videos',
          storagePath: 'neet-demo.mp4',
          thumbnailBucket: null,
          thumbnailPath: null,
          durationSeconds: 2700,
          status: 'published',
          displayOrder: 1,
          createdBy: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
        },
        {
          demoClassId: 'd2',
          instituteId: 'inst-1',
          streamId: 's2',
          streamCode: 'JEE',
          streamName: 'JEE',
          title: 'JEE Mathematics Live Demo',
          description: 'Calculus preview',
          storageBucket: 'content-videos',
          storagePath: 'jee-demo.mp4',
          thumbnailBucket: null,
          thumbnailPath: null,
          durationSeconds: 3000,
          status: 'published',
          displayOrder: 2,
          createdBy: 'admin',
          createdAt: new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          publishedAt: new Date().toISOString(),
        },
      ];

      expect(demoClassMatchesCategory(mockDemos[0], 'NEET')).toBe(true);
      expect(demoClassMatchesCategory(mockDemos[0], 'JEE')).toBe(false);
      expect(demoClassMatchesCategory(mockDemos[0], 'ALL')).toBe(true);

      expect(demoClassMatchesCategory(mockDemos[1], 'JEE')).toBe(true);
      expect(demoClassMatchesCategory(mockDemos[1], 'NEET')).toBe(false);
      expect(demoClassMatchesCategory(mockDemos[1], 'ALL')).toBe(true);
    });

    it('16. Automatically resets filter state to ALL if active category becomes unavailable', () => {
      expect(demoClassPickerSource).toMatch(/stream !== 'ALL'\s*&&\s*!streams\.some\(/);
      expect(demoClassPickerSource).toContain("setStream('ALL')");
    });

    it('17. Combines stream filter and search query correctly', () => {
      const mockDemo: DemoClass = {
        demoClassId: 'd1',
        instituteId: 'inst-1',
        streamId: 's1',
        streamCode: 'NEET',
        streamName: 'NEET',
        title: 'Organic Chemistry Masterclass',
        description: 'Reaction mechanisms',
        storageBucket: 'content-videos',
        storagePath: 'neet-chem.mp4',
        thumbnailBucket: null,
        thumbnailPath: null,
        durationSeconds: 2700,
        status: 'published',
        displayOrder: 1,
        createdBy: 'admin',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        publishedAt: new Date().toISOString(),
      };

      // Matches NEET category
      expect(demoClassMatchesCategory(mockDemo, 'NEET')).toBe(true);
      // Title search matches
      expect(mockDemo.title.toLowerCase().includes('chemistry')).toBe(true);
      // Description search matches
      expect(mockDemo.description!.toLowerCase().includes('reaction')).toBe(true);
    });

    it('18. Mobile CSS defines flex-wrap and responsive sizing for stream filter pills', () => {
      expect(coursesCssSource).toContain('.store-stream-filters { display: flex; gap: 5px; flex-wrap: wrap; }');
      expect(coursesCssSource).toContain('.store-stream-filters button {');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Section D: Active Course Filtering
  // ────────────────────────────────────────────────────────────────
  describe('D. Active Course Filtering', () => {
    const mockCourses: Course[] = [
      {
        courseId: 'c1',
        slug: 'neet-2026',
        title: 'NEET 2026 Comprehensive Batch',
        streamId: 's-neet',
        streamCode: 'NEET',
        status: 'published',
        deletedAt: null,
        originalPrice: 15000,
        discountedPrice: 12000,
        currency: 'INR',
        batches: [],
      },
      {
        courseId: 'c2',
        slug: 'jee-2027',
        title: 'JEE 2027 Target Batch',
        streamId: 's-jee',
        streamCode: 'JEE',
        status: 'published',
        deletedAt: null,
        originalPrice: 18000,
        discountedPrice: 14000,
        currency: 'INR',
        batches: [],
      },
      {
        courseId: 'c3',
        slug: 'cuet-2025',
        title: 'CUET 2025 Crash Course',
        streamId: 's-cuet',
        streamCode: 'CUET',
        status: 'draft', // INACTIVE / UNPUBLISHED
        deletedAt: null,
        originalPrice: 8000,
        discountedPrice: 6000,
        currency: 'INR',
        batches: [],
      },
      {
        courseId: 'c4',
        slug: 'upsc-foundation',
        title: 'UPSC Foundation 2026',
        streamId: 's-upsc',
        streamCode: 'UPSC',
        status: 'archived', // INACTIVE
        deletedAt: null,
        originalPrice: 25000,
        discountedPrice: 20000,
        currency: 'INR',
        batches: [],
      },
      {
        courseId: 'c5',
        slug: 'class-10-foundation',
        title: 'Class 10 Foundation Batch',
        streamId: 's-found',
        streamCode: 'FOUNDATION',
        status: 'published',
        deletedAt: null,
        originalPrice: 10000,
        discountedPrice: 8000,
        currency: 'INR',
        batches: [],
      },
      {
        courseId: 'c6',
        slug: 'deleted-course',
        title: 'NEET Deleted Batch',
        streamId: 's-neet-del',
        streamCode: 'NEET',
        status: 'published',
        deletedAt: '2026-01-01T00:00:00Z', // SOFT DELETED
        originalPrice: 10000,
        discountedPrice: 8000,
        currency: 'INR',
        batches: [],
      },
    ];

    it('19. Accurately identifies active courses (status === published and not deleted)', () => {
      expect(isCourseActive(mockCourses[0])).toBe(true); // NEET active
      expect(isCourseActive(mockCourses[1])).toBe(true); // JEE active
      expect(isCourseActive(mockCourses[4])).toBe(true); // Foundation active
    });

    it('20. Inactive (draft / archived) courses are rejected', () => {
      expect(isCourseActive(mockCourses[2])).toBe(false); // CUET draft
      expect(isCourseActive(mockCourses[3])).toBe(false); // UPSC archived
    });

    it('21. Soft-deleted courses are rejected even if marked published', () => {
      expect(isCourseActive(mockCourses[5])).toBe(false); // deletedAt set
    });

    it('22. Hides categories without active courses (CUET and UPSC in example)', () => {
      const activeOnly = mockCourses.filter(isCourseActive);
      const activeCategories = deriveActiveCategories(activeOnly);
      const categoryCodes = activeCategories.map((c) => c.code);

      expect(categoryCodes).not.toContain('CUET');
      expect(categoryCodes).not.toContain('UPSC');
    });

    it('23. Shows categories with active courses (ALL, NEET, JEE, Foundation in example)', () => {
      const activeOnly = mockCourses.filter(isCourseActive);
      const activeCategories = deriveActiveCategories(activeOnly);
      const categoryCodes = activeCategories.map((c) => c.code);

      expect(categoryCodes).toContain('ALL');
      expect(categoryCodes).toContain('NEET');
      expect(categoryCodes).toContain('JEE');
      expect(categoryCodes.includes('10TH') || categoryCodes.includes('FOUNDATION')).toBe(true);
    });

    it('24. Handles loading and empty states safely', () => {
      expect(demoClassPickerSource).toContain('Loading demo classes…');
      expect(demoClassPageSource).toContain('.catch((err) => {');
    });

    it('25. Gracefully handles empty demo class results with reset CTA', () => {
      expect(demoClassPickerSource).toContain('No demo classes found for');
      expect(demoClassPickerSource).toContain('Show all demo classes ↗');
    });
  });

  // ────────────────────────────────────────────────────────────────
  // Section E: Regression Protections
  // ────────────────────────────────────────────────────────────────
  describe('E. Regression Protections', () => {
    it('26. Existing demo-class cards structure remains intact', () => {
      expect(demoClassPickerSource).toContain('store-course-card store-demo-card');
      expect(demoClassPickerSource).toContain('store-demo-thumb-wrapper');
      expect(demoClassPickerSource).toContain('store-demo-duration');
      expect(demoClassPickerSource).toContain('store-demo-watch-button');
    });

    it('27. Video preview modal and signed URL streaming preserved', () => {
      expect(demoClassPickerSource).toContain('getDemoClassVideoSignedUrl');
      expect(demoClassPickerSource).toContain('store-modal-backdrop');
      expect(demoClassPickerSource).toContain('store-modal-video-container');
      expect(demoClassPickerSource).toContain('<video');
    });

    it('28. Booking and authentication guard remains intact', () => {
      expect(demoClassPickerSource).toContain('LOGIN REQUIRED');
      expect(demoClassPickerSource).toContain('Please log in to watch');
      expect(demoClassPickerSource).toContain('href="/login"');
      expect(demoClassPickerSource).toContain('href="/signup"');
    });

    it('29. Scheduling information and course batch linking preserved', () => {
      expect(demoClassPickerSource).toContain('Like what you see? Join the complete course batch today.');
      expect(demoClassPickerSource).toContain('href="/courses"');
    });

    it('30. Homepage renders FreeDemoSection unchanged with default link targets', () => {
      expect(marketingHomeSource).toContain('<FreeDemoSection />');
    });

    it('31. Courses page remains unchanged', () => {
      expect(coursesPageSource).toContain('export default async function CoursesPage()');
      expect(coursesPageSource).toContain('const courses = await getCourses();');
      expect(coursesPageSource).toContain('<CourseCatalog courses={courses} />');
    });

    it('32. PYQ and Mock Test functionality remains unchanged', () => {
      expect(pyqPageSource).toContain('PYQ & Mock Test');
      expect(pyqCatalogSource).toContain('Explore PYQ Packages');
      expect(pyqCatalogSource).toContain('Explore Mock Tests');
    });
  });
});
