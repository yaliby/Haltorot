import { alignByColumns } from '../src/lib/chordAlign.js';
import { decodeEntities, hasHebrew, searchTitle, textMatch, titleMatch } from '../src/lib/text.js';
import { createLogger } from '../src/lib/logger.js';

const log = createLogger('tab4u');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const BASE = 'https://www.tab4u.com';

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA, 'Accept-Language': 'he-IL,he;q=0.9' } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

function stripHtml(html) {
  return decodeEntities(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ''))
    .replace(/\u00a0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .trim();
}

function expandTab4uChordHtml(html) {
  const chords = [];
  let plain = '';
  const re = /<span[^>]*class="c_C"[^>]*>([^<]*)<\/span>|&nbsp;|([^<]+)/gi;
  let m;
  while ((m = re.exec(html))) {
    if (m[1] !== undefined && m[0].includes('c_C')) {
      const name = m[1].trim();
      chords.push({ c: name, start: plain.length });
      plain += name;
    } else if (m[0] === '&nbsp;') {
      plain += ' ';
    } else if (m[2]) {
      /* Markup indentation between the spans is not a column of the chart. */
      plain += m[2].replace(/[\r\n\t]/g, '');
    }
  }
  return { plain, chords };
}

/* Tab4U sets the chord row ltr but flush right (.chords { direction: ltr;
   text-align: right }) over a Hebrew lyric that reads right to left off that
   same margin. So the column that picks a word is the chord's distance from
   the *right* edge, not the left — mirror it, and the chords come back in
   reading order. */
function mirrorColumns(chords, len) {
  return chords
    .map(({ c, start }) => ({ c, start: len - (start + c.length) }))
    .sort((a, b) => a.start - b.start);
}

function alignTab4uRows(chordHtml, lyric) {
  const { plain, chords } = expandTab4uChordHtml(chordHtml);
  if (!chords.length) return lyric ? [{ t: lyric }] : null;
  /* Either way the two rows are one monospace grid, so the column is exact.
     An English chart (.chords_en) is set flush left like its lyric, so its
     columns are read straight. */
  const cols = hasHebrew(lyric) ? mirrorColumns(chords, plain.length) : chords;
  return alignByColumns(cols, plain.length, lyric, { rescale: false });
}

/** Tab4U direction lines (not verse/chorus sections). */
const INLINE_DIRECTION = /^(פתיחה|מעבר|באורגן|סולו|ריף|אינטרו|אאוטרו|קודה|bridge|intro|outro|solo|rif{1,2})\s*$/i;

function isSectionLabel(text) {
  if (!/[:：]$/.test(text) || text.length >= 48) return false;
  const bare = text.replace(/[:：]\s*$/, '').trim();
  if (INLINE_DIRECTION.test(bare)) return false;
  return true;
}

export function parseTab4uHtml(html) {
  const start = html.indexOf('class="song_block"');
  const chunk = start >= 0 ? html.slice(start) : html;
  const sections = [];
  let current = { label: 'שיר', bars: '', lines: [] };
  let pendingChords = null;

  const push = () => {
    if (current.lines.length) sections.push(current);
  };

  /* Tab4U marks an English song's chord rows chords_en — same shape, set flush
     left instead of right. */
  const rows = [...chunk.matchAll(/<tr>\s*<td class="(chords_en|chords|song|tabs)">([\s\S]*?)<\/td>\s*<\/tr>/gi)];
  for (const [, kind, inner] of rows) {
    if (kind === 'tabs') continue;

    if (kind !== 'song') {
      const inlineLyric = stripHtml(inner.replace(/<span[^>]*class="c_C"[^>]*>[\s\S]*?<\/span>/gi, ''));
      if (inlineLyric && /<span[^>]*class="c_C"/i.test(inner)) {
        const line = alignTab4uRows(inner, inlineLyric);
        if (line) current.lines.push(line);
        pendingChords = null;
      } else {
        if (pendingChords) {
          const chordsOnly = alignTab4uRows(pendingChords, '');
          if (chordsOnly) current.lines.push(chordsOnly);
        }
        pendingChords = inner;
      }
      continue;
    }

    const text = stripHtml(inner);
    if (!text) continue;

    /* The organ part is written as tab rows, which are dropped anyway — drop
       its heading too, but keep reading: the song carries on underneath it. */
    if (/^באורגן\s*[:：]?/i.test(text)) continue;

    if (isSectionLabel(text)) {
      push();
      current = { label: text.replace(/[:：]\s*$/, ''), bars: '', lines: [] };
      pendingChords = null;
      continue;
    }

    if (pendingChords) {
      const line = alignTab4uRows(pendingChords, text);
      if (line) current.lines.push(line);
      pendingChords = null;
    } else {
      current.lines.push([{ t: text }]);
    }
  }

  push();
  return sections.filter((s) => s.lines.length);
}

