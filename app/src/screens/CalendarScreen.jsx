import React, { useState, useMemo, useRef, useEffect, useLayoutEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { SongArt } from '../components/SongArt.jsx';
import { LanguageToggle } from '../components/LanguageToggle.jsx';
import { ThemeToggle } from '../components/ThemeToggle.jsx';
import { useStore, useRooms } from '../store.jsx';
import { useI18n } from '../i18n/index.js';
import {
  monthName,
  monthGrid,
  addMonths,
  parseISO,
  longDate,
  weekdayOf,
  runtime,
  timeSpan,
  relative,
  dowLabels
} from '../lib/dates.js';
import { hue } from '../lib/hues.js';
import { InstanceKeyBadge } from '../components/InstanceKeyPicker.jsx';
import { eventSongSteps, instanceKey } from '../lib/chords.js';

/* The month strip is a three-page carousel: previous, current, next. It rides
   the finger 1:1 and then settles onto whichever page the swipe was pulling
   in, so a month reads as one sheet being dragged aside rather than a grid
   that redraws. `--p` is where the strip sits between pages (-1 .. 1); the
   header month rides the same variable, so title and grid move together. */
const SLIDE_MS = 400;
const SNAP_MS = 220;
const AXIS_LOCK = 8;
const SWIPE_RATIO = 0.2;
const SWIPE_SPEED = 0.4;
/* How far up the day sheet has to be dragged before it stays open. */
const SHEET_RATIO = 0.3;
/* The curve everything lands on, the stylesheet's `--settle` in JavaScript. */
const SETTLE = 'cubic-bezier(0.22, 1, 0.36, 1)';

/* A booking has two ends. The second one is offered rather than demanded: it
   follows the start until someone sets it by hand, and it can be cleared. */
const DEFAULT_HOURS = 3;

function shift(time, hours) {
  const [h, m] = String(time).split(':').map(Number);
  if (!Number.isFinite(h) || !Number.isFinite(m)) return '';
  const at = (h + hours) % 24;
  return `${String(at).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** Move the start, and bring an untouched end along with it. */
function withStart(draft, time) {
  const following = !draft.end || draft.end === shift(draft.time, DEFAULT_HOURS);
  return { ...draft, time, end: following ? shift(time, DEFAULT_HOURS) : draft.end };
}

function reduceMotion() {
  return typeof window !== 'undefined' && !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
}

function DayCell({ c, events, selected, today, pickDay, enterDay, t, locale, kindLabel, live }) {
  const ev = c.date ? events[c.date] : null;
  const cls = [
    'day',
    !c.inMonth && 'is-out',
    ev && 'has-event',
    ev && `kind-${ev.kind}`,
    c.date === selected && 'is-selected',
    c.date === today && 'is-today'
  ]
    .filter(Boolean)
    .join(' ');

  return (
    <button
      className={cls}
      disabled={!c.inMonth}
      tabIndex={live ? undefined : -1}
      aria-current={c.date && c.date === today ? 'date' : undefined}
      onClick={() => pickDay(c.date)}
      onDoubleClick={() => enterDay(c.date)}
      aria-label={
        c.date
          ? ev
            ? t('calendar.dayAriaEvent', { date: longDate(c.date, locale), kind: kindLabel(ev.kind), time: ev.time })
            : t('calendar.dayAriaFree', { date: longDate(c.date, locale) })
          : undefined
      }
    >
      <div className="day-top">
        <span className="day-num">{c.label}</span>
        <span className="day-dot" />
      </div>
      {ev && (
        <div className="day-body">
          <span className="day-time">{ev.time}</span>
          <span className="day-sub">
            {ev.kind === 's'
              ? t('common.showAt', { place: ev.place })
              : t('common.songsCount', { n: ev.songs.length })}
          </span>
        </div>
      )}
    </button>
  );
}

export default function CalendarScreen() {
  const { events, songs, today, dispatch, notify, locale } = useStore();
  const rooms = useRooms();
  const { t, dir } = useI18n();
  const rtl = dir === 'rtl';
  const navigate = useNavigate();
  const dow = dowLabels(locale);

  const start = parseISO(today);
  const [view, setView] = useState({ y: start.y, m: start.m });
  const [selected, setSelected] = useState(today);
  const [creating, setCreating] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState({ time: '20:00', end: shift('20:00', DEFAULT_HOURS), place: rooms[0], kind: 'r' });
  const [addingRoom, setAddingRoom] = useState(false);
  const [newRoom, setNewRoom] = useState('');
  const [slide, setSlide] = useState(null);
  const [grabbing, setGrabbing] = useState(null);
  const drag = useRef(null);
  const dragged = useRef(false);
  const hold = useRef(null);
  const main = useRef(null);
  const panel = useRef(null);
  const scrim = useRef(null);
  /* Where the sheet stood before the day changed shape, kept for the settle
     that plays once React has put the new shape in place. */
  const landing = useRef(null);
  const sheet = useRef(null);
  const sheetDragged = useRef(false);
  const viewport = useRef(null);
  const track = useRef(null);

  /* Visual order is left-to-right on screen. Hebrew reads the other way, so
     next month sits to the left there and the same drag stays natural. */
  const pages = useMemo(() => {
    const back = addMonths(view.y, view.m, -1);
    const fwd = addMonths(view.y, view.m, 1);
    const list = rtl ? [fwd, view, back] : [back, view, fwd];
    if (slide) list[slide.index] = slide.month;
    return list.map((mo) => ({ mo, cells: monthGrid(mo.y, mo.m) }));
  }, [view, rtl, slide]);

  const event = events[selected];

  const byId = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs]);
  const setSongs = event ? event.songs.map((id) => byId[id]).filter(Boolean) : [];
  const totalSec = setSongs.reduce((a, s) => a + s.sec, 0);

  const kindLabel = (kind) => (kind === 's' ? t('common.show') : t('common.rehearsal'));
  const kindBadge = (kind, isToday) => {
    if (isToday) return t('common.tonight');
    return kind === 's' ? t('common.showBadge') : t('common.rehearsalBadge');
  };

  function openCreate(date) {
    setSelected(date);
    setDraft({ time: '20:00', end: shift('20:00', DEFAULT_HOURS), place: rooms[0], kind: 'r' });
    setAddingRoom(false);
    setNewRoom('');
    setCreating(true);
    showDay(true);
  }

  function pickDay(date) {
    setSelected(date);
    if (creating && events[date]) setCreating(false);
  }

  /* A second click on a day is a way in: the day opens on its own screen
     rather than in the sheet, booked or not. */
  function enterDay(date) {
    if (!date || dragged.current) return;
    navigate(`/rehearsal/${date}`);
  }

  /** Where the strip sits between pages. Written straight to the DOM so a
      drag doesn't re-render 126 day cells per frame. */
  function setProgress(v) {
    main.current?.style.setProperty('--p', String(v));
  }

  /** Where the strip sits *right now* — mid-animation included. */
  function readProgress() {
    const el = track.current;
    const w = viewport.current?.clientWidth;
    if (!el || !w) return 0;
    const m = getComputedStyle(el).transform;
    if (!m || m === 'none') return 0;
    return new DOMMatrixReadOnly(m).m41 / w + 1;
  }

  /** Visual page index that `delta` months away lands on. */
  function indexFor(delta) {
    if (delta > 0) return rtl ? 0 : 2;
    if (delta < 0) return rtl ? 2 : 0;
    return 1;
  }

  function monthAt(index) {
    const delta = index === 1 ? 0 : index === 0 ? (rtl ? 1 : -1) : rtl ? -1 : 1;
    return addMonths(view.y, view.m, delta);
  }

  /** Glide the strip onto `index`, then adopt that month as the view. */
  function settle(index, month) {
    setGrabbing(null);
    setSlide({
      index,
      month: month || monthAt(index),
      ms: reduceMotion() ? 0 : index === 1 ? SNAP_MS : SLIDE_MS
    });
  }

  /** Take a slide off the clock right where it stands: adopt the month it was
      heading for and re-express the current position against it, so the strip
      can be caught mid-flight without anything jumping. Returns where the
      strip now sits. */
  function land() {
    if (!slide) return readProgress();
    const near = monthAt(slide.index);
    // A jump of more than one month has nothing in common with the page the
    // strip is passing over; finish that one outright instead.
    const far = slide.index !== 1 && (near.y !== slide.month.y || near.m !== slide.month.m);
    const p = far ? 0 : readProgress() + slide.index - 1;
    if (slide.index !== 1) setView(slide.month);
    hold.current = p;
    setSlide(null);
    return p;
  }

  // The strip only carries a transition while it is settling, so landing —
  // where the view shifts and the strip jumps back to centre — never animates.
  // `hold` is a position handed over from a slide that was caught by hand.
  useLayoutEffect(() => {
    const held = hold.current;
    hold.current = null;
    if (slide) {
      setProgress(1 - slide.index);
      return;
    }
    setProgress(held ?? 0);
  }, [slide]);

  useEffect(() => {
    if (!slide) return;
    const id = window.setTimeout(() => {
      if (slide.index !== 1) {
        setView(slide.month);
      }
      setSlide(null);
    }, slide.ms);
    return () => window.clearTimeout(id);
  }, [slide]);

  function onPointerDown(e) {
    if (drag.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // A finger on a moving strip stops it dead and takes it over, so the month
    // can be grabbed before, during or after a change — always.
    const moving = !!slide;
    drag.current = {
      id: e.pointerId,
      p0: land(),
      x0: e.clientX,
      y0: e.clientY,
      x: e.clientX,
      t: e.timeStamp,
      v: 0,
      w: viewport.current?.clientWidth || 1,
      axis: null
    };
    // Catching a slide is not a tap on the day underneath it.
    dragged.current = moving;
  }

  function onPointerMove(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      d.axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      // Either way the finger was dragging, so the day underneath it is safe:
      // a vertical swipe belongs to the day sheet, not to the cell it began on.
      dragged.current = true;
      if (d.axis !== 'x') {
        // The sheet has the finger now, and it will carry it off the grid —
        // the release may never come back here. So the month lets go on the
        // spot, leaving the strip parked on a whole month either way.
        drag.current = null;
        if (d.p0) settle(target(d.p0, 0));
        return;
      }
      setGrabbing('x');
      e.currentTarget.setPointerCapture?.(e.pointerId);
    }
    if (d.axis !== 'x') return;
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.v = (e.clientX - d.x) / dt;
    d.x = e.clientX;
    d.t = e.timeStamp;
    setProgress(at(d, e.clientX));
  }

  /** Where a pointer at `x` puts the strip, held to the pages that exist. */
  function at(d, x) {
    return Math.max(-1, Math.min(1, d.p0 + (x - d.x0) / d.w));
  }

  /** A flick carries it on if it is already off centre, otherwise it puts the
      month back; a slow drag goes by how far it got. */
  function target(p, v) {
    if (Math.abs(v) > SWIPE_SPEED) return v > 0 ? (p > 0 ? 0 : 1) : p < 0 ? 2 : 1;
    return p > SWIPE_RATIO ? 0 : p < -SWIPE_RATIO ? 2 : 1;
  }

  function onPointerUp(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    // A finger that only stopped a slide still has to leave it on a month.
    if (d.axis !== 'x' && !d.p0) return;
    settle(target(at(d, e.clientX), d.axis === 'x' ? d.v : 0));
  }

  function onPointerCancel(e) {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    if (d.axis === 'x' || d.p0) settle(target(at(d, d.x), 0));
  }

  /* The day sheet is dragged, not clicked open: the peek header takes the
     finger and the sheet's height follows it, snapping open or shut on
     release. Heights are written straight to the node — the transition in the
     stylesheet is for the snap, not for the drag. */
  function sheetSpan() {
    const el = panel.current;
    const css = getComputedStyle(el);
    const shut = parseFloat(css.getPropertyValue('--peek-h')) || 74;
    // The sheet stands on the action bar, so the screen's share is measured
    // from the top of it — otherwise a full day climbs into the header.
    const act = parseFloat(css.getPropertyValue('--act-h')) || 0;
    // Never taller than the day needs, and never taller than the screen wants.
    return { shut, tall: Math.max(shut + 80, Math.min(0.74 * window.innerHeight - act, el.scrollHeight)) };
  }

  /* The drag is followed on the window: a finger that starts on the handle
     leaves it within a few pixels, and the events have to keep coming. The
     handle is only where the sheet is most obviously grabbable — the whole
     calendar behind it takes the same up-and-down swipe, so the day can be
     pulled open from wherever the thumb happens to be resting. */
  function onSheetDown(e) {
    if (sheet.current || !panel.current) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    // Only a sheet is dragged. On a wide screen the panel is a column beside
    // the month, and the calendar keeps its own gestures.
    if (getComputedStyle(panel.current).position !== 'fixed') return;
    // A finger that lands in the day's own text belongs to the scroll first;
    // only from the very top, on the way down, does the sheet take it. Outside
    // the sheet — the month, the header, the dimmed backdrop — there is
    // nothing to scroll, so the swipe is the sheet's from the first pixel.
    const content = panel.current.contains(e.target) && !e.target.closest?.('.sheet-peek');
    // A finger on a sheet that is still moving stops it dead and takes it
    // over, exactly as it does with a month in mid-flight.
    const flying = panel.current.getAnimations().length > 0;
    const h0 = panel.current.getBoundingClientRect().height;
    if (flying) {
      const o = scrim.current ? +getComputedStyle(scrim.current).opacity : 0;
      stopSheet();
      panel.current.style.maxHeight = h0 + 'px';
      scrim.current?.style.setProperty('--sheet', String(o));
    }
    const move = (ev) => onSheetMove(ev);
    const up = (ev) => onSheetUp(ev);
    const cancel = (ev) => onSheetCancel(ev);
    sheet.current = {
      id: e.pointerId,
      x0: e.clientX,
      y0: e.clientY,
      y: e.clientY,
      t: e.timeStamp,
      v: 0,
      h0,
      ...sheetSpan(),
      axis: null,
      slop: 0,
      flying,
      content,
      top: panel.current.scrollTop,
      off() {
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', up);
        window.removeEventListener('pointercancel', cancel);
      }
    };
    sheetDragged.current = flying;
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    window.addEventListener('pointercancel', cancel);
  }

  useEffect(() => () => sheet.current?.off(), []);

  /* Inside the day's own text the browser is quicker than we are: it hands the
     swipe to the scroll before it knows which way the finger is going, and the
     sheet loses it mid-gesture. So at the top of the day, where there is
     nothing left to scroll back to, the first move downward is refused
     outright and the swipe stays ours. Upward, the scroll keeps it. */
  useEffect(() => {
    const el = panel.current;
    if (!el) return;
    const claim = (e) => {
      const d = sheet.current;
      if (!d || !d.content || d.axis === 'x') return;
      if (el.scrollTop <= 0 && e.cancelable && e.touches[0]?.clientY > d.y0) e.preventDefault();
    };
    el.addEventListener('touchmove', claim, { passive: false });
    return () => el.removeEventListener('touchmove', claim);
  }, []);

  function onSheetMove(e) {
    const d = sheet.current;
    if (!d || d.id !== e.pointerId) return;
    const dx = e.clientX - d.x0;
    const dy = e.clientY - d.y0;
    if (!d.axis) {
      if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK) return;
      d.axis = Math.abs(dy) > Math.abs(dx) ? 'y' : 'x';
      if (d.axis === 'y' && d.content && (dy < 0 || d.top > 0)) {
        sheet.current = null;
        d.off();
        return;
      }
      if (d.axis !== 'y') return;
      sheetDragged.current = true;
      setGrabbing('y');
      // The pixels the lock spent working out which way the finger was going
      // are not the sheet's to travel: it sets off from where the finger
      // crossed, not from where it landed, or it leaps the whole threshold in
      // its first frame.
      d.slop = dy;
      // Going up, the sheet takes its open shape straight away — the height
      // below is set in the same beat, so it never flashes to full.
      if (dy < 0) setOpen(true);
    }
    if (d.axis !== 'y') return;
    const dt = e.timeStamp - d.t;
    if (dt > 0) d.v = (e.clientY - d.y) / dt;
    d.y = e.clientY;
    d.t = e.timeStamp;
    const h = Math.max(d.shut, Math.min(d.tall, d.h0 - (dy - d.slop)));
    panel.current.style.maxHeight = h + 'px';
    scrim.current?.style.setProperty('--sheet', String((h - d.shut) / (d.tall - d.shut)));
  }

  /* A pace that carries on from the finger: a flick lands quickly, a slow
     release glides, and neither is ever slower than a month change. */
  function restMs(dist, v) {
    return Math.round(Math.min(SLIDE_MS, Math.max(SNAP_MS, dist / Math.max(Math.abs(v), 0.3))));
  }

  /* Open or shut the day. Where it stands now is taken down here; where it is
     going is only known once the day has been re-rendered, so the movement
     itself is played in the layout effect below. */
  function showDay(next, ms = SLIDE_MS) {
    if (panel.current) {
      landing.current = {
        from: panel.current.getBoundingClientRect().height,
        o: scrim.current ? +getComputedStyle(scrim.current).opacity : 0,
        ms: reduceMotion() ? 0 : ms
      };
      stopSheet();
      panel.current.style.maxHeight = '';
      scrim.current?.style.removeProperty('--sheet');
    }
    setOpen(next);
  }

  function stopSheet() {
    panel.current?.getAnimations().forEach((a) => a.cancel());
    scrim.current?.getAnimations().forEach((a) => a.cancel());
  }

  /* The sheet is moved rather than transitioned: a height that has to cross
     from a finger's inline value to a stylesheet's own flinches on the way,
     and a drag can arrive at any moment and take the movement over. The
     dimming behind it is given the same clock and the same curve. */
  useLayoutEffect(() => {
    const el = panel.current;
    const to = landing.current && el ? el.getBoundingClientRect().height : 0;
    const l = landing.current;
    landing.current = null;
    if (!l || !l.ms || Math.abs(to - l.from) < 1) return;
    const ease = { duration: l.ms, easing: SETTLE };
    el.animate([{ maxHeight: l.from + 'px' }, { maxHeight: to + 'px' }], ease);
    scrim.current?.animate([{ opacity: l.o }, { opacity: open ? 1 : 0 }], ease);
  });

  function restSheet(d) {
    const h = panel.current.getBoundingClientRect().height;
    const up = d.v < -SWIPE_SPEED;
    const down = d.v > SWIPE_SPEED;
    const stays = up || (!down && (h - d.shut) / (d.tall - d.shut) > SHEET_RATIO);
    if (!stays) panel.current.scrollTop = 0;
    setGrabbing(null);
    showDay(stays, restMs(Math.abs((stays ? d.tall : d.shut) - h), d.v));
  }

  function onSheetUp(e) {
    const d = sheet.current;
    if (!d || d.id !== e.pointerId) return;
    sheet.current = null;
    d.off();
    // A finger that only stopped a moving sheet still has to leave it on an end.
    if (d.axis === 'y' || d.flying) restSheet({ ...d, v: d.axis === 'y' ? d.v : 0 });
  }

  function onSheetCancel(e) {
    const d = sheet.current;
    if (!d || d.id !== e.pointerId) return;
    sheet.current = null;
    d.off();
    if (d.axis === 'y' || d.flying) restSheet({ ...d, v: 0 });
  }

  // A drag that ends on the peek row mustn't also toggle it — nor may one that
  // ends out on the month pick the day it let go over.
  function onSheetClickCapture(e) {
    if (!sheetDragged.current) return;
    sheetDragged.current = false;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  // A swipe that ends on a day mustn't also pick that day.
  function onClickCapture(e) {
    if (!dragged.current) return;
    dragged.current = false;
    e.preventDefault();
    e.stopPropagation();
  }

  const gridProps = { events, selected, today, pickDay, enterDay, t, locale, kindLabel };

  /* A room the band types in is theirs from that moment: it joins the list,
     and the booking in hand is already standing in it. */
  function addRoom() {
    const name = newRoom.trim();
    if (!name) return;
    const known = rooms.find((r) => r.toLowerCase() === name.toLowerCase());
    dispatch({ type: 'add-room', name });
    setDraft((d) => ({ ...d, place: known || name }));
    setNewRoom('');
    setAddingRoom(false);
  }

  function save() {
    const snapshot = { events };
    dispatch({ type: 'create-rehearsal', date: selected, ...draft });
    setCreating(false);
    showDay(false);
    const msg = draft.kind === 's' ? t('calendar.addedShow', { date: longDate(selected, locale) }) : t('calendar.addedRehearsal', { date: longDate(selected, locale) });
    notify(msg, snapshot);
  }

  return (
    <>
      <main
        className={'main cal-main' + (slide ? ' is-settling' : '') + (grabbing === 'x' ? ' is-dragging' : '')}
        ref={main}
        onPointerDown={onSheetDown}
        onClickCapture={onSheetClickCapture}
        style={{ '--slide-ms': (slide ? slide.ms : 0) + 'ms' }}
      >
        <header className="cal-head">
          <div className="cal-head-row">
            <div className="cal-head-title">
              <div className="cal-track cal-title-track">
                {pages.map(({ mo }, i) => (
                  <div
                    key={`${mo.y}-${mo.m}`}
                    className="cal-page cal-title-page"
                    dir={dir}
                    aria-hidden={i !== 1 ? 'true' : undefined}
                  >
                    <h1 className="cal-title">{monthName(mo.m, locale)}</h1>
                    <span className="cal-year">{mo.y}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="cal-head-toggles">
              <LanguageToggle />
              <ThemeToggle />
            </div>
          </div>
        </header>

        <div className="cal-grid-wrap">
          <div className="cal-dow">
            {dow.full.map((d, i) => (
              <span key={i}>
                <span className="hide-sm">{d}</span>
                <span className="show-sm">{dow.short[i]}</span>
              </span>
            ))}
          </div>

          <div
            className="cal-viewport"
            ref={viewport}
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClickCapture={onClickCapture}
          >
            <div className="cal-track cal-grid-track" ref={track}>
              {pages.map(({ mo, cells }, i) => (
                <div
                  key={`${mo.y}-${mo.m}`}
                  className="cal-page cal-month"
                  dir={dir}
                  aria-hidden={i !== 1 ? 'true' : undefined}
                >
                  {cells.map((c) => (
                    <DayCell key={c.key} c={c} live={i === 1} {...gridProps} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      </main>

      <div
        className={'sheet-scrim day-scrim' + (open ? ' is-on' : '')}
        ref={scrim}
        onPointerDown={onSheetDown}
        onClickCapture={onSheetClickCapture}
        onClick={() => showDay(false)}
      />

      <aside
        className={'panel' + (open ? ' is-open' : '') + (grabbing === 'y' ? ' is-grabbing' : '')}
        ref={panel}
        onPointerDown={onSheetDown}
        onClickCapture={onSheetClickCapture}
      >
        <div className="sheet-peek">
          <span className="sheet-grip" />
          <button
            className="sheet-peek-row"
            aria-expanded={open}
            aria-label={open ? t('calendar.collapseDay') : t('calendar.expandDay')}
            onClick={() => showDay(!open)}
          >
            <span className="sheet-peek-main">
              <span className="sheet-peek-day">{longDate(selected, locale)}</span>
              <span className="sheet-peek-sub">
                {creating
                  ? t('calendar.peekNew', { kind: kindLabel(draft.kind), time: timeSpan(draft.time, draft.end) })
                  : event
                    ? <>
                        <bdi>{timeSpan(event.time, event.end)}</bdi>
                        {' · '}
                        <bdi>{event.place}</bdi>
                        {' · '}
                        {t('common.songsCount', { n: event.songs.length })}
                      </>
                    : t('calendar.nothingScheduled')}
              </span>
            </span>
            {event && !creating && (
              <span className={'badge' + (event.kind === 's' ? ' show' : '')}>
                {kindBadge(event.kind, selected === today)}
              </span>
            )}
          </button>
        </div>

        {creating ? (
          <div className="panel-inner slidein">
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="eyebrow">{draft.kind === 's' ? t('calendar.newShow') : t('calendar.newRehearsal')}</div>
              <button className="icon-btn" aria-label={t('common.cancel')} onClick={() => { setCreating(false); showDay(false); }}>
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="panel-head">
              <h2 style={{ fontSize: 26 }}>{longDate(selected, locale)}</h2>
              <div style={{ fontSize: 11.5, color: 'var(--fainter)', marginTop: 4 }}>
                {weekdayOf(selected, locale)} · {relative(selected, today, locale)}
              </div>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="eyebrow" style={{ letterSpacing: '0.02em', textTransform: 'none', fontSize: 11, color: 'var(--dim)' }}>
                {t('calendar.whatIsIt')}
              </label>
              <div style={{ display: 'flex', gap: 6 }}>
                {[['r', t('common.rehearsal')], ['s', t('common.show')]].map(([k, label]) => (
                  <button
                    key={k}
                    className={'chip' + (draft.kind === k ? ' is-on' : '')}
                    style={{ flex: 1 }}
                    aria-pressed={draft.kind === k}
                    onClick={() => setDraft((d) => ({ ...d, kind: k }))}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </div>

            {/* Both ends are the band's to set to whatever the night
                actually is. */}
            <div style={{ display: 'flex', gap: 6 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <span className="eyebrow" style={{ letterSpacing: '0.02em', textTransform: 'none', fontSize: 11, color: 'var(--dim)' }}>
                  {t('calendar.startTime')}
                </span>
                <input
                  type="time"
                  className="field mono"
                  value={draft.time}
                  onChange={(e) => setDraft((d) => withStart(d, e.target.value))}
                />
              </label>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 8, flex: 1 }}>
                <span className="eyebrow" style={{ letterSpacing: '0.02em', textTransform: 'none', fontSize: 11, color: 'var(--dim)' }}>
                  {t('calendar.endTime')}
                </span>
                <input
                  type="time"
                  className="field mono"
                  value={draft.end}
                  onChange={(e) => setDraft((d) => ({ ...d, end: e.target.value }))}
                />
              </label>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <label className="eyebrow" style={{ letterSpacing: '0.02em', textTransform: 'none', fontSize: 11, color: 'var(--dim)' }}>
                {t('calendar.room')}
              </label>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
                {rooms.map((p) => (
                  <button
                    key={p}
                    className={'chip' + (draft.place === p ? ' is-on' : '')}
                    style={{ height: 42, justifyContent: 'space-between', padding: '0 14px' }}
                    onClick={() => setDraft((d) => ({ ...d, place: p }))}
                  >
                    <span>{p}</span>
                    {draft.place === p && <Icon name="check" size={13} />}
                  </button>
                ))}
                {addingRoom ? (
                  <div style={{ display: 'flex', gap: 6 }}>
                    <input
                      className="field"
                      style={{ flex: 1 }}
                      autoFocus
                      value={newRoom}
                      placeholder={t('calendar.roomName')}
                      aria-label={t('calendar.roomName')}
                      onChange={(e) => setNewRoom(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') addRoom();
                        if (e.key === 'Escape') { setAddingRoom(false); setNewRoom(''); }
                      }}
                    />
                    <button
                      className="chip"
                      style={{ height: 42, padding: '0 14px' }}
                      disabled={!newRoom.trim()}
                      onClick={addRoom}
                    >
                      {t('common.add')}
                    </button>
                  </div>
                ) : (
                  <button
                    className="chip"
                    style={{ height: 42, justifyContent: 'center', padding: '0 14px', color: 'var(--dim)' }}
                    onClick={() => setAddingRoom(true)}
                  >
                    <Icon name="plus" size={13} />
                    {t('calendar.addRoom')}
                  </button>
                )}
              </div>
            </div>

            <button className="btn btn-lg btn-block panel-cta" onClick={save}>
              {t('calendar.addToCalendar')}
            </button>
            <p style={{ margin: '-10px 0 0', fontSize: 11, color: 'var(--fainter)', textAlign: 'center' }}>
              {t('calendar.pickDayHint')}
            </p>
          </div>
        ) : event ? (
          <div className="panel-inner slidein" key={selected}>
            <div className="panel-head" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span className={'badge' + (event.kind === 's' ? ' show' : '')}>
                {kindBadge(event.kind, selected === today)}
              </span>
              <span style={{ fontSize: 11, color: 'var(--fainter)' }}>
                {weekdayOf(selected, locale)} · {relative(selected, today, locale)}
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div className="panel-head" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <h2 style={{ fontSize: 26, lineHeight: 1.1 }}>{longDate(selected, locale)}</h2>
                <div className="meta-row" style={{ fontSize: 13 }}>
                  <span className="strong"><bdi>{timeSpan(event.time, event.end)}</bdi></span>
                  <span className="sep">·</span>
                  <span>{event.place}</span>
                </div>
              </div>
            </div>

            <div className="stat-row">
              <div className="stat-cell">
                <b>{setSongs.length}</b>
                <span>{t('common.songs')}</span>
              </div>
              <div className="stat-cell">
                <b>{totalSec ? runtime(totalSec, locale) : '—'}</b>
                <span>{t('calendar.runtime')}</span>
              </div>
            </div>

            {setSongs.length > 0 ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 9 }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <div className="eyebrow">{t('calendar.setlist')}</div>
                  <span style={{ fontSize: 11, color: 'var(--fainter)' }}>{t('calendar.firstN', { n: Math.min(4, setSongs.length) })}</span>
                </div>
                <div>
                  {setSongs.slice(0, 4).map((s, i) => {
                    const steps = eventSongSteps(event, s.id);
                    const playKey = instanceKey(s, steps);
                    return (
                    <button key={s.id} className="mini-row" onClick={() => navigate(`/song/${s.id}?from=${selected}`)}>
                      {/* The cover opens the row — the blank tile when there is
                          none, since the key already has its badge at the end. */}
                      <SongArt song={s} fallback="note" />
                      <span className="grow">
                        <span className="mini-line">
                          <span className="mini-num">{i + 1}</span>
                          <span className="mini-title truncate">{s.title}</span>
                          <InstanceKeyBadge song={s} steps={steps} />
                        </span>
                        <span className="mini-sub">{s.artist}</span>
                      </span>
                      <span className="key-badge" style={hue(playKey)}>{playKey}</span>
                    </button>
                    );
                  })}
                </div>
              </div>
            ) : (
              <div className="empty">
                <p>{t('calendar.noSongsYet')}</p>
              </div>
            )}

            <button className="btn btn-lg btn-block panel-cta" onClick={() => navigate(`/rehearsal/${selected}`)}>
              {t('calendar.openRehearsal')}
              <Icon name="arrow" size={15} />
            </button>
          </div>
        ) : (
          <div className="panel-inner slidein" key={selected}>
            <div className="panel-head" style={{ fontSize: 11, color: 'var(--fainter)' }}>{weekdayOf(selected, locale)}</div>
            <h2 className="panel-head" style={{ fontSize: 26 }}>{longDate(selected, locale)}</h2>
            <div className="empty">
              <Icon name="music" size={30} style={{ color: 'var(--fainter)' }} />
              <p>{t('calendar.emptyDay')}</p>
            </div>

            <button className="btn btn-lg btn-block panel-cta" onClick={() => openCreate(selected)}>
              <Icon name="plus" size={15} />
              {t('calendar.addRehearsal')}
            </button>
          </div>
        )}
      </aside>

      {/* The day's action does not belong to the sheet: it stands on the tab
          bar, outside the panel, so dragging the day open or shut — or swiping
          the month — never moves it. Only its label follows the chosen day. */}
      <div className="sheet-act">
        {creating ? (
          <button className="btn btn-block" onClick={save}>
            {t('calendar.addToCalendar')}
          </button>
        ) : event ? (
          <button className="btn btn-block" onClick={() => navigate(`/rehearsal/${selected}`)}>
            {event.kind === 's' ? t('calendar.openShow') : t('calendar.openRehearsal')}
            <Icon name="arrow" size={15} />
          </button>
        ) : (
          <button className="btn btn-block" onClick={() => openCreate(selected)}>
            <Icon name="plus" size={15} />
            {t('calendar.addRehearsal')}
          </button>
        )}
      </div>
    </>
  );
}
