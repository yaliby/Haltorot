import { DEFAULT_LOCALE } from '../i18n/constants.js';
import he from '../i18n/he.js';
import en from '../i18n/en.js';

const packs = { he, en };

function pack(locale) {
  return packs[locale === 'en' ? 'en' : DEFAULT_LOCALE].dates;
}

export const MONTHS = he.dates.months;
export const MONTHS_SHORT = he.dates.monthsShort;
export const WEEKDAYS = he.dates.weekdays;

const pad = (n) => (n < 10 ? '0' + n : String(n));

export const iso = (y, m, d) => `${y}-${pad(m + 1)}-${pad(d)}`;

export function parseISO(s) {
  const [y, m, d] = String(s).split('-').map(Number);
  return { y, m: m - 1, d };
}

/** True for a real calendar date written as YYYY-MM-DD. */
export function isISODate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const { y, m, d } = parseISO(s);
  if (m < 0 || m > 11 || d < 1) return false;
  return d <= new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
}

export function monthName(m, locale = DEFAULT_LOCALE) {
  return pack(locale).months[m];
}

export function weekdayOf(s, locale = DEFAULT_LOCALE) {
  const { y, m, d } = parseISO(s);
  return pack(locale).weekdays[new Date(Date.UTC(y, m, d)).getUTCDay()];
}

/** "August 29" / "29 באוגוסט" style — month name + day */
export function longDate(s, locale = DEFAULT_LOCALE) {
  const { m, d } = parseISO(s);
  const month = pack(locale).months[m];
  return locale === 'he' ? `${d} ב${month}` : `${month} ${d}`;
}

/** "Aug 29" */
export function shortDate(s, locale = DEFAULT_LOCALE) {
  const { m, d } = parseISO(s);
  return `${pack(locale).monthsShort[m]} ${d}`;
}

/* Play dates used to be written as English labels ('Aug 29'). Postgres needs
   a real calendar day, so the conversion lives here rather than being written
   out twice. */
const SHORT_MONTHS = { Jan: 1, Feb: 2, Mar: 3, Apr: 4, May: 5, Jun: 6,
                       Jul: 7, Aug: 8, Sep: 9, Oct: 10, Nov: 11, Dec: 12 };

/** 'Aug 29' -> '2026-08-29', taking the year from `today`. */
export function shortDateToISO(label, today) {
  const m = String(label || '').match(/^([A-Za-z]{3})\s+(\d{1,2})$/);
  if (!m) return null;
  const month = SHORT_MONTHS[m[1]];
  if (!month) return null;
  return iso(Number(String(today).slice(0, 4)), month - 1, Number(m[2]));
}

export function dowLabels(locale = DEFAULT_LOCALE) {
  const d = pack(locale);
  return { full: d.dow, short: d.dowShort };
}

const DAY_MS = 86400000;
export const WEEK_MS = 7 * DAY_MS;

/** Sunday 00:00 UTC of the week that contains the 1st of the month. */
export function monthWeekStart(y, m) {
  const first = new Date(Date.UTC(y, m, 1)).getUTCDay();
  return Date.UTC(y, m, 1) - first * DAY_MS;
}

/** How many Sunday-weeks lie between the two month grids (signed). */
export function weekOffset(fromY, fromM, toY, toM) {
  return Math.round((monthWeekStart(toY, toM) - monthWeekStart(fromY, fromM)) / WEEK_MS);
}

/** `weekCount` Sunday-first weeks starting at `weekStart`, focused on one month. */
export function cellsFromWeekStart(weekStart, weekCount, focusY, focusM) {
  const cells = [];
  const n = weekCount * 7;
  for (let i = 0; i < n; i++) {
    const dt = new Date(weekStart + i * DAY_MS);
    const y = dt.getUTCFullYear();
    const mo = dt.getUTCMonth();
    const d = dt.getUTCDate();
    const id = iso(y, mo, d);
    const inMonth = y === focusY && mo === focusM;
    cells.push({ key: id, inMonth, label: d, date: inMonth ? id : null });
  }
  return cells;
}

/** 42 cells covering the month grid, Sunday-first. */
export function monthGrid(y, m) {
  return cellsFromWeekStart(monthWeekStart(y, m), 6, y, m);
}

export function addMonths(y, m, delta) {
  const total = y * 12 + m + delta;
  return { y: Math.floor(total / 12), m: ((total % 12) + 12) % 12 };
}

/* An event that has an end reads as a span; one that doesn't is still just a
   time. The dash is an en dash with no spaces, so it stays one token when the
   meta row wraps. */
export function timeSpan(time, end) {
  return end ? `${time}\u2013${end}` : time;
}

/** 252 -> "4:12" */
export function mmss(sec) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${s < 10 ? '0' + s : s}`;
}

/** 2319 -> "39 min" */
export function runtime(sec, locale = DEFAULT_LOCALE) {
  const mins = Math.round(sec / 60);
  const d = pack(locale);
  if (mins < 60) return d.min.replace('{n}', String(mins));
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return d.hoursMin.replace('{h}', String(h)).replace('{m}', String(m));
}

/** Human distance from today */
export function relative(dateStr, today, locale = DEFAULT_LOCALE) {
  const d = pack(locale);
  if (dateStr === today) return d.tonight;
  const a = parseISO(dateStr);
  const b = parseISO(today);
  const days = Math.round(
    (Date.UTC(a.y, a.m, a.d) - Date.UTC(b.y, b.m, b.d)) / 86400000
  );
  if (days === 1) return d.tomorrow;
  if (days === -1) return d.yesterday;
  if (days > 0) return d.inDays.replace('{n}', String(days));
  return d.daysAgo.replace('{n}', String(-days));
}
