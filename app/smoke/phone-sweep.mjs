/* Every screen, on a phone, in both languages and both themes — looking for
   the three things that make an app feel unfinished on a small screen:
   something sticking out past the edge, something clipped mid-word, and
   something too small to hit with a thumb.

   Run the dev server first:  npm run dev
   Then:                      node smoke/phone-sweep.mjs
*/
import { chromium } from 'playwright-core';
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const here = dirname(fileURLToPath(import.meta.url));
const dir = join(here, 'phone');
mkdirSync(dir, { recursive: true });

const BASE = process.env.BASE || 'http://127.0.0.1:5174';
const chrome =
  process.env.CHROME ||
  '/home/yaliby/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';

/* Two phones: the one most people hold, and the narrowest one still sold. */
const PHONES = [
  { name: 'iphone', width: 390, height: 844 },
  { name: 'small', width: 360, height: 740 }
];

const findings = [];
const note = (where, kind, detail) => {
  findings.push({ where, kind, detail });
  console.log(`  ${kind === 'clean' ? 'ok  ' : 'FAIL'} ${where} · ${kind}${detail ? ' · ' + detail : ''}`);
};

/* Sticking out: the element runs past the viewport and nothing between it and
   the page clips it. A carousel that parks a month offscreen inside an
   overflow-hidden track is doing its job, not leaking. */
const AUDIT = () => {
  const W = document.documentElement.clientWidth;
  const H = document.documentElement.clientHeight;
  const label = (el) =>
    el.tagName.toLowerCase() +
    (el.className && typeof el.className === 'string' ? '.' + el.className.trim().split(/\s+/).join('.') : '') +
    ' « ' + (el.textContent || '').trim().slice(0, 40) + ' »';

  const clippedByAncestor = (el) => {
    let p = el.parentElement;
    while (p && p !== document.documentElement) {
      const s = getComputedStyle(p);
      if (/hidden|scroll|auto|clip/.test(s.overflowX) || /hidden|scroll|auto|clip/.test(s.overflow)) return true;
      p = p.parentElement;
    }
    return false;
  };

  const out = { pageScroll: 0, outside: [], clipped: [], small: [], underTabbar: [] };
  out.pageScroll = document.documentElement.scrollWidth - W;

  for (const el of document.body.querySelectorAll('*')) {
    const s = getComputedStyle(el);
    if (s.display === 'none' || s.visibility === 'hidden' || s.opacity === '0') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 1 || r.height < 1) continue;

    if ((r.right > W + 1 || r.left < -1) && !clippedByAncestor(el)) {
      out.outside.push({ el: label(el), left: Math.round(r.left), right: Math.round(r.right) });
    }

    /* A word cut off mid-letter with no ellipsis is a layout that ran out of
       room and said nothing about it. */
    if (
      el.children.length === 0 &&
      /hidden|clip/.test(s.overflowX) &&
      s.textOverflow !== 'ellipsis' &&
      el.scrollWidth > el.clientWidth + 2
    ) {
      out.clipped.push({ el: label(el), by: el.scrollWidth - el.clientWidth });
    }

    /* Anything you are meant to hit with a thumb. A wide back link is only
       15px tall and is still an easy target — what is hard is a box that is
       small in both directions, so the area has a say too. */
    if ((el.tagName === 'BUTTON' || el.tagName === 'A') && el.offsetParent !== null) {
      if (Math.round(Math.min(r.width, r.height)) < 24 && r.width * r.height < 1600) {
        out.small.push({ el: label(el), w: Math.round(r.width), h: Math.round(r.height) });
      }
    }
  }

  /* The tab bar is the floor. Nothing you can press may sit under it. */
  const bar = document.querySelector('.tabbar');
  if (bar) {
    const b = bar.getBoundingClientRect();
    for (const el of document.querySelectorAll('.btn, .ghost, .align-bar, .song-nextbar, .sheet-act')) {
      const s = getComputedStyle(el);
      if (s.display === 'none' || s.visibility === 'hidden') continue;
      const r = el.getBoundingClientRect();
      if (r.height < 1) continue;
      if (r.top < b.bottom && r.bottom > b.top && r.top < H) {
        const z = (n) => Number(getComputedStyle(n).zIndex) || 0;
        if (z(el) < z(bar) && !el.closest('.tabbar')) {
          out.underTabbar.push({ el: label(el), top: Math.round(r.top), barTop: Math.round(b.top) });
        }
      }
    }
  }
  return out;
};

