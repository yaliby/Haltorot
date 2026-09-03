// Band identity and rooms. The library and the calendar start empty —
// songs and bookings live in the database (or in localStorage until one exists).

import { iso } from './lib/dates.js';

const now = new Date();
export const TODAY = iso(now.getFullYear(), now.getMonth(), now.getDate());

export const BAND = {
  name: 'Static Bloom',
  city: 'Tel Aviv',
  members: [
    // `hue` is the colour each member carries — avatars, their notes, the
    // attendance list. Spread far enough apart to tell five initials apart.
    { id: 'maya', initials: 'M', name: 'Maya', role: 'Vocals', hue: 348 },
    { id: 'ori', initials: 'O', name: 'Ori', role: 'Guitar', hue: 45 },
    { id: 'dana', initials: 'D', name: 'Dana', role: 'Bass', hue: 152 },
    { id: 'tal', initials: 'T', name: 'Tal', role: 'Drums', hue: 208 },
    { id: 'noam', initials: 'N', name: 'Noam', role: 'Keys', hue: 285 }
  ]
};

export const SONGS = [];
export const EVENTS = {};
export const ROOMS = ['יניב', 'מטאור', 'חיפה'];
