import React, { createContext, useContext, useReducer, useEffect, useState, useRef, useCallback, useMemo } from 'react';
import { EVENTS, SONGS, TODAY, ROOMS } from './data.js';
import { isDeletableSong } from './lib/songs.js';
import { freezeUndo } from './lib/undo.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('store');

const TOAST_MS = 5000;
const TOAST_UNDO_MS = 12000;
import { DEFAULT_LOCALE } from './i18n/constants.js';
import { applyDocumentLocale, translate } from './i18n/translate.js';
import { dbEnabled, loadAll, persist } from './lib/db.js';
import { DEFAULT_THEME, applyDocumentTheme } from './theme.js';

const KEY = 'static-bloom.v2';
const StoreCtx = createContext(null);

const initial = (locale = DEFAULT_LOCALE, theme = DEFAULT_THEME) => ({
  events: EVENTS,
  songs: SONGS,
  rooms: [],
  toast: null,
  locale,
  theme
});

/* Where the rooms come from depends on whether there is a database: its table
   already holds the three shipped ones, so concatenating them again would show
   each twice. Without a database, state.rooms is only what the band added. */
const allRooms = (rooms) => (dbEnabled ? rooms : ROOMS.concat(rooms));

/** A room the band typed in. Trimmed, and only if it isn't already on the list. */
const isNewRoom = (name, rooms) => {
  const v = String(name || '').trim();
  if (!v) return false;
  return !allRooms(rooms).some((r) => r.toLowerCase() === v.toLowerCase());
};

/** The ids of the standing set, in library order. */
const bunkerSongs = (songs) => songs.filter((s) => s.bunker).map((s) => s.id);

/** Enough of a chart to draw without printing `undefined` over a lyric. */
const isSections = (v) =>
  Array.isArray(v) &&
  v.every(
    (sec) =>
      !!sec &&
      typeof sec.label === 'string' &&
      Array.isArray(sec.lines) &&
      sec.lines.every(
        (line) =>
          Array.isArray(line) &&
          line.every((seg) => !!seg && (typeof seg.c === 'string' || typeof seg.t === 'string'))
      )
  );

/** Enough of a song to render a row without printing NaN at anyone. */
const isSong = (s) =>
  !!s &&
  typeof s.id === 'string' &&
  typeof s.title === 'string' &&
  typeof s.artist === 'string' &&
  typeof s.key === 'string' &&
  Number.isFinite(s.sec) &&
  Number.isFinite(s.bpm);

function load(initialLocale) {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return initial(initialLocale || DEFAULT_LOCALE);
    const saved = JSON.parse(raw);
    const locale = initialLocale || (saved.locale === 'en' ? 'en' : DEFAULT_LOCALE);
    const theme = saved.theme === 'light' ? 'light' : DEFAULT_THEME;
    /* With a database behind us the schedule and the library live there, and
       localStorage is left holding only what belongs to this device. Until
       `hydrate` lands the first paint is an empty library and calendar. */
    if (dbEnabled) return initial(locale, theme);
    // Scheduling state and songs the band added are restored.
    const custom = (Array.isArray(saved.custom) ? saved.custom : [])
      .filter(isSong)
      .filter((s) => !SONGS.some((o) => o.id === s.id))
      .map((s) => ({
        ...s,
        sections: Array.isArray(s.sections) ? s.sections : [],
        custom: true
      }));
    /* A chart the band has re-aligned stays theirs — keep the edit and lay
       it back over that song on the next load. */
    const charts = saved.charts && typeof saved.charts === 'object' ? saved.charts : {};
    // Rooms the band added themselves; the three shipped ones always stay.
    const rooms = (Array.isArray(saved.rooms) ? saved.rooms : [])
      .map((r) => String(r).trim())
      .filter((r, i, all) => r && all.indexOf(r) === i && !ROOMS.includes(r));
    const edited = SONGS.map((s) =>
      isSections(charts[s.id]) ? { ...s, sections: charts[s.id], chartEdited: true } : s
    );
    log.info('loaded from localStorage', {
      custom: custom.length,
      titles: custom.map((s) => s.title),
      charts: edited.filter((s) => s.chartEdited).length
    });
    return {
      events: saved.events && typeof saved.events === 'object' ? saved.events : EVENTS,
      songs: edited.concat(custom),
      rooms,
      toast: null,
      locale,
      theme
    };
  } catch (e) {
    log.warn('load failed, using defaults', { error: e.message });
    return initial(initialLocale || DEFAULT_LOCALE);
  }
}