async function check(page, where, shotName) {
  if (shotName) await page.screenshot({ path: join(dir, `${shotName}.png`) });
  const r = await page.evaluate(AUDIT);
  let clean = true;
  if (r.pageScroll > 1) { note(where, 'page scrolls sideways', `${r.pageScroll}px`); clean = false; }
  for (const o of r.outside.slice(0, 6)) { note(where, 'sticks out', `${o.el} [${o.left}..${o.right}]`); clean = false; }
  for (const c of r.clipped.slice(0, 6)) { note(where, 'clipped text', `${c.el} (+${c.by}px)`); clean = false; }
  for (const s of r.small.slice(0, 6)) { note(where, 'tap target', `${s.el} ${s.w}×${s.h}`); clean = false; }
  for (const u of r.underTabbar.slice(0, 4)) { note(where, 'under the tab bar', u.el); clean = false; }
  if (clean) note(where, 'clean', '');
  return r;
}

const settle = (page, ms = 380) => page.waitForTimeout(ms);

/* --- the one flow that is new: moving a chord over a word ---------------- */
async function alignFlow(page, tag) {
  await page.goto(`${BASE}/song/copper-line?from=2026-08-29`, { waitUntil: 'networkidle' });
  await settle(page, 500);
  const scrim = page.locator('.note-scrim');
  if (await scrim.count()) { await page.locator('.note-pop .icon-btn').click(); await settle(page); }

  await page.locator('.chart-edit-btn').click();
  await settle(page);
  await check(page, `${tag} · align opened`, `${tag}-align-open`);

  const before = await page.locator('.chart-section .line').first().innerText();

  // Pick up the second chord of the first sung line, then drop it a letter back.
  const line = page.locator('.chart-section .line').filter({ hasText: 'copper' }).first();
  const chordBtn = line.locator('.ed-chord').nth(1);
  const chordName = (await chordBtn.innerText()).trim();
  await chordBtn.click();
  await settle(page, 200);

  const held = await page.locator('.align-chord').innerText();
  console.log(`  picked up ${chordName}, bar says ${held.trim()}`);
  if (held.trim() !== chordName) note(`${tag} · align`, 'bar shows the wrong chord', held);

  await check(page, `${tag} · chord in hand`, `${tag}-align-held`);

  // A tap on a letter is the move.
  const letters = line.locator('.ed-ch');
  const n = await letters.count();
  const target = letters.nth(Math.max(0, Math.floor(n / 2) - 3));
  const letter = await target.innerText();
  const targetAt = await target.getAttribute('data-at');
  await target.click();
  await settle(page, 200);

  const moved = await line.evaluate((p) =>
    [...p.querySelectorAll('.chord-seg')].map((s) => [
      s.querySelector('.c')?.innerText.trim(),
      s.querySelector('.t')?.innerText
    ])
  );
  const nowAt = await line.locator('.chord-seg.is-held .ed-ch').first().getAttribute('data-at');
  if (nowAt !== targetAt) note(`${tag} · align`, 'the chord did not land on the tapped letter', `${nowAt} ≠ ${targetAt}`);
  else console.log(`  ${chordName} landed on «${letter}» at ${targetAt}`);

  // The arrows walk it one character at a time.
  await page.locator('.align-move button').first().click();
  await settle(page, 150);
  const back = await line.locator('.chord-seg.is-held .ed-ch').first().getAttribute('data-at');
  if (Number(back) !== Number(targetAt) - 1) note(`${tag} · align`, 'the arrow did not step one character', `${targetAt} → ${back}`);
  else console.log(`  the arrow stepped it to ${back}`);

  await check(page, `${tag} · after the move`, `${tag}-align-moved`);

  await page.locator('.align-acts .btn').click();
  await settle(page, 500);
  await check(page, `${tag} · saved`, `${tag}-align-saved`);

  const after = await page.locator('.chart-section .line').first().innerText();
  console.log(`  chart line before/after save: ${JSON.stringify(before)} / ${JSON.stringify(after)}`);

  // And it is still there after a reload.
  await page.reload({ waitUntil: 'networkidle' });
  await settle(page, 500);
  const kept = await page
    .locator('.chart-section .line')
    .filter({ hasText: 'copper' })
    .first()
    .innerText();
  console.log(`  after reload: ${JSON.stringify(kept)}`);
  return { chordName, moved, kept };
}

