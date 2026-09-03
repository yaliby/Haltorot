import React, { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon.jsx';
import { Loader } from './Loader.jsx';
import { useI18n } from '../i18n/index.js';
import { mmss } from '../lib/dates.js';
import { searchSongs, importChart, artworkAt } from '../lib/songImport.js';
import { songSlug, sameSongEntry } from '../lib/text.js';
import { isDeletableSong } from '../lib/songs.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('import-ui');

export function SongImportSheet({ open, songs, onClose, onImport, dispatch, notify, locale }) {
  const { t } = useI18n();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [importing, setImporting] = useState(null);
  const [error, setError] = useState('');
  const timer = useRef(null);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
      setImporting(null);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    clearTimeout(timer.current);
    const q = query.trim();
    if (!q || q.length < 2) {
      setResults([]);
      setLoading(false);
      setError('');
      return;
    }

    setLoading(true);
    setError('');
    timer.current = setTimeout(() => {
      log.debug('search debounced', { q, locale });
      searchSongs(q, { locale })
        .then((rows) => {
          setResults(rows);
          setLoading(false);
          if (!rows.length) setError(t('import.empty'));
        })
        .catch((err) => {
          log.error('search error', { q, error: err.message });
          setResults([]);
          setLoading(false);
          setError(t('import.searchFailed'));
        });
    }, 320);

    return () => clearTimeout(timer.current);
  }, [query, t, locale]);

  async function add(hit) {
    log.info('user picked hit', { title: hit.title, artist: hit.artist, sec: hit.sec });

    const existing = songs.find((s) => sameSongEntry(s, hit));
    if (existing) {
      if (!isDeletableSong(existing)) {
        log.warn('duplicate blocked (built-in)', { id: existing.id, title: existing.title });
        setError(t('library.errDuplicate'));
        return;
      }
      log.info('replacing existing entry', { id: existing.id, title: existing.title });
      dispatch({ type: 'remove-from-library', songId: existing.id });
    }

    setImporting(`${hit.title}::${hit.artist}`);
    setError('');
    try {
      const chart = await importChart(hit.title, hit.artist);
      const song = {
        id: songSlug(hit.title, new Set(songs.map((s) => s.id))),
        title: hit.title.trim(),
        artist: hit.artist.trim(),
        key: chart.key || '?',
        bpm: chart.bpm || 100,
        sec: hit.sec,
        artwork: artworkAt(hit.artwork, 200),
        capo: chart.capo || 0,
        timeSig: '4/4',
        own: false,
        sections: chart.sections,
        needsWork: false,
        lastPlayed: t('common.never'),
        importSource: chart.source,
        importUrl: chart.sourceUrl
      };
      log.info('adding to library', {
        id: song.id,
        title: song.title,
        artist: song.artist,
        source: song.importSource,
        sections: song.sections.length
      });
      onImport(song);
      notify(t('import.added', { title: song.title }), { songs });
      onClose();
    } catch (e) {
      log.error('import flow failed', { title: hit.title, artist: hit.artist, error: e.message });
      setError(
        e.message === 'no chord tabs found'
          ? t('import.noChords')
          : e.message === 'import endpoint missing'
            ? t('import.endpointMissing')
            : t('import.failed')
      );
    } finally {
      setImporting(null);
    }
  }

  if (!open) return null;

  return (
    <>
      <div className="sheet-scrim" onClick={onClose} />
      <aside className="aside is-sheet slidein import-sheet" style={{ width: 360, flex: '0 0 360px' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <div className="eyebrow">{t('import.eyebrow')}</div>
            <div style={{ fontSize: 15, fontWeight: 600, marginTop: 4 }}>{t('import.title')}</div>
          </div>
          <button className="icon-btn" aria-label={t('common.cancel')} onClick={onClose}>
            <Icon name="close" size={14} />
          </button>
        </div>

        <p style={{ margin: 0, fontSize: 12, color: 'var(--dim)', lineHeight: 1.55 }}>{t('import.hint')}</p>

        <div className="search">
          <Icon name="search" size={14} />
          <input
            className="field"
            autoFocus
            aria-label={t('import.searchAria')}
            placeholder={t('import.searchPlaceholder')}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        {loading && (
          <p className="import-status">
            <Loader size={16} />
            {t('import.searching')}
          </p>
        )}

        <div className="import-results">
          {results.map((hit) => {
            const busy = importing === `${hit.title}::${hit.artist}`;
            return (
              <button
                key={`${hit.title}-${hit.artist}-${hit.sec}`}
                className="import-hit"
                disabled={!!importing}
                onClick={() => add(hit)}
              >
                {hit.artwork ? (
                  <img className="import-art" src={hit.artwork} alt="" width={44} height={44} />
                ) : (
                  <span className="import-art import-art-fallback">
                    <Icon name="music" size={18} />
                  </span>
                )}
                <span className="import-hit-main">
                  <span className="import-hit-title truncate">{hit.title}</span>
                  <span className="import-hit-artist truncate">{hit.artist}</span>
                  <span className="import-hit-meta">
                    {mmss(hit.sec)}
                    {hit.album ? ` · ${hit.album}` : ''}
                  </span>
                </span>
                <span className="import-hit-action">
                  {busy ? <Loader size={13} /> : null}
                  {busy ? t('import.fetching') : t('import.add')}
                </span>
              </button>
            );
          })}
        </div>

        {error && <p className="import-status import-error">{error}</p>}

        <p className="import-poc">{t('import.pocNote')}</p>
      </aside>
    </>
  );
}
