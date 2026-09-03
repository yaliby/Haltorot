import React, { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { SongImportSheet } from '../components/SongImportSheet.jsx';
import { SongArt } from '../components/SongArt.jsx';
import { useStore } from '../store.jsx';
import { useI18n } from '../i18n/index.js';
import { BAND } from '../data.js';
import { hue, keyHue } from '../lib/hues.js';
import { songKey } from '../lib/chords.js';
import { mmss, runtime } from '../lib/dates.js';
import { songSlug, sameSongEntry } from '../lib/text.js';
import { isDeletableSong } from '../lib/songs.js';
import { freezeUndo } from '../lib/undo.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('library');

const KEYS = ['C', 'G', 'D', 'A', 'E', 'F', 'Bb', 'Am', 'Em', 'Bm', 'F#m', 'Dm', 'Gm', 'Cm'];
const BLANK = { title: '', artist: BAND.name, key: 'C', bpm: '100', length: '3:30', own: true };

function parseLength(v) {
  const m = /^(\d{1,2}):([0-5]?\d)$/.exec(v.trim());
  if (m) return Number(m[1]) * 60 + Number(m[2]);
  const n = Number(v.trim());
  return Number.isFinite(n) && n > 0 ? Math.round(n) : null;
}

const GROUP_IDS = ['all', 'originals', 'covers', 'charts', 'work'];

export default function LibraryScreen() {
  const { songs, events, dispatch, notify, locale } = useStore();
  const { t } = useI18n();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [group, setGroup] = useState('all');
  const [key, setKey] = useState('all');
  const [creating, setCreating] = useState(false);
  const [importing, setImporting] = useState(false);
  const [draft, setDraft] = useState(BLANK);

  const GROUPS = useMemo(() => {
    const tests = {
      all: () => true,
      originals: (s) => s.own,
      covers: (s) => !s.own,
      charts: (s) => s.sections.length > 0,
      work: (s) => s.needsWork
    };
    return GROUP_IDS.map((id) => ({
      id,
      label: t(`library.${id === 'all' ? 'allSongs' : id === 'charts' ? 'hasChords' : id === 'work' ? 'needsWork' : id}`),
      test: tests[id]
    }));
  }, [t]);

  const allKeyLabel = t('common.all');

  const titleTaken = songs.some((s) => sameSongEntry(s, { title: draft.title, artist: draft.artist }));
  const seconds = parseLength(draft.length);
  const bpm = Number(draft.bpm);
  const problem = !draft.title.trim()
    ? t('library.errTitle')
    : titleTaken
    ? t('library.errDuplicate')
    : !seconds
    ? t('library.errLength')
    : !(bpm >= 20 && bpm <= 320)
    ? t('library.errBpm')
    : null;

  function createSong() {
    if (problem) return;
    const song = {
      id: songSlug(draft.title, new Set(songs.map((s) => s.id))),
      title: draft.title.trim(),
      artist: draft.artist.trim() || BAND.name,
      key: draft.key,
      bpm: Math.round(bpm),
      sec: seconds,
      capo: 0,
      timeSig: '4/4',
      own: draft.own,
      sections: [],
      needsWork: true,
      lastPlayed: t('common.never')
    };
    dispatch({ type: 'add-to-library', song });
    setCreating(false);
    setDraft(BLANK);
    setQuery('');
    setGroup('all');
    setKey('all');
    notify(t('library.added', { title: song.title }), { songs });
  }

  function removeSong(song) {
    log.info('delete requested', { id: song.id, title: song.title, deletable: isDeletableSong(song) });
    const snapshot = freezeUndo({ events, songs });
    dispatch({ type: 'remove-from-library', songId: song.id });
    notify(t('song.removed', { title: song.title }), snapshot);
  }

  /* The filter, the search and the badge all speak in the key the song is
     heard in — a capo song is filed where the ear files it. */
  const keys = useMemo(() => ['all', ...Array.from(new Set(songs.map(songKey)))], [songs]);
  const active = GROUPS.find((g) => g.id === group) || GROUPS[0];

  const q = query.trim().toLowerCase();
  const rows = songs
    .filter(active.test)
    .filter((s) => key === 'all' || songKey(s) === key)
    .filter((s) => !q || `${s.title} ${s.artist} ${songKey(s)}`.toLowerCase().includes(q));

  const totalSec = songs.reduce((a, s) => a + s.sec, 0);

  return (
    <>
      <aside className="rail lib-rail" style={{ borderInlineEnd: 0, width: 200, flex: '0 0 200px', background: 'transparent', paddingTop: 90 }}>
        <div className="rail-section">
          <div className="eyebrow">{t('library.collections')}</div>
          {GROUPS.map((g) => {
            const n = songs.filter(g.test).length;
            return (
              <button
                key={g.id}
                className="nav-item"
                style={{ height: 34, fontSize: 12.5, background: group === g.id ? 'var(--raised-2)' : undefined, color: group === g.id ? 'var(--text)' : undefined, fontWeight: group === g.id ? 600 : 400 }}
                onClick={() => setGroup(g.id)}
              >
                {g.label}
                <span className="nav-count">{n}</span>
              </button>
            );
          })}
        </div>
        <div style={{ marginTop: 'auto', padding: '0 8px', fontSize: 10.5, color: 'var(--fainter)', lineHeight: 1.6 }}>
          {t('library.libraryTotal')}
          <br />
          <span className="mono" style={{ color: 'var(--dim)', fontSize: 13 }}>{runtime(totalSec, locale)}</span> {t('library.ofMaterial')}
        </div>
      </aside>

      <main className="main">
        <header className="screen-head lib-screen-head" style={{ background: 'transparent', borderBottom: 0, paddingBottom: 0 }}>
          <div className="lib-top">
            <div className="lib-title-row">
              <h1 style={{ fontSize: 34, marginBottom: 7 }}>{t('library.songs')}</h1>
              <div style={{ fontSize: 13, color: 'var(--dim)' }}>
                {t('library.countOf', { shown: rows.length, total: songs.length, group: active.label })}
              </div>
            </div>

            <div className="lib-tools">
              <div className="search">
                <Icon name="search" size={14} />
                <input
                  className="field"
                  aria-label={t('library.searchAria')}
                  placeholder={t('library.searchPlaceholder')}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                />
              </div>
              <button
                className="btn"
                aria-expanded={importing}
                onClick={() => { setCreating(false); setImporting(true); }}
              >
                <Icon name="globe" size={15} />
                {t('import.button')}
              </button>
            </div>
          </div>

          <div className="chip-row show-sm" style={{ marginTop: 14 }}>
            {GROUPS.map((g) => (
              <button
                key={g.id}
                className={'chip' + (group === g.id ? ' is-on' : '')}
                style={{ height: 28, fontSize: 11.5, padding: '0 11px' }}
                onClick={() => setGroup(g.id)}
              >
                {g.label}
              </button>
            ))}
          </div>

          <div className="chip-row" style={{ marginTop: 16 }}>
            <span className="eyebrow hide-sm" style={{ marginInlineEnd: 3 }}>{t('common.key')}</span>
            {keys.map((k) => (
              <button
                key={k}
                className={'chip mono' + (key === k ? ' is-on' : '')}
                style={{ '--h': k === 'all' ? 199 : keyHue(k) }}
                onClick={() => setKey(k)}
              >
                {k === 'all' ? allKeyLabel : k}
              </button>
            ))}
          </div>
        </header>

        <div className="lib-head" style={{ marginTop: 18 }}>
          <span>{t('common.key')}</span>
          <span>{t('common.title')}</span>
          <span>{t('common.tempo')}</span>
          <span className="right">{t('common.time')}</span>
          <span>{t('library.lastPlayed')}</span>
          <span />
        </div>

        <div className="scroll" style={{ padding: '6px 20px 30px' }}>
          {rows.map((s) => (
            <div key={s.id} className="lib-row">
              <button
                type="button"
                className="lib-row-open"
                onClick={() => navigate(`/song/${s.id}`)}
              >
                <SongArt song={s} />

                <span className="grow" style={{ display: 'flex', flexDirection: 'column', gap: 2, textAlign: 'start' }}>
                  <span className="title-line">
                    <span className="set-title truncate">{s.title}</span>
                    {/* A capo belongs to the title, not to the small print: it
                        changes what the guitarist has to do before the first
                        chord, so it rides beside the name where the eye lands. */}
                    {s.capo > 0 && (
                      <span className="capo-mark" title={t('common.capoWith', { capo: s.capo })}>
                        <Icon name="capo" size={11} />
                        <span>{t('common.capoShort', { capo: s.capo })}</span>
                      </span>
                    )}
                    {s.needsWork && <span className="tag tag-work">{t('common.needsWork')}</span>}
                  </span>
                  <span className="title-line" style={{ gap: 7 }}>
                    <span className="set-artist truncate">{s.artist}</span>
                    <span
                      className="key-badge lib-key mono"
                      style={hue(songKey(s))}
                      title={s.capo ? t('common.capoWith', { capo: s.capo }) : undefined}
                    >
                      {songKey(s)}
                    </span>
                    {s.sections.length === 0 && <span className="tag tag-flat">{t('common.noChart')}</span>}
                  </span>
                </span>

                <span className="lib-tempo set-bpm">{s.bpm} <i>{t('common.bpm')}</i></span>
                <span className="lib-time set-dur">{mmss(s.sec)}</span>
                <span className="lib-last" style={{ fontSize: 12, color: 'var(--faint)' }}>{s.lastPlayed || t('common.never')}</span>
              </button>

              <div className="lib-actions">
                {isDeletableSong(s) && (
                  <button
                    type="button"
                    className="icon-btn bordered lib-del"
                    aria-label={t('library.remove', { title: s.title })}
                    onClick={() => removeSong(s)}
                  >
                    <Icon name="trash" size={13} />
                  </button>
                )}
                <span className="go" aria-hidden><Icon name="arrow" size={13} /></span>
              </div>
            </div>
          ))}

          {rows.length === 0 && !creating && (
            <div className="empty empty-plain">
              <Icon name="search" size={32} style={{ color: 'var(--fainter)' }} />
              <p>{songs.length === 0 ? t('library.emptyNone') : t('library.empty')}</p>
              {songs.length > 0 && (
                <button
                  className="ghost"
                  onClick={() => {
                    setQuery('');
                    setGroup('all');
                    setKey('all');
                  }}
                >
                  {t('library.resetFilters')}
                </button>
              )}
            </div>
          )}
        </div>
      </main>

      {creating && <div className="sheet-scrim" onClick={() => setCreating(false)} />}

      <SongImportSheet
        open={importing}
        songs={songs}
        onClose={() => setImporting(false)}
        onImport={(song) => dispatch({ type: 'add-to-library', song })}
        dispatch={dispatch}
        notify={notify}
        locale={locale}
      />

      {creating && (
        <aside className="aside is-sheet slidein" style={{ width: 300, flex: '0 0 300px' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <div className="eyebrow">{t('library.newSongTitle')}</div>
            <button className="icon-btn" aria-label={t('common.cancel')} onClick={() => setCreating(false)}>
              <Icon name="close" size={14} />
            </button>
          </div>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="eyebrow">{t('common.title')}</span>
            <input
              className="field"
              autoFocus
              value={draft.title}
              placeholder={t('library.titlePlaceholder')}
              onChange={(e) => setDraft((d) => ({ ...d, title: e.target.value }))}
              onKeyDown={(e) => e.key === 'Enter' && createSong()}
            />
          </label>

          <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="eyebrow">{t('library.artist')}</span>
            <input
              className="field"
              value={draft.artist}
              onChange={(e) => setDraft((d) => ({ ...d, artist: e.target.value, own: e.target.value.trim() === BAND.name }))}
            />
          </label>

          <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
            <span className="eyebrow">{t('common.key')}</span>
            <div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>
              {KEYS.map((k) => (
                <button
                  key={k}
                  className={'chip mono' + (draft.key === k ? ' is-on' : '')}
                  aria-pressed={draft.key === k}
                  onClick={() => setDraft((d) => ({ ...d, key: k }))}
                >
                  {k}
                </button>
              ))}
            </div>
          </div>

          <div style={{ display: 'flex', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
              <span className="eyebrow">{t('common.tempo')}</span>
              <input
                className="field mono"
                type="number"
                min="20"
                max="320"
                value={draft.bpm}
                onChange={(e) => setDraft((d) => ({ ...d, bpm: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
              <span className="eyebrow">{t('library.length')}</span>
              <input
                className="field mono"
                value={draft.length}
                placeholder="3:30"
                onChange={(e) => setDraft((d) => ({ ...d, length: e.target.value }))}
                onKeyDown={(e) => e.key === 'Enter' && createSong()}
              />
            </label>
          </div>

          <div style={{ display: 'flex', gap: 6 }}>
            {[[true, t('common.original')], [false, t('common.cover')]].map(([v, label]) => (
              <button
                key={label}
                className={'chip' + (draft.own === v ? ' is-on' : '')}
                style={{ flex: 1 }}
                aria-pressed={draft.own === v}
                onClick={() => setDraft((d) => ({ ...d, own: v }))}
              >
                {label}
              </button>
            ))}
          </div>

          <button className="btn btn-lg btn-block" disabled={!!problem} onClick={createSong}>
            {t('library.addToLibrary')}
          </button>
          <p style={{ margin: '-8px 0 0', fontSize: 11, color: problem ? 'var(--warn)' : 'var(--fainter)', textAlign: 'center', lineHeight: 1.5 }}>
            {problem || t('library.hintOk')}
          </p>
        </aside>
      )}
    </>
  );
}
