import React, { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { SongArt } from '../components/SongArt.jsx';
import { useStore } from '../store.jsx';
import { useI18n } from '../i18n/index.js';
import { hue, tempoHue } from '../lib/hues.js';
import { songKey } from '../lib/chords.js';
import { mmss, runtime } from '../lib/dates.js';

/* The standing set, on its own screen. Everything on it comes out of the
   library the band already has: this screen adds and removes, it never
   creates a song. What it decides is what a new rehearsal opens with. */
export default function BunkerScreen() {
  const { songs, dispatch, notify, locale } = useStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [adding, setAdding] = useState(false);
  const [poolQuery, setPoolQuery] = useState('');

  const set = songs.filter((s) => s.bunker);
  const totalSec = set.reduce((a, s) => a + s.sec, 0);

  const pq = poolQuery.trim().toLowerCase();
  const pool = songs
    .filter((s) => !s.bunker)
    .filter((s) => !pq || `${s.title} ${s.artist} ${songKey(s)}`.toLowerCase().includes(pq));

  function put(song, on) {
    dispatch({ type: 'set-bunker', songId: song.id, on });
    notify(t(on ? 'bunker.added' : 'bunker.removed', { title: song.title }));
  }

  return (
    <>
      <main className="main">
        <header className="screen-head">
          <h1 className="screen-title" style={{ fontSize: 34 }}>{t('bunker.title')}</h1>
          <p style={{ fontSize: 13, color: 'var(--dim)', maxWidth: 460, lineHeight: 1.6, marginTop: 6 }}>
            {t('bunker.lede')}
          </p>
          {set.length > 0 && (
            <div className="meta-row" style={{ marginTop: 10 }}>
              <span className="mono">
                {t(set.length === 1 ? 'bunker.countOne' : 'bunker.count', {
                  n: set.length,
                  time: runtime(totalSec, locale)
                })}
              </span>
            </div>
          )}
        </header>

        <div className="set-wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('bunker.list')}</h2>
            {/* On a phone the library panel is a sheet, so it needs a way up.
                On a wide screen it is already standing in the sidebar. */}
            <button
              className={'ghost show-sm' + (adding ? ' is-on' : '')}
              style={{ marginInlineStart: 'auto' }}
              aria-expanded={adding}
              onClick={() => setAdding((v) => !v)}
            >
              <Icon name="plus" size={14} />
              {t('bunker.addSong')}
            </button>
          </div>

          {set.length > 0 && (
            <div className="set-head set-head-plain">
              <span>{t('common.title')}</span>
              <span>{t('common.key')}</span>
              <span>{t('common.tempo')}</span>
              <span className="right">{t('common.time')}</span>
              <span />
            </div>
          )}

          <div className="scroll" style={{ padding: '6px 0 26px' }}>
            {set.map((s, i) => (
              <div key={s.id} className="set-row set-row-plain">
                <div className="set-body grow">
                  <button className="set-open" onClick={() => navigate(`/song/${s.id}?from=bunker`)}>
                    <SongArt song={s} fallback="note" />
                    <span className="set-lines">
                      <span className="title-line">
                        <span className="set-num" style={{ width: 'auto' }}>{String(i + 1).padStart(2, '0')}</span>
                        <span className="set-title truncate">{s.title}</span>
                        {s.needsWork && <span className="tag tag-work">{t('common.needsWork')}</span>}
                      </span>
                      <span className="title-line" style={{ gap: 7 }}>
                        <span className="set-artist truncate">{s.artist}</span>
                        <span className="show-sm key-badge" style={hue(songKey(s))}>{songKey(s)}</span>
                        <span className="show-sm mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{s.bpm} {t('common.bpm')}</span>
                      </span>
                    </span>
                  </button>
                </div>

                <div className="set-key">
                  <span
                    className="key-badge"
                    style={hue(songKey(s))}
                    title={s.capo ? t('common.capoWith', { capo: s.capo }) : undefined}
                  >
                    {songKey(s)}
                  </span>
                  {s.capo > 0 && <span className="set-capo">{t('common.capoWith', { capo: s.capo })}</span>}
                </div>

                <div className="set-tempo">
                  <span className="tempo-dot" style={tempoHue(s.bpm)} />
                  <span className="set-bpm">{s.bpm}</span>
                </div>

                <div className="set-time set-dur">{mmss(s.sec)}</div>

                <div className="set-actions">
                  <button
                    className="kill"
                    aria-label={t('bunker.remove', { title: s.title })}
                    onClick={() => put(s, false)}
                  >
                    {t('bunker.removeButton')}
                    <Icon name="close" size={13} />
                  </button>
                </div>
              </div>
            ))}

            {set.length === 0 && (
              <div className="empty empty-plain">
                <Icon name="star" size={30} style={{ color: 'var(--fainter)' }} />
                <p>{songs.length === 0 ? t('bunker.libraryEmpty') : t('bunker.empty')}</p>
                {songs.length === 0 ? (
                  <Link to="/songs" className="btn">{t('bunker.toLibrary')}</Link>
                ) : (
                  <button className="btn show-sm" onClick={() => setAdding(true)}>
                    <Icon name="plus" size={15} />
                    {t('bunker.addSong')}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      </main>

      {adding && <div className="sheet-scrim" onClick={() => setAdding(false)} />}

      <aside className={'aside' + (adding ? ' is-sheet' : '')} style={{ width: 326, flex: '0 0 326px' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="eyebrow">{t('bunker.addFromLibrary')}</div>
            <button className="icon-btn show-sm" aria-label={t('common.close')} onClick={() => setAdding(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>

          <div className="search">
            <Icon name="search" size={14} />
            <input
              className="field"
              placeholder={t('bunker.searchLibrary')}
              aria-label={t('bunker.searchLibrary')}
              value={poolQuery}
              onChange={(e) => setPoolQuery(e.target.value)}
            />
          </div>

          {pool.length ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
              {pool.map((s) => (
                <button
                  key={s.id}
                  className="mini-row"
                  style={{ margin: 0, width: '100%', padding: 10 }}
                  onClick={() => put(s, true)}
                >
                  <span className="grow">
                    <span className="mini-title truncate" style={{ display: 'block' }}>{s.title}</span>
                    <span className="mini-sub">{s.artist} · {songKey(s)} · {s.bpm} BPM</span>
                  </span>
                  <span style={{ width: 26, height: 26, borderRadius: 99, border: '1px solid var(--line-2)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--accent)', flex: '0 0 auto' }}>
                    <Icon name="plus" size={13} />
                  </span>
                </button>
              ))}
            </div>
          ) : (
            <p style={{ fontSize: 12.5, color: 'var(--fainter)', textAlign: 'center', padding: '30px 10px', lineHeight: 1.55 }}>
              {pq
                ? t('bunker.poolNoMatch', { q: poolQuery })
                : songs.length === 0
                  ? t('bunker.libraryEmpty')
                  : t('bunker.poolEmpty')}
            </p>
          )}
        </div>
      </aside>
    </>
  );
}