export function reducer(state, action) {
  switch (action.type) {
    case 'create-rehearsal': {
      const { date, time, end, place, kind } = action;
      if (!date || state.events[date]) return state;
      /* The bunker is the band's standing set — the songs they run every time.
         A new rehearsal opens with them already on the list, and whatever they
         don't feel like tonight comes off it. A show starts empty: its set is
         built for the room, not out of habit. */
      const songs = kind === 's' ? [] : bunkerSongs(state.songs);
      return {
        ...state,
        events: {
          ...state.events,
          [date]: { kind: kind || 'r', time, end: end || '', place, songs, done: [] }
        }
      };
    }

    case 'delete-rehearsal': {
      const events = { ...state.events };
      delete events[action.date];
      return { ...state, events };
    }

    case 'update-rehearsal': {
      const ev = state.events[action.date];
      if (!ev) return state;
      return { ...state, events: { ...state.events, [action.date]: { ...ev, ...action.patch } } };
    }

    /* The list of rooms is the band's, not the app's — anywhere they play
       once is somewhere they can book again. */
    case 'add-room': {
      if (!isNewRoom(action.name, state.rooms)) return state;
      return { ...state, rooms: [...state.rooms, String(action.name).trim()] };
    }

    case 'set-attendance': {
      const ev = state.events[action.date];
      if (!ev) return state;
      const att = { ...(ev.att || {}) };
      if (action.status) att[action.member] = action.status;
      else delete att[action.member];
      return { ...state, events: { ...state.events, [action.date]: { ...ev, att } } };
    }

    case 'add-song': {
      const ev = state.events[action.date];
      if (!ev || ev.songs.includes(action.songId)) return state;
      return {
        ...state,
        events: { ...state.events, [action.date]: { ...ev, songs: [...ev.songs, action.songId] } }
      };
    }

    case 'remove-song': {
      const ev = state.events[action.date];
      if (!ev) return state;
      return {
        ...state,
        events: {
          ...state.events,
          [action.date]: {
            ...ev,
            songs: ev.songs.filter((id) => id !== action.songId),
            done: ev.done.filter((id) => id !== action.songId)
          }
        }
      };
    }

    /** Move `from` so it lands in the slot the drop indicator points at. */
    case 'reorder': {
      const ev = state.events[action.date];
      if (!ev) return state;
      const { from, to } = action;
      if (from === to) return state;
      const songs = ev.songs.slice();
      const [moved] = songs.splice(from, 1);
      songs.splice(from < to ? to - 1 : to, 0, moved);
      return { ...state, events: { ...state.events, [action.date]: { ...ev, songs } } };
    }

    case 'add-to-library': {
      if (!isSong(action.song)) {
        log.warn('add-to-library rejected: invalid song', action.song);
        return state;
      }
      if (state.songs.some((s) => s.id === action.song.id)) {
        log.warn('add-to-library rejected: duplicate id', { id: action.song.id });
        return state;
      }
      const sections = Array.isArray(action.song.sections) ? action.song.sections : [];
      log.info('add-to-library', {
        id: action.song.id,
        title: action.song.title,
        artist: action.song.artist,
        sections: sections.length,
        source: action.song.importSource
      });
      return {
        ...state,
        songs: [...state.songs, { ...action.song, sections, custom: true, needsWork: action.song.needsWork ?? !sections.length }]
      };
    }

    /** Only songs the band added here can be deleted. */
    case 'remove-from-library': {
      const song = state.songs.find((s) => s.id === action.songId);
      if (!isDeletableSong(song)) {
        log.warn('remove-from-library rejected', { songId: action.songId, found: !!song });
        return state;
      }
      log.info('remove-from-library', { id: song.id, title: song.title, artist: song.artist });
      const events = {};
      for (const [date, ev] of Object.entries(state.events)) {
        events[date] = ev.songs.includes(action.songId)
          ? {
              ...ev,
              songs: ev.songs.filter((id) => id !== action.songId),
              done: ev.done.filter((id) => id !== action.songId)
            }
          : ev;
      }
      return { ...state, songs: state.songs.filter((s) => s.id !== action.songId), events };
    }

    /** In or out of the standing set. */
    case 'set-bunker': {
      const song = state.songs.find((s) => s.id === action.songId);
      if (!song) {
        log.warn('set-bunker rejected: unknown song', { songId: action.songId });
        return state;
      }
      const on = !!action.on;
      if (!!song.bunker === on) return state;
      log.info('set-bunker', { id: song.id, title: song.title, on });
      return {
        ...state,
        songs: state.songs.map((s) => (s.id === action.songId ? { ...s, bunker: on } : s))
      };
    }

    /* Only the chord anchors move — the words, the sections and the bar counts
       are the ones the chart was written with. */
    case 'edit-chart': {
      if (!isSections(action.sections)) {
        log.warn('edit-chart rejected: invalid sections', { songId: action.songId });
        return state;
      }
      if (!state.songs.some((s) => s.id === action.songId)) {
        log.warn('edit-chart rejected: unknown song', { songId: action.songId });
        return state;
      }
      log.info('edit-chart', { id: action.songId, sections: action.sections.length });
      return {
        ...state,
        songs: state.songs.map((s) =>
          s.id === action.songId ? { ...s, sections: action.sections, chartEdited: true } : s
        )
      };
    }

    case 'restore': {
      const nextEvents = action.events ?? state.events;
      const nextSongs = (action.songs ?? state.songs).map((s) =>
        isDeletableSong(s) ? { ...s, custom: true } : s
      );
      log.info('restore undo', {
        songs: nextSongs.length,
        custom: nextSongs.filter((s) => s.custom).length,
        hadEvents: !!action.events
      });
      return { ...state, events: nextEvents, songs: nextSongs };
    }

    /** The database has answered; its rows replace the empty first paint. */
    case 'hydrate':
      return {
        ...state,
        events: action.events,
        songs: action.songs,
        rooms: action.rooms
      };

    case 'toast':
      return { ...state, toast: action.toast };

    case 'set-locale':
      return action.locale === 'en' || action.locale === 'he'
        ? { ...state, locale: action.locale }
        : state;

    case 'set-theme':
      return action.theme === 'light' || action.theme === 'dark'
        ? { ...state, theme: action.theme }
        : state;

    case 'reset':
      return { ...initial(state.locale, state.theme) };

    default:
      return state;
  }
}

