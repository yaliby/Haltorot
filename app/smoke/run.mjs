// Minimal browser stubs so the store's localStorage read doesn't throw.
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };

console.error = () => {}; // react-router's useLayoutEffect SSR noise
const { render } = await import('./dist/entry.js');
const { TODAY } = await import('../src/data.js');
const { monthName, parseISO, longDate } = await import('../src/lib/dates.js');

const { m } = parseISO(TODAY);
const thisMonth = monthName(m, 'en');
const todayLong = longDate(TODAY, 'en');

const routes = [
  ['/',                          [thisMonth, 'Static Bloom', 'Add rehearsal', 'Nothing scheduled']],
  ['/songs',                     ['Songs', 'Collections', 'New song', 'Import online', 'The library is empty']],
  [`/rehearsal/${TODAY}`,        [todayLong, 'Nothing is booked', 'Book a rehearsal']],
  ['/rehearsal/2026-12-01',      ['Nothing is booked', 'Book a rehearsal']],
  ['/rehearsal/not-a-date',      ['is not a date on the calendar', 'Back to the calendar']],
  ['/song/nope',                 ['isn']],
  ['/song/nope?from=not-a-date', ['isn', '>Songs<']]
];

let fail = 0;
for (const [path, needles] of routes) {
  try {
    const html = render(path).replace(/<!-- -->/g, "");
    const missing = needles.filter((n) => !html.includes(n));
    if (missing.length) {
      fail++;
      console.log(`FAIL ${path}\n     missing: ${missing.join(' | ')}`);
    } else {
      console.log(`ok   ${path}  (${html.length} bytes)`);
    }
  } catch (err) {
    fail++;
    console.log(`THREW ${path}\n     ${err.message}`);
  }
}
console.log(fail ? `\n${fail} route(s) failed` : '\nall routes render');
process.exit(fail ? 1 : 0);
