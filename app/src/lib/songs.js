import { SONGS } from '../data.js';

const builtInIds = new Set(SONGS.map((s) => s.id));

/** Songs the band added (or imported). Nothing is shipped in the bundle. */
export function isDeletableSong(song) {
  return !!song && (song.custom || !builtInIds.has(song.id));
}
