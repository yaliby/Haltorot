import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'phone');
mkdirSync(dir, { recursive: true });

const chrome =
  process.env.CHROME ||
  '/home/yaliby/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});

const context = await browser.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  isMobile: true,
  hasTouch: true,
  locale: 'he-IL'
});

const page = await context.newPage();
await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);

async function shot(name) {
  await page.screenshot({ path: join(dir, `${name}.png`), fullPage: false });
  console.log('shot', name, page.url());
}

await shot('01-calendar-he');

// sliders present?
const toggles = page.locator('.app-toggles');
console.log('toggles visible', await toggles.isVisible());
const box = await toggles.boundingBox();
console.log('toggles box', box);

const importBtn = page.locator('button', { hasText: 'ייבוא מהרשת' });
await page.locator('.tab', { hasText: 'שירים' }).click();
await page.waitForTimeout(350);
await shot('02-songs-he');

if (await importBtn.count()) {
  const b = await importBtn.boundingBox();
  console.log('import btn box', b);
  const clipped = b && (b.x + b.width > 390 || b.x < 0 || b.y < 0);
  console.log('import clipped?', clipped, 'right', b ? b.x + b.width : null);
}

await page.locator('.tab', { hasText: 'לוח שנה' }).click();
await page.waitForTimeout(300);

// next month
await page.getByLabel('חודש הבא').click();
await page.waitForTimeout(500);
await shot('03-calendar-next');

await page.getByLabel('חודש קודם').click();
await page.waitForTimeout(500);

// open a rehearsal day if possible
const booked = page.locator('.cal-month:not([aria-hidden]) .day.has-event').first();
if (await booked.count()) {
  await booked.click();
  await page.waitForTimeout(250);
  await shot('04-day-panel');
  const openBtn = page.locator('.sheet-act .btn');
  if (await openBtn.count()) {
    await openBtn.click();
    await page.waitForTimeout(400);
    await shot('05-rehearsal');
  }
}

await page.goto('http://127.0.0.1:5174/songs', { waitUntil: 'networkidle' });
await page.waitForTimeout(300);
await shot('06-songs-direct');

await page.goto('http://127.0.0.1:5174/song/copper-line?from=2026-08-29', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('07-song');

await page.locator('.theme-toggle').click();
await page.waitForTimeout(400);
await shot('08-song-light');

await page.locator('.lang-toggle').click();
await page.waitForTimeout(600);
await shot('09-song-en');

await page.goto('http://127.0.0.1:5174/', { waitUntil: 'networkidle' });
await page.waitForTimeout(400);
await shot('10-calendar-en');

await browser.close();
console.log('done', dir);