/* A Hebrew chart is the hard case and the library ships none: the words run
   right to left under a chord row that still runs left to right, and every
   letter has to stay tappable through the bidi reorder. Seed one. */
const HEB = {
  id: 'sweep-hebrew',
  title: 'כוכב נופל',
  artist: 'סטטיק בלום',
  key: 'Am',
  bpm: 92,
  sec: 210,
  capo: 0,
  timeSig: '4/4',
  own: true,
  custom: true,
  sections: [
    {
      label: 'בית',
      bars: '8 bars',
      lines: [
        [{ c: 'Am', t: 'הכוכבים דולקים ' }, { c: 'F', t: 'על אש קטנה' }],
        [{ c: 'C', t: 'ואני עוד ' }, { c: 'G', t: 'זוכר את הדרך' }]
      ]
    }
  ]
};

async function hebrewFlow(page, tag) {
  await page.goto(`${BASE}/songs`, { waitUntil: 'networkidle' });
  await page.evaluate((song) => {
    const raw = localStorage.getItem('static-bloom.v2');
    const saved = raw ? JSON.parse(raw) : {};
    const custom = (saved.custom || []).filter((s) => s.id !== song.id);
    localStorage.setItem('static-bloom.v2', JSON.stringify({ ...saved, custom: [...custom, song] }));
  }, HEB);
  await page.goto(`${BASE}/song/${HEB.id}`, { waitUntil: 'networkidle' });
  await settle(page, 500);
  await check(page, `${tag} · hebrew chart`, `${tag}-09-hebrew`);

  await page.locator('.chart-edit-btn').click();
  await settle(page, 300);

  const line = page.locator('.chart-section .line').first();
  await line.locator('.ed-chord').nth(1).click();
  await settle(page, 200);
  await check(page, `${tag} · hebrew align`, `${tag}-10-hebrew-align`);

  /* The words run right to left, so "one character earlier" is the arrow
     pointing right. */
  const dir = await page.locator('.align-move').getAttribute('dir');
  const firstArrow = await page.locator('.align-move button svg').first().getAttribute('data-icon');
  if (dir !== 'rtl') note(`${tag} · hebrew`, 'the arrows did not follow the words', `dir=${dir}`);
  if (firstArrow !== 'right') note(`${tag} · hebrew`, 'earlier is not the right arrow', `icon=${firstArrow}`);

  /* Every letter still answers where it is drawn, after the bidi reorder. */
  const letters = line.locator('.ed-ch');
  const target = letters.nth(3);
  const want = await target.getAttribute('data-at');
  const glyph = await target.innerText();
  await target.click();
  await settle(page, 200);
  const got = await line.locator('.chord-seg.is-held .ed-ch').first().getAttribute('data-at');
  if (got !== want) note(`${tag} · hebrew`, 'the chord missed the tapped letter', `${got} ≠ ${want}`);
  else console.log(`  hebrew: the chord landed on «${glyph}» at ${want}`);

  /* The chord row still reads left to right over a right-to-left lyric. */
  const rowReadsLtr = await line.evaluate((p) => {
    const cs = [...p.querySelectorAll('.chord-seg')].filter((s) => s.querySelector('.c')?.innerText.trim());
    const xs = cs.map((s) => s.querySelector('.c').getBoundingClientRect().right);
    return xs.length < 2 ? true : xs[0] > xs[1];
  });
  if (!rowReadsLtr) note(`${tag} · hebrew`, 'the chord row lost its reading order', '');

  await check(page, `${tag} · hebrew moved`, `${tag}-11-hebrew-moved`);
  await page.locator('.align-acts .btn').click();
  await settle(page, 450);
  await check(page, `${tag} · hebrew saved`, `${tag}-12-hebrew-saved`);

  await page.reload({ waitUntil: 'networkidle' });
  await settle(page, 450);
  console.log('  hebrew after reload:', JSON.stringify(await line.innerText()));
}

/* --- the sweep ---------------------------------------------------------- */
const browser = await chromium.launch({
  executablePath: chrome,
  headless: true,
  args: ['--no-sandbox', '--disable-gpu']
});