export function StoreProvider({ children, initialLocale }) {
  const [state, rawDispatch] = useReducer(reducer, initialLocale, load);
  const timer = useRef(null);
  /* Kept out of the reducer on purpose: this is the state of one read on
     mount, not of the band's material, and `reset` must not raise it again. */
  const [hydrating, setHydrating] = useState(dbEnabled);

  /* The reducer stays the single source of truth for what the screens show;
     the database is told afterwards. Keeping a ref to the state lets the
     wrapper hand the writer the *result* of an action without waiting for a
     render, so two taps in quick succession still persist in order. */
  const stateRef = useRef(state);
  const notifyRef = useRef(null);
  const localeRef = useRef(state.locale);
  localeRef.current = state.locale;

  const dispatch = useCallback((action) => {
    const next = reducer(stateRef.current, action);
    const changed = next !== stateRef.current;
    stateRef.current = next;
    rawDispatch(action);
    if (!changed) return;   // the reducer refused it; nothing to write
    persist(action, next).then((saved) => {
      if (!saved) notifyRef.current?.(translate(localeRef.current, 'common.saveFailed'));
    });
  }, []);

  // One read on mount; after that this app is the only writer we expect.
  useEffect(() => {
    if (!dbEnabled) return;
    let live = true;
    loadAll()
      .then((data) => {
        if (!live) return;
        log.info('hydrated from database', {
          songs: data.songs.length,
          events: Object.keys(data.events).length,
          rooms: data.rooms.length
        });
        dispatch({ type: 'hydrate', ...data });
        setHydrating(false);
      })
      .catch((e) => {
        if (!live) return;
        log.warn('hydrate failed, staying on empty first paint', { error: e.message });
        setHydrating(false);
        notifyRef.current?.(translate(localeRef.current, 'common.loadFailed'));
      });
    return () => {
      live = false;
    };
  }, [dispatch]);

  useEffect(() => {
    applyDocumentLocale(state.locale);
  }, [state.locale]);

  useEffect(() => {
    applyDocumentTheme(state.theme);
  }, [state.theme]);

  useEffect(() => {
    try {
      const custom = state.songs.filter((s) => isDeletableSong(s));
      // A custom song carries its own chart; an older row only needs the diff.
      const charts = {};
      for (const s of state.songs) {
        if (s.chartEdited && !isDeletableSong(s)) charts[s.id] = s.sections;
      }
      localStorage.setItem(
        KEY,
        JSON.stringify(
          dbEnabled
            ? { locale: state.locale, theme: state.theme }
            : {
                events: state.events,
                custom,
                charts,
                rooms: state.rooms,
                locale: state.locale,
                theme: state.theme
              }
        )
      );
      log.debug('persisted', {
        custom: custom.length,
        charts: Object.keys(charts).length,
        total: state.songs.length
      });
    } catch {
      /* private mode — the session still works, it just won't persist */
    }
  }, [state.events, state.songs, state.rooms, state.locale, state.theme]);

  useEffect(() => () => clearTimeout(timer.current), []);

  const toastRef = useRef(null);

  // Named `notify`, not `toast`: the context also carries the toast *state*.
  const armToastTimer = useCallback((ms) => {
    clearTimeout(timer.current);
    timer.current = setTimeout(() => dispatch({ type: 'toast', toast: null }), ms);
  }, []);

  const notify = useCallback((message, undo) => {
    const frozen = freezeUndo(undo);
    const payload = { message, undo: frozen, id: Date.now() };
    toastRef.current = payload;
    dispatch({ type: 'toast', toast: payload });
    armToastTimer(frozen ? TOAST_UNDO_MS : TOAST_MS);
  }, [armToastTimer]);

  const dismissToast = useCallback(() => {
    clearTimeout(timer.current);
    toastRef.current = null;
    dispatch({ type: 'toast', toast: null });
  }, []);

  const holdToast = useCallback(() => clearTimeout(timer.current), []);

  const releaseToast = useCallback(() => {
    if (!toastRef.current) return;
    armToastTimer(toastRef.current.undo ? TOAST_UNDO_MS : TOAST_MS);
  }, [armToastTimer]);

  useEffect(() => {
    toastRef.current = state.toast;
  }, [state.toast]);

  // Lets the dispatch wrapper above report a failed write once `notify` exists.
  useEffect(() => {
    notifyRef.current = notify;
  }, [notify]);

  return (
    <StoreCtx.Provider value={{ ...state, hydrating, dispatch, notify, dismissToast, holdToast, releaseToast, today: TODAY }}>
      {children}
    </StoreCtx.Provider>
  );
}

export const useStore = () => {
  const ctx = useContext(StoreCtx);
  if (!ctx) throw new Error('useStore must be used inside <StoreProvider>');
  return ctx;
};

export function useSong(id) {
  const { songs } = useStore();
  return songs.find((s) => s.id === id) || null;
}

/** Every room the band can book, shipped and self-added alike. */
export function useRooms() {
  const { rooms } = useStore();
  return useMemo(() => allRooms(rooms), [rooms]);
}

/** Sorted [date, event] pairs. */
export function useEventList() {
  const { events } = useStore();
  return Object.entries(events).sort((a, b) => a[0].localeCompare(b[0]));
}