function pathMeta(path) {
  const bits = decodeURIComponent(path).split('/').pop().replace('.html', '').split('_-_');
  return {
    title: (bits[1] || '').replace(/_/g, ' '),
    artist: (bits[0] || '').replace(/^\d+_/, '').replace(/_/g, ' ')
  };
}

function parseSearchRow(html) {
  const path = (html.match(/href="(tabs\/songs\/[^"]+\.html)"/i) || [])[1];
  if (!path) return null;

  const meta = pathMeta(path);
  const title = stripHtml((html.match(/<div class="searchSongT[^"]*">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const artist = stripHtml((html.match(/<div class="searchArtT[^"]*">([\s\S]*?)<\/div>/i) || [])[1] || '');
  const key = stripHtml((html.match(/<div class="searchKeyT[^"]*">([\s\S]*?)<\/div>/i) || [])[1] || '');

  return {
    path,
    title: title || meta.title,
    artist: artist || meta.artist,
    key: key.replace(/טון\s*/i, '').trim()
  };
}

export async function searchTab4u(title, artist = '') {
  const q = [searchTitle(title), artist].filter(Boolean).join(' ').trim();
  log.debug('search', { q, title, artist: artist || '(none)' });
  const html = await fetchText(`${BASE}/resultsSimple?tab=songs&q=${encodeURIComponent(q)}`);
  const hits = [];

  for (const m of html.matchAll(/<a[^>]+class="[^"]*songLinkT[^"]*"[^>]+href="(tabs\/songs\/[^"]+)"[\s\S]*?<\/a>/gi)) {
    const row = parseSearchRow(m[0]);
    if (row) hits.push(row);
  }

  if (!hits.length) {
    for (const m of html.matchAll(/href="(tabs\/songs\/[^"]+\.html)"/gi)) {
      const path = m[1];
      const meta = pathMeta(path);
      hits.push({ path, title: meta.title || title, artist: meta.artist, key: '' });
    }
  }

  const seen = new Set();
  const raw = hits.length;
  const matched = hits
    .filter((h) => {
      if (seen.has(h.path)) return false;
      seen.add(h.path);
      return titleMatch(title, h.title) && textMatch(artist, h.artist);
    })
    .slice(0, 8);

  log.info('search results', {
    q,
    raw,
    matched: matched.length,
    hits: matched.map((h) => ({ title: h.title, artist: h.artist, path: h.path }))
  });

  if (raw && !matched.length) {
    log.warn('raw hits rejected by title/artist filter', {
      sample: hits.slice(0, 5).map((h) => ({ title: h.title, artist: h.artist }))
    });
  }

  return matched;
}

/* Kept for the pages that still carry it, but today's Tab4U prints no key at
   all — the search row has no key cell and the song page only offers a "שנה
   טון" button. When this comes back empty the key is read off the chords. */
function extractKey(html) {
  const m = html.match(/טון[:\s]*<\/[^>]+>\s*<[^>]+>([^<]+)</i) || html.match(/id="toneInSong"[^>]*>([^<]+)</i);
  return m ? m[1].trim() : '';
}

export async function fetchTab4uSong(hit) {
  const url = `${BASE}/${hit.path}`;
  log.debug('fetch song page', { url, title: hit.title, artist: hit.artist });
  const html = await fetchText(url);
  const sections = parseTab4uHtml(html);
  if (!sections.length) throw new Error('chart parsed empty');
  log.debug('parsed', {
    sections: sections.length,
    lines: sections.reduce((n, s) => n + s.lines.length, 0)
  });

  return {
    sections,
    bpm: null,
    key: hit.key || extractKey(html),
    sourceUrl: url,
    tabId: hit.path
  };
}

export async function importChords(title, artist) {
  const hits = await searchTab4u(title, artist);
  if (!hits.length) throw new Error('no chord tabs found');

  let lastErr;
  for (const hit of hits.slice(0, 3)) {
    try {
      log.info('loading hit', { title: hit.title, artist: hit.artist, path: hit.path });
      return await fetchTab4uSong(hit);
    } catch (e) {
      log.warn('hit load failed', { path: hit.path, error: e.message });
      lastErr = e;
    }
  }
  throw lastErr || new Error('could not load chord tab');
}
