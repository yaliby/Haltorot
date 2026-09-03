/** Shared text helpers for song import and library ids. */

const HEBREW = /[\u0590-\u05FF]/;

export function hasHebrew(s) {
  return HEBREW.test(String(s || ''));
}

export function decodeEntities(s) {
  return String(s || '')
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ');
}

export function normText(s) {
  return decodeEntities(s)
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[''`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Latin ↔ Hebrew artist names used on Tab4U vs iTunes. */
const ARTIST_ALIASES = [
  ['mashina', 'משינה'],
  ['aviv geffen', 'אביב גפן'],
  ['ehud banai', 'אהוד בנאי'],
  ['shalom hanoch', 'שלום חנוך'],
  ['berry sakharof', 'ברי סחרוף'],
  ['rita', 'ריטה'],
  ['shlomo artzi', 'שלמה ארצי'],
  ['idang', 'עידן רייכל'],
  ['idan raichel', 'עידן רייכל'],
  ['assaf shefer', 'אסף שפר'],
  ['eviatar banai', 'אביב עמוס בנאי'],
  ['evyatar banai', 'אביב עמוס בנאי']
];

function artistAliases(norm) {
  const out = new Set([norm]);
  for (const [a, b] of ARTIST_ALIASES) {
    if (norm === a || norm === b) {
      out.add(a);
      out.add(b);
    }
  }
  return out;
}

function textsOverlap(a, b) {
  return a === b || b.includes(a) || a.includes(b);
}

const TITLE_SUFFIX = /\s*[\(\[-].*$/;

/** Strip live / remaster suffixes before comparing song titles. */
export function normTitle(s) {
  return normText(s).replace(TITLE_SUFFIX, '').trim();
}

/** Title to send to a chord-site search.
 *  iTunes often appends " (Single Version)" / " (feat. …)"; UG and Tab4U
 *  index the song without that suffix, so searching the raw iTunes title
 *  returns nothing even when a chart exists. */
export function searchTitle(s) {
  const raw = String(s || '').trim();
  const cut = raw.replace(TITLE_SUFFIX, '').trim();
  return cut || raw;
}

/** Stricter than textMatch — avoids "יש לי מלאך" matching "מלאך". */
export function titleMatch(want, got) {
  const a = normTitle(want);
  const b = normTitle(got);
  if (!a || !b) return !a;
  if (a === b) return true;

  const [short, long] = a.length <= b.length ? [a, b] : [b, a];
  if (short.length >= 4) {
    if (long.startsWith(short) && short.length / long.length >= 0.65) return true;
    if (long.includes(short) && short.length / long.length >= 0.72) return true;
  }

  const wordsA = a.split(/\s+/).filter((w) => w.length > 1);
  const wordsB = b.split(/\s+/).filter((w) => w.length > 1);
  if (!wordsA.length) return a === b;
  const setB = new Set(wordsB);
  const hit = wordsA.filter((w) => setB.has(w) || wordsB.some((x) => w.length >= 3 && x.includes(w)));
  return hit.length / wordsA.length >= 0.75;
}

export function textMatch(want, got) {
  const a = normText(want);
  const b = normText(got);
  if (!a || !b) return !a;
  if (textsOverlap(a, b)) return true;
  for (const wa of artistAliases(a)) {
    for (const wb of artistAliases(b)) {
      if (textsOverlap(wa, wb)) return true;
    }
  }
  return false;
}

/** Same song row in library vs an import hit. */
export function sameSongEntry(a, b) {
  return titleMatch(a.title, b.title) && textMatch(a.artist, b.artist);
}

export function songSlug(title, taken) {
  const clean = String(title || '').trim();
  let base = clean
    .toLowerCase()
    .replace(/[^a-z0-9\u0590-\u05FF]+/g, '-')
    .replace(/^-|-$/g, '');

  if (!base) {
    let hash = 0;
    for (const ch of clean) hash = (hash * 31 + ch.charCodeAt(0)) | 0;
    base = `song-${Math.abs(hash).toString(36)}`;
  }

  let id = base;
  for (let i = 2; taken.has(id); i++) id = `${base}-${i}`;
  return id;
}
