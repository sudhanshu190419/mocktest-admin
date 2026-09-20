/**
 * Design Audit Capture Script
 * - Logs in as the test student
 * - Captures screenshots of all student + marketing surfaces (desktop + mobile)
 * - Collects console errors per page
 *
 * Run: node scripts/design-audit/audit.mjs
 * Output: scripts/design-audit/shots/*.png + manifest.json
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT = path.join(__dirname, 'shots');
fs.mkdirSync(OUT, { recursive: true });

const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000';
const PHONE_NATIONAL = process.env.AUDIT_PHONE || '7897894568';
const PHONE_ALT = process.env.AUDIT_PHONE_ALT || '9178978945';
const PASSWORD = process.env.AUDIT_PASSWORD || '00121200';

const manifest = { generatedAt: new Date().toISOString(), base: BASE, pages: [], consoleErrors: {} };
let shotIndex = 0;

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 });
  } catch {
    /* SPA may keep polling; continue */
  }
  await page.waitForTimeout(900);
}

async function shot(page, name, fullPage = true) {
  const file = `${String(++shotIndex).padStart(2, '0')}-${name}.png`;
  await page.screenshot({ path: path.join(OUT, file), fullPage });
  return file;
}

async function record(page, name, url, fullPage = true) {
  const errors = [];
  const onConsole = (msg) => {
    if (msg.type() === 'error') errors.push(msg.text().slice(0, 300));
  };
  const onPageError = (err) => errors.push(`PAGEERROR: ${String(err).slice(0, 300)}`);
  page.on('console', onConsole);
  page.on('pageerror', onPageError);

  let ok = true;
  let finalUrl = url;
  try {
    await page.goto(new URL(url, BASE).toString(), { waitUntil: 'domcontentloaded', timeout: 30000 });
    await settle(page);
    finalUrl = page.url();
  } catch (e) {
    ok = false;
    errors.push(`NAV_FAIL: ${String(e).slice(0, 200)}`);
  }
  let file = null;
  if (ok) file = await shot(page, name, fullPage);

  manifest.pages.push({ name, url, finalUrl, viewport: page.viewportSize(), file, errors });
  manifest.consoleErrors[name] = errors;
  page.off('console', onConsole);
  page.off('pageerror', onPageError);
  console.log(`${ok ? '✔' : '✖'} ${name} → ${finalUrl}${errors.length ? ` (${errors.length} console errors)` : ''}`);
  return finalUrl;
}

async function firstHref(page, selector) {
  try {
    const el = await page.$(selector);
    return el ? await el.getAttribute('href') : null;
  } catch {
    return null;
  }
}

async function login(context) {
  const page = await context.newPage();
  await page.goto(new URL('/login?next=%2Fstudent%2Foverview', BASE).toString(), { waitUntil: 'domcontentloaded' });
  await settle(page);
  const attempts = [PHONE_NATIONAL, PHONE_ALT];
  for (const phone of attempts) {
    const phoneInput = page.locator('#auth-phone');
    const pwInput = page.locator('#auth-password');
    await phoneInput.fill('');
    await phoneInput.fill(phone);
    await pwInput.fill('');
    await pwInput.fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL(/\/student/, { timeout: 12000 });
      console.log(`Logged in with ${phone}`);
      return { page, phone };
    } catch {
      console.log(`Login attempt failed for ${phone}, retrying…`);
    }
  }
  await shot(page, 'zz-login-failed', false);
  throw new Error('Login failed for all phone variants. Check credentials.');
}

const DESKTOP = { width: 1440, height: 900 };
const MOBILE = { width: 390, height: 844 };

