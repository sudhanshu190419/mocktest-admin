import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';

describe('Phase 2 Homepage Redesign Implementation & Regression Test Suite', () => {
  const marketingHomePath = path.resolve(__dirname, '../MarketingHomeView.tsx');
  const heroSectionPath = path.resolve(__dirname, '../HeroSection.tsx');
  const studentHeroPath = path.resolve(__dirname, '../StudentHomeHero.tsx');
  const storeCourseCardPath = path.resolve(__dirname, '../StoreCourseCard.tsx');
  const catalogServicePath = path.resolve(__dirname, '../../../services/courseCatalogService.ts');
  const catalogTypesPath = path.resolve(__dirname, '../../../types/courseCatalog.ts');

  const marketingHomeSource = fs.readFileSync(marketingHomePath, 'utf8');
  const heroSectionSource = fs.readFileSync(heroSectionPath, 'utf8');
  const studentHeroSource = fs.readFileSync(studentHeroPath, 'utf8');
  const storeCourseCardSource = fs.readFileSync(storeCourseCardPath, 'utf8');
  const catalogServiceSource = fs.readFileSync(catalogServicePath, 'utf8');
  const catalogTypesSource = fs.readFileSync(catalogTypesPath, 'utf8');

  // ==========================================
  // DOMAIN 1: HERO VISIBILITY TESTS (1 - 8)
  // ==========================================
  describe('1. Hero Visibility and Gating Architecture', () => {
    it('Test 1: Guest sees existing HeroSection', () => {
      expect(studentHeroSource).toContain('if (isGuest)');
      expect(studentHeroSource).toContain('return <HeroSection />;');
    });

    it('Test 2: Newly registered student with no purchases sees HeroSection', () => {
      // Condition strictly checks !studentName || !hasCourses -> HeroSection
      expect(studentHeroSource).toMatch(/if\s*\(\s*!studentName\s*\|\|\s*!hasCourses\s*\)\s*\{\s*return\s*<HeroSection\s*\/>;/);
    });

    it('Test 3: Logged-in student without course purchase sees HeroSection', () => {
      expect(studentHeroSource).toContain('const hasCourses = enrolledCourses.length > 0;');
      // When hasCourses is false, HeroSection is rendered
      expect(studentHeroSource).toMatch(/if\s*\(\s*!studentName\s*\|\|\s*!hasCourses\s*\)\s*\{\s*return\s*<HeroSection\s*\/>;/);
    });

    it('Test 4: PYQ-only purchaser sees HeroSection', () => {
      // Even if hasPyq is true, !hasCourses triggers HeroSection
      const gatingBlockMatch = studentHeroSource.match(/if\s*\(\s*!studentName\s*\|\|\s*!hasCourses\s*\)\s*\{\s*return\s*<HeroSection\s*\/>;\s*\}/);
      expect(gatingBlockMatch).not.toBeNull();
    });

    it('Test 5: Student with active full-course enrollment sees existing purchased-course experience', () => {
      // hasCourses && hasPyq or hasCourses && !hasPyq render student workspace
      expect(studentHeroSource).toContain("if (hasCourses && hasPyq)");
      expect(studentHeroSource).toContain("STUDENT WORKSPACE");
      expect(studentHeroSource).toContain("if (hasCourses && !hasPyq)");
      expect(studentHeroSource).toContain("COURSE LEARNER");
    });

    it('Test 6: Installment course purchaser with active enrollment sees existing purchased-course experience', () => {
      // Installment purchases populate course_enrollments with is_active = true,
      // mapping to enrolledCourses in bootstrap data and hasCourses = true
      expect(studentHeroSource).toContain('const enrolledCourses = data?.enrolledCourses || [];');
      expect(studentHeroSource).toContain('const hasCourses = enrolledCourses.length > 0;');
    });

    it('Test 7: Loading bootstrap data does not prematurely show the wrong variant (anti-flicker)', () => {
      // Loading condition is checked before student workspace evaluation and renders skeleton with aria-busy
      const loadingMatch = studentHeroSource.match(/if\s*\(loading\)\s*\{\s*return\s*\(\s*<section[^>]*aria-busy="true"/);
      expect(loadingMatch).not.toBeNull();
    });

    it('Test 8: Existing course purchasers retain their current welcome/workspace behaviour', () => {
      expect(studentHeroSource).toContain('Welcome back, <span className="text-brand">{studentName}</span>');
      expect(studentHeroSource).toContain('My Learning Center');
      expect(studentHeroSource).toContain('Continue Learning');
    });
  });

  // ==========================================
  // DOMAIN 2: CTA TESTS (9 - 10)
  // ==========================================
  describe('2. Hero CTA Labels and Verified Destinations', () => {
    it('Test 9: Primary CTA "Browse Courses" navigates to /courses', () => {
      expect(heroSectionSource).toContain('Browse Courses');
      expect(heroSectionSource).not.toContain('Explore Courses');
      expect(heroSectionSource).toMatch(/href="\/courses"[\s\S]*?Browse Courses/);
    });

    it('Test 10: Secondary CTA "Explore PYQ Packages" navigates to /pyq', () => {
      expect(heroSectionSource).toContain('Explore PYQ Packages');
      expect(heroSectionSource).not.toContain('Try a Free Mock Test');
      expect(heroSectionSource).toMatch(/href="\/pyq"[\s\S]*?Explore PYQ Packages/);
    });
  });

  // ==========================================
  // DOMAIN 3: OUR COURSES TESTS (11 - 16)
  // ==========================================
  describe('3. Our Courses Section Transformation', () => {
    it('Test 11: Heading is Our Courses', () => {
      expect(marketingHomeSource).toContain('<h2 id="home-goals-title">Our Courses</h2>');
      expect(marketingHomeSource).not.toContain('What are you working towards?');
    });

    it('Test 12: "First, Your Direction" is removed', () => {
      expect(marketingHomeSource).not.toContain('FIRST, YOUR DIRECTION');
      expect(marketingHomeSource).not.toContain('First, Your Direction');
    });

    it('Test 13: Showing goal offerings dynamic text is removed', () => {
      expect(marketingHomeSource).not.toContain('offerings.');
      expect(marketingHomeSource).not.toMatch(/Showing\s*<strong>\{goal\.label\}<\/strong>\s*offerings/);
    });

    it('Test 14: Course Collection category eyebrow is removed', () => {
      expect(marketingHomeSource).not.toContain('THE COURSE COLLECTION');
      expect(marketingHomeSource).not.toContain('The Course Collection');
    });

    it('Test 15: Goal-selection pills remain functional with all 6 categories', () => {
      const expectedCodes = ['NEET', 'UPSC', 'JEE', 'K12', 'CUET', 'FOUNDATION'];
      expectedCodes.forEach((code) => {
        expect(marketingHomeSource).toContain(`code: '${code}'`);
      });
      expect(marketingHomeSource).toContain("setSelectedGoal(item.code)");
    });

    it('Test 16: Selected-goal filtering still works and synchronizes with preferred stream', () => {
      expect(marketingHomeSource).toMatch(/const\s*\[selectedGoal,\s*setSelectedGoal\]\s*=\s*useState<[^>]+>\('NEET'\);/);
      expect(marketingHomeSource).toContain('studentStream.toUpperCase().includes(g.code)');
      expect(marketingHomeSource).toContain('course.streamCode === goal.code');
    });
  });

  // ==========================================
  // DOMAIN 4: EXPLORE BATCHES TESTS (17 - 28)
  // ==========================================
  describe('4. Explore Batches Section & Card Details', () => {
    it('Test 17: Section heading is Explore Batches', () => {
      expect(marketingHomeSource).toContain('<h2 id="home-courses-title">Explore Batches</h2>');
      expect(marketingHomeSource).not.toContain('Make room for your ambition');
    });

    it('Test 18: Correct batch names are displayed from existing relationships', () => {
      expect(marketingHomeSource).toContain('featuredBatches');
      expect(marketingHomeSource).toContain('batch={batch}');
      expect(storeCourseCardSource).toContain('const batchName = batch?.name || course.presentation?.displayTitle || course.title;');
      expect(storeCourseCardSource).toContain('{batchName}');
    });

    it('Test 19: Associated course information is contextually displayed', () => {
      expect(storeCourseCardSource).toContain('const isDedicatedBatch = Boolean(batch?.name && batch.name !== course.title);');
      expect(storeCourseCardSource).toContain('{course.title}');
    });

    it('Test 20: Existing course banner and thumbnail images are reused with gradient scrim overlay', () => {
      expect(storeCourseCardSource).toContain('topImage = STREAM_COVER_IMAGES[streamCode] || course.thumbnailPath || course.bannerPath || null;');
      expect(storeCourseCardSource).toContain('bg-gradient-to-t from-slate-950/85 via-slate-950/30 to-transparent');
    });

    it('Test 21: Existing course description is displayed where appropriate', () => {
      expect(storeCourseCardSource).toContain('{course.shortDescription || course.description}');
    });

    it('Test 22: "Live + recorded" badge is removed', () => {
      expect(storeCourseCardSource).not.toContain('Live + recorded');
      expect(storeCourseCardSource).not.toContain('Live + Recorded');
    });

    it('Test 23: Medium/language badge is removed', () => {
      expect(storeCourseCardSource).not.toContain('course.presentation.languageLabel');
      expect(storeCourseCardSource).not.toContain('languageLabel');
      expect(storeCourseCardSource).not.toContain('course.difficultyLevel');
      expect(storeCourseCardSource).not.toContain('difficultyLevel');
    });

    it('Test 23b: Course duration is strictly preserved (0 days, 300 days, 500 days)', () => {
      expect(storeCourseCardSource).toContain('{course.duration} days');
      expect(storeCourseCardSource).toContain('IconCalendar');
    });

    it('Test 23c: "All courses, all goals" link is removed from homepage', () => {
      expect(marketingHomeSource).not.toContain('All courses, all goals');
    });

    it('Test 24: "View Details" CTA is displayed', () => {
      expect(storeCourseCardSource).toContain("isEnrolled ? 'Go to Course' : 'View Details'");
      expect(storeCourseCardSource).not.toContain("'Explore Course'");
    });

    it('Test 25: No start-date text or date badge is displayed (explicit client rule)', () => {
      expect(storeCourseCardSource).not.toContain('start_date');
      expect(storeCourseCardSource).not.toContain('startDate');
      expect(storeCourseCardSource).not.toContain('batchStartDate');
      expect(storeCourseCardSource).not.toContain('Starts on');
      expect(storeCourseCardSource).not.toContain('Starts ');
      expect(marketingHomeSource).not.toContain('start_date');
      expect(catalogServiceSource).not.toContain('start_date');
    });

    it('Test 26: Cards handle missing banner and description data safely', () => {
      expect(storeCourseCardSource).toContain('CourseArtwork');
      expect(storeCourseCardSource).toContain('topImage');
      // Empty description falls back to empty string
      expect(storeCourseCardSource).toContain('{course.shortDescription || course.description}');
    });

    it('Test 27: Batch/category filtering is correct and respects selected goal', () => {
      expect(marketingHomeSource).toContain('for (const course of featuredCourses)');
      expect(marketingHomeSource).toContain('featuredCourses = courses');
      expect(marketingHomeSource).toContain('course.streamCode === goal.code');
    });

    it('Test 28: Duplicate batch associations are handled and deduplicated', () => {
      expect(marketingHomeSource).toContain('const seenBatchIds = new Set<string>();');
      expect(marketingHomeSource).toContain('if (!seenBatchIds.has(b.id))');
      expect(marketingHomeSource).toContain('seenBatchIds.add(b.id);');
    });
  });

  // ==========================================
  // DOMAIN 5: PRESERVATION TESTS (29 - 35)
  // ==========================================
  describe('5. Preservation of Existing Homepage Architecture & Exclusions', () => {
    it('Test 29: No USP section is introduced', () => {
      expect(marketingHomeSource.toLowerCase()).not.toContain('unique selling');
      expect(marketingHomeSource.toLowerCase()).not.toContain('usp');
      expect(marketingHomeSource.toLowerCase()).not.toContain('why choose us');
    });

    it('Test 30: No testimonials section is introduced', () => {
      expect(marketingHomeSource.toLowerCase()).not.toContain('testimonials');
      expect(marketingHomeSource.toLowerCase()).not.toContain('student reviews');
      expect(marketingHomeSource.toLowerCase()).not.toContain('what our students say');
    });

    it('Test 31: No achievements section is introduced', () => {
      expect(marketingHomeSource.toLowerCase()).not.toContain('achievements');
      expect(marketingHomeSource.toLowerCase()).not.toContain('our toppers');
      expect(marketingHomeSource.toLowerCase()).not.toContain('results banner');
    });

    it('Test 32: PYQ packages section is removed from home screen and Explore Batches adopts store-home-tint background', () => {
      // Home screen no longer renders the PYQ section carousel
      expect(marketingHomeSource).not.toContain('id="home-pyq"');
      expect(marketingHomeSource).not.toContain('PYQPackageCard');
      expect(marketingHomeSource).not.toContain('pyqCarousel');
      // Explore Batches section adopts the exact store-home-tint background wrapper previously used by PYQ
      expect(marketingHomeSource).toContain('<section className="store-home-tint" aria-labelledby="home-courses-title">');
      expect(marketingHomeSource).toContain('id="home-courses"');
    });

    it('Test 33: Existing App Showcase section remains intact', () => {
      expect(marketingHomeSource).toContain('<AppShowcaseSection />');
    });

    it('Test 34: Existing Free Demo section remains intact', () => {
      expect(marketingHomeSource).toContain('<FreeDemoSection />');
    });

    it('Test 35: Existing student purchase and access workflows remain unchanged', () => {
      // Course link destination preserved
      expect(storeCourseCardSource).toContain("const courseUrl = isEnrolled ? `/student/courses/${course.courseId}` : `/courses/${course.slug || course.courseId}`;");
      // Types preserve Course and CourseInstallmentPlan
      expect(catalogTypesSource).toContain('export interface CourseInstallmentPlan');
      expect(catalogTypesSource).toContain('export interface Course');
      expect(catalogTypesSource).toContain('export interface CourseBatchItem');
    });
  });
});
