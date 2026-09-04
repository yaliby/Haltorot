import React, { useState, useMemo, useRef, useEffect } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { SongArt } from '../components/SongArt.jsx';
import { useStore, useRooms } from '../store.jsx';
import { useI18n } from '../i18n/index.js';
import { BAND } from '../data.js';
import { InstanceKeyCell, InstanceKeyPicker } from '../components/InstanceKeyPicker.jsx';
import { hue, memberHue, tempoHue } from '../lib/hues.js';
import { eventSongSteps, instanceKey, songKey } from '../lib/chords.js';
import { monthName, parseISO, longDate, weekdayOf, mmss, runtime, relative, isISODate, timeSpan } from '../lib/dates.js';

export default function RehearsalScreen() {
  const { date } = useParams();
  const navigate = useNavigate();
  const { events, songs, today, dispatch, notify, locale } = useStore();
  const rooms = useRooms();
  const { t, role } = useI18n();

  const [query, setQuery] = useState('');
  const [poolQuery, setPoolQuery] = useState('');
  const [picked, setPicked] = useState(null);
  const [pickSteps, setPickSteps] = useState(0);
  const [mode, setMode] = useState('info');
  const [form, setForm] = useState(null);
  const [drag, setDrag] = useState({ from: null, to: null });
  const dropTo = useRef(null);
  const dragFrom = useRef(null);

  const event = events[date];
  const byId = useMemo(() => Object.fromEntries(songs.map((s) => [s.id, s])), [songs]);

  const attLabel = (status) => {
    if (status === 'late') return t('rehearsal.attLate');
    if (status === 'out') return t('rehearsal.attOut');
    if (status === 'in') return t('rehearsal.attIn');
    return t('rehearsal.attUnset');
  };

  if (!isISODate(date)) {
    return (
      <main className="main">
        <div className="empty empty-plain">
          <Icon name="calendar" size={32} style={{ color: 'var(--fainter)' }} />
          <p>{t('rehearsal.invalidDate', { date })}</p>
          <Link to="/" className="ghost">{t('rehearsal.backCalendar')}</Link>
        </div>
      </main>
    );
  }

  function book(kind) {
    dispatch({
      type: 'create-rehearsal',
      date,
      kind,
      time: kind === 's' ? '21:00' : '20:00',
      end: kind === 's' ? '23:59' : '23:00',
      place: kind === 's' ? rooms[rooms.length - 1] : rooms[0]
    });
    const msg = kind === 's'
      ? t('rehearsal.addedShow', { date: longDate(date, locale) })
      : t('rehearsal.addedRehearsal', { date: longDate(date, locale) });
    notify(msg, { events });
  }

  if (!event) {
    return (
      <main className="main">
        <div className="empty empty-plain">
          <Icon name="calendar" size={32} style={{ color: 'var(--fainter)' }} />
          <p>{t('rehearsal.nothingBooked', { date: longDate(date, locale) })}</p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
            <button className="btn" onClick={() => book('r')}>
              <Icon name="plus" size={15} />
              {t('rehearsal.bookRehearsal')}
            </button>
            <button className="ghost" onClick={() => book('s')}>{t('rehearsal.bookShow')}</button>
          </div>
          <Link to="/" className="ghost">{t('rehearsal.backCalendar')}</Link>
        </div>
      </main>
    );
  }

  const setSongs = event.songs.map((id) => byId[id]).filter(Boolean);
  const totalSec = setSongs.reduce((a, s) => a + s.sec, 0);
  const q = query.trim().toLowerCase();
  const filtering = q.length > 0;
  const visible = setSongs
    .map((s, i) => ({ ...s, index: i, instanceSteps: eventSongSteps(event, s.id) }))
    .filter((s) => !q || `${s.title} ${s.artist} ${songKey(s)} ${instanceKey(s, s.instanceSteps)}`.toLowerCase().includes(q));

  const pq = poolQuery.trim().toLowerCase();
  const pool = songs
    .filter((s) => !event.songs.includes(s.id))
    .filter((s) => !pq || `${s.title} ${s.artist} ${songKey(s)}`.toLowerCase().includes(pq));
  const isShow = event.kind === 's';
  const { m } = parseISO(date);

  const attendance = event.att || {};
  const nextStatus = { undefined: 'in', in: 'late', late: 'out', out: '' };
  const keyTally = setSongs.reduce((acc, s) => {
    const k = instanceKey(s, eventSongSteps(event, s.id));
    return { ...acc, [k]: (acc[k] || 0) + 1 };
  }, {});

  function move(from, to) {
    if (from === null || to === null || to === from || to === from + 1) return;
    dispatch({ type: 'reorder', date, from, to });
  }

  function onDrop() {
    const from = dragFrom.current;
    const to = dropTo.current;
    setDrag({ from: null, to: null });
    dragFrom.current = null;
    dropTo.current = null;
    move(from, to);
  }

  function remove(song) {
    dispatch({ type: 'remove-song', date, songId: song.id });
    notify(t('rehearsal.removed', { title: song.title }), { events });
  }

  function add(song, steps = 0) {
    dispatch({ type: 'add-song', date, songId: song.id, steps });
    notify(t('rehearsal.addedToSet', { title: song.title }), { events });
  }

  function pick(song) {
    setPicked(song);
    setPickSteps(0);
  }

  function cancelPick() {
    setPicked(null);
    setPickSteps(0);
  }

  function confirmPick() {
    if (!picked) return;
    add(picked, pickSteps);
    cancelPick();
  }

  function closeSheet() {
    setMode('info');
    cancelPick();
  }

  function openEdit() {
    setForm({ kind: event.kind, time: event.time, end: event.end || '', place: event.place });
    setMode('edit');
  }

  function saveEdit() {
    dispatch({
      type: 'update-rehearsal',
      date,
      patch: { ...form, place: form.place.trim() || event.place, time: form.time || event.time }
    });
    setMode('info');
    notify(t('rehearsal.detailsUpdated'), { events });
  }

  function removeRehearsal() {
    dispatch({ type: 'delete-rehearsal', date });
    notify(
      isShow
        ? t('rehearsal.deletedShow', { date: longDate(date, locale) })
        : t('rehearsal.deletedRehearsal', { date: longDate(date, locale) }),
      { events }
    );
    navigate('/');
  }

  return (
    <>
      <main className="main reh-main">
        <header className="screen-head">
          <Link to="/" className="back" style={{ marginBottom: 14 }}>
            <Icon name="left" size={13} />
            {monthName(m, locale)} {parseISO(date).y}
          </Link>

          <div className="reh-head">
            <div className="reh-head-main">
              <div className="reh-kind">
                {/* The badge names the kind; "tonight" is already in the
                    relative day beside it, so it isn't said twice. */}
                <span className={'badge' + (isShow ? ' show' : '')}>
                  {isShow ? t('common.showBadge') : t('common.rehearsalBadge')}
                </span>
                <span>{weekdayOf(date, locale)} · {relative(date, today, locale)}</span>
              </div>

              {/* The back link carries the month and year, so the title is
                  only the day. */}
              <h1 className="screen-title">{longDate(date, locale)}</h1>

              <div className="meta-row">
                <span className="strong"><bdi>{timeSpan(event.time, event.end)}</bdi></span>
                <span className="sep">·</span>
                <span>{event.place}</span>
                {totalSec > 0 && (
                  <>
                    <span className="sep">·</span>
                    <span className="mono">~{runtime(totalSec, locale)}</span>
                  </>
                )}
              </div>

              <div className="reh-ctl">
                <button className="ghost" onClick={openEdit}>
                  {t('rehearsal.editDetails')}
                </button>
              </div>
            </div>

            {setSongs.length > 0 && (
              <div className="head-actions">
                <button className="btn btn-lg" onClick={() => navigate(`/song/${setSongs[0].id}?from=${date}`)}>
                  <Icon name="play" size={15} />
                  {t('rehearsal.startRun')}
                </button>
              </div>
            )}
          </div>
        </header>

        <div className="set-wrap">
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 14, flexWrap: 'wrap' }}>
            <h2 style={{ fontSize: 16, fontWeight: 600, letterSpacing: '-0.01em' }}>{t('rehearsal.setlist')}</h2>
            {setSongs.length > 0 && (
              <div style={{ marginInlineStart: 'auto', display: 'flex', alignItems: 'center', gap: 9 }}>
                <div className="search hide-sm">
                  <Icon name="search" size={14} />
                  <input
                    className="field"
                    style={{ width: 200, height: 34 }}
                    placeholder={t('rehearsal.filterSongs')}
                    aria-label={t('rehearsal.filterSetlist')}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <button
                  className={'ghost' + (mode === 'add' ? ' is-on' : '')}
                  aria-expanded={mode === 'add'}
                  onClick={() => {
                    if (mode === 'add') closeSheet();
                    else { cancelPick(); setMode('add'); }
                  }}
                >
                  <Icon name="plus" size={14} />
                  {t('rehearsal.addSong')}
                </button>
              </div>
            )}
          </div>

          {setSongs.length > 0 && (
            <div className="set-head">
              <span>{t('rehearsal.colTitle')}</span>
              <span>{t('common.key')}</span>
              <span>{t('common.tempo')}</span>
              <span className="right">{t('common.time')}</span>
              <span />
              <span />
            </div>
          )}

          <div className="scroll" style={{ padding: '6px 0 26px' }}>
            {visible.map((s) => {
              const playKey = instanceKey(s, s.instanceSteps);
              const cls = [
                'set-row',
                drag.from === s.index && 'is-dragging',
                drag.from !== null && drag.to === s.index && drag.from !== s.index && 'is-over',
                drag.from !== null && drag.to === setSongs.length && s.index === setSongs.length - 1 && 'is-over-after'
              ]
                .filter(Boolean)
                .join(' ');

              return (
                <div
                  key={s.id}
                  className={cls}
                  draggable={!filtering}
                  onDragStart={(e) => {
                    if (filtering) return;
                    dragFrom.current = s.index;
                    e.dataTransfer.effectAllowed = 'move';
                    try { e.dataTransfer.setData('text/plain', String(s.index)); } catch { /* Safari */ }
                    setDrag({ from: s.index, to: null });
                  }}
                  onDragOver={(e) => {
                    if (dragFrom.current === null) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = 'move';
                    const box = e.currentTarget.getBoundingClientRect();
                    const to = s.index + (e.clientY > box.top + box.height / 2 ? 1 : 0);
                    dropTo.current = to;
                    setDrag((d) => (d.to === to ? d : { ...d, to }));
                  }}
                  onDrop={(e) => { e.preventDefault(); onDrop(); }}
                  onDragEnd={() => { dragFrom.current = null; dropTo.current = null; setDrag({ from: null, to: null }); }}
                >
                  <div className="set-body grow">
                    <button
                      className="set-open"
                      onClick={() => navigate(`/song/${s.id}?from=${date}`)}
                    >
                      <SongArt song={s} fallback="note" />
                      <span className="set-lines">
                        <span className="title-line">
                          <span className="set-num" style={{ width: 'auto' }}>{String(s.index + 1).padStart(2, '0')}</span>
                          <span className="set-title truncate">{s.title}</span>
                          {s.needsWork && <span className="tag tag-work">{t('common.needsWork')}</span>}
                        </span>
                        <span className="title-line" style={{ gap: 7 }}>
                          <span className="set-artist truncate">{s.artist}</span>
                          <span className="show-sm key-badge" style={hue(playKey)}>{playKey}</span>
                          <span className="show-sm mono" style={{ fontSize: 11, color: 'var(--faint)' }}>{s.bpm} {t('common.bpm')}</span>
                        </span>
                      </span>
                    </button>
                  </div>

                  <InstanceKeyCell song={s} steps={s.instanceSteps} />

                  <div className="set-tempo">
                    <span className="tempo-dot" style={tempoHue(s.bpm)} />
                    <span className="set-bpm">{s.bpm}</span>
                  </div>

                  <div className="set-time set-dur">{mmss(s.sec)}</div>

                  {/* The reorder handle sits at the far end of the row: the
                      cover leads it, the way it leads a library row. */}
                  <div className="set-lead">
                    <button
                      className="grip hide-sm"
                      aria-label={t('rehearsal.reorder', { title: s.title })}
                      title={t('rehearsal.reorderHint')}
                      disabled={filtering}
                      onKeyDown={(e) => {
                        if (e.key === 'ArrowUp') { e.preventDefault(); move(s.index, s.index - 1); }
                        if (e.key === 'ArrowDown') { e.preventDefault(); move(s.index, s.index + 2); }
                      }}
                    >
                      <Icon name="grip" size={13} />
                    </button>
                    <button
                      className="move show-sm"
                      aria-label={t('rehearsal.moveUp', { title: s.title })}
                      disabled={filtering || s.index === 0}
                      onClick={() => move(s.index, s.index - 1)}
                    >
                      <Icon name="up" size={13} />
                    </button>
                    <button
                      className="move show-sm"
                      aria-label={t('rehearsal.moveDown', { title: s.title })}
                      disabled={filtering || s.index === setSongs.length - 1}
                      onClick={() => move(s.index, s.index + 2)}
                    >
                      <Icon name="down" size={13} />
                    </button>
                  </div>

                  <div className="set-actions">
                    <button className="kill" aria-label={t('rehearsal.remove', { title: s.title })} onClick={() => remove(s)}>
                      {t('rehearsal.removeButton')}
                      <Icon name="close" size={13} />
                    </button>
                  </div>
                </div>
              );
            })}

            {setSongs.length === 0 && (
              <div className="empty empty-plain">
                <Icon name="music" size={30} style={{ color: 'var(--fainter)' }} />
                <p>{t('rehearsal.emptySet')}</p>
                <button className="btn" onClick={() => setMode('add')}>
                  <Icon name="plus" size={15} />
                  {t('rehearsal.addSong')}
                </button>
              </div>
            )}

            {setSongs.length > 0 && visible.length === 0 && (
              <div className="empty empty-plain">
                <Icon name="search" size={30} style={{ color: 'var(--fainter)' }} />
                <p>{t('rehearsal.noMatch', { q: query })}</p>
                <button className="ghost" onClick={() => setQuery('')}>{t('rehearsal.clearFilter')}</button>
              </div>
            )}
          </div>
        </div>
      </main>

      {mode !== 'info' && <div className="sheet-scrim" onClick={closeSheet} />}

      <aside
        className={'aside' + (mode === 'info' ? '' : ' is-sheet')}
        style={{ width: 326, flex: '0 0 326px' }}
      >
        {mode === 'add' ? (
          picked ? (
            <InstanceKeyPicker
              song={picked}
              steps={pickSteps}
              onSteps={setPickSteps}
              onCancel={cancelPick}
              onConfirm={confirmPick}
              confirmLabel={t('rehearsal.addSong')}
            />
          ) : (
          <div className="slidein" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="eyebrow">{t('rehearsal.addFromLibrary')}</div>
              <button className="icon-btn" aria-label={t('common.close')} onClick={closeSheet}>
                <Icon name="close" size={14} />
              </button>
            </div>

            <div className="search">
              <Icon name="search" size={14} />
              <input
                className="field"
                placeholder={t('rehearsal.searchLibrary')}
                aria-label={t('rehearsal.searchLibrary')}
                value={poolQuery}
                onChange={(e) => setPoolQuery(e.target.value)}
              />
            </div>

            {pool.length ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 3, overflowY: 'auto' }}>
                {pool.map((s) => (
                  <button key={s.id} className="mini-row" style={{ margin: 0, width: '100%', padding: 10 }} onClick={() => pick(s)}>
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
                  ? t('rehearsal.poolNoMatch', { q: poolQuery })
                  : t('rehearsal.poolAllInSet')}
              </p>
            )}
          </div>
          )
        ) : mode === 'edit' ? (
          <div className="slidein" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div className="eyebrow">{t('rehearsal.editDetails')}</div>
              <button className="icon-btn" aria-label={t('common.close')} onClick={() => setMode('info')}>
                <Icon name="close" size={14} />
              </button>
            </div>

            <div style={{ display: 'flex', gap: 6 }}>
              {[['r', t('common.rehearsal')], ['s', t('common.show')]].map(([k, label]) => (
                <button
                  key={k}
                  className={'chip' + (form.kind === k ? ' is-on' : '')}
                  style={{ flex: 1 }}
                  aria-pressed={form.kind === k}
                  onClick={() => setForm((f) => ({ ...f, kind: k }))}
                >
                  {label}
                </button>
              ))}
            </div>

            <div style={{ display: 'flex', gap: 8 }}>
              <label style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                <span className="eyebrow">{t('calendar.startTime')}</span>
                <input
                  type="time"
                  className="field mono"
                  value={form.time}
                  onChange={(e) => setForm((f) => ({ ...f, time: e.target.value }))}
                />
              </label>

              <label style={{ display: 'flex', flexDirection: 'column', gap: 7, flex: 1 }}>
                <span className="eyebrow">{t('calendar.endTime')}</span>
                <input
                  type="time"
                  className="field mono"
                  value={form.end}
                  onChange={(e) => setForm((f) => ({ ...f, end: e.target.value }))}
                />
              </label>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
              <span className="eyebrow">{t('calendar.room')}</span>
              <input
                className="field"
                list="rooms"
                value={form.place}
                placeholder={t('rehearsal.roomPlaceholder')}
                onChange={(e) => setForm((f) => ({ ...f, place: e.target.value }))}
              />
              <datalist id="rooms">
                {rooms.map((r) => <option key={r} value={r} />)}
              </datalist>
            </label>

            <button className="btn btn-lg btn-block" onClick={saveEdit}>{t('rehearsal.saveChanges')}</button>
            <button className="ghost danger" onClick={removeRehearsal}>
              <Icon name="trash" size={14} />
              {isShow ? t('rehearsal.deleteShow') : t('rehearsal.deleteRehearsal')}
            </button>
          </div>
        ) : (
          <>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
              <div className="eyebrow">{t('rehearsal.whosComing')}</div>
              <div>
                {BAND.members.map((m2) => {
                  const status = attendance[m2.id];
                  return (
                    <div className="att-row" key={m2.id}>
                      <div className="avatar" style={{ width: 30, height: 30, marginInlineStart: 0, borderColor: 'transparent', ...memberHue(m2) }}>{m2.initials}</div>
                      <div className="grow">
                        <div style={{ fontSize: 12.5, fontWeight: 500, color: 'var(--ink-soft)' }}>{m2.name}</div>
                        <div style={{ fontSize: 10.5, color: 'var(--fainter)' }}>{role(m2.role)}</div>
                      </div>
                      <button
                        className={'att-status ' + (status || 'unset')}
                        title={t('rehearsal.attTap', { name: m2.name })}
                        aria-label={t('rehearsal.attChange', { name: m2.name, status: attLabel(status) })}
                        onClick={() =>
                          dispatch({ type: 'set-attendance', date, member: m2.id, status: nextStatus[status] })
                        }
                      >
                        {attLabel(status)}
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>

            {setSongs.length > 0 && (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                <div className="eyebrow">{t('rehearsal.keysInSet')}</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                  {Object.entries(keyTally).map(([k, n]) => (
                    <span
                      key={k}
                      className={'key-badge' + (n > 1 ? ' is-twice' : '')}
                      style={{ ...hue(k), fontSize: 11 }}
                    >
                      {k} ×{n}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </>
        )}
      </aside>
    </>
  );
}