for (const phone of PHONES) {
  for (const locale of ['he', 'en']) {
    for (const theme of ['dark', 'light']) {
      const tag = `${phone.name}-${locale}-${theme}`;
      console.log(`\n=== ${tag} (${phone.width}×${phone.height}) ===`);
      const context = await browser.newContext({
        viewport: { width: phone.width, height: phone.height },
        deviceScaleFactor: 2,
        isMobile: true,
        hasTouch: true,
        locale: locale === 'he' ? 'he-IL' : 'en-US'
      });
      const page = await context.newPage();
      page.on('pageerror', (e) => note(tag, 'page error', e.message));
      page.on('console', (m) => {
        // The dev server has no favicon; that is not the app's problem.
        if (m.type() === 'error' && !/favicon/.test(m.location()?.url || '')) note(tag, 'console error', m.text());
      });

      await page.goto(BASE, { waitUntil: 'networkidle' });
      await page.evaluate(
        ([l, th]) => {
          const raw = localStorage.getItem('static-bloom.v2');
          const saved = raw ? JSON.parse(raw) : {};
          localStorage.setItem('static-bloom.v2', JSON.stringify({ ...saved, locale: l, theme: th }));
        },
        [locale, theme]
      );
      await page.reload({ waitUntil: 'networkidle' });
      await settle(page, 500);

      await check(page, `${tag} · calendar`, `${tag}-01-calendar`);

      // a booked day, opened
      const booked = page.locator('.cal-month:not([aria-hidden]) .day.has-event').first();
      if (await booked.count()) {
        await booked.click();
        await settle(page);
        await check(page, `${tag} · day sheet`, `${tag}-02-day`);
        const open = page.locator('.sheet-act .btn');
        if (await open.count()) {
          await open.click();
          await settle(page, 500);
          await check(page, `${tag} · rehearsal`, `${tag}-03-rehearsal`);
        }
      }

      await page.goto(`${BASE}/songs`, { waitUntil: 'networkidle' });
      await settle(page, 400);
      await check(page, `${tag} · library`, `${tag}-04-songs`);

      // the import sheet, and the hand-written new song under it
      const imp = page.locator('.lib-import-btn').first();
      if (await imp.count()) {
        await imp.click();
        await settle(page, 450);
        await check(page, `${tag} · import sheet`, `${tag}-05-import`);
        await page.locator('.import-sheet .icon-btn').click();
        await settle(page, 350);
      }
      const add = page.locator('.lib-tools .btn').first();
      if (await add.count()) {
        await add.click();
        await settle(page, 450);
        await check(page, `${tag} · new song sheet`, `${tag}-05b-newsong`);
        await page.locator('.sheet-scrim').click({ position: { x: 10, y: 10 } });
        await settle(page, 350);
      }

      await page.goto(`${BASE}/song/copper-line?from=2026-08-29`, { waitUntil: 'networkidle' });
      await settle(page, 500);
      if (await page.locator('.note-scrim').count()) {
        await page.locator('.note-pop .icon-btn').click();
        await settle(page);
      }
      await check(page, `${tag} · song`, `${tag}-06-song`);

      // stage mode
      await page.locator('.ctl-toggles .ghost').last().click();
      await settle(page, 450);
      await check(page, `${tag} · stage`, `${tag}-07-stage`);
      await page.locator('.stage-bar button').last().click();
      await settle(page, 350);

      // a song with no chart at all
      await page.goto(`${BASE}/song/room-12`, { waitUntil: 'networkidle' });
      await settle(page, 400);
      await check(page, `${tag} · song with no chart`, `${tag}-08-nochart`);

      // and the new mode, on both phones, in both scripts
      await alignFlow(page, tag);
      await hebrewFlow(page, tag);

      await context.close();
    }
  }
}

await browser.close();

const bad = findings.filter((f) => f.kind !== 'clean');
writeFileSync(join(dir, 'sweep.json'), JSON.stringify(findings, null, 2));
console.log(`\n${findings.length - bad.length} clean · ${bad.length} finding(s)`);
for (const f of bad) console.log(`  ${f.where} · ${f.kind} · ${f.detail}`);
console.log('shots in', dir);
process.exit(bad.length ? 1 : 0);
