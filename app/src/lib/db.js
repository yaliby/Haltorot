// The Supabase-backed store of record.
//
// Everything here speaks two shapes: the rows Postgres holds, and the objects
// the screens already expect. The mapping lives in this file alone so that no
// screen and no reducer has to know the database exists.
//
// Only the publishable key reaches the browser; see db/schema.sql for why the
// policies are wide open and what to change when sign-in arrives.
import { createClient } from '@supabase/supabase-js';
import { shortDate } from './dates.js';
import { createLogger } from './logger.js';

const log = createLogger('db');

const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
const URL = env.VITE_SUPABASE_URL;
const KEY = env.VITE_SUPABASE_PUBLISHABLE_KEY;

/* No credentials means no database: the app starts with an empty library
   and calendar, which is exactly what the SSR smoke test renders against. */
export const dbEnabled = Boolean(URL && KEY);

export const supabase = dbEnabled
  ? createClient(URL, KEY, { auth: { persistSession: false } })
  : null;

const DAY_MS = 86400000;

/** '2026-08-27T20:00:00Z' -> '2 days ago', matching the shipped copy. */
function noteAge(noteAt, now = Date.now()) {
  if (!noteAt) return undefined;
  const days = Math.max(0, Math.round((now - new Date(noteAt).getTime()) / DAY_MS));
  if (days === 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 7) return `${days} days ago`;
  const weeks = Math.round(days / 7);
  if (weeks === 1) return '1 week ago';
  if (days < 60) return `${weeks} weeks ago`;
  const months = Math.round(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

/** A row from `songs` in the shape every screen already reads. */
function rowToSong(r) {
  return {
    id: r.id,
    title: r.title,
    artist: r.artist,
    key: r.key,
    bpm: r.bpm,
    sec: r.sec,
    capo: r.capo,
    timeSig: r.time_sig,
    own: r.own,
    sections: Array.isArray(r.sections) ? r.sections : [],
    ...(r.artwork ? { artwork: r.artwork } : {}),
    ...(r.needs_work ? { needsWork: true } : {}),
    ...(r.bunker ? { bunker: true, ...(r.bunker_steps ? { bunkerSteps: r.bunker_steps } : {}) } : {}),
    ...(r.custom ? { custom: true } : {}),
    ...(r.note ? { note: r.note } : {}),
    ...(r.note_by ? { noteBy: r.note_by } : {}),
    ...(r.note_at ? { noteAge: noteAge(r.note_at), noteAt: r.note_at } : {}),
    ...(r.last_played ? { lastPlayed: shortDate(r.last_played, 'en'), lastPlayedISO: r.last_played } : {}),
    ...(r.import_source ? { importSource: r.import_source } : {})
  };
}

/** The reverse: an app song ready for `insert`/`upsert`. */
function songToRow(s) {
  return {
    id: s.id,
    title: s.title,
    artist: s.artist ?? '',
    key: s.key ?? '',
    bpm: s.bpm ?? 0,
    sec: s.sec ?? 0,
    capo: s.capo ?? 0,
    time_sig: s.timeSig ?? '4/4',
    own: !!s.own,
    needs_work: !!s.needsWork,
    bunker: !!s.bunker,
    bunker_steps: s.bunker ? (s.bunkerSteps || 0) : 0,
    custom: !!s.custom,
    sections: s.sections ?? [],
    artwork: s.artwork ?? null,
    note: s.note ?? null,
    note_by: s.noteBy ?? null,
    note_at: s.noteAt ?? null,
    last_played: s.lastPlayedISO ?? null,
    import_source: s.importSource ?? null
  };
}

/** Rows for one date, assembled into the event object the screens read. */
function rowToEvent(r) {
  const set = (r.event_songs || []).slice().sort((a, b) => a.pos - b.pos);
  const steps = Object.fromEntries(
    set.filter((s) => s.steps).map((s) => [s.song_id, s.steps])
  );
  return {
    kind: r.kind,
    time: r.time,
    end: r.end_time || '',
    place: r.place,
    songs: set.map((s) => s.song_id),
    done: set.filter((s) => s.done).map((s) => s.song_id),
    ...(Object.keys(steps).length ? { steps } : {}),
    ...((r.attendance || []).length
      ? { att: Object.fromEntries(r.attendance.map((a) => [a.member_id, a.status])) }
      : {})
  };
}

/** Everything the store needs, in one round trip per table. */
export async function loadAll() {
  const [songs, events, rooms] = await Promise.all([
    supabase.from('songs').select('*'),
    supabase.from('events').select('*, event_songs(song_id, pos, done, steps), attendance(member_id, status)'),
    supabase.from('rooms').select('name')
  ]);
  for (const r of [songs, events, rooms]) if (r.error) throw r.error;

  return {
    songs: songs.data.map(rowToSong),
    events: Object.fromEntries(events.data.map((r) => [r.date, rowToEvent(r)])),
    rooms: rooms.data.map((r) => r.name)
  };
}

const ok = ({ error }) => {
  if (error) throw error;
};

/** Rewrite one event's setlist positions from the order the app now holds. */
async function writeSetlist(date, ev) {
  ok(await supabase.from('event_songs').delete().eq('event_date', date));
  if (!ev.songs.length) return;
  const done = new Set(ev.done || []);
  ok(
    await supabase.from('event_songs').insert(
      ev.songs.map((songId, pos) => ({
        event_date: date,
        song_id: songId,
        pos,
        done: done.has(songId),
        steps: ev.steps?.[songId] || 0
      }))
    )
  );
}

/**
 * Push the whole world, for undo. This goes through
 * one server-side function rather than a few dozen round trips: replacing the
 * schedule piecemeal leaves the database torn for seconds at a time, and loses
 * data outright if the tab closes halfway. See replace_all in db/schema.sql.
 */
async function replaceAll(state) {
  const { error } = await supabase.rpc('replace_all', {
    payload: {
      songs: state.songs.map(songToRow),
      events: Object.entries(state.events).map(([date, ev]) => ({
        date,
        kind: ev.kind,
        time: ev.time,
        end_time: ev.end || '',
        place: ev.place,
        songs: ev.songs || [],
        done: ev.done || [],
        steps: ev.steps || {},
        att: ev.att || {}
      }))
    }
  });
  if (error) throw error;
}

/* One writer per action. Each reads from the state the reducer just produced,
   so the database is told the answer rather than asked to recompute it. */
const writers = {
  'create-rehearsal': async (a, s) => {
    const ev = s.events[a.date];
    ok(await supabase.from('events').insert({
      date: a.date, kind: ev.kind, time: ev.time, end_time: ev.end || '', place: ev.place
    }));
    // A rehearsal is born with the bunker already on it.
    if (ev.songs.length) await writeSetlist(a.date, ev);
  },
  'delete-rehearsal': async (a) => {
    ok(await supabase.from('events').delete().eq('date', a.date));
  },
  'update-rehearsal': async (a, s) => {
    const ev = s.events[a.date];
    if (!ev) return;
    ok(await supabase.from('events').update({
      kind: ev.kind, time: ev.time, end_time: ev.end || '', place: ev.place
    }).eq('date', a.date));
  },
  'add-room': async (a, s) => {
    const name = String(a.name).trim();
    if (!s.rooms.includes(name)) return;      // the reducer rejected it
    ok(await supabase.from('rooms').insert({ name }));
  },
  'set-attendance': async (a, s) => {
    const status = (s.events[a.date]?.att || {})[a.member];
    if (status) {
      ok(await supabase.from('attendance')
        .upsert({ event_date: a.date, member_id: a.member, status }));
    } else {
      ok(await supabase.from('attendance')
        .delete().eq('event_date', a.date).eq('member_id', a.member));
    }
  },
  'add-song': async (a, s) => writeSetlist(a.date, s.events[a.date]),
  'remove-song': async (a, s) => writeSetlist(a.date, s.events[a.date]),
  'reorder': async (a, s) => writeSetlist(a.date, s.events[a.date]),
  'add-to-library': async (a, s) => {
    const song = s.songs.find((x) => x.id === a.song.id);
    if (song) ok(await supabase.from('songs').insert(songToRow(song)));
  },
  'remove-from-library': async (a) => {
    ok(await supabase.from('songs').delete().eq('id', a.songId));
  },
  'set-bunker': async (a, s) => {
    const song = s.songs.find((x) => x.id === a.songId);
    if (!song) return;
    ok(await supabase.from('songs').update({
      bunker: !!song.bunker,
      bunker_steps: song.bunker ? (song.bunkerSteps || 0) : 0
    }).eq('id', a.songId));
  },
  'edit-chart': async (a) => {
    ok(await supabase.from('songs').update({ sections: a.sections }).eq('id', a.songId));
  },
  'restore': async (a, s) => replaceAll(s),
  'reset': async (a, s) => replaceAll(s)
};

/**
 * Persist whatever `action` just did. Returns false if the write failed, so the
 * caller can tell the band their change did not land.
 */
export async function persist(action, nextState) {
  const write = writers[action.type];
  if (!dbEnabled || !write) return true;
  try {
    await write(action, nextState);
    log.debug('persisted', { action: action.type });
    return true;
  } catch (e) {
    log.warn('persist failed', { action: action.type, error: e.message });
    return false;
  }
}
