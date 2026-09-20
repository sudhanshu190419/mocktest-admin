/**
 * Design Audit Measurement Script
 * Logs in, visits every student surface at desktop (1440) and mobile (390),
 * and extracts measurable design facts from the live DOM:
 *  - horizontal overflow + offending elements
 *  - tap-target heights (<44px)
 *  - font-size distribution (<12px = below comfortable floor)
 *  - actual colors in use (backgrounds + text) to quantify brand drift
 *  - font families actually rendered
 *  - sticky header/subnav geometry
 * Output: scripts/design-audit/measurements.json
 */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE = process.env.AUDIT_BASE_URL || 'http://localhost:3000';
const PHONE_NATIONAL = process.env.AUDIT_PHONE || '7897894568';
const PHONE_ALT = process.env.AUDIT_PHONE_ALT || '9178978945';
const PASSWORD = process.env.AUDIT_PASSWORD || '00121200';

const PAGES = [
  ['overview', '/student/overview'],
  ['courses', '/student/courses'],
  ['classes', '/student/classes'],
  ['recordings', '/student/recordings'],
  ['timetable', '/student/timetable'],
  ['doubts', '/student/doubts'],
  ['tests', '/student/tests'],
  ['results', '/student/results'],
  ['analytics', '/student/analytics'],
  ['profile', '/student/profile'],
];

