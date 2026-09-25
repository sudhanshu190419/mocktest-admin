import { describe, it, expect } from 'vitest';
import fs from 'fs';
import { bottomNavItems, guestBottomNavItems } from '@/components/student/StudentBottomNav';
import { isExamEnginePath } from '@/lib/routes';

describe('StudentBottomNav Destination and Route Matcher Tests', () => {
  it('defines the 5 primary destinations for logged in students in the correct order', () => {
    const labels = bottomNavItems.map((item) => item.label);
    expect(labels).toEqual(['Home', 'Courses', 'Tests', 'PYQ', 'Me']);
    expect(bottomNavItems[0].href).toBe('/');
    expect(bottomNavItems[1].href).toBe('/courses');
    expect(bottomNavItems[2].href).toBe('/student/tests');
    expect(bottomNavItems[3].href).toBe('/pyq');
    expect(bottomNavItems[4].href).toBe('/student/overview');
  });

  it('defines the 5 primary destinations for guest users in the correct order', () => {
    const labels = guestBottomNavItems.map((item) => item.label);
    expect(labels).toEqual(['Home', 'Courses', 'Tests', 'PYQ', 'Sign In']);
    expect(guestBottomNavItems[0].href).toBe('/');
    expect(guestBottomNavItems[1].href).toBe('/courses');
    expect(guestBottomNavItems[2].href).toBe('/login?next=/student/tests');
    expect(guestBottomNavItems[3].href).toBe('/pyq');
    expect(guestBottomNavItems[4].href).toBe('/login');
  });

  it('correctly matches Home route only on exact root', () => {
    const homeItem = bottomNavItems.find((i) => i.label === 'Home')!;
    expect(homeItem.matches('/')).toBe(true);
    expect(homeItem.matches('/courses')).toBe(false);
    expect(homeItem.matches('/student/overview')).toBe(false);
  });

  it('correctly matches Courses routes for both catalog and student course surfaces', () => {
    const coursesItem = bottomNavItems.find((i) => i.label === 'Courses')!;
    expect(coursesItem.matches('/courses')).toBe(true);
    expect(coursesItem.matches('/courses/neet-crash-course')).toBe(true);
    expect(coursesItem.matches('/student/courses')).toBe(true);
    expect(coursesItem.matches('/student/courses/c-101')).toBe(true);
    expect(coursesItem.matches('/student/overview')).toBe(false);
  });

  it('correctly matches Tests routes', () => {
    const testsItem = bottomNavItems.find((i) => i.label === 'Tests')!;
    expect(testsItem.matches('/student/tests')).toBe(true);
    expect(testsItem.matches('/student/tests/t-101')).toBe(true);
    expect(testsItem.matches('/student/tests/t-101/results')).toBe(true);
    expect(testsItem.matches('/student/overview')).toBe(false);
  });

  it('correctly matches PYQ routes', () => {
    const pyqItem = bottomNavItems.find((i) => i.label === 'PYQ')!;
    expect(pyqItem.matches('/pyq')).toBe(true);
    expect(pyqItem.matches('/pyq/neet-chemistry-2025')).toBe(true);
    expect(pyqItem.matches('/courses')).toBe(false);
  });

  it('correctly matches Me routes for general student portal while excluding tests and courses', () => {
    const meItem = bottomNavItems.find((i) => i.label === 'Me')!;
    expect(meItem.matches('/student/overview')).toBe(true);
    expect(meItem.matches('/student/profile')).toBe(true);
    expect(meItem.matches('/student/doubts')).toBe(true);
    expect(meItem.matches('/student/analytics')).toBe(true);
    expect(meItem.matches('/student/timetable')).toBe(true);
    expect(meItem.matches('/student/recordings')).toBe(true);

    // Excluded from 'Me' because they have dedicated bottom nav tabs
    expect(meItem.matches('/student/tests')).toBe(false);
    expect(meItem.matches('/student/courses')).toBe(false);
    expect(meItem.matches('/courses')).toBe(false);
  });

  it('correctly identifies distraction-free exam engine and live classroom routes', () => {
    expect(isExamEnginePath('/student/tests/t-1')).toBe(true);
    expect(isExamEnginePath('/student/tests/t-1/runner')).toBe(true);
    expect(isExamEnginePath('/student/tests')).toBe(false);
    expect(isExamEnginePath('/student/overview')).toBe(false);
  });
});

describe('StudentBottomNav Component & Guard Source Code Contract', () => {
  const componentContent = fs.readFileSync('src/components/student/StudentBottomNav.tsx', 'utf8');

  it('StudentBottomNav component supports both authenticated and guest navigation', () => {
    expect(componentContent).toContain('useAuth');
    expect(componentContent).toContain('guestBottomNavItems');
    expect(componentContent).toContain('const items = user ? bottomNavItems : guestBottomNavItems;');
  });

  it('StudentBottomNav suppresses rendering on distraction-free paths', () => {
    expect(componentContent).toContain('isExamEnginePath(pathname)');
    expect(componentContent).toContain("pathname.includes('/runner')");
    expect(componentContent).toContain("pathname.includes('/student/runner')");
    expect(componentContent).toContain("pathname.match(/\\/student\\/classes\\/[^/]+$/)");
  });

  it('StudentBottomNav renders accessible navigation container and badges', () => {
    expect(componentContent).toContain('className="student-bottom-nav"');
    expect(componentContent).toContain('aria-label="Primary mobile navigation"');
    expect(componentContent).toContain('student-bottomnav-badge');
    expect(componentContent).toContain("count > 9 ? '9+' : count");
  });
});

describe('Student Bottom Nav Shell & CSS Architectural Integration', () => {
  it('CourseStoreShell mounts StudentBottomNav permanently on mobile', () => {
    const shellContent = fs.readFileSync('src/components/marketing/CourseStoreShell.tsx', 'utf8');
    expect(shellContent).toContain('import { StudentBottomNav } from');
    expect(shellContent).toContain('<StudentBottomNav />');
  });

  it('courses.css declares .student-bottom-nav for mobile screens (<1024px) with z-index 50', () => {
    const cssContent = fs.readFileSync('src/app/courses/courses.css', 'utf8');
    expect(cssContent).toContain('.student-bottom-nav');
    expect(cssContent).toContain('@media (max-width: 1023px)');
    expect(cssContent).toContain('z-index: 50;');
    expect(cssContent).toContain('bottom: calc(12px + env(safe-area-inset-bottom, 0px));');
  });

  it('student.css declares .student-bottom-nav with matching z-index 50 and safe area insets', () => {
    const cssContent = fs.readFileSync('src/app/student/student.css', 'utf8');
    expect(cssContent).toContain('.student-bottom-nav');
    expect(cssContent).toContain('@media (max-width: 1023px)');
    expect(cssContent).toContain('z-index: 50;');
  });

  it('student/layout.tsx references StudentBottomNav and wraps with CourseStoreShell and StudentGuard', () => {
    const layoutContent = fs.readFileSync('src/app/student/layout.tsx', 'utf8');
    expect(layoutContent).toContain('StudentGuard');
    expect(layoutContent).toContain('CourseStoreShell');
    expect(layoutContent).toContain('StudentBottomNav');
  });
});
