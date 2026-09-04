import React from 'react';

const P = { fill: 'none', stroke: 'currentColor', strokeWidth: 1.8, strokeLinecap: 'round', strokeLinejoin: 'round' };

export function Icon({ name, size = 17, ...rest }) {
  const paths = {
    calendar: (
      <>
        <rect x="3.5" y="5" width="17" height="15.5" rx="2.5" />
        <path d="M3.5 9.6h17M8 3v4M16 3v4" />
      </>
    ),
    music: (
      <>
        <circle cx="7" cy="18" r="3" />
        <circle cx="18" cy="15.5" r="3" />
        <path d="M10 18V6.2l11-2.2v11.5" />
      </>
    ),
    left: <path d="M14.5 5.5 8 12l6.5 6.5" strokeWidth="2" />,
    up: <path d="M5.5 14.5 12 8l6.5 6.5" strokeWidth="2" />,
    down: <path d="M5.5 9.5 12 16l6.5-6.5" strokeWidth="2" />,
    right: <path d="M9.5 5.5 16 12l-6.5 6.5" strokeWidth="2" />,
    plus: <path d="M12 5.5v13M5.5 12h13" strokeWidth="2.2" />,
    minus: <path d="M5.5 12h13" strokeWidth="2.2" />,
    close: <path d="M6 6l12 12M18 6L6 18" strokeWidth="2" />,
    check: <path d="M5 12.5 10 17.5 19 7" strokeWidth="3" />,
    search: (
      <>
        <circle cx="11" cy="11" r="6.5" strokeWidth="2" />
        <path d="M16 16l4.5 4.5" strokeWidth="2" />
      </>
    ),
    globe: (
      <>
        <circle cx="12" cy="12" r="8.5" />
        <path d="M3.5 12h17M12 3.5a14 14 0 0 1 0 17M12 3.5a14 14 0 0 0 0 17" />
      </>
    ),
    arrow: <path d="M5 12h13M12.5 6l6 6-6 6" strokeWidth="2" />,
    lines: <path d="M4 7h16M4 12h16M4 17h10" strokeWidth="1.9" />,
    /* A capo: the bar clamped across the strings. */
    capo: (
      <>
        <path d="M6 3v18M12 3v18M18 3v18" strokeWidth="1.3" />
        <rect x="2.6" y="9.4" width="18.8" height="4.2" rx="2.1" fill="currentColor" stroke="none" />
      </>
    ),
    note: (
      <>
        <path d="M4.6 6.2A2.2 2.2 0 0 1 6.8 4h10.4a2.2 2.2 0 0 1 2.2 2.2v7.6a2.2 2.2 0 0 1-2.2 2.2H9.6l-4.1 3.4a.55.55 0 0 1-.9-.42z" />
        <path d="M8.4 8.6h7.2M8.4 11.9h4.4" />
      </>
    ),
    expand: <path d="M4 9V5.5A1.5 1.5 0 0 1 5.5 4H9M15 4h3.5A1.5 1.5 0 0 1 20 5.5V9M20 15v3.5a1.5 1.5 0 0 1-1.5 1.5H15M9 20H5.5A1.5 1.5 0 0 1 4 18.5V15" strokeWidth="1.9" />,
    more: null,
    trash: <path d="M5 7h14M10 7V5.2h4V7M8 7l.8 12h6.4L16 7" strokeWidth="1.8" />,
    pencil: (
      <>
        <path d="M16.2 4.4a2 2 0 0 1 2.8 2.8L8.6 17.6 4.5 19l1.4-4.1z" strokeWidth="1.7" />
        <path d="M14.6 6l3.4 3.4" strokeWidth="1.7" />
      </>
    ),
    sun: (
      <>
        <circle cx="12" cy="12" r="3.6" />
        <path d="M12 3.4v2.2M12 18.4v2.2M3.4 12h2.2M18.4 12h2.2M5.8 5.8l1.6 1.6M16.6 16.6l1.6 1.6M5.8 18.2l1.6-1.6M16.6 7.4l1.6-1.6" />
      </>
    ),
    moon: <path d="M15.4 4.6A7.4 7.4 0 1 0 19.4 15 6.2 6.2 0 0 1 15.4 4.6z" />,
    star: <path d="M12 4.2l2.42 4.9 5.41.79-3.91 3.81.92 5.39L12 16.55l-4.84 2.54.92-5.39-3.91-3.81 5.41-.79z" strokeWidth="1.6" />
  };

  if (name === 'play') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
        <path d="M8 5.2 19 12 8 18.8z" />
      </svg>
    );
  }
  if (name === 'grip') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
        {[6, 12, 18].map((y) => (
          <React.Fragment key={y}>
            <circle cx="9" cy={y} r="1.5" />
            <circle cx="15" cy={y} r="1.5" />
          </React.Fragment>
        ))}
      </svg>
    );
  }
  if (name === 'more') {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden {...rest}>
        <circle cx="5" cy="12" r="1.8" />
        <circle cx="12" cy="12" r="1.8" />
        <circle cx="19" cy="12" r="1.8" />
      </svg>
    );
  }

  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden data-icon={name} {...P} {...rest}>
      {paths[name]}
    </svg>
  );
}

export function Logo({ size = 26 }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" aria-hidden>
      <circle cx="12" cy="12" r="3" fill="var(--accent)" />
      <path d="M12 4.5a7.5 7.5 0 0 1 7.5 7.5" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" opacity="0.9" />
      <path d="M12 8.2a3.8 3.8 0 0 1 3.8 3.8" stroke="var(--accent)" strokeWidth="1.6" strokeLinecap="round" opacity="0.5" />
      <path d="M12 19.5A7.5 7.5 0 0 1 4.5 12" stroke="#4b4340" strokeWidth="1.6" strokeLinecap="round" opacity="0.45" />
    </svg>
  );
}
