import { parseChordPro } from '../src/lib/chordpro.js';
import { transpose } from '../src/lib/chords.js';
import { searchTitle, textMatch } from '../src/lib/text.js';
import { createLogger } from '../src/lib/logger.js';

const log = createLogger('ug');

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';
const CHORD_TYPES = new Set(['Chords', 'Chords*']);

async function fetchText(url) {
  const res = await fetch(url, { headers: { 'User-Agent': UA } });
  if (!res.ok) throw new Error(`fetch ${url} → ${res.status}`);
  return res.text();
}

function decodeHtml(s) {
  return s
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#039;/g, "'")
    .replace(/&#39;/g, "'");
}

function slugify(s) {
  return s
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

function parseSearchResults(html) {
  const text = decodeHtml(html);
  const tabs = [];
  const seen = new Set();

  const re =
    /"id":(\d+),"song_id":\d+,"song_name":"([^"]+)","artist_id":\d+,"artist_name":"([^"]+)","type":"([^"]+)"/g;

  for (const m of text.matchAll(re)) {
    if (!CHORD_TYPES.has(m[4])) continue;
    const id = m[1];
    if (seen.has(id)) continue;
    seen.add(id);

    const chunk = text.slice(m.index, m.index + 1400);
    const rating = Number((chunk.match(/"rating":([0-9.]+)/) || [])[1] || 0);
    const votes = Number((chunk.match(/"votes":(\d+)/) || [])[1] || 0);
    const key = (chunk.match(/"tonality_name":"([^"]*)"/) || [])[1] || '';

    tabs.push({
      id,
      title: m[2],
      artist: m[3],
      rating,
      votes,
      key
    });
  }

  return tabs;
}

export async function searchChordTabs(title, artist = '') {
  const q = searchTitle(title);
  log.debug('search', { title, query: q, artist: artist || '(none)' });
  const html = await fetchText(
    `https://www.ultimate-guitar.com/search.php?search_type=title&value=${encodeURIComponent(q)}`
  );

  const parsed = parseSearchResults(html);
  const tabs = parsed
    .filter((t) => textMatch(title, t.title) && textMatch(artist, t.artist))
    .sort((a, b) => b.votes - a.votes || b.rating - a.rating);

  log.info('search results', {
    raw: parsed.length,
    matched: tabs.length,
    top: tabs.slice(0, 3).map((t) => ({ id: t.id, title: t.title, artist: t.artist, votes: t.votes }))
  });

  return tabs;
}

function extractWikiTab(html) {
  const m = html.match(/wiki_tab&quot;:\{&quot;content&quot;:&quot;(.*?)&quot;,&quot;revision_id/);
  if (!m) return null;
  return decodeHtml(m[1])
    .replace(/\\r\\n/g, '\n')
    .replace(/\\n/g, '\n')
    .replace(/\\\//g, '/');
}

function extractBpm(html) {
  const m = html.match(/encode_strummings&quot;:&quot;(\{.*?\})&quot;/s);
  if (!m) return null;
  try {
    const raw = decodeHtml(m[1].replace(/\\&quot;/g, '"').replace(/\\\//g, '/'));
    const data = JSON.parse(raw);
    const bpm = data?.patterns?.[0]?.bpm;
    return Number.isFinite(bpm) ? Math.round(bpm) : null;
  } catch {
    return null;
  }
}

/* The tab page's own meta carries the capo and the key the song sounds in —
   which is not the key of the printed chords when a capo is on. The app keeps
   the chords' key and the capo apart, so hand back the shapes' key. */
function extractMeta(html) {
  const meta = (html.match(/&quot;meta&quot;:\{(.{0,120})/s) || [])[1] || '';
  const capo = Number((meta.match(/&quot;capo&quot;:(\d+)/) || [])[1] || 0);
  const tonality = (meta.match(/&quot;tonality&quot;:&quot;([^&]*)&quot;/) || [])[1] || '';
  return { capo: Number.isFinite(capo) ? capo : 0, tonality };
}

function tabUrl(tab) {
  const artistSlug = slugify(tab.artist);
  const titleSlug = slugify(tab.title);
  if (artistSlug && titleSlug) {
    return `https://tabs.ultimate-guitar.com/tab/${artistSlug}/${titleSlug}-chords-${tab.id}`;
  }
  return `https://tabs.ultimate-guitar.com/tab/chords-${tab.id}`;
}

export async function fetchChordTab(tab) {
  const url = tabUrl(tab);
  const html = await fetchText(url);
  const content = extractWikiTab(html);
  if (!content) throw new Error('no chart content on tab page');

  const sections = parseChordPro(content);
  if (!sections.length) throw new Error('chart parsed empty');

  const { capo, tonality } = extractMeta(html);
  const sounding = tonality || tab.key || '';
  log.debug('tab meta', { id: tab.id, capo, tonality: sounding || '(none)' });

  return {
    sections,
    bpm: extractBpm(html),
    capo,
    key: sounding ? transpose(sounding, -capo) : null,
    sourceUrl: url,
    tabId: tab.id
  };
}

export async function importChords(title, artist) {
  const tabs = await searchChordTabs(title, artist);
  if (!tabs.length) throw new Error('no chord tabs found');

  let lastErr;
  for (const tab of tabs.slice(0, 3)) {
    try {
      log.info('loading tab', { id: tab.id, title: tab.title, artist: tab.artist });
      return await fetchChordTab(tab);
    } catch (e) {
      log.warn('tab load failed', { id: tab.id, error: e.message });
      lastErr = e;
    }
  }
  throw lastErr || new Error('could not load chord tab');
}
