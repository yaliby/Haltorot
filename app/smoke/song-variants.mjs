import { chromium } from 'playwright-core';
import { mkdirSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const dir = join(dirname(fileURLToPath(import.meta.url)), 'phone');
mkdirSync(dir, { recursive: true });
const chrome = process.env.CHROME || '/home/yaliby/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const browser = await chromium.launch({ executablePath: chrome, headless: true, args: ['--no-sandbox', '--disable-gpu'] });

async function run(name, { locale = 'he', theme = 'dark', url, w = 390, h = 844, scrollTo = 0 }) {
  const context = await browser.newContext({ viewport: { width: w, height: h }, deviceScaleFactor: 2, isMobile: w < 900, hasTouch: w < 900, locale: 'he-IL' });
  await context.addInitScript(([l, t]) => {
    localStorage.setItem('static-bloom.v2', JSON.stringify({ locale: l, theme: t }));
  }, [locale, theme]);
  const page = await context.newPage();
  await page.goto(url, { waitUntil: 'networkidle' });
  await page.waitForTimeout(500);
  if (scrollTo) await page.evaluate((y) => { const s = document.querySelector('.song-body'); if (s) s.scrollTop = y; }, scrollTo);
  await page.waitForTimeout(250);
  const info = await page.evaluate(() => {
    const b = (s) => { const e = document.querySelector(s); if (!e) return null; const r = e.getBoundingClientRect(); return [Math.round(r.x), Math.round(r.y), Math.round(r.width), Math.round(r.height)]; };
    return {
      locale: document.documentElement.lang, dir: document.documentElement.dir, theme: document.documentElement.dataset.theme,
      head: b('.song-head'), ctlRows: (() => { const c = document.querySelector('.song-ctl'); return c ? Math.round(c.getBoundingClientRect().height) : null; })(),
      nextbar: b('.song-nextbar'), aside: b('.aside'),
      overflow: [...document.querySelectorAll('body *')].filter((e) => e.getBoundingClientRect().right > innerWidth + 1).slice(0, 6).map((e) => (e.tagName + '.' + e.className).slice(0, 50))
    };
  });
  console.log(name, JSON.stringify(info));
  await page.screenshot({ path: join(dir, `${name}.png`) });
  await context.close();
}

const base = 'http://127.0.0.1:5174';
await run('v1-inset-he', { url: `${base}/song/copper-line?from=2026-08-29` });
await run('v2-en', { url: `${base}/song/copper-line?from=2026-08-29`, locale: 'en' });
await run('v3-light-bottom', { url: `${base}/song/copper-line`, theme: 'light', scrollTo: 99999 });
await run('v4-nochart', { url: `${base}/song/room-12` });
await run('v5-small', { url: `${base}/song/copper-line?from=2026-08-29`, w: 320, h: 700 });
await run('v7-360', { url: `${base}/song/copper-line?from=2026-08-29`, w: 360, h: 780 });
await run('v8-430', { url: `${base}/song/copper-line?from=2026-08-29`, w: 430, h: 932 });
await run('v6-desktop', { url: `${base}/song/copper-line?from=2026-08-29`, w: 1280, h: 900 });
await browser.close();
