globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
console.error = () => {};

const { transpose, chordsUsed, detectKey, songKey } = await import('../src/lib/chords.js');
const { monthGrid, monthWeekStart, weekOffset, cellsFromWeekStart, iso, runtime, mmss, relative, isISODate } = await import('../src/lib/dates.js');

let fail = 0;
const eq = (label, got, want) => {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  if (!ok) { fail++; console.log(`FAIL ${label}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
  else console.log(`ok   ${label} = ${JSON.stringify(got)}`);
};

// --- chords
eq('D +2', transpose('D', 2), 'E');
eq('Bm +2', transpose('Bm', 2), 'C#m');
eq('A/C# +1', transpose('A/C#', 1), 'A#/D');
eq('F#m -1', transpose('F#m', -1), 'Fm');
eq('Bb +1 keeps flats', transpose('Bb', 1), 'B');
eq('Eb -1 keeps flats', transpose('Eb', -1), 'D');
eq('Gsus4 +5', transpose('Gsus4', 5), 'Csus4');
eq('wrap G +5', transpose('G', 5), 'C');
eq('wrap C -1', transpose('C', -1), 'B');
eq('no steps is identity', transpose('F#m7', 0), 'F#m7');

/* Neither Tab4U nor every UG tab prints a key, so it gets read off the chords.
   A wrong default would send the whole band transposing. */
const chart = (...chords) => [{ label: 'x', lines: chords.map((c) => [{ c }]) }];
eq('key of a I-V-vi-IV chart', detectKey(chart('C', 'G', 'Am', 'F', 'C')), 'C');
eq('key hears the relative minor', detectKey(chart('Em', 'C', 'G', 'D', 'Em')), 'Em');
eq('key hears the relative major', detectKey(chart('G', 'Em', 'C', 'D', 'G')), 'G');
eq('key keeps the chart flat spelling', detectKey(chart('Bb', 'F', 'Gm', 'Eb', 'Bb')), 'Bb');
eq('key survives a borrowed bVII', detectKey(chart('D', 'C', 'G', 'D', 'C', 'D')), 'D');
eq('key ignores the bass of a slash chord', detectKey(chart('A', 'E/G#', 'F#m', 'D', 'A')), 'A');
eq('key of a chart with no chords', detectKey([{ label: 'x', lines: [[{ t: 'just words' }]] }]), '');

/* A capo song is heard above its chords — the badge says the key the room
   hears, and says which capo it counts on. */
eq('capo 2 on an Em chart sounds F#m', songKey({ key: 'Em', capo: 2 }), 'F#m');
eq('capo key is spelled like a chart', songKey({ key: 'Am', capo: 1 }), 'Bbm');
eq('no capo leaves the key alone', songKey({ key: 'Bb', capo: 0 }), 'Bb');
eq('a missing capo is no capo', songKey({ key: 'D' }), 'D');

// --- calendar math: Aug 1 2026 is a Saturday, Aug 29 a Saturday
const aug = monthGrid(2026, 7);
eq('Aug 1 sits in the SAT column', aug.findIndex((c) => c.date === '2026-08-01') % 7, 6);
eq('Aug 29 sits in the SAT column', aug.findIndex((c) => c.date === '2026-08-29') % 7, 6);
eq('Aug has 31 in-month cells', aug.filter((c) => c.inMonth).length, 31);
eq('grid is always 42 cells', aug.length, 42);
const feb = monthGrid(2028, 1);
eq('Feb 2028 is a leap month', feb.filter((c) => c.inMonth).length, 29);
eq('Aug to Sep is 5 Sunday-weeks', weekOffset(2026, 7, 2026, 8), 5);
eq('Sep 1 stays in the Tuesday column on the continuous strip',
  cellsFromWeekStart(monthWeekStart(2026, 7), 11, 2026, 8).findIndex((c) => c.key === '2026-09-01') % 7, 2);

// --- formatting
eq('mmss', mmss(252), '4:12');
eq('runtime short', runtime(2319, 'en'), '39 min');
eq('runtime long', runtime(4200, 'en'), '1h 10m');
eq('relative today', relative('2026-08-29', '2026-08-29', 'en'), 'Tonight');
eq('relative future', relative('2026-09-05', '2026-08-29', 'en'), 'in 7 days');
eq('relative past', relative('2026-08-22', '2026-08-29', 'en'), '7 days ago');

// --- date guards: a hand-typed URL must not reach the screens
eq('a real date passes', isISODate('2026-08-29'), true);
eq('junk is rejected', isISODate('nonsense'), false);
eq('Feb 30 is rejected', isISODate('2026-02-30'), false);
eq('month 13 is rejected', isISODate('2026-13-01'), false);

// --- reducer: reorder must land where the drop indicator points (above the hovered row)
const { reducer } = await import('./dist/entry.js');
const base = { events: { d: { kind: 'r', time: '19:00', place: 'X', songs: ['a','b','c','d'], done: ['a'] } }, songs: [], toast: null };
const order = (st) => st.events.d.songs.join('');

eq('drag 1 down onto 3', order(reducer(base, { type: 'reorder', date: 'd', from: 0, to: 2 })), 'bacd');
eq('drag 4 up onto 2',   order(reducer(base, { type: 'reorder', date: 'd', from: 3, to: 1 })), 'adbc');
eq('drop on itself is a no-op', order(reducer(base, { type: 'reorder', date: 'd', from: 1, to: 1 })), 'abcd');
eq('a song can move down one slot', order(reducer(base, { type: 'reorder', date: 'd', from: 0, to: 2 })), 'bacd');
eq('a song can land last', order(reducer(base, { type: 'reorder', date: 'd', from: 1, to: 4 })), 'acdb');
eq('a song can land first', order(reducer(base, { type: 'reorder', date: 'd', from: 2, to: 0 })), 'cabd');
eq('remove drops it from the set',
   JSON.stringify(reducer(base, { type: 'remove-song', date: 'd', songId: 'a' }).events.d),
   JSON.stringify({ kind: 'r', time: '19:00', place: 'X', songs: ['b','c','d'], done: [] }));
eq('add-song appends once',
   order(reducer(reducer(base, { type: 'add-song', date: 'd', songId: 'e' }), { type: 'add-song', date: 'd', songId: 'e' })), 'abcde');
eq('create-rehearsal will not clobber an existing day',
   reducer(base, { type: 'create-rehearsal', date: 'd', time: '09:00', place: 'Y' }).events.d.time, '19:00');
eq('original state is untouched', order(base), 'abcd');

// --- editing and deleting a booking
eq('update-rehearsal patches the day',
   JSON.stringify(reducer(base, { type: 'update-rehearsal', date: 'd', patch: { time: '21:00', place: 'Y' } }).events.d),
   JSON.stringify({ kind: 'r', time: '21:00', place: 'Y', songs: ['a','b','c','d'], done: ['a'] }));
eq('update-rehearsal ignores a day with nothing on it',
   reducer(base, { type: 'update-rehearsal', date: 'zzz', patch: { time: '21:00' } }).events.zzz, undefined);
eq('delete-rehearsal empties the day', Object.keys(reducer(base, { type: 'delete-rehearsal', date: 'd' }).events), []);
eq('restore brings the snapshot back',
   order(reducer(reducer(base, { type: 'delete-rehearsal', date: 'd' }), { type: 'restore', events: base.events })), 'abcd');

// --- attendance lives on the event and can be cleared again
const att1 = reducer(base, { type: 'set-attendance', date: 'd', member: 'tal', status: 'late' });
eq('attendance is recorded', att1.events.d.att, { tal: 'late' });
eq('attendance can be cleared',
   reducer(att1, { type: 'set-attendance', date: 'd', member: 'tal', status: '' }).events.d.att, {});
eq('attendance ignores an empty day',
   reducer(base, { type: 'set-attendance', date: 'zzz', member: 'tal', status: 'in' }).events.zzz, undefined);

// --- the library the band adds to
const newSong = { id: 'x', title: 'X', artist: 'Static Bloom', key: 'C', bpm: 100, sec: 210 };
const withSong = reducer(base, { type: 'add-to-library', song: newSong });
eq('add-to-library keeps the chart empty and marks it custom',
   [withSong.songs.length, withSong.songs[0].custom, withSong.songs[0].sections.length], [1, true, 0]);
const withChart = reducer(base, {
  type: 'add-to-library',
  song: { ...newSong, sections: [{ label: 'Verse', bars: '', lines: [[{ c: 'C', t: 'hey' }]] }], needsWork: false }
});
eq('add-to-library keeps imported sections', [withChart.songs[0].sections.length, withChart.songs[0].needsWork], [1, false]);
eq('add-to-library will not add the same id twice',
   reducer(withSong, { type: 'add-to-library', song: newSong }).songs.length, 1);
eq('add-to-library rejects junk', reducer(base, { type: 'add-to-library', song: { id: 5 } }).songs.length, 0);

const booked = reducer(withSong, { type: 'add-song', date: 'd', songId: 'x' });
const dropped = reducer(booked, { type: 'remove-from-library', songId: 'x' });
eq('deleting a custom song pulls it out of every setlist', [dropped.songs.length, order(dropped)], [0, 'abcd']);
eq('undo library delete restores the song',
   reducer(dropped, { type: 'restore', events: booked.events, songs: booked.songs }).songs.length, 1);
eq('a song that is not shipped can be deleted',
   reducer({ ...base, songs: [{ id: 'copper-line', title: 'Copper Line' }] }, { type: 'remove-from-library', songId: 'copper-line' }).songs.length, 0);

// --- moving a chord over the words
const { readLine, writeLine, splitLine, moveChord, nudgeChord, isAlignable, readSections, writeSections } =
  await import('../src/lib/chordEdit.js');

const sung = [{ c: 'D', t: 'Six on the ' }, { c: 'A', t: 'copper line,' }];
eq('a line reads back as one lyric with anchors',
   readLine(sung), { text: 'Six on the copper line,', chords: [{ c: 'D', at: 0 }, { c: 'A', at: 11 }] });

/* Reading a chart and writing it straight back out must hand back the same
   chart, or opening the editor and saving would quietly rewrite every song. */
const fixtureCharts = [
  [{ label: 'Verse', bars: '8 bars', lines: [sung] }],
  [{ label: 'Intro', bars: '4 bars', lines: [[{ c: 'D' }, { c: 'A' }, { c: 'Bm' }, { c: 'G' }]] }]
];
let roundTrips = 0;
for (const sections of fixtureCharts) {
  const back = writeSections(readSections(sections));
  if (JSON.stringify(back) !== JSON.stringify(sections)) {
    fail++;
    console.log('FAIL round trip rewrote a fixture chart');
  } else roundTrips++;
}
eq('a chart survives a round trip untouched', roundTrips, fixtureCharts.length);

/* Moving the A one character earlier takes the space with it — the fragment
   carries its own gap, the way the chart was typed. */
eq('a chord moved one letter earlier takes the space with it',
   writeLine(nudgeChord(readLine(sung), 1, -1)),
   [{ c: 'D', t: 'Six on the' }, { c: 'A', t: ' copper line,' }]);
eq('a chord moved onto the first letter leaves nothing before it',
   writeLine(moveChord(readLine(sung), 1, 0)),
   [{ c: 'D' }, { c: 'A', t: 'Six on the copper line,' }]);
eq('a chord can be sent past the last word',
   writeLine(moveChord(readLine(sung), 1, 23)),
   [{ c: 'D', t: 'Six on the copper line,' }, { c: 'A' }]);
eq('a chord cannot be pushed off the front', nudgeChord(readLine(sung), 0, -5).chords[0].at, 0);
eq('a chord cannot be pushed off the end', moveChord(readLine(sung), 1, 999).chords[1].at, 23);
const still = readLine(sung);
eq('moving a chord where it already is hands back the same line', moveChord(still, 1, 11) === still, true);

/* Chords crossing each other stay in the order the line holds them, so the
   chord in hand is still the chord in hand after the move. */
const crossed = moveChord(readLine(sung), 0, 20);
eq('a chord dragged past its neighbour keeps its own slot', crossed.chords.map((c) => c.c), ['D', 'A']);
eq('but the line prints them in reading order',
   writeLine(crossed).map((g) => g.c || '-'), ['-', 'A', 'D']);

const lead = [{ t: 'On ' }, { c: 'G', t: 'the road' }];
eq('words before the first chord belong to no chord', writeLine(readLine(lead)), lead);
eq('an intro row of chords has nothing to align to', isAlignable(readLine([{ c: 'D' }, { c: 'A' }])), false);
eq('an intro row still writes back out whole',
   writeLine(readLine([{ c: 'D' }, { c: 'A' }])), [{ c: 'D' }, { c: 'A' }]);
eq('split says where every fragment starts in the lyric',
   splitLine(readLine(sung)).map((p) => [p.ci, p.from]), [[0, 0], [1, 11]]);

// --- the chart edit, in the store
const chartSong = { id: 'copper-line', title: 'Copper Line', sections: [{ label: 'V', bars: '', lines: [[{ c: 'D', t: 'hi' }]] }] };
const chartBase = { ...base, songs: [chartSong] };
const moved = [{ label: 'V', bars: '', lines: [[{ c: 'D' }, { t: 'hi' }]] }];
eq('edit-chart replaces the chart and marks it edited',
   (() => { const st = reducer(chartBase, { type: 'edit-chart', songId: 'copper-line', sections: moved });
            return [JSON.stringify(st.songs[0].sections), st.songs[0].chartEdited]; })(),
   [JSON.stringify(moved), true]);
eq('edit-chart rejects junk',
   reducer(chartBase, { type: 'edit-chart', songId: 'copper-line', sections: [{ lines: 'nope' }] }).songs[0].chartEdited,
   undefined);
eq('edit-chart ignores a song that is not there',
   reducer(chartBase, { type: 'edit-chart', songId: 'nobody', sections: moved }).songs[0].sections.length, 1);
eq('undo puts the old chart back',
   JSON.stringify(reducer(
     reducer(chartBase, { type: 'edit-chart', songId: 'copper-line', sections: moved }),
     { type: 'restore', songs: chartBase.songs }
   ).songs[0].sections), JSON.stringify(chartSong.sections));

// --- chordpro import parser
const { parseChordPro } = await import('../src/lib/chordpro.js');
const sample = `[Intro]
[ch]Em[/ch]   [ch]G[/ch]
[Verse]
[tab][ch]Em[/ch]       [ch]G[/ch]
Today is gonna be the day[/tab]`;
const parsed = parseChordPro(sample);
eq('chordpro sections', parsed.map((s) => s.label), ['Intro', 'Verse']);
eq('chordpro intro chords', parsed[0].lines[0].map((s) => s.c), ['Em', 'G']);
eq('chordpro verse split', parsed[1].lines[0].map((s) => [s.c, s.t?.trim()]), [['Em', 'Today is gonna be the'], ['G', 'day']]);

const knock = `[Verse 2]
[tab][ch]G[/ch]             [ch]D[/ch]                   [ch]Am[/ch]
  Mama put my guns in the ground[/tab]`;
const knockParsed = parseChordPro(knock)[0].lines[0];
eq('knockin chord count', knockParsed.length, 3);
eq('knockin Am lands on ground', knockParsed[2].c, 'Am');
eq('knockin Am text', knockParsed[2].t?.trim(), 'ground');

const { songSlug, hasHebrew, textMatch, titleMatch, searchTitle } = await import('../src/lib/text.js');
eq('hebrew slug', songSlug('מחר', new Set()), 'מחר');
eq('hasHebrew', hasHebrew('אביב גפן'), true);
eq('hebrew title match', textMatch('מחר', 'מחר (live)'), true);
eq('title match live suffix', titleMatch('מחר', 'מחר (live)'), true);
eq('title rejects partial', titleMatch('יש לי מלאך', 'מלאך'), false);
eq('mashina title', titleMatch('הכוכבים דולקים על אש קטנה', 'הכוכבים דולקים על אש קטנה'), true);
eq('mashina alias', textMatch('Mashina', 'משינה'), true);
eq('search title strips single version', searchTitle('Let It Go (Single Version)'), 'Let It Go');
eq('search title strips featuring', searchTitle("Let It Go (feat. Missy Elliott & Lil 'Kim)"), 'Let It Go');
eq('search title keeps a bare title', searchTitle('Let It Go'), 'Let It Go');

const { parseTab4uHtml } = await import('../server/tab4u.js');

/* The column maths below is checked against tab4u's own page and nothing else
   — a saved copy would freeze the very thing under test, and the lyrics are
   not ours to commit. So the page is fetched live, and when it cannot be
   reached (a CI runner, a plane) these checks say so and stand down rather
   than failing for a reason that has nothing to do with the code. */
let skipped = 0;
async function livePage(what, url) {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
      signal: AbortSignal.timeout(15000)
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } catch (e) {
    skipped++;
    console.log(`skip ${what} — tab4u unreachable (${e.message})`);
    return null;
  }
}

const mashinaHtml = await livePage(
  'mashina chart',
  'https://www.tab4u.com/tabs/songs/2055_%D7%9E%D7%A9%D7%99%D7%A0%D7%94_-_%D7%94%D7%9B%D7%95%D7%9B%D7%91%D7%99%D7%9D_%D7%93%D7%95%D7%9C%D7%A7%D7%99%D7%9D_%D7%A2%D7%9C_%D7%90%D7%A9_%D7%A7%D7%98%D7%A0%D7%94.html'
);
if (mashinaHtml) {
const mashinaSections = parseTab4uHtml(mashinaHtml);
eq('mashina single section', mashinaSections.length, 1);
/* Tab4U prints no key of its own — the page only offers a "שנה טון" button. */
eq('mashina key read off the chords', detectKey(mashinaSections), 'G');
const lineText = (l) => l.map((s) => s.t || '').join('');
eq(
  'mashina has chorus',
  mashinaSections[0].lines.some((l) => /הכוכבים דולקים/.test(lineText(l))),
  true
);

/* Tab4U prints a Hebrew chart mirrored: the chord row is ltr but flush right,
   over a lyric read right to left. These three lines are checked against where
   tab4u's own page puts each chord, so a regression in the column maths shows
   up as the wrong word. */
const pairs = (lyric) => {
  const line = mashinaSections[0].lines.find((l) => lineText(l).trim().startsWith(lyric));
  return line.filter((s) => s.c).map((s) => [s.c, (s.t || '').trim().split(/\s+/)[0] || '-']);
};
eq('mashina verse reads G then Bm', pairs('הסיפור'), [['G', 'הסיפור'], ['Bm', 'מוזר']]);
eq('mashina word before the first chord', pairs('על בחורה'), [['F', 'בחורה'], ['C', 'הכרתי']]);
eq('mashina four chords in reading order', pairs('ואותה'),
  [['G', 'ואותה'], ['Bm', 'בבר'], ['F', 'לילה'], ['C', '-']]);

/* The organ part is printed as tab rows partway down the page; reading must
   carry on past it, or the last verse is lost. */
eq(
  'mashina keeps the verse below the organ part',
  mashinaSections[0].lines.some((l) => /במזומן/.test(lineText(l))),
  true
);
}

/* An English chart on Tab4U is marked chords_en and set flush left. */
const oasisHtml = await livePage('oasis chart', 'https://www.tab4u.com/tabs/songs/3396_Oasis_-_Wonderwall.html');
if (oasisHtml) {
const oasis = parseTab4uHtml(oasisHtml).flatMap((s) => s.lines);
eq('oasis chart has chords', oasis.filter((l) => l.some((s) => s.c)).length > 20, true);
eq(
  'oasis first sung line',
  oasis.find((l) => /gonna be the day/i.test(l.map((s) => s.t || '').join('')))
    .filter((s) => s.c).map((s) => [s.c, (s.t || '').trim().split(/\s+/)[0]]),
  [['Em7', 'Today'], ['G', 'gonna']]
);
}

const note = skipped ? ` (${skipped} live-page group${skipped > 1 ? 's' : ''} skipped)` : '';
console.log(fail ? `\n${fail} check(s) failed` : `\nall logic checks pass${note}`);
process.exit(fail ? 1 : 0);
