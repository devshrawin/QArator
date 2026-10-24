// Small DOM helpers shared by the panel and the settings page.

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const isDark = () => matchMedia('(prefers-color-scheme: dark)').matches;

/** Point border beams and thinking orbs at the current theme, and swap the toolbar icon. */
export function applyTheme(root = document) {
  const dark = isDark();
  root.querySelectorAll('[data-beam]').forEach((el) => el.setAttribute('data-beam', dark ? 'qa-beam-d' : 'qa-beam-l'));
  root.querySelectorAll('canvas[data-orb]').forEach((el) => {
    if (el.dataset.orbInvert) el.dataset.orbTheme = dark ? 'light' : 'dark';
    else el.dataset.orbTheme = dark ? 'dark' : 'light';
  });
}
export function watchTheme(onChange) {
  const mq = matchMedia('(prefers-color-scheme: dark)');
  const run = () => {
    applyTheme();
    setToolbarIcon(mq.matches);
    onChange && onChange(mq.matches);
  };
  mq.addEventListener('change', run);
  setToolbarIcon(mq.matches);
}
export function setToolbarIcon() { /* one icon for light and dark toolbars */ }

/** Wrap a field in a border beam. */
export const beam = (inner, active = false) =>
  `<div data-beam="${isDark() ? 'qa-beam-d' : 'qa-beam-l'}"${active ? ' data-active=""' : ''}>${inner}<div data-beam-bloom=""></div></div>`;

/** A thinking orb canvas. size 20 or 64. */
export const orb = (state, size = 20, label = '', invert = false) =>
  `<canvas data-orb="${state}" data-orb-size="${size}" data-orb-theme="${(isDark() !== invert) ? 'dark' : 'light'}"${invert ? ' data-orb-invert="1"' : ''} width="${size}" height="${size}" ${label ? `role="img" aria-label="${esc(label)}"` : 'aria-hidden="true"'} style="width:${size}px;height:${size}px"></canvas>`;

const P = (d, extra = '') => `<svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" ${extra}>${d}</svg>`;
export const icon = {
  capture: P('<path d="M2.5 5.5v-3h3M10.5 2.5h3v3M2.5 10.5v3h3M10.5 13.5h3v-3"/><circle cx="8" cy="8" r="2"/>'),
  image: P('<rect x="2.5" y="3" width="11" height="10" rx="1.5"/><circle cx="6" cy="6.5" r="1.2"/><path d="M3 12l3.5-3.5 2.5 2.5 2-2 2.5 2.5"/>'),
  paste: P('<rect x="4" y="3" width="8" height="11" rx="1.5"/><path d="M6 3V2h4v1M6.5 8h3M6.5 10.5h2"/>'),
  clock: P('<circle cx="8" cy="8" r="5.5"/><path d="M8 5v3l2 1.5"/>'),
  settings: P('<path d="M2.5 5h11M2.5 11h11"/><circle cx="6" cy="5" r="1.8" fill="var(--bg)"/><circle cx="10.5" cy="11" r="1.8" fill="var(--bg)"/>'),
  check: P('<path d="M3.5 8.5l3 3 6-7"/>', 'stroke-width="2"'),
  alert: P('<path d="M8 2.5l6 11H2z"/><path d="M8 7v3M8 12v.01"/>'),
  x: P('<path d="M4 4l8 8M12 4l-8 8"/>'),
  pen: P('<path d="M10.5 2.5l3 3-8 8H2.5v-3z"/>'),
  trash: P('<path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.5 9h6l.5-9"/>'),
  globe: P('<circle cx="8" cy="8" r="5.5"/><path d="M2.5 8h11M8 2.5c-2 2-2 9 0 11M8 2.5c2 2 2 9 0 11"/>'),
  chevron: P('<path d="M6 4l4 4-4 4"/>'),
  back: P('<path d="M10 3L5 8l5 5"/>'),
  copy: P('<rect x="5.5" y="5.5" width="8" height="8" rx="1.5"/><path d="M10.5 5.5V3.5a1 1 0 0 0-1-1h-6a1 1 0 0 0-1 1v6a1 1 0 0 0 1 1h2"/>'),
  download: P('<path d="M8 2.5v8M4.5 7L8 10.5 11.5 7M3 13.5h10"/>'),
  upload: P('<path d="M8 10.5v-8M4.5 6L8 2.5 11.5 6M3 13.5h10"/>'),
  box: P('<rect x="2.5" y="3.5" width="11" height="9" rx="1"/>'),
  arrow: P('<path d="M3 13L13 3M7 3h6v6"/>'),
  hide: P('<rect x="2" y="5.5" width="12" height="5" rx="1" fill="currentColor"/>'),
  undo: P('<path d="M5 4L2.5 6.5 5 9M2.5 6.5h7a3.5 3.5 0 0 1 0 7H7"/>'),
  key: P('<circle cx="5.5" cy="10.5" r="3"/><path d="M7.6 8.4l5.9-5.9M11 5l2 2"/>'),
  refresh: P('<path d="M13 8a5 5 0 1 1-1.5-3.6M13 3v3h-3"/>'),
  external: P('<path d="M9 2.5h4.5V7M13.5 2.5L7.5 8.5M11.5 9.5v4h-9v-9h4"/>'),
  plus: P('<path d="M8 3v10M3 8h10"/>'),
  up: P('<path d="M4 10l4-4 4 4"/>'),
  down: P('<path d="M4 6l4 4 4-4"/>'),
  left: P('<path d="M10 4L6 8l4 4"/>'),
  right: P('<path d="M6 4l4 4-4 4"/>')
};

export const markSvg = (size = 20) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 16 16" aria-hidden="true"><rect width="16" height="16" rx="3.5" fill="#FF7A3D"/><path d="M3 7V3h4M9 3h4v4M3 9v4h4" fill="none" stroke="#16181B" stroke-width="2"/><path d="M9.5 9.5L13 13" fill="none" stroke="#16181B" stroke-width="2" stroke-linecap="round"/></svg>`;

export function toast(msg, ms = 1800) {
  const t = document.createElement('div');
  t.className = 'toast';
  t.setAttribute('role', 'status');
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), ms);
}

export async function copyText(text, label = 'Copied') {
  try { await navigator.clipboard.writeText(text); toast(label); return true; }
  catch (e) {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy'); ta.remove();
    toast(ok ? label : 'Copy failed. Select the text and press Ctrl+C.');
    return ok;
  }
}

export function downloadDataUrl(dataUrl, name) {
  const a = document.createElement('a');
  a.href = dataUrl; a.download = name; document.body.appendChild(a); a.click(); a.remove();
}

export const fmtTime = (ts) => new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
export const uid = () => Math.random().toString(36).slice(2, 10);
