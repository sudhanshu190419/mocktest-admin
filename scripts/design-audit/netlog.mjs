/** Identify failing network requests on key student pages. */
import { chromium } from 'playwright';
import { setTimeout as wait } from 'node:timers/promises';

const BASE = 'http://localhost:3000';
const out = [];

async function login(context) {
  const page = await context.newPage();
  await page.goto(`${BASE}/login?next=%2Fstudent%2Foverview`, { waitUntil: 'domcontentloaded' });
  await wait(800);
  for (const phone of ['7897894568', '9178978945']) {
    await page.locator('#auth-phone').fill(phone);
    await page.locator('#auth-password').fill('00121200');
    await page.locator('button[type="submit"]').click();
    try {
      await page.waitForURL(/\/student/, { timeout: 10000 });
      return page;
    } catch {}
  }
  throw new Error('login failed');
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 1440, height: 900 } });
const page = await login(ctx);

page.on('response', (res) => {
  if (res.status() >= 400) {
    out.push(`[${res.status()}] ${res.url().slice(0, 220)}`);
  }
});

for (const url of ['/student/overview', '/student/timetable', '/student/profile']) {
  out.push(`── ${url} ──`);
  await page.goto(`${BASE}${url}`, { waitUntil: 'domcontentloaded' });
  try {
    await page.waitForLoadState('networkidle', { timeout: 10000 });
  } catch {}
  await wait(1500);
}

console.log(out.join('\n'));
await browser.close();
