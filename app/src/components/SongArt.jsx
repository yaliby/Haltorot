import React, { useState } from 'react';
import { hue } from '../lib/hues.js';
import { songKey } from '../lib/chords.js';
import { Icon } from './Icon.jsx';

/** The row's tile: the album cover when the import brought one home, the key
 *  badge otherwise. A cover row carries its key beside the artist instead —
 *  see `.lib-key` in the stylesheet.
 *
 *  `fallback="note"` is for a list that already spends a column on the key —
 *  the setlist does — where a second key would only say it twice. */
export function SongArt({ song, fallback = 'key' }) {
  const [broken, setBroken] = useState(false);

  if (!song.artwork || broken) {
    if (fallback === 'note') {
      return <span className="art art-blank"><Icon name="music" size={16} /></span>;
    }
    const key = songKey(song);
    return <span className={'art' + (song.own ? ' own' : '')} style={hue(key)}>{key}</span>;
  }

  return (
    <span className="art art-cover">
      <img src={song.artwork} alt="" width={42} height={42} loading="lazy" onError={() => setBroken(true)} />
    </span>
  );
}
