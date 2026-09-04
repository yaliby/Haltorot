import React from 'react';
import { Icon } from './Icon.jsx';
import { useI18n } from '../i18n/index.js';
import { hue } from '../lib/hues.js';
import { clampSteps, instanceKey, songKey, transpose } from '../lib/chords.js';

/* Dedicated to the add-to-bunker / add-to-set path. The library song itself
   is never rewritten — only the instance that is about to be created. */
const INTERVALS = [
  { steps: -2, label: 'toneDown' },
  { steps: -1, label: 'halfDown' },
  { steps: 1, label: 'halfUp' },
  { steps: 2, label: 'toneUp' }
];

export function InstanceKeyPicker({ song, steps, onSteps, onConfirm, onCancel, confirmLabel }) {
  const { t } = useI18n();
  const original = songKey(song);
  const n = clampSteps(steps);
  const display = instanceKey(song, n);
  const shifted = n !== 0;

  return (
    <div className="instance-key slidein" style={{ display: 'flex', flexDirection: 'column', gap: 16, minHeight: 0 }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <button className="ghost" onClick={onCancel} style={{ paddingInline: 10 }}>
          <Icon name="left" size={13} />
          {t('instanceKey.back')}
        </button>
        <button className="icon-btn" aria-label={t('common.close')} onClick={onCancel}>
          <Icon name="close" size={14} />
        </button>
      </div>

      <div>
        <div className="eyebrow">{t('instanceKey.title')}</div>
        <div className="instance-key-song">
          <div className="mini-title truncate">{song.title}</div>
          <div className="mini-sub">{song.artist} · {original}</div>
        </div>
      </div>

      <button
        type="button"
        className={'instance-key-original' + (shifted ? '' : ' is-on')}
        aria-pressed={!shifted}
        onClick={() => onSteps(0)}
      >
        <span>
          <span className="instance-key-original-label">{t('instanceKey.original')}</span>
          <span className="mini-sub">{t('instanceKey.originalHint')}</span>
        </span>
        <span className="key-badge" style={hue(original)}>{original || '—'}</span>
      </button>

      <div>
        <div className="eyebrow">{t('instanceKey.transpose')}</div>
        <div className="seg seg-key instance-key-seg">
          <button
            type="button"
            aria-label={t('song.transposeDown')}
            disabled={n <= -11}
            onClick={() => onSteps(Math.max(-11, n - 1))}
          >
            <Icon name="minus" size={14} />
          </button>
          <span className="seg-label" aria-live="polite">
            <small>{shifted ? `KEY ${n > 0 ? `+${n}` : n}` : t('instanceKey.keyLabel')}</small>
            <strong className={shifted ? 'is-set' : ''} style={hue(display)}>{display || '—'}</strong>
          </span>
          <button
            type="button"
            aria-label={t('song.transposeUp')}
            disabled={n >= 11}
            onClick={() => onSteps(Math.min(11, n + 1))}
          >
            <Icon name="plus" size={14} />
          </button>
        </div>
        <div className="instance-key-intervals">
          {INTERVALS.map((opt) => (
            <button
              key={opt.steps}
              type="button"
              className={'chip' + (n === opt.steps ? ' is-on' : '')}
              aria-pressed={n === opt.steps}
              onClick={() => onSteps(opt.steps)}
            >
              {t(`instanceKey.${opt.label}`)}
              <span className="instance-key-interval-key">{transpose(original, opt.steps) || '—'}</span>
            </button>
          ))}
        </div>
        <p className="instance-key-hint">
          {shifted
            ? t('instanceKey.changedHint', { from: original, to: display })
            : t('instanceKey.defaultHint')}
        </p>
      </div>

      <button
        type="button"
        className="btn btn-lg btn-block"
        data-instance-key-confirm
        onClick={onConfirm}
      >
        {confirmLabel}
      </button>
    </div>
  );
}

/** Shown beside a title when that bunker / setlist instance is not in the original key. */
export function InstanceKeyBadge({ song, steps, title }) {
  const { t } = useI18n();
  const n = clampSteps(steps);
  if (!n) return null;
  const from = songKey(song);
  const to = instanceKey(song, n);
  return (
    <span
      className="instance-key-tag"
      style={hue(to)}
      title={title || t('instanceKey.badgeTitle', { from, to, n: n > 0 ? `+${n}` : String(n) })}
    >
      <span className="instance-key-tag-key">{to}</span>
      <span className="instance-key-tag-shift">{n > 0 ? `+${n}` : n}</span>
    </span>
  );
}
