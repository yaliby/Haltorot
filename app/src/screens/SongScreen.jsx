import React, { useState, useEffect, useMemo, useCallback } from 'react';
import { useParams, useNavigate, useSearchParams, Link } from 'react-router-dom';
import { Icon } from '../components/Icon.jsx';
import { useStore } from '../store.jsx';
import { useI18n } from '../i18n/index.js';
import { BAND } from '../data.js';
import { hue, memberHue, tempoHue } from '../lib/hues.js';
import { bunkerSongSteps, eventSongSteps, instanceKey, transpose, chordsUsed, songKey } from '../lib/chords.js';
import { longDate, mmss, isISODate } from '../lib/dates.js';
import { consumeNoteAutoShow } from '../lib/sessionNotes.js';
import { hasHebrew } from '../lib/text.js';
import { isDeletableSong } from '../lib/songs.js';
import { freezeUndo } from '../lib/undo.js';
import {
  readSections, writeSections, splitLine, isAlignable, moveChord, nudgeChord
} from '../lib/chordEdit.js';

export default function SongScreen() {
  const { id } = useParams();
  const [params] = useSearchParams();
  const from = params.get('from');
  const navigate = useNavigate();
  const { songs, events, dispatch, notify, locale } = useStore();
  const { t } = useI18n();

  const [steps, setSteps] = useState(0);
  const [capoOff, setCapoOff] = useState(false);
  const [scale, setScale] = useState(1);
  const [stage, setStage] = useState(false);
  const [showChords, setShowChords] = useState(true);
  const [noteOpen, setNoteOpen] = useState(false);
  const [jumpOpen, setJumpOpen] = useState(false);
  /* Aligning works on a copy of the chart read back into lyrics-and-anchors,
     so a chord can be walked across a word and the whole thing still thrown
     away. `sel` is the chord in hand: which section, which line, which chord. */
  const [align, setAlign] = useState(false);
  const [draft, setDraft] = useState(null);
  const [sel, setSel] = useState(null);
  const notePopRef = React.useRef(null);
  const jumpRef = React.useRef(null);

  const song = songs.find((s) => s.id === id);
  const inSet = from && isISODate(from) && events[from] ? from : null;
  const event = inSet ? events[inSet] : null;
  /* The bunker is not a day, so it is never a set to run through — but it is
     somewhere the band opened the song from, and the way back leads there. */
  const fromBunker = from === 'bunker';
  const back = inSet ? `/rehearsal/${inSet}` : fromBunker ? '/bunker' : '/songs';
  /* Opening from a bunker or a setlist starts on that instance's key.
     Transposing on this screen is still local — it does not rewrite the song. */
  const instanceSteps = event
    ? eventSongSteps(event, id)
    : fromBunker
      ? bunkerSongSteps(song)
      : 0;

  const setSongs = useMemo(
    () => (event ? event.songs.map((sid) => songs.find((s) => s.id === sid)).filter(Boolean) : []),
    [event, songs]
  );
  const position = setSongs.findIndex((s) => s.id === id);
  const next = position >= 0 ? setSongs[position + 1] : null;
  const prev = position > 0 ? setSongs[position - 1] : null;
  const nextKey = next ? instanceKey(next, event ? eventSongSteps(event, next.id) : 0) : '';

  const go = useCallback(
    (target) => target && navigate(`/song/${target.id}${inSet ? `?from=${inSet}` : ''}`),
    [navigate, inSet]
  );

  /* Only a line with both a chord and words can be aligned — a row of intro
     chords has nothing underneath to line them up against. */
  const canAlign =
    !!song &&
    song.sections.some((sec) =>
      sec.lines.some((line) => line.some((g) => g.c) && line.some((g) => g.t && g.t.trim()))
    );

  const startAlign = useCallback(() => {
    if (!song) return;
    setDraft(readSections(song.sections));
    setSel(null);
    // Nothing to move if the chords are hidden, and nowhere to put a bar on stage.
    setShowChords(true);
    setStage(false);
    setJumpOpen(false);
    setNoteOpen(false);
    setAlign(true);
  }, [song]);

  // Walking into a song hands you the note first — once per tab session, even
  // across a refresh. Stepping to another song in a set is a first visit of
  // its own. The note button still opens it any time after that.
  const hasNote = !!song?.note;
  useEffect(() => {
    setSteps(instanceSteps);
    setCapoOff(false);
    setJumpOpen(false);
    setAlign(false);
    setDraft(null);
    setSel(null);
    setNoteOpen(hasNote && consumeNoteAutoShow('song', id));
  }, [id, hasNote, instanceSteps]);
  useEffect(() => { if (noteOpen) notePopRef.current?.focus(); }, [noteOpen]);

  useEffect(() => {
    if (!jumpOpen) return;
    const onPointer = (e) => {
      if (!jumpRef.current?.contains(e.target)) setJumpOpen(false);
    };
    document.addEventListener('pointerdown', onPointer);
    return () => document.removeEventListener('pointerdown', onPointer);
  }, [jumpOpen]);

  useEffect(() => {
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const tag = e.target.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;
      // Aligning has its own, much smaller keyboard.
      if (align) return;

      const map = {
        '+': () => setSteps((s) => Math.min(11, s + 1)),
        '=': () => setSteps((s) => Math.min(11, s + 1)),
        '-': () => setSteps((s) => Math.max(-11, s - 1)),
        '0': () => setSteps(0),
        ']': () => setScale((s) => Math.min(1.75, +(s + 0.12).toFixed(2))),
        '[': () => setScale((s) => Math.max(0.8, +(s - 0.12).toFixed(2))),
        f: () => setStage((v) => !v),
        c: () => setShowChords((v) => !v),
        e: () => canAlign && startAlign(),
        j: () => go(next),
        k: () => go(prev),
        Escape: () =>
          jumpOpen
            ? setJumpOpen(false)
            : noteOpen
              ? setNoteOpen(false)
              : stage
                ? setStage(false)
                : navigate(back)
      };
      const fn = map[e.key] || map[e.key.toLowerCase()];
      if (fn) { e.preventDefault(); fn(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [go, next, prev, stage, noteOpen, jumpOpen, back, navigate, align, canAlign, startAlign]);

  /* The chord in hand walks with the arrow keys — and a Hebrew line runs the
     other way, so "earlier in the words" is the other arrow. */
  const selLine = align && draft ? draft[sel?.si]?.lines[sel?.li] : null;
  const selRtl = selLine ? hasHebrew(selLine.text) : false;

  const stopAlign = useCallback(() => {
    setAlign(false);
    setDraft(null);
    setSel(null);
  }, []);

  /* Every move is the same shape: rewrite one line of the draft in place. */
  const editLine = useCallback((si, li, fn) => {
    setDraft((d) =>
      d.map((sec, i) =>
        i !== si ? sec : { ...sec, lines: sec.lines.map((ln, j) => (j === li ? fn(ln) : ln)) }
      )
    );
  }, []);

  const nudge = useCallback(
    (delta) => { if (sel) editLine(sel.si, sel.li, (ln) => nudgeChord(ln, sel.ci, delta)); },
    [sel, editLine]
  );

  /* Tapping a letter is the precise move: the chord in hand lands on exactly
     that character. Taps on another line are ignored — picking a chord up and
     dropping it in a different line is not a move, it is a mistake. */
  const place = useCallback(
    (si, li, at) => {
      if (!sel || sel.si !== si || sel.li !== li) return;
      editLine(si, li, (ln) => moveChord(ln, sel.ci, at));
    },
    [sel, editLine]
  );

  useEffect(() => {
    if (!align) return;
    const onKey = (e) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'Escape') { e.preventDefault(); stopAlign(); return; }
      if (!sel) return;
      if (e.key === (selRtl ? 'ArrowRight' : 'ArrowLeft')) { e.preventDefault(); nudge(-1); }
      else if (e.key === (selRtl ? 'ArrowLeft' : 'ArrowRight')) { e.preventDefault(); nudge(1); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [align, sel, selRtl, nudge, stopAlign]);

  if (!song) {
    return (
      <main className="main">
        <div className="empty empty-plain">
          <p>{t('song.notFound')}</p>
          <Link to="/songs" className="ghost">{t('song.backSongs')}</Link>
        </div>
      </main>
    );
  }

  const chordRow = showChords ? 18 : 0;
  /* Two separate things. Transposing moves the song, so the key on the badge
     moves with it. Taking the capo off moves only the shapes — the same song
     in the same key, played where the capo was standing. */
  const capo = capoOff ? 0 : song.capo;
  const shift = steps + (capoOff ? song.capo : 0);
  const displayKey = transpose(songKey(song), steps);
  const chords = chordsUsed(song.sections, shift);
  const hasChart = song.sections.length > 0;
  const noteAuthor = BAND.members.find((m) => m.id === song.noteBy);
  const chartVars = { '--sc': scale, '--chord-row-base': `${chordRow}px` };
  const shiftLabel = steps ? (steps > 0 ? ` +${steps}` : ` ${steps}`) : '';

  const sections = align && draft ? draft : song.sections;
  const selChord = sel && selLine ? transpose(selLine.chords[sel.ci]?.c || '', shift) : '';

  const saveAlign = () => {
    const next = writeSections(draft);
    if (JSON.stringify(next) === JSON.stringify(song.sections)) {
      notify(t('song.alignUnchanged'));
    } else {
      const snapshot = freezeUndo({ songs });
      dispatch({ type: 'edit-chart', songId: song.id, sections: next });
      notify(t('song.alignSaved', { title: song.title }), snapshot);
    }
    stopAlign();
  };

  /* A line as it is read: fragments already cut, chords printed over them. */
  const viewLine = (line, li) => {
    const chordsOnly = line.every((seg) => !seg.t);
    /* An rtl line already lays its fragments out right to left,
       so they stay in reading order — don't reverse them too. */
    const lineRtl = line.some((seg) => hasHebrew(seg.t));
    return (
      <p key={li} className={'line' + (chordsOnly ? ' chords-only' : '')} dir={lineRtl ? 'rtl' : 'ltr'}>
        {line.map((seg, gi) => {
          const chord = transpose(seg.c, shift);
          return (
            <span className="chord-seg" key={gi}>
              <span className="c" style={hue(chord)}>{showChords ? chord : ' '}</span>
              <span className="t">{seg.t || ''}</span>
            </span>
          );
        })}
      </p>
    );
  };

  /* The same line while it is being aligned: every chord is a button to pick
     up, every letter a place to put it down. The letters stay plain spans on
     purpose — a button is an atomic inline box, and a Hebrew line made of five
     hundred of them would stop reading right to left. The arrows in the bar
     below are the keyboard's way in. */
  const alignLine = (model, si, li) => {
    const parts = splitLine(model);
    const alignable = isAlignable(model);
    const lineRtl = hasHebrew(model.text);
    const here = sel && sel.si === si && sel.li === li;

    const letters = (part) => {
      const out = [];
      let at = part.from;
      for (const ch of part.t) {
        const i = at;
        out.push(
          <span key={i} className="ed-ch" data-at={i} onClick={() => place(si, li, i)}>{ch}</span>
        );
        at += ch.length;
      }
      return out;
    };

    return (
      <p
        key={li}
        className={'line' + (alignable ? '' : ' chords-only') + (here ? ' is-held' : '')}
        dir={lineRtl ? 'rtl' : 'ltr'}
      >
        {parts.map((part, pi) => {
          const chord = transpose(part.c, shift);
          const held = here && sel.ci === part.ci;
          return (
            <span className={'chord-seg' + (held ? ' is-held' : '')} key={pi}>
              <span className="c" style={hue(chord)}>
                {part.c && alignable ? (
                  <button
                    type="button"
                    className={'ed-chord' + (held ? ' is-held' : '')}
                    aria-pressed={held}
                    aria-label={t('song.alignChord', { chord })}
                    onClick={() => setSel(held ? null : { si, li, ci: part.ci })}
                  >
                    {chord}
                  </button>
                ) : (
                  chord || ' '
                )}
              </span>
              <span className="t">{alignable ? letters(part) : part.t || ''}</span>
            </span>
          );
        })}
        {/* The far end of the line is a place too — a chord can ring out past
            the last word. */}
        {alignable && (
          <span className="chord-seg ed-tail">
            <span className="c"> </span>
            <span className="t">
              <span
                className="ed-ch ed-ch-end"
                data-at={model.text.length}
                title={t('song.alignEnd')}
                onClick={() => place(si, li, model.text.length)}
              />
            </span>
          </span>
        )}
      </p>
    );
  };

  const jumpTo = (i) => {
    setJumpOpen(false);
    const el = document.getElementById(`chart-sec-${i}`);
    if (!el) return;
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    el.scrollIntoView({ behavior: reduce ? 'auto' : 'smooth', block: 'start' });
  };

  return (
    <>
      {stage && (
        <div className="stage-bar">
          <button aria-label={t('song.smallerText')} style={{ fontSize: 13, fontWeight: 600 }} onClick={() => setScale((v) => Math.max(0.8, +(v - 0.12).toFixed(2)))}>A</button>
          <button aria-label={t('song.largerText')} style={{ fontSize: 18, fontWeight: 600 }} onClick={() => setScale((v) => Math.min(1.75, +(v + 0.12).toFixed(2)))}>A</button>
          <button
            className={showChords ? 'is-on' : ''}
            aria-label={t('song.showChords')}
            aria-pressed={showChords}
            onClick={() => setShowChords((v) => !v)}
          >
            <Icon name="lines" size={16} />
          </button>
          <button aria-label={t('song.exitStageAria')} onClick={() => setStage(false)}>
            <Icon name="close" size={16} />
          </button>
        </div>
      )}

      <main className={'main' + (stage ? ' is-stage' : '')}>
        <header className="song-head" style={stage ? { background: 'var(--bg)' } : undefined}>
          {!stage && (
            <Link to={back} className="back">
              <Icon name="left" size={13} />
              {inSet
                ? event.kind === 's'
                  ? t('song.backShow', { date: longDate(inSet, locale) })
                  : t('song.backRehearsal', { date: longDate(inSet, locale) })
                : fromBunker
                  ? t('nav.bunker')
                  : t('nav.songs')}
            </Link>
          )}

          {/* Title, then every fact about the song on one readable line.
              The tempo and capo used to sit in boxes at the far end of the
              header, pulling the eye away from the title they describe. */}
          <div className="song-headline">
            <div className="song-title-row">
              {position >= 0 && <span className="track-num">{String(position + 1).padStart(2, '0')}</span>}
              <h1 className="song-title" style={stage ? { fontSize: 30 } : undefined}>{song.title}</h1>
            </div>

            <div className="meta-row song-facts">
              <span>{song.artist}</span>
              <span className="sep">·</span>
              <span className="mono">{mmss(song.sec)}</span>
              {/* The time signature is the one fact a phone can spare. */}
              <span className="sep hide-sm">·</span>
              <span className="mono hide-sm">{song.timeSig}</span>
              <span className="sep">·</span>
              <span className="song-bpm">
                <span className="tick" style={{ animationDuration: `${60 / song.bpm}s`, ...tempoHue(song.bpm) }} />
                <span className="mono">{song.bpm}</span> {t('common.bpm')}
              </span>
              {/* A capo is only worth saying when there is one — but then it
                  is worth saying loudly, because the key beside it is the key
                  the room hears, not the one the chords are written in. */}
              {capo > 0 && (
                /* The dot travels with the chip: on a phone the chip wraps to
                   its own line, and a separator left behind reads as a fact
                   that went missing. */
                <span className="capo-fact">
                  <span className="sep">·</span>
                  <span className="capo-chip">
                    <Icon name="capo" size={13} />
                    {t('song.capoAt', { capo })}
                  </span>
                </span>
              )}
            </div>
          </div>

          <div className="song-ctl">
            {/* Value controls share the first row with the chords toggle,
                which sits in the gap once the type-size letters sit together.
                The remaining on/off toggles are their own group. */}
            <div className="ctl-group">
              <div className="seg seg-key">
                <button aria-label={t('song.transposeDown')} onClick={() => setSteps((s) => Math.max(-11, s - 1))}>
                  <Icon name="minus" size={14} />
                </button>
                <button
                  className="seg-label"
                  onClick={() => setSteps(0)}
                  title={t('song.keyReset')}
                  aria-label={
                    capo > 0
                      ? t('song.keyCapoAria', { key: displayKey, capo, shift: shiftLabel })
                      : t('song.keyAria', { key: displayKey, shift: shiftLabel })
                  }
                >
                  <small>
                    {steps === 0 ? 'KEY' : `KEY ${steps > 0 ? `+${steps}` : steps}`}
                  </small>
                  <strong className={steps ? 'is-set' : ''} style={hue(displayKey)}>{displayKey}</strong>
                </button>
                <button aria-label={t('song.transposeUp')} onClick={() => setSteps((s) => Math.min(11, s + 1))}>
                  <Icon name="plus" size={14} />
                </button>
              </div>

              <div className="seg seg-scale">
                <button className="scale-down" aria-label={t('song.smallerText')} onClick={() => setScale((s) => Math.max(0.8, +(s - 0.12).toFixed(2)))}>A</button>
                <button className="scale-up" aria-label={t('song.largerText')} onClick={() => setScale((s) => Math.min(1.75, +(s + 0.12).toFixed(2)))}>A</button>
              </div>

              <button
                className={'ghost ctl-chords' + (showChords ? ' is-on' : '')}
                aria-label={t('song.chords')}
                aria-pressed={showChords}
                /* Aligning needs the chords on screen, and stage mode has no
                   room for the bar — while a chord is in hand, both wait. */
                disabled={align}
                onClick={() => setShowChords((v) => !v)}
              >
                <Icon name="lines" size={14} />
                <span className="btn-label">{t('song.chords')}</span>
              </button>
            </div>

            <div className="ctl-toggles">
              {/* Says what it will do, in the words a guitarist would use:
                  take the capo off and play the shapes it stood in for. */}
              {song.capo > 0 && (
                <button
                  className={'ghost ctl-capo' + (capoOff ? ' is-on' : '')}
                  aria-pressed={capoOff}
                  title={
                    capoOff
                      ? t('song.capoBackTitle', { capo: song.capo })
                      : t('song.capoTakeOffTitle', { capo: song.capo, key: displayKey })
                  }
                  onClick={() => setCapoOff((v) => !v)}
                >
                  <Icon name="capo" size={14} />
                  <span className="btn-label">{capoOff ? t('song.capoBack') : t('song.capoTakeOff')}</span>
                </button>
              )}

              {song.note && (
                <button
                  className={'ghost ctl-note' + (noteOpen ? ' is-on' : '')}
                    aria-label={t('song.showNote')}
                  aria-expanded={noteOpen}
                  onClick={() => setNoteOpen(true)}
                >
                  <Icon name="note" size={14} />
                  <span className="btn-label">{t('song.noteButton')}</span>
                </button>
              )}

              <button
                className={'ghost' + (stage ? ' is-on' : '')}
                aria-label={stage ? t('song.exitStage') : t('song.stageMode')}
                aria-pressed={stage}
                disabled={align}
                onClick={() => setStage((v) => !v)}
              >
                <Icon name="expand" size={14} />
                <span className="btn-label">{stage ? t('song.exitStage') : t('song.stageMode')}</span>
              </button>
            </div>

            {inSet && (next || prev) && (
              <div className="seg hide-sm">
                <button aria-label={t('song.prevSong')} disabled={!prev || align} onClick={() => go(prev)}>
                  <Icon name="left" size={14} />
                </button>
                <button aria-label={t('song.nextSong')} disabled={!next || align} onClick={() => go(next)}>
                  <Icon name="right" size={14} />
                </button>
              </div>
            )}

            {chords.length > 0 && (
              <div className="chord-pills hide-sm">
                {chords.slice(0, 7).map((c) => (
                  <span key={c} className="chord-pill" style={hue(c)}>{c}</span>
                ))}
              </div>
            )}
          </div>
        </header>

        <div className="song-body">
          <div className="scroll">
            {hasChart ? (
              <div
                className={'chart' + (canAlign ? ' can-align' : '') + (align ? ' is-aligning' : '')}
                style={chartVars}
              >
                <div className="chart-jump">
                  <div className="chart-jump-tools">
                    {/* Aligning starts where the chart is, not up in the
                        header — and it steps out of the way once it is on,
                        because the bar at the foot of the screen owns it. */}
                    {canAlign && !align && (
                      <button
                        type="button"
                        className="ghost chart-edit-btn"
                        aria-label={t('song.align')}
                        title={t('song.align')}
                        onClick={startAlign}
                      >
                        <Icon name="pencil" size={15} />
                      </button>
                    )}
                    <div className="chart-jump-inner" ref={jumpRef}>
                      <button
                        type="button"
                        className={'ghost chart-jump-btn' + (jumpOpen ? ' is-on' : '')}
                        aria-label={t('song.jumpTo')}
                        aria-haspopup="menu"
                        aria-expanded={jumpOpen}
                        aria-controls="chart-jump-menu"
                        onClick={() => setJumpOpen((v) => !v)}
                      >
                        <span>{t('song.structure')}</span>
                        <Icon name="down" size={13} />
                      </button>
                      {jumpOpen && (
                        <div className="chart-jump-menu" id="chart-jump-menu" role="menu">
                          {sections.map((sec, i) => (
                            <button
                              key={i}
                              type="button"
                              role="menuitem"
                              className={'struct-row' + (sec.accent ? ' hot' : '')}
                              onClick={() => jumpTo(i)}
                            >
                              <span className="dot" />
                              <span>{sec.label}</span>
                              <small>{sec.bars}</small>
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                {sections.map((sec, si) => (
                  <section key={si} id={`chart-sec-${si}`} className={'chart-section' + (sec.accent ? ' accent' : '')}>
                    <div className="chart-label">
                      <span>{sec.label}</span>
                      <small>{sec.bars}</small>
                    </div>
                    {sec.lines.map((line, li) => (align ? alignLine(line, si, li) : viewLine(line, li)))}
                  </section>
                ))}
                <div className="chart-end">
                  <i /><span>{t('song.end')}</span><i />
                </div>
              </div>
            ) : (
              <div className="empty empty-plain">
                <Icon name="lines" size={30} style={{ color: 'var(--fainter)' }} />
                <p>
                  {t('song.noChart', { title: song.title, key: displayKey, bpm: song.bpm })}
                </p>
                <Link className="ghost" to={inSet ? `/rehearsal/${inSet}` : '/songs'}>
                  {inSet ? t('song.backSet') : t('song.backSongs')}
                </Link>
              </div>
            )}
          </div>

          {!stage && (
            <aside className="aside">
              {song.note && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div className="eyebrow">{t('song.bandNote')}</div>
                  <div className="note" style={memberHue(noteAuthor)}>{song.note}</div>
                  {noteAuthor && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, paddingInlineStart: 2 }}>
                      <div className="avatar" style={{ width: 22, height: 22, marginInlineStart: 0, fontSize: 10, borderColor: 'transparent', ...memberHue(noteAuthor) }}>{noteAuthor.initials}</div>
                      <span style={{ fontSize: 11, color: 'var(--fainter)' }}>
                        {/* The age is English either way — isolate it so a
                            Hebrew line doesn't strand its number. */}
                        {t('song.updated', { name: noteAuthor.name, age: `\u2068${song.noteAge}\u2069` })}
                      </span>
                    </div>
                  )}
                </div>
              )}

              {inSet && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 11 }}>
                  <div className="eyebrow">{t('song.inSet')}</div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 9, background: 'var(--well)', border: '1px solid var(--line)', borderRadius: 11, padding: '12px 13px' }}>
                    <div style={{ fontSize: 12, fontWeight: 500, color: 'var(--ink-soft)' }}>
                      {t('song.songOf', { n: position + 1, total: setSongs.length })}
                    </div>
                    <div className="progress">
                      <i style={{ width: `${((position + 1) / setSongs.length) * 100}%` }} />
                    </div>
                  </div>
                </div>
              )}

              {isDeletableSong(song) && !align && (
                <button
                  className="ghost danger"
                  onClick={() => {
                    const snapshot = freezeUndo({ events, songs });
                    dispatch({ type: 'remove-from-library', songId: song.id });
                    notify(t('song.removed', { title: song.title }), snapshot);
                    navigate('/songs');
                  }}
                >
                  <Icon name="trash" size={14} />
                  {t('song.removeFromLibrary')}
                </button>
              )}

              <p className="hide-sm shortcuts-hint" style={{ margin: 'auto 0 0', fontSize: 10.5, color: 'var(--fainter)', lineHeight: 1.7, whiteSpace: 'pre-line' }}>
                <b style={{ color: 'var(--faint)', fontWeight: 600 }}>{t('song.shortcuts')}</b>
                {'\n'}{t('song.shortcutsBody')}
              </p>
            </aside>
          )}
        </div>

        {!align && (next || prev) && (
          <div className="song-nextbar show-sm" style={{ flex: '0 0 auto', background: 'var(--bar)', borderTop: '1px solid var(--raised-2)', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
            <button
              className="icon-btn bordered"
              style={{ width: 46, height: 46, borderRadius: 12 }}
              aria-label={t('song.prevSongMobile')}
              disabled={!prev}
              onClick={() => go(prev)}
            >
              <Icon name="left" size={17} />
            </button>
            <div className="grow">
              <div className="eyebrow" style={{ fontSize: 10 }}>{next ? t('song.upNext') : t('song.lastInSet')}</div>
              <div className="truncate" style={{ fontSize: 14, fontWeight: 500, color: 'var(--ink)', marginTop: 2 }}>
                {next ? next.title : song.title}
              </div>
            </div>
            {next && <span className="key-badge" style={hue(nextKey)}>{nextKey}</span>}
            <button
              className="btn"
              style={{ width: 46, height: 46, borderRadius: 12, padding: 0 }}
              aria-label={t('song.nextSongMobile')}
              disabled={!next}
              onClick={() => go(next)}
            >
              <Icon name="right" size={18} />
            </button>
          </div>
        )}
        {align && (
          <div className="align-bar" role="region" aria-label={t('song.alignTitle')}>
            <div className="align-say">
              <span className="eyebrow">{t('song.alignTitle')}</span>
              <p>{sel ? t('song.alignPlace', { chord: selChord }) : t('song.alignPick')}</p>
            </div>

            {/* The arrows follow the words: on a Hebrew line, one character
                earlier is one step to the right. */}
            <div className="align-move" dir={selRtl ? 'rtl' : 'ltr'}>
              <button type="button" aria-label={t('song.alignBack')} disabled={!sel} onClick={() => nudge(-1)}>
                <Icon name={selRtl ? 'right' : 'left'} size={14} />
              </button>
              <span className="align-chord" style={selChord ? hue(selChord) : undefined}>
                {selChord || '—'}
              </span>
              <button type="button" aria-label={t('song.alignOn')} disabled={!sel} onClick={() => nudge(1)}>
                <Icon name={selRtl ? 'left' : 'right'} size={14} />
              </button>
            </div>

            <div className="align-acts">
              <button type="button" className="ghost" onClick={stopAlign}>{t('common.cancel')}</button>
              <button type="button" className="btn" onClick={saveAlign}>{t('song.alignSave')}</button>
            </div>
          </div>
        )}
      </main>

      {noteOpen && song.note && (
        <div
          className="note-scrim"
          onMouseDown={(e) => { if (e.target === e.currentTarget) setNoteOpen(false); }}
        >
          <div ref={notePopRef} tabIndex={-1} className="note-pop" role="dialog" aria-modal="true" aria-label={t('song.bandNote')} style={memberHue(noteAuthor)}>
            <div className="note-pop-head">
              <span className="eyebrow">{t('song.bandNote')}</span>
              <button className="icon-btn" aria-label={t('song.closeNote')} onClick={() => setNoteOpen(false)}>
                <Icon name="close" size={15} />
              </button>
            </div>
            <p className="note-pop-body">{song.note}</p>
            {noteAuthor && (
              <div className="note-pop-by">
                <div className="avatar" style={{ width: 22, height: 22, marginInlineStart: 0, fontSize: 10, borderColor: 'transparent', ...memberHue(noteAuthor) }}>{noteAuthor.initials}</div>
                <span style={{ fontSize: 11, color: 'var(--fainter)' }}>
                  {/* The age is English either way — isolate it so a
                      Hebrew line doesn't strand its number. */}
                  {t('song.updated', { name: noteAuthor.name, age: `\u2068${song.noteAge}\u2069` })}
                </span>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
