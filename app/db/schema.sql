-- Halturaz — one band's rehearsals, setlists and charts.
--
-- Scope decision: a single band, no sign-in. Every policy below therefore
-- grants the anonymous role full access. The publishable key ships inside the
-- browser bundle, so this data is readable and writable by anyone who can
-- reach the deployed URL — fine for a private address, not for a public one.
-- RLS stays ENABLED so that adding sign-in later is a policy rewrite rather
-- than a re-architecture: replace `using (true)` with a membership check.

begin;

create table if not exists members (
  id        text primary key,              -- slug the app already uses: 'maya'
  name      text not null,
  initials  text not null,
  role      text not null,
  hue       integer not null check (hue between 0 and 360),
  pos       integer not null default 0     -- display order in the attendance list
);

create table if not exists rooms (
  name text primary key                    -- the band types these in freely
);

create table if not exists songs (
  id            text primary key,          -- slug the library already uses
  title         text not null,
  artist        text not null default '',
  key           text not null default '',
  bpm           integer not null default 0,
  sec           integer not null default 0,
  capo          integer not null default 0,
  time_sig      text not null default '4/4',
  own           boolean not null default false,
  needs_work    boolean not null default false,
  custom        boolean not null default false,
  -- The standing set: every new rehearsal opens with these songs already on it.
  bunker        boolean not null default false,
  -- Semitone offset for that bunker instance only. 0 is the song's own key.
  bunker_steps  integer not null default 0 check (bunker_steps between -11 and 11),
  -- The chart itself: [{ label, bars, accent, lines: [[{ c, t }]] }]
  -- stored whole, exactly the shape the renderer already expects.
  sections      jsonb not null default '[]'::jsonb,
  -- Album cover from the import search. Nullable: a song added by hand has none,
  -- and the row falls back to the key badge.
  artwork       text,
  note          text,
  note_by       text references members (id) on delete set null,
  note_at       timestamptz,               -- app derives "2 days ago" from this
  last_played   date,
  import_source text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

-- `create table if not exists` above does nothing to a table that already
-- exists, so columns added after the first deploy need saying out loud.
alter table songs add column if not exists artwork text;
alter table songs add column if not exists bunker boolean not null default false;
alter table songs add column if not exists bunker_steps integer not null default 0;

create table if not exists events (
  date       date primary key,             -- one booking per day, as the app assumes
  kind       text not null default 'r' check (kind in ('r', 's')),  -- rehearsal | show
  time       text not null default '',
  end_time   text not null default '',
  place      text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- The setlist. `pos` carries the drag-to-reorder order; `done` is the tick.
create table if not exists event_songs (
  event_date date    not null references events (date) on delete cascade,
  song_id    text    not null references songs (id)   on delete cascade,
  pos        integer not null default 0,
  done       boolean not null default false,
  -- Semitone offset for this setlist instance only. 0 is the song's own key.
  steps      integer not null default 0 check (steps between -11 and 11),
  primary key (event_date, song_id)
);
create index if not exists event_songs_order on event_songs (event_date, pos);
alter table event_songs add column if not exists steps integer not null default 0;

create table if not exists attendance (
  event_date date not null references events (date)   on delete cascade,
  member_id  text not null references members (id)    on delete cascade,
  status     text not null check (status in ('in', 'out', 'late')),
  primary key (event_date, member_id)
);

-- Keep updated_at honest without the client having to remember.
create or replace function touch_updated_at() returns trigger
  language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists songs_touch on songs;
create trigger songs_touch before update on songs
  for each row execute function touch_updated_at();

drop trigger if exists events_touch on events;
create trigger events_touch before update on events
  for each row execute function touch_updated_at();

-- Undo replaces the whole world. Doing that as a
-- few dozen round trips leaves the database visibly torn for several seconds,
-- and loses data outright if the tab closes midway. One function, one
-- transaction: it either all lands or none of it does.
create or replace function replace_all(payload jsonb) returns void
  language plpgsql as $$
declare
  ev jsonb;
  d  date;
begin
  /* The qualifier is not decoration: Supabase blocks an unqualified DELETE
     for the anonymous role, and `date` is the primary key, so this matches
     every row while satisfying that guard. */
  delete from events where date is not null;   -- cascades to setlists and attendance

  insert into songs (id, title, artist, key, bpm, sec, capo, time_sig, own,
                     needs_work, custom, bunker, bunker_steps, sections, artwork, note, note_by, note_at,
                     last_played, import_source)
  select id, title, artist, key, bpm, sec, capo, time_sig, own,
         needs_work, custom, coalesce(bunker, false), coalesce(bunker_steps, 0), sections, artwork, note, note_by, note_at,
         last_played, import_source
    from jsonb_to_recordset(payload -> 'songs') as x (
      id text, title text, artist text, key text, bpm integer, sec integer,
      capo integer, time_sig text, own boolean, needs_work boolean,
      custom boolean, bunker boolean, bunker_steps integer, sections jsonb, artwork text, note text, note_by text,
      note_at timestamptz, last_played date, import_source text)
  on conflict (id) do update set
    title = excluded.title, artist = excluded.artist, key = excluded.key,
    bpm = excluded.bpm, sec = excluded.sec, capo = excluded.capo,
    time_sig = excluded.time_sig, own = excluded.own,
    needs_work = excluded.needs_work, custom = excluded.custom,
    bunker = excluded.bunker, bunker_steps = excluded.bunker_steps,
    sections = excluded.sections, artwork = excluded.artwork,
    note = excluded.note,
    note_by = excluded.note_by, note_at = excluded.note_at,
    last_played = excluded.last_played, import_source = excluded.import_source;

  delete from songs where id not in (
    select id from jsonb_to_recordset(payload -> 'songs') as y (id text));

  for ev in select value from jsonb_array_elements(payload -> 'events') loop
    d := (ev ->> 'date')::date;

    insert into events (date, kind, time, end_time, place)
      values (d, ev ->> 'kind', ev ->> 'time',
              coalesce(ev ->> 'end_time', ''), coalesce(ev ->> 'place', ''));

    insert into event_songs (event_date, song_id, pos, done, steps)
      select d, s.value #>> '{}', s.pos - 1,
             jsonb_exists(coalesce(ev -> 'done', '[]'::jsonb), s.value #>> '{}'),
             coalesce((ev -> 'steps' ->> (s.value #>> '{}'))::integer, 0)
        from jsonb_array_elements(coalesce(ev -> 'songs', '[]'::jsonb))
             with ordinality as s (value, pos);

    insert into attendance (event_date, member_id, status)
      select d, a.key, a.value #>> '{}'
        from jsonb_each(coalesce(ev -> 'att', '{}'::jsonb)) as a (key, value);
  end loop;
end;
$$;

grant execute on function replace_all(jsonb) to anon, authenticated;

-- RLS on, wide open to anon. See the header comment before loosening further.
do $$
declare t text;
begin
  foreach t in array array['members','rooms','songs','events','event_songs','attendance'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop policy if exists anon_all on %I', t);
    execute format(
      'create policy anon_all on %I for all to anon, authenticated using (true) with check (true)', t);
    execute format('grant select, insert, update, delete on %I to anon, authenticated', t);
  end loop;
end $$;

commit;
