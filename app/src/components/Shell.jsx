import React from 'react';
import { NavLink } from 'react-router-dom';
import { Icon, Logo } from './Icon.jsx';
import { LanguageToggle } from './LanguageToggle.jsx';
import { ThemeToggle } from './ThemeToggle.jsx';
import { BAND } from '../data.js';
import { useStore } from '../store.jsx';
import { useI18n } from '../i18n/index.js';
import { memberHue } from '../lib/hues.js';

function MonthStats() {
  const { events, today } = useStore();
  const { t } = useI18n();
  const prefix = today.slice(0, 7);
  const keys = Object.keys(events).filter((k) => k.startsWith(prefix));
  const rehearsals = keys.filter((k) => events[k].kind === 'r').length;
  const shows = keys.filter((k) => events[k].kind === 's').length;

  return (
    <div className="rail-section">
      <div className="eyebrow">{t('shell.thisMonth')}</div>
      <div>
        <div className="stat">
          <span className="stat-dot" style={{ background: 'var(--accent)' }} />
          <span className="stat-label">{t('shell.rehearsals')}</span>
          <span className="stat-value">{rehearsals}</span>
        </div>
        <div className="stat">
          <span className="stat-dot" style={{ background: 'var(--teal)' }} />
          <span className="stat-label">{t('shell.shows')}</span>
          <span className="stat-value">{shows}</span>
        </div>
      </div>
    </div>
  );
}

export function Shell({ children }) {
  const { songs } = useStore();
  const bunker = songs.filter((s) => s.bunker).length;
  const { t } = useI18n();

  return (
    <div className="app">
      <aside className="rail shell-rail">
        <div className="brand">
          <Logo />
          <div>
            <div className="brand-name">{BAND.name}</div>
            <div className="brand-sub">
              {t('shell.members', { n: BAND.members.length, city: BAND.city })}
            </div>
          </div>
        </div>

        <nav className="nav">
          <NavLink to="/" end className={({ isActive }) => 'nav-item' + (isActive ? ' is-active' : '')}>
            <Icon name="calendar" />
            {t('nav.calendar')}
          </NavLink>
          <NavLink to="/songs" className={({ isActive }) => 'nav-item' + (isActive ? ' is-active' : '')}>
            <Icon name="music" />
            {t('nav.songs')}
            <span className="nav-count">{songs.length}</span>
          </NavLink>
          <NavLink to="/bunker" className={({ isActive }) => 'nav-item' + (isActive ? ' is-active' : '')}>
            <Icon name="star" />
            {t('nav.bunker')}
            <span className="nav-count">{bunker}</span>
          </NavLink>
        </nav>

        <MonthStats />

        <div style={{ marginTop: 'auto', padding: '0 8px', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div className="avatars">
            {BAND.members.map((m) => (
              <div className="avatar" key={m.id} style={memberHue(m)} title={`${m.name} · ${m.role}`}>
                {m.initials}
              </div>
            ))}
          </div>
        </div>
      </aside>

      <div className="app-body">
        <div className="app-toggles">
          <LanguageToggle />
          <ThemeToggle />
        </div>
        {children}
      </div>

      <nav className="tabbar">
        <NavLink to="/" end className={({ isActive }) => 'tab' + (isActive ? ' is-active' : '')}>
          <Icon name="calendar" size={20} />
          <span>{t('nav.calendar')}</span>
        </NavLink>
        <NavLink to="/songs" className={({ isActive }) => 'tab' + (isActive ? ' is-active' : '')}>
          <Icon name="music" size={20} />
          <span>{t('nav.songs')}</span>
        </NavLink>
        <NavLink to="/bunker" className={({ isActive }) => 'tab' + (isActive ? ' is-active' : '')}>
          <Icon name="star" size={20} />
          <span>{t('nav.bunker')}</span>
        </NavLink>
      </nav>
    </div>
  );
}
