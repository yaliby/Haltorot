const SHARP = ['C','C#','D','D#','E','F','F#','G','G#','A','A#','B'];
const FLAT_NAME = { 'C#':'Db', 'D#':'Eb', 'F#':'Gb', 'G#':'Ab', 'A#':'Bb' };
const ALIAS = { Db:'C#', Eb:'D#', Gb:'F#', Ab:'G#', Bb:'A#', Cb:'B', Fb:'E', 'E#':'F', 'B#':'C' };

function shiftRoot(root, steps) {
  const norm = ALIAS[root] || root;
  const i = SHARP.indexOf(norm);
  if (i < 0) return root;
  const out = SHARP[(i + (steps % 12) + 12) % 12];
  // keep flat spelling if the source was flat
  return root.length > 1 && root[1] === 'b' && FLAT_NAME[out] ? FLAT_NAME[out] : out;
}

/** "Bm7" +2 -> "C#m7"; handles slash chords ("A/C#"). */
export function transpose(chord, steps) {
  if (!chord || !steps) return chord || '';
  return chord
    .split('/')
    .map((part) => {
      const m = /^([A-G][#b]?)(.*)$/.exec(part);
      return m ? shiftRoot(m[1], steps) + m[2] : part;
    })
    .join('/');
}

/** Distinct chords in a chart, in first-appearance order. */
export function chordsUsed(sections, steps = 0) {
  const seen = [];
  for (const sec of sections) {
    for (const line of sec.lines) {
      for (const seg of line) {
        if (!seg.c) continue;
        const c = transpose(seg.c, steps);
        if (!seen.includes(c)) seen.push(c);
      }
    }
  }
  return seen;
}

/* The black keys as a band writes them: Bbm, not A#m. A chart's own spelling
   is left alone — this is only for a key we worked out ourselves. */
const KEY_NAME = { 1: ['Db', 'C#m'], 3: ['Eb', 'Ebm'], 6: ['F#', 'F#m'], 8: ['Ab', 'G#m'], 10: ['Bb', 'Bbm'] };

/** The key a song sounds in: the key its chords are written in, moved by the
 *  capo. A chart printed in Em under a capo on 2 is heard in F#m. */
export function songKey(song) {
  if (!song || typeof song.key !== 'string') return '';
  if (!song.capo || !/^[A-G][#b]?m?$/.test(song.key)) return song.key || '';
  const moved = transpose(song.key, song.capo);
  const spelling = KEY_NAME[pitchClass(moved)];
  return spelling ? spelling[moved.endsWith('m') ? 1 : 0] : moved;
}

/** Semitone offset for one bunker / setlist instance. 0 is the song's own key. */
export function clampSteps(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 0;
  return Math.max(-11, Math.min(11, Math.round(v)));
}

/** The key that instance will be played in — the song's sounding key, moved. */
export function instanceKey(song, steps) {
  return transpose(songKey(song), clampSteps(steps));
}

/** Non-zero transpose stored on a rehearsal / show for one song. */
export function eventSongSteps(event, songId) {
  return clampSteps(event?.steps?.[songId]);
}

/** Non-zero transpose stored on the bunker instance of a song. */
export function bunkerSongSteps(song) {
  return song?.bunker ? clampSteps(song.bunkerSteps) : 0;
}

/** Pitch class of a root name, 0–11 from C ("Bb" -> 10). -1 if it isn't one. */
export function pitchClass(name) {
  const m = /^([A-G][#b]?)/.exec(name || '');
  if (!m) return -1;
  return SHARP.indexOf(ALIAS[m[1]] || m[1]);
}

/* --- Reading the key off the chords, for a chart that doesn't print one. --- */

const MAJOR_SCALE = [0, 2, 4, 5, 7, 9, 11];
const MINOR_SCALE = [0, 2, 3, 5, 7, 8, 10];

/* The triad each degree wants. Minor takes both the natural v and the borrowed
   V — a chart leans on the major dominant as often as not, and neither
   spelling should cost it the key. */
const MAJOR_TRIADS = { 0: ['maj'], 2: ['min'], 4: ['min'], 5: ['maj'], 7: ['maj'], 9: ['min'], 11: ['dim'] };
const MINOR_TRIADS = { 0: ['min'], 2: ['dim'], 3: ['maj'], 5: ['min', 'maj'], 7: ['min', 'maj'], 8: ['maj'], 10: ['maj'] };

/* Tonic and dominant carry a key; the rest of the scale only agrees with it.
   Minor spreads its weight over VI/VII too — i–VI–III–VII is a whole genre. */
const MAJOR_WEIGHT = { 0: 1, 7: 0.5, 5: 0.35, 9: 0.15, 2: 0.1 };
const MINOR_WEIGHT = { 0: 1, 7: 0.5, 5: 0.4, 10: 0.3, 8: 0.25, 3: 0.15 };

/* Borrowed from the parallel minor, or plain mixolydian — half of rock is
   built on a bVII. These say nothing either way about the key. */
const MAJOR_NEUTRAL = { 10: 'maj', 3: 'maj', 8: 'maj' };

const OFF_SCALE = 0.4; // a chromatic root argues against the key
const WRONG_TRIAD = 0.3; // the right root with the wrong third still argues for it
const NO_TONIC = 1.2; // a key whose own tonic chord is never played

/* Where a chart says "home": how much of it sits on the tonic chord, and
   whether it opens, closes and starts its sections there. */
const SHARE = 0.8;
const FIRST = 0.3;
const LAST = 0.4;
const SECTION = 0.3;

const FLAT_DEFAULT = { 1: 'Db', 3: 'Eb', 6: 'Gb', 8: 'Ab', 10: 'Bb' };

/** Triad quality of a chord suffix. 'any' is a shape that names no third. */
function quality(suffix) {
  const s = suffix.replace(/^\(|\)$/g, '');
  if (/^(dim|°|o(?![a-z]))/i.test(s)) return 'dim';
  if (/^(aug|\+)/.test(s)) return 'aug';
  if (/^(m(?!aj)|min)/.test(s)) return 'min';
  if (/^(5|sus|no3)/.test(s)) return 'any';
  return 'maj';
}

function parseChord(name) {
  const m = /^([A-G][#b]?)(.*)$/.exec(String(name || '').split('/')[0].trim());
  if (!m) return null;
  const pc = pitchClass(m[1]);
  return pc < 0 ? null : { root: m[1], pc, q: quality(m[2]) };
}

/** The chords of a chart, flat and in order, plus where each section starts. */
function readChords(sections) {
  const all = [];
  const starts = [];
  for (const sec of sections || []) {
    let first = true;
    for (const line of sec.lines || []) {
      for (const seg of line) {
        if (!seg.c) continue;
        const chord = parseChord(seg.c);
        if (!chord) continue;
        all.push(chord);
        if (first) {
          starts.push(chord);
          first = false;
        }
      }
    }
  }
  return { all, starts };
}

/** Spell a pitch class the way this chart already spells it. */
function spellPc(pc, chords) {
  const tally = {};
  for (const c of chords) if (c.pc === pc) tally[c.root] = (tally[c.root] || 0) + 1;
  const seen = Object.keys(tally).sort((a, b) => tally[b] - tally[a])[0];
  if (seen) return seen;
  const flats = chords.filter((c) => c.root.endsWith('b')).length;
  const sharps = chords.filter((c) => c.root.endsWith('#')).length;
  return (flats > sharps && FLAT_DEFAULT[pc]) || SHARP[pc];
}

function isTonic(chord, tonic, wants) {
  return Boolean(chord) && chord.pc === tonic && (chord.q === 'any' || wants.includes(chord.q));
}

function scoreKey(tonic, mode, { all, starts, counts, top }) {
  const scale = mode === 'm' ? MINOR_SCALE : MAJOR_SCALE;
  const triads = mode === 'm' ? MINOR_TRIADS : MAJOR_TRIADS;
  const weight = mode === 'm' ? MINOR_WEIGHT : MAJOR_WEIGHT;

  /* How much of the chart the key explains, per chord played, so a long chart
     and a short one are read on the same scale as the evidence below. */
  let fit = 0;
  let tonicPlays = 0;
  for (const [pc, byQuality] of counts) {
    const degree = (pc - tonic + 12) % 12;
    for (const [q, n] of byQuality) {
      if (mode !== 'm' && MAJOR_NEUTRAL[degree] === q) {
        continue;
      } else if (!scale.includes(degree)) {
        fit -= n * OFF_SCALE;
      } else if (q === 'any' || triads[degree].includes(q)) {
        fit += n * (1 + (weight[degree] || 0));
        if (degree === 0) tonicPlays += n;
      } else {
        /* A borrowed third — the chord still belongs to the key's harmony. */
        fit += n * WRONG_TRIAD;
      }
    }
  }
  let score = fit / all.length;

  const wants = triads[0];
  if (!tonicPlays) score -= NO_TONIC;
  else score += SHARE * (tonicPlays / top);

  if (isTonic(all[0], tonic, wants)) score += FIRST;
  if (isTonic(all[all.length - 1], tonic, wants)) score += LAST;
  if (starts.length) score += SECTION * (starts.filter((c) => isTonic(c, tonic, wants)).length / starts.length);

  return score;
}

/**
 * Read the key off the chords themselves, for a source that didn't print one.
 * Returns the app's key spelling ("F", "F#m"), or '' if the chart has no chords.
 */
export function detectKey(sections) {
  const { all, starts } = readChords(sections);
  if (!all.length) return '';

  const counts = new Map();
  for (const { pc, q } of all) {
    if (!counts.has(pc)) counts.set(pc, new Map());
    counts.get(pc).set(q, (counts.get(pc).get(q) || 0) + 1);
  }
  const byRoot = [...counts].map(([pc, byQuality]) => [pc, [...byQuality]]);
  const top = Math.max(...[...counts.values()].map((m) => [...m.values()].reduce((a, b) => a + b, 0)));
  const chart = { all, starts, counts: byRoot, top };

  let best = null;
  for (let tonic = 0; tonic < 12; tonic++) {
    for (const mode of ['', 'm']) {
      const score = scoreKey(tonic, mode, chart);
      if (!best || score > best.score) best = { tonic, mode, score };
    }
  }

  return spellPc(best.tonic, all) + best.mode;
}
