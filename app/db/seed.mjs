// Seeds members and rooms from src/data.js. The library and calendar start
// empty — the band adds those itself. Idempotent: re-running replaces the
// seeded rows. Refuses to clobber a database that already holds songs or
// events unless you pass --force.
import { BAND, SONGS, EVENTS, ROOMS, TODAY } from '../src/data.js';
import { withDb } from './client.mjs';

const force = process.argv.includes('--force');
/** '2 days ago' -> an absolute timestamp, counted back from today. */
function noteTimestamp(age) {
  if (!age) return null;
  const m = age.match(/^(\d+)\s+(day|week|month)s?\s+ago$/);
  if (!m) return null;
  const days = Number(m[1]) * ({ day: 1, week: 7, month: 30 })[m[2]];
  const d = new Date(`${TODAY}T20:00:00Z`);
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

await withDb(async (db) => {
  const { rows: [count] } = await db.query(
    `select (select count(*) from songs)::int as songs,
            (select count(*) from events)::int as events`
  );
  const seeded = count.songs === 0 && count.events === 0;
  if (!seeded && !force) {
    console.error(
      `refusing to seed: the database already holds ${count.songs} songs and ` +
      `${count.events} events. Re-run with --force to replace them.`
    );
    process.exitCode = 1;
    return;
  }

  await db.query('begin');
  try {
    // Children first; the foreign keys cascade but being explicit keeps the
    // order obvious if this ever grows a table.
    await db.query('truncate attendance, event_songs, events, songs, rooms, members cascade');

    for (const [i, m] of BAND.members.entries()) {
      await db.query(
        `insert into members (id, name, initials, role, hue, pos) values ($1,$2,$3,$4,$5,$6)`,
        [m.id, m.name, m.initials, m.role, m.hue, i]
      );
    }
    for (const name of ROOMS) {
      await db.query('insert into rooms (name) values ($1)', [name]);
    }
    for (const s of SONGS) {
      await db.query(
        `insert into songs (id, title, artist, key, bpm, sec, capo, time_sig, own,
                            needs_work, custom, sections, artwork, note, note_by,
                            note_at, last_played, import_source)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)`,
        [s.id, s.title, s.artist, s.key, s.bpm, s.sec, s.capo ?? 0, s.timeSig || '4/4',
         !!s.own, !!s.needsWork, !!s.custom, JSON.stringify(s.sections || []),
         s.artwork ?? null, s.note ?? null, s.noteBy ?? null, noteTimestamp(s.noteAge),
         s.lastPlayedISO ?? null, s.importSource ?? null]
      );
    }
    for (const [date, ev] of Object.entries(EVENTS)) {
      await db.query(
        `insert into events (date, kind, time, end_time, place) values ($1,$2,$3,$4,$5)`,
        [date, ev.kind || 'r', ev.time || '', ev.end || '', ev.place || '']
      );
      const done = new Set(ev.done || []);
      for (const [pos, songId] of (ev.songs || []).entries()) {
        await db.query(
          `insert into event_songs (event_date, song_id, pos, done) values ($1,$2,$3,$4)`,
          [date, songId, pos, done.has(songId)]
        );
      }
      for (const [memberId, status] of Object.entries(ev.att || {})) {
        await db.query(
          `insert into attendance (event_date, member_id, status) values ($1,$2,$3)`,
          [date, memberId, status]
        );
      }
    }
    await db.query('commit');
  } catch (e) {
    await db.query('rollback');
    throw e;
  }

  const { rows } = await db.query(
    `select 'members' as t, count(*)::int from members
     union all select 'rooms', count(*)::int from rooms
     union all select 'songs', count(*)::int from songs
     union all select 'events', count(*)::int from events
     union all select 'event_songs', count(*)::int from event_songs
     union all select 'attendance', count(*)::int from attendance`
  );
  console.log('seeded:');
  for (const r of rows) console.log(`  ${r.t.padEnd(12)} ${r.count}`);
});