(async () => {
  const browser = await chromium.launch();

  // ── 1. Logged-out public pass (desktop) ──────────────────────────────
  const publicCtx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const pub = await publicCtx.newPage();
  await record(pub, 'public-home', '/');
  await record(pub, 'public-courses', '/courses');
  const courseHref = await firstHref(pub, 'a[href^="/courses/"]');
  await record(pub, 'public-login', '/login');
  if (courseHref) await record(pub, 'public-course-detail', courseHref);
  await record(pub, 'public-pyq', '/pyq');
  const pyqHref = await firstHref(pub, 'a[href^="/pyq/"]');
  if (pyqHref) await record(pub, 'public-pyq-detail', pyqHref);
  await record(pub, 'public-demo-class', '/demo-class');
  await publicCtx.close();

  // ── 2. Logged-in student pass (desktop) ──────────────────────────────
  const ctx = await browser.newContext({ viewport: DESKTOP, deviceScaleFactor: 2 });
  const { page } = await login(ctx);
  await shot(page, 'student-overview-logged-in');

  // Profile dropdown open state
  try {
    await page.locator('.store-user-btn').click();
    await page.waitForTimeout(400);
    await shot(page, 'student-header-profile-dropdown', false);
    await page.keyboard.press('Escape');
    await page.mouse.click(10, 500);
  } catch (e) {
    console.log('dropdown capture skipped:', String(e).slice(0, 100));
  }

  await record(page, 'student-courses', '/student/courses');
  const studentCourseHref = await firstHref(page, 'a[href^="/student/courses/"]:not([href$="/student/courses/"])');
  await record(page, 'student-course-detail', studentCourseHref || '/student/courses');

  // Subject workspace: from course detail page
  const subjectHref = await firstHref(page, 'a[href*="/subjects/"]');
  if (subjectHref) {
    await record(page, 'student-subject-workspace', subjectHref);
  }

  await record(page, 'student-classes', '/student/classes');
  await record(page, 'student-recordings', '/student/recordings');
  await record(page, 'student-timetable', '/student/timetable');
  await record(page, 'student-doubts', '/student/doubts');

  // Ask-doubt modal open state
  try {
    await page.goto(new URL('/student/doubts?new=true', BASE).toString(), { waitUntil: 'domcontentloaded' });
    await settle(page);
    await shot(page, 'student-doubts-ask-modal');
  } catch { /* skip */ }

  await record(page, 'student-tests', '/student/tests');
  await record(page, 'student-results', '/student/results');
  await record(page, 'student-analytics', '/student/analytics');
  await record(page, 'student-profile', '/student/profile');

  // Detail pages (crawl)
  const doubtHref = await firstHref(page, 'a[href*="/student/doubts/"]');
  if (doubtHref) await record(page, 'student-doubt-detail', doubtHref);
  const testHref = await firstHref(page, 'a[href^="/student/tests/"]:not([href*="/runner"])');
  if (testHref) await record(page, 'student-test-instructions', testHref);
  const resultHref = await firstHref(page, 'a[href*="/results/"]');
  if (resultHref) {
    await record(page, 'student-result-detail', resultHref);
    if (!resultHref.endsWith('/review')) {
      await record(page, 'student-result-review', resultHref.replace(/\/results\/([^/]+)$/, '/results/$1/review'));
    }
  }

  await ctx.close();

  // ── 3. Mobile pass (logged in) ───────────────────────────────────────
  const mctx = await browser.newContext({ viewport: MOBILE, deviceScaleFactor: 3, isMobile: true, hasTouch: true });
  const m = await mctx.newPage();
  await login(mctx);
  const mobilePages = [
    ['m-student-overview', '/student/overview'],
    ['m-student-courses', '/student/courses'],
    ['m-student-classes', '/student/classes'],
    ['m-student-recordings', '/student/recordings'],
    ['m-student-timetable', '/student/timetable'],
    ['m-student-doubts', '/student/doubts'],
    ['m-student-tests', '/student/tests'],
    ['m-student-results', '/student/results'],
    ['m-student-analytics', '/student/analytics'],
    ['m-student-profile', '/student/profile'],
  ];
  for (const [name, url] of mobilePages) await record(m, name, url);

  // Mobile menu open state
  try {
    await m.goto(new URL('/student/overview', BASE).toString(), { waitUntil: 'domcontentloaded' });
    await settle(m);
    await m.locator('.store-menu-toggle').click();
    await m.waitForTimeout(400);
    await shot(m, 'm-header-menu-open', false);
  } catch { /* skip */ }
  await mctx.close();

  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  const errCount = Object.values(manifest.consoleErrors).reduce((a, b) => a + b.length, 0);
  console.log(`\nDone: ${manifest.pages.length} captures, ${errCount} console errors. Output: ${OUT}`);
  await browser.close();
})().catch((e) => {
  console.error('AUDIT FAILED:', e);
  fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
  process.exit(1);
});
