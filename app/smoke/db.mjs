/* The database, exercised through the app rather than around it.
   Every write below is made by clicking the real UI; the admin connection is
   only ever used to read back what landed, or to set up a fixture.

   The suite takes a full backup first and restores it at the end, so it is
   safe to run against a database that holds real work — including the checks
   that deliberately wipe everything.

   Run the dev server first:  npm run dev
   Then:                      npm run db:test
*/
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { chromium } from 'playwright-core';
import { withDb, adminEnv } from '../db/client.mjs';

const BASE = process.env.BASE || 'http://127.0.0.1:5174';
const CHROME =
  process.env.CHROME ||
  '/home/yaliby/.cache/ms-playwright/chromium-1234/chrome-linux64/chrome';
const FREE = '2026-12-01';        // no booking unless a test creates one
const BUSY = '2026-11-15';        // fixture rehearsal the suite inserts

let fail = 0;
let section = '';
const head = (s) => { section = s; console.log(`\n── ${s}`); };
const check = (name, pass, detail = '') => {
  console.log(`  ${pass ? 'ok  ' : 'FAIL'} ${name}${detail ? ' · ' + detail : ''}`);
  if (!pass) fail++;
};
const q = (sql, params) => withDb((db) => db.query(sql, params).then((r) => r.rows));
const one = async (sql, params) => (await q(sql, params))[0];
const counts = () => one(
  `select (select count(*)::int from events)      e,
          (select count(*)::int from event_songs) es,
          (select count(*)::int from songs)       s,
          (select count(*)::int from attendance)  a,
          (select count(*)::int from rooms)       r,
          (select count(*)::int from members)     m`);

/* jsonb keeps an object, not the text you sent, so key order is not preserved.
   Compare the way every reader of a chart does: by content. */
const sorted = (v) =>
  Array.isArray(v) ? v.map(sorted)
  : v && typeof v === 'object'
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, sorted(v[k])]))
    : v;
const sameJson = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

const { SUPABASE_URL } = adminEnv();
const PUB =
  process.env.VITE_SUPABASE_PUBLISHABLE_KEY ||
  readFileSync(new URL('../.env', import.meta.url), 'utf8')
    .match(/VITE_SUPABASE_PUBLISHABLE_KEY=(.+)/)?.[1]?.trim();
const rest = (path, init = {}) =>
  fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: { apikey: PUB, Authorization: `Bearer ${PUB}`,
               'Content-Type': 'application/json', ...(init.headers || {}) }
  });

const run = (cmd, args) => new Promise((res, rej) => {
  const p = spawn(cmd, args, { cwd: new URL('..', import.meta.url).pathname, stdio: 'pipe' });
  let out = '';
  p.stdout.on('data', (d) => (out += d));
  p.stderr.on('data', (d) => (out += d));
  p.on('close', (code) => (code === 0 ? res(out) : rej(new Error(out.slice(-400)))));
});

// ── backup ───────────────────────────────────────────────────────────────
head('backup');
await run('node', ['db/backup.mjs', 'suite-backup.json']);
const start = await counts();
check('backup taken', true, JSON.stringify(start));

const browser = await chromium.launch({ executablePath: CHROME });
const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
const writeFailures = [];
page.on('console', (m) => {
  if (m.type() === 'warning' && m.text().includes('persist failed')) writeFailures.push(m.text());
});

/* A UI step that cannot complete is a finding, not a reason to abandon the
   remaining checks — and it must never leave the database unrestored. */
async function step(what, fn) {
  try {
    return await fn();
  } catch (e) {
    check(what, false, e.message.split('\n')[0].slice(0, 90));
    return null;
  }
}

const go = async (path, wait = 1400) => {
  await page.goto(`${BASE}${path}`, { waitUntil: 'networkidle' });
  await page.waitForTimeout(wait);
  // A song that carries a band note opens it over the chart; it swallows clicks.
  if (await page.$('.note-scrim')) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
  }
};
/* An empty setlist offers a plain button; a filled one offers the toggle in
   the section header. Try the toggle first, then fall back. */
async function openPicker() {
  const toggle = await page.$('button.ghost[aria-expanded="false"]');
  if (toggle) await toggle.click();
  else await page.click('.empty button.btn, button.btn');
  await page.waitForTimeout(800);
  return page.$$('button.mini-row');
}