const MEASURE = () => {
  const vw = window.innerWidth;
  const doc = document.documentElement;

  // 1. Horizontal overflow
  const overflowTotal = Math.max(0, doc.scrollWidth - vw);
  const offenders = [];
  if (overflowTotal > 2) {
    for (const el of document.querySelectorAll('body *')) {
      const r = el.getBoundingClientRect();
      if (r.right > vw + 8 && r.width > 24 && r.height > 8) {
        offenders.push(
          `${el.tagName.toLowerCase()}.${String(el.className && el.className.baseVal !== undefined ? el.className.baseVal : el.className).split(' ').slice(0, 3).join('.')} → right=${Math.round(r.right)} w=${Math.round(r.width)}`
        );
        if (offenders.length >= 6) break;
      }
    }
  }

  // 2. Tap targets (interactive, visible)
  const smallTargets = [];
  const targetCandidates = document.querySelectorAll('a[href], button, select, input, summary, [role="button"]');
  let targetCount = 0;
  for (const el of targetCandidates) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none' || style.pointerEvents === 'none') continue;
    targetCount++;
    const h = Math.round(r.height);
    if (h < 44) {
      smallTargets.push(`${el.tagName.toLowerCase()} h=${h}px ${String(el.textContent || '').trim().slice(0, 30)}`);
    }
  }

  // 3. Font sizes below 12px
  const tinyText = [];
  const fontSizeHist = {};
  const textEls = document.querySelectorAll('h1,h2,h3,h4,h5,p,span,a,button,small,label,td,th,li,div');
  for (const el of textEls) {
    if (el.children.length > 3) continue;
    const own = Array.from(el.childNodes).filter((n) => n.nodeType === 3 && n.textContent.trim().length > 1);
    if (!own.length) continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.visibility === 'hidden' || style.display === 'none') continue;
    const fs = parseFloat(style.fontSize);
    fontSizeHist[fs] = (fontSizeHist[fs] || 0) + 1;
    if (fs < 12) {
      tinyText.push(`fs=${fs}px "${(el.textContent || '').trim().slice(0, 40)}"`);
    }
  }

  // 4. Colors in use — buttons, pills, links, headings, cards
  const bgColors = {};
  const textColors = {};
  const colorTargets = document.querySelectorAll(
    'button, a, h1, h2, h3, .student-kpi-card, .student-card, .student-pill, [class*="bg-"], [class*="text-"]'
  );
  for (const el of colorTargets) {
    const r = el.getBoundingClientRect();
    if (r.width === 0 || r.height === 0) continue;
    const style = getComputedStyle(el);
    if (style.display === 'none' || style.visibility === 'hidden') continue;
    const bg = style.backgroundColor;
    const tx = style.color;
    if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
      bgColors[bg] = (bgColors[bg] || 0) + 1;
    }
    if (tx) {
      textColors[tx] = (textColors[tx] || 0) + 1;
    }
  }

  // 5. Font families
  const fontFamilies = {};
  for (const el of document.querySelectorAll('body, h1, h2, h3, p, button, a')) {
    const f = getComputedStyle(el).fontFamily;
    fontFamilies[f.split(',')[0].replace(/["']/g, '')] = (fontFamilies[f.split(',')[0].replace(/["']/g, '')] || 0) + 1;
  }

  // 6. Sticky geometry
  const header = document.querySelector('.store-header');
  const subnav = document.querySelector('.student-subnav-wrapper');
  const headerH = header ? Math.round(header.getBoundingClientRect().height) : null;
  const subnavTop = subnav ? getComputedStyle(subnav).top : null;
  const subnavH = subnav ? Math.round(subnav.getBoundingClientRect().height) : null;

  // 7. Border radius / shadow variance on cards
  const radii = {};
  document.querySelectorAll('.student-card, .student-kpi-card, [class*="rounded-"]').forEach((el) => {
    const r = getComputedStyle(el).borderRadius;
    radii[r] = (radii[r] || 0) + 1;
  });

  return {
    viewport: vw,
    overflowTotal,
    offenders: offenders.slice(0, 6),
    interactiveCount: targetCount,
    smallTargetCount: smallTargets.length,
    smallTargetSample: smallTargets.slice(0, 8),
    tinyTextCount: tinyText.length,
    tinyTextSample: tinyText.slice(0, 6),
    fontSizeHist,
    bgColorsTop: Object.entries(bgColors).sort((a, b) => b[1] - a[1]).slice(0, 15),
    textColorsTop: Object.entries(textColors).sort((a, b) => b[1] - a[1]).slice(0, 15),
    fontFamilies,
    headerHeight: headerH,
    subnavTop,
    subnavHeight: subnavH,
    radiusHist: Object.entries(radii).sort((a, b) => b[1] - a[1]).slice(0, 10),
  };
};

async function settle(page) {
  try {
    await page.waitForLoadState('networkidle', { timeout: 12000 });
  } catch {}
  await page.waitForTimeout(700);
}

async function login(context) {
  const page = await context.newPage();
  await page.goto(new URL('/login?next=%2Fstudent%2Foverview', BASE).toString(), { waitUntil: 'domcontentloaded' });
  await settle(page);
  for (const phone of [PHONE_NATIONAL, PHONE_ALT]) {
    await page.locator('#auth-phone').fill('');
    await page.locator('#auth-phone').fill(phone);
    await page.locator('#auth-password').fill('');
    await page.locator('#auth-password').fill(PASSWORD);
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL(/\/student/, { timeout: 12000 });
      return page;
    } catch {}
  }
  throw new Error('Login failed');
}

const out = {};

(async () => {
  const browser = await chromium.launch();

  for (const [label, viewport] of [
    ['desktop', { width: 1440, height: 900 }],
    ['mobile', { width: 390, height: 844 }],
  ]) {
    const ctx = await browser.newContext({
      viewport,
      deviceScaleFactor: 2,
      ...(label === 'mobile' ? { isMobile: true, hasTouch: true } : {}),
    });
    const page = await login(ctx);
    out[label] = {};
    for (const [name, url] of PAGES) {
      try {
        await page.goto(new URL(url, BASE).toString(), { waitUntil: 'domcontentloaded' });
        await settle(page);
        out[label][name] = await page.evaluate(MEASURE);
        console.log(`✔ ${label}/${name}`);
      } catch (e) {
        out[label][name] = { error: String(e).slice(0, 200) };
        console.log(`✖ ${label}/${name}`);
      }
    }
    await ctx.close();
  }

  fs.writeFileSync(path.join(__dirname, 'measurements.json'), JSON.stringify(out, null, 2));
  console.log('\nWrote measurements.json');
  await browser.close();
})().catch((e) => {
  console.error('MEASURE FAILED:', e);
  process.exit(1);
});
