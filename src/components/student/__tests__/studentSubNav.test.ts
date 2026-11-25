import { describe, it, expect } from 'vitest';
import fs from 'fs';
import path from 'path';
import { STUDENT_NAV_ITEMS } from '@/components/student/StudentSubNav';
import { isExamEnginePath } from '@/lib/routes';

describe('StudentSubNav Destination and Route Matcher Tests', () => {
  it('defines all core student modules in the correct reorganized order preserving Dashboard', () => {
    const labels = STUDENT_NAV_ITEMS.map((item) => item.label);
    expect(labels).toEqual([
      'Dashboard',
      'My Courses',
      'Class Timetable',
      'Live Classes',
      'Recordings',
      'PYQ & Sample Paper',
      'Class Test',
      'My Doubts',
      'My Performance',
      'Results',
      'Profile',
    ]);

    expect(STUDENT_NAV_ITEMS[0].href).toBe('/student/overview');
    expect(STUDENT_NAV_ITEMS[1].href).toBe('/student/courses');
    expect(STUDENT_NAV_ITEMS[2].href).toBe('/student/timetable');
    expect(STUDENT_NAV_ITEMS[3].href).toBe('/student/classes');
    expect(STUDENT_NAV_ITEMS[4].href).toBe('/student/recordings');
    expect(STUDENT_NAV_ITEMS[5].href).toBe('/pyq');
    expect(STUDENT_NAV_ITEMS[6].href).toBe('/student/tests');
    expect(STUDENT_NAV_ITEMS[7].href).toBe('/student/doubts');
    expect(STUDENT_NAV_ITEMS[8].href).toBe('/student/analytics');
    expect(STUDENT_NAV_ITEMS[9].href).toBe('/student/results');
    expect(STUDENT_NAV_ITEMS[10].href).toBe('/student/profile');
  });

  it('correctly matches Dashboard routes for /student and /student/overview', () => {
    const dashboardItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Dashboard')!;
    expect(dashboardItem.matches('/student')).toBe(true);
    expect(dashboardItem.matches('/student/overview')).toBe(true);
    expect(dashboardItem.matches('/student/courses')).toBe(false);
    expect(dashboardItem.matches('/student/tests')).toBe(false);
  });

  it('correctly matches My Courses and nested course modules', () => {
    const coursesItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'My Courses')!;
    expect(coursesItem.matches('/student/courses')).toBe(true);
    expect(coursesItem.matches('/student/courses/c-101')).toBe(true);
    expect(coursesItem.matches('/student/courses/c-101/subjects/s-1')).toBe(true);
    expect(coursesItem.matches('/student/overview')).toBe(false);
  });

  it('correctly matches Live Classes routes', () => {
    const classesItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Live Classes')!;
    expect(classesItem.matches('/student/classes')).toBe(true);
    expect(classesItem.matches('/student/classes/room-101')).toBe(true);
    expect(classesItem.matches('/student/recordings')).toBe(false);
  });

  it('correctly matches Recordings routes', () => {
    const recItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Recordings')!;
    expect(recItem.matches('/student/recordings')).toBe(true);
    expect(recItem.matches('/student/recordings/rec-505')).toBe(true);
    expect(recItem.matches('/student/classes')).toBe(false);
  });

  it('correctly matches PYQ & Sample Paper routes', () => {
    const pyqItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'PYQ & Sample Paper')!;
    expect(pyqItem.matches('/pyq')).toBe(true);
    expect(pyqItem.matches('/pyq/pyq-pkg-101')).toBe(true);
    expect(pyqItem.matches('/student/courses')).toBe(false);
  });

  it('correctly matches Class Test routes while isolating Results', () => {
    const testsItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Class Test')!;
    const resultsItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Results')!;

    expect(testsItem.matches('/student/tests')).toBe(true);
    expect(testsItem.matches('/student/tests/t-99')).toBe(true);
    expect(testsItem.matches('/student/results')).toBe(false);

    expect(resultsItem.matches('/student/results')).toBe(true);
    expect(resultsItem.matches('/student/results/att-1')).toBe(true);
    expect(resultsItem.matches('/student/tests')).toBe(false);
  });

  it('correctly matches Time Table, Doubts, My Performance, and Profile', () => {
    const timetableItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Class Timetable')!;
    const doubtsItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'My Doubts')!;
    const analyticsItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'My Performance')!;
    const profileItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Profile')!;

    expect(timetableItem.matches('/student/timetable')).toBe(true);
    expect(doubtsItem.matches('/student/doubts')).toBe(true);
    expect(doubtsItem.matches('/student/doubts/d-123')).toBe(true);
    expect(analyticsItem.matches('/student/analytics')).toBe(true);
    expect(profileItem.matches('/student/profile')).toBe(true);
  });

  it('correctly isolates badge configuration to tests and doubts', () => {
    const testsItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'Class Test')!;
    const doubtsItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'My Doubts')!;
    const coursesItem = STUDENT_NAV_ITEMS.find((i) => i.label === 'My Courses')!;

    expect(testsItem.badge).toBe('tests');
    expect(doubtsItem.badge).toBe('doubts');
    expect(coursesItem.badge).toBeUndefined();
  });
});

describe('StudentSubNav Component Source & Layout Integration Tests', () => {
  const componentPath = path.join(process.cwd(), 'src/components/student/StudentSubNav.tsx');
  const componentContent = fs.readFileSync(componentPath, 'utf8');

  it('StudentSubNav component contains distraction-free route filters', () => {
    expect(componentContent).toContain('isExamEnginePath(pathname)');
    expect(componentContent).toContain("pathname.includes('/runner')");
    expect(componentContent).toContain("pathname.includes('/student/runner')");
    expect(componentContent).toContain("pathname.match(/\\/student\\/classes\\/[^/]+$/)");
  });

  it('StudentSubNav component includes auto-scrolling for active pills into view', () => {
    expect(componentContent).toContain('scrollIntoView');
    expect(componentContent).toContain('student-subnav-pill.is-active');
  });

  it('StudentSubNav renders accessible nav container and badge caps', () => {
    expect(componentContent).toContain('aria-label="Student Portal Navigation"');
    expect(componentContent).toContain('student-subnav-badge');
    expect(componentContent).toContain("badgeCount > 9 ? '9+' : badgeCount");
  });

  it('student/layout.tsx integrates StudentSubNav inside CourseStoreShell', () => {
    const layoutPath = path.join(process.cwd(), 'src/app/student/layout.tsx');
    const layoutContent = fs.readFileSync(layoutPath, 'utf8');

    expect(layoutContent).toContain('StudentSubNav');
    expect(layoutContent).toContain('<StudentSubNav />');
    expect(layoutContent).toContain('CourseStoreShell');
  });
});