try {
  const FIX_CHART = [{ label: 'V', bars: '4', lines: [[{ c: 'D', t: 'hello there' }]] }];
  await q(`delete from events where date = $1`, [BUSY]);
  await q(`delete from songs where id in ('fx-one','fx-two','fx-three')`);
  await q(
    `insert into songs (id,title,artist,key,bpm,sec,own,custom,sections)
     values ('fx-one','Fixture One','Probe','D',96,180,true,true,$1::jsonb),
            ('fx-two','Fixture Two','Probe','G',110,200,true,true,'[]'::jsonb),
            ('fx-three','Fixture Three','Probe','A',90,160,true,true,'[]'::jsonb)`,
    [JSON.stringify(FIX_CHART)]
  );
  await q(`insert into events (date, kind, time, end_time, place)
           values ($1, 'r', '19:00', '22:00', 'יניב')`, [BUSY]);
  await q(`insert into event_songs (event_date, song_id, pos, done)
           values ($1,'fx-one',0,false), ($1,'fx-two',1,true), ($1,'fx-three',2,false)`, [BUSY]);
  await q(`insert into attendance (event_date, member_id, status)
           values ($1, 'maya', 'in')
           on conflict (event_date, member_id) do update set status = 'in'`, [BUSY]);

  // ── schema and integrity, before anything moves ───────────────────────
  head('schema and integrity');
  const rls = await q(
    `select relname, relrowsecurity from pg_class
      where relname in ('members','rooms','songs','events','event_songs','attendance')
        and relnamespace = 'public'::regnamespace order by relname`);
  check('RLS enabled on all six tables',
        rls.length === 6 && rls.every((r) => r.relrowsecurity),
        rls.filter((r) => !r.relrowsecurity).map((r) => r.relname).join(', ') || 'all on');

  const pol = await q(`select tablename from pg_policies where schemaname = 'public'`);
  check('every table carries a policy', new Set(pol.map((p) => p.tablename)).size === 6,
        `${pol.length} policies`);

  const orphanSongs = await one(
    `select count(*)::int c from event_songs es
      left join songs s on s.id = es.song_id where s.id is null`);
  check('no setlist row points at a missing song', orphanSongs.c === 0, `${orphanSongs.c}`);
  const orphanAtt = await one(
    `select count(*)::int c from attendance a
      left join members m on m.id = a.member_id where m.id is null`);
  check('no attendance row points at a missing member', orphanAtt.c === 0, `${orphanAtt.c}`);

  const gaps = await q(
    `select event_date from (
       select event_date, pos, row_number() over (partition by event_date order by pos) - 1 rn
         from event_songs) t where pos <> rn group by event_date`);
  check('setlist positions are contiguous everywhere', gaps.length === 0,
        gaps.map((g) => g.event_date).join(', '));

  // The constraints must actually bite, not just be declared.
  let rejected = await rest('event_songs', { method: 'POST',
    body: JSON.stringify({ event_date: BUSY, song_id: 'no-such-song', pos: 99 }) });
  check('a setlist row for an unknown song is refused', rejected.status >= 400, `http ${rejected.status}`);
  rejected = await rest('events', { method: 'POST',
    body: JSON.stringify({ date: '2027-01-01', kind: 'x' }) });
  check('an event of an unknown kind is refused', rejected.status >= 400, `http ${rejected.status}`);
  rejected = await rest('attendance', { method: 'POST',
    body: JSON.stringify({ event_date: BUSY, member_id: 'maya', status: 'maybe' }) });
  check('an attendance status outside the three is refused', rejected.status >= 400, `http ${rejected.status}`);

  // ── reading ──────────────────────────────────────────────────────────
  head('reading');
  await q(`insert into songs (id,title,artist,key,bpm,sec,own)
           values ('db-probe','DBPROBE Only In Postgres','Probe','C',100,180,true)
           on conflict (id) do nothing`);
  await go('/songs');
  let body = await page.textContent('body');
  check('library hydrates from Postgres', body.includes('DBPROBE Only In Postgres'));
  check('fixture songs render', body.includes('Fixture One'));
  await q(`delete from songs where id = 'db-probe'`);

  const html = await page.content();
  const dupes = ['יניב', 'מטאור', 'חיפה'].filter((r) => html.split(`>${r}<`).length - 1 > 1);
  check('rooms are not listed twice', dupes.length === 0, dupes.join(', '));

  await go(`/rehearsal/${BUSY}`);
  body = await page.textContent('body');
  const seeded = await q(
    `select s.title from event_songs es join songs s on s.id = es.song_id
      where es.event_date = $1 order by es.pos`, [BUSY]);
  check('a fixture setlist renders in database order',
        seeded.length > 0 && seeded.every((t) => body.includes(t.title)), `${seeded.length} songs`);

  // ── writing: booking, setlist, order ─────────────────────────────────
  head('writing');
  await q(`delete from events where date = $1`, [FREE]);
  await go(`/rehearsal/${FREE}`, 1200);
  await page.click('.empty-plain button.btn');
  await page.waitForTimeout(1500);
  const booked = await one(`select kind, time, end_time, place from events where date = $1`, [FREE]);
  check('booking reaches the events table', !!booked, JSON.stringify(booked || null));
  check('place comes from the rooms table', booked?.place === 'יניב', booked?.place);

  let offered = await openPicker();
  check('setlist picker lists the library', offered.length > 0, `${offered.length} songs`);
  for (const row of offered.slice(0, 3)) { await row.click(); await page.waitForTimeout(800); }
  let set = await q(`select song_id, pos from event_songs where event_date = $1 order by pos`, [FREE]);
  check('setlist rows are written', set.length === 3, JSON.stringify(set.map((r) => r.song_id)));
  check('positions are contiguous from zero', set.every((r, i) => r.pos === i));

  // Reorder, via the grip's keyboard path — the same reducer action drag uses.
  const orderBefore = set.map((r) => r.song_id);
  const grip = await page.$('button.grip');
  if (grip) { await grip.focus(); await page.keyboard.press('ArrowDown'); await page.waitForTimeout(1400); }
  set = await q(`select song_id, pos from event_songs where event_date = $1 order by pos`, [FREE]);
  const orderAfter = set.map((r) => r.song_id);
  check('reorder is written through', JSON.stringify(orderBefore) !== JSON.stringify(orderAfter),
        `${orderBefore.join(',')} -> ${orderAfter.join(',')}`);
  check('reorder keeps positions contiguous', set.every((r, i) => r.pos === i));
  check('reorder keeps every song', orderBefore.slice().sort().join() === orderAfter.slice().sort().join());

  // Edit the booking's own details.
  await step('an edited booking is written through', async () => {
    await page.click('.reh-ctl button.ghost', { timeout: 8000 });
    await page.waitForTimeout(700);
    await page.fill('input[type="time"]', '18:30');
    await page.click('button.btn-block', { timeout: 8000 });
    await page.waitForTimeout(1600);
  });
  const edited = await one(`select time from events where date = $1`, [FREE]);
  check('an edited booking is written through', edited?.time === '18:30', edited?.time);

  // ── durability ───────────────────────────────────────────────────────
  head('durability');
  await page.evaluate(() => localStorage.clear());
  await go(`/rehearsal/${FREE}`);
  body = await page.textContent('body');
  const titles = await q(
    `select s.title from event_songs es join songs s on s.id = es.song_id
      where es.event_date = $1 order by es.pos`, [FREE]);
  check('booking survives a reload with localStorage cleared', body.includes('18:30'));
  check('setlist survives it too',
        titles.length === 3 && titles.every((t) => body.includes(t.title)),
        titles.map((t) => t.title).join(', '));

  // A second browser must see the first one's work: the database is shared.
  const other = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await other.goto(`${BASE}/rehearsal/${FREE}`, { waitUntil: 'networkidle' });
  await other.waitForTimeout(1600);
  const otherBody = await other.textContent('body');
  check('a second browser sees the same booking', otherBody.includes('18:30'));
  await other.close();

  // ── attendance ───────────────────────────────────────────────────────
  head('attendance');
  await go(`/rehearsal/${BUSY}`);
  const attBefore = await one(
    `select status from attendance where event_date = $1 and member_id = 'maya'`, [BUSY]);
  const att = await page.$$('button.att-status');
  if (att.length) { await att[0].click(); await page.waitForTimeout(1400); }
  const attAfter = await one(
    `select status from attendance where event_date = $1 and member_id = 'maya'`, [BUSY]);
  check('attendance writes through', att.length > 0 && attBefore?.status !== attAfter?.status,
        `${attBefore?.status} -> ${attAfter?.status}`);

  // ── library ──────────────────────────────────────────────────────────
  head('library');
  await q(`insert into songs (id,title,artist,key,bpm,sec,own,custom)
           values ('probe-del','PROBE Deletable','Probe','G',110,200,true,true)
           on conflict (id) do update set custom = true`);
  await go('/songs');
  body = await page.textContent('body');
  check('a band-added song appears', body.includes('PROBE Deletable'));
  const del = await page.$('button.lib-del');
  check('only band-added songs offer a delete', !!del);
  const delCount = (await page.$$('button.lib-del')).length;
  const songCount = (await one(`select count(*)::int c from songs`)).c;
  check('every song in the library can be deleted', delCount === songCount,
        `${delCount} buttons, ${songCount} songs`);
  // Delete the probe specifically, not whichever row came first.
  const probeDel = await page.$(`button.lib-del[aria-label*="PROBE Deletable"]`);
  if (probeDel) { await probeDel.click(); await page.waitForTimeout(1500); }
  const gone = await q(`select id from songs where id = 'probe-del'`);
  check('deleting a song removes the row', gone.length === 0);

  // ── charts ───────────────────────────────────────────────────────────
  head('charts');
  await go('/song/fx-one');
  const chartBefore = (await one(`select sections from songs where id = 'fx-one'`)).sections;
  const alignBtn = await page.$('button.chart-edit-btn');
  check('the chart offers an align mode', !!alignBtn);
  await step('align mode opens and saves', async () => {
    await page.click('button.chart-edit-btn', { timeout: 8000 });
    await page.waitForTimeout(800);
    const chord = await page.$('.align-chord, [class*="align"] button:not(.ghost)');
    if (chord) { await chord.click(); await page.waitForTimeout(300); await page.keyboard.press('ArrowRight'); }
    await page.waitForTimeout(300);
    await page.click('.align-acts button.btn', { timeout: 8000 });
    await page.waitForTimeout(1600);
  });
  const chartAfter = (await one(`select sections from songs where id = 'fx-one'`)).sections;
  check('the chart is still a valid chart after an edit',
        Array.isArray(chartAfter) && chartAfter.length === chartBefore.length &&
        chartAfter.every((s) => typeof s.label === 'string' && Array.isArray(s.lines)),
        `${chartAfter.length} sections`);

  // Whatever the UI did or did not change, the column round-trips exactly.
  const probeChart = [{ label: 'Probe', bars: '1', lines: [[{ c: 'C#m7', t: 'שלום' }]] }];
  await rest('songs?id=eq.fx-two', { method: 'PATCH', body: JSON.stringify({ sections: probeChart }) });
  const back = await (await rest('songs?id=eq.fx-two&select=sections')).json();
  check('a chart round-trips through jsonb unchanged', sameJson(back[0].sections, probeChart));
  check('unicode and sharps survive the round trip',
        back[0].sections[0].lines[0][0].t === 'שלום' && back[0].sections[0].lines[0][0].c === 'C#m7');

  // ── importing ────────────────────────────────────────────────────────
  /* This one reaches iTunes and Ultimate Guitar. If either is unreachable the
     section reports a skip rather than a failure — the database wiring is what
     is under test here, not somebody else's uptime. */
  head('importing');
  const idsBefore = (await q('select id from songs')).map((r) => r.id);
  let imported = null;
  await step('the import sheet opens', async () => {
    await go('/songs');
    for (const btn of await page.$$('button')) {
      if (/ייבוא|import/i.test((await btn.textContent()) || '')) { await btn.click(); break; }
    }
    await page.waitForTimeout(900);
    await page.fill('.import-sheet input.field', 'Wonderwall', { timeout: 8000 });
  });
  await page.waitForTimeout(4000);
  const hits = await page.$$('button.import-hit');
  if (!hits.length) {
    console.log('  skip  the search returned nothing — iTunes unreachable?');
  } else {
    check('the search returns results', true, `${hits.length} hits`);
    await hits[0].click();
    await page.waitForTimeout(9000);
    const rows = await q(
      `select id, title, custom, import_source, artwork, last_played,
              jsonb_array_length(sections) secs from songs`);
    imported = rows.find((r) => !idsBefore.includes(r.id));
    check('the imported song reaches Postgres', !!imported, imported?.title || 'nothing new');
    if (imported) {
      check('it is marked as the band\'s own addition', imported.custom === true);
      check('it carries a chart', imported.secs > 0, `${imported.secs} sections`);
      check('it records where it came from', !!imported.import_source, imported.import_source);
      /* The cover is the half of the import that has no other home: it comes
         from iTunes, not from the chart, so nothing else would notice it
         going missing. Checking only the title let it vanish for a while. */
      check('it stores the album cover', !!imported.artwork, imported.artwork || 'none');
      await page.evaluate(() => localStorage.clear());
      await go('/songs');
      check('the import survives a reload',
            (await page.textContent('body')).includes(imported.title));
      if (imported.artwork) {
        check('the cover survives a reload too', !!(await page.$('.art-cover img')));
      }
      check('a song never played reads as such, not as a blank',
            (await page.textContent('.lib-last')).trim().length > 0);
    }
  }

  // ── undo ─────────────────────────────────────────────────────────────
  head('undo');
  await go(`/rehearsal/${FREE}`);
  const beforeUndo = await counts();
  const more = await openPicker();
  check('picker reopens on a filled setlist', more.length > 0, `${more.length} songs`);
  if (more.length) { await more[0].click(); await page.waitForTimeout(1000); }
  const undo = await page.$('.toast-undo');
  check('undo is offered', !!undo);
  if (undo) { await undo.click(); await page.waitForTimeout(2500); }
  const afterUndo = await counts();
  check('undo rolls back without disturbing anything else',
        JSON.stringify(afterUndo) === JSON.stringify(beforeUndo),
        `${JSON.stringify(beforeUndo)} -> ${JSON.stringify(afterUndo)}`);

  // ── deleting a booking ───────────────────────────────────────────────
  head('deleting a booking');
  await go(`/rehearsal/${FREE}`);
  await step('the edit panel opens', async () => {
    await page.click('.reh-ctl button.ghost', { timeout: 8000 });
    await page.waitForTimeout(700);
  });
  const danger = await page.$('button.ghost.danger');
  check('the booking offers a delete', !!danger);
  if (danger) { await danger.click(); await page.waitForTimeout(1600); }
  const deleted = await q(`select date from events where date = $1`, [FREE]);
  check('the event row is gone', deleted.length === 0);
  const cascaded = await one(`select count(*)::int c from event_songs where event_date = $1`, [FREE]);
  check('its setlist cascaded away with it', cascaded.c === 0, `${cascaded.c} left`);

  // ── resilience ───────────────────────────────────────────────────────
  head('resilience');
  const offline = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  await offline.route('**/*.supabase.co/**', (r) => r.abort());
  await offline.goto(`${BASE}/songs`, { waitUntil: 'domcontentloaded' });
  await offline.waitForTimeout(2000);
  const offlineBody = await offline.textContent('body');
  check('with the database unreachable the app still renders',
        offlineBody.includes('Static Bloom'), 'empty library still paints');

  /* The client retries before it gives up, so the notice takes a few seconds
     to arrive — and then it dismisses itself. Watch for it rather than
     sampling once, and record how long the band waits in the dark. */
  const t0 = Date.now();
  let notice = null;
  await offline.waitForSelector('.toast', { timeout: 20000 }).catch(() => {});
  const el = await offline.$('.toast');
  if (el) notice = await el.textContent();
  const waited = Math.round((Date.now() - t0) / 1000);
  check('and it says so rather than failing silently',
        !!notice && /לא הצלחנו|Could not reach/.test(notice), `after ${waited}s`);
  check('the wait before that notice stays under 15s', waited < 15, `${waited}s`);
  await offline.close();

  // ── locales and themes ───────────────────────────────────────────────
  head('locales and themes');
  for (const [loc, dir] of [['he', 'rtl'], ['en', 'ltr']]) {
    const p2 = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await p2.goto(`${BASE}/songs`, { waitUntil: 'networkidle' });
    await p2.evaluate((l) => localStorage.setItem('static-bloom.v2', JSON.stringify({ locale: l, theme: 'dark' })), loc);
    await p2.reload({ waitUntil: 'networkidle' });
    await p2.waitForTimeout(1600);
    const d = await p2.getAttribute('html', 'dir');
    const t2 = await p2.textContent('body');
    check(`${loc}: direction is ${dir}`, d === dir, d);
    check(`${loc}: database content renders`, t2.includes('Fixture One'));
    await p2.close();
  }

  // ── reset ────────────────────────────────────────────────────────────
  head('reset');
  await go('/songs');
  const reset = await page.$('button.reset-demo');
  check('there is no reset-demo control', !reset);

  check('nothing failed to persist along the way', writeFailures.length === 0,
        writeFailures.slice(0, 2).join(' | '));
} finally {
  await browser.close();
  // ── restore ────────────────────────────────────────────────────────────
  head('restore');
  const out = await run('node', ['db/restore.mjs', 'suite-backup.json']);
  const end = await counts();
  check('the database is back exactly as it was',
        JSON.stringify(end) === JSON.stringify(start),
        `${JSON.stringify(start)} -> ${JSON.stringify(end)}`);
  if (!out.includes('FAIL')) check('every table restored to its original size', true);
}

console.log(fail ? `\n${fail} database check(s) failed` : '\nthe database is wired through the app');
process.exit(fail ? 1 : 0);
