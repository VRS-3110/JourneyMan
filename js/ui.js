// JourneyMan — small helpers shared by the views.

export const $ = (sel, el = document) => el.querySelector(sel);
export const $$ = (sel, el = document) => [...el.querySelectorAll(sel)];
export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export const ICONS = {
  inbox: '<path d="M2 9h3l1 2h4l1-2h3"/><path d="M3.6 3h8.8L14 9v4H2V9z"/>',
  today: '<path d="M8 1.8l1.8 3.9 4.2.5-3.1 2.9.8 4.2L8 11.2l-3.7 2.1.8-4.2L2 6.2l4.2-.5z"/>',
  upcoming: '<rect x="2" y="3" width="12" height="11" rx="2"/><path d="M2 6.5h12M5.5 1.5v3M10.5 1.5v3"/>',
  anytime: '<path d="M8 2l6 3-6 3-6-3z"/><path d="M2 8l6 3 6-3"/><path d="M2 11l6 3 6-3"/>',
  projects: '<rect x="2" y="2" width="5" height="5" rx="1.2"/><rect x="9" y="2" width="5" height="5" rx="1.2"/><rect x="2" y="9" width="5" height="5" rx="1.2"/><rect x="9" y="9" width="5" height="5" rx="1.2"/>',
  logbook: '<path d="M3 2.5h8.5A1.5 1.5 0 0 1 13 4v9.5H4.5A1.5 1.5 0 0 1 3 12z"/><path d="M5.5 7.2l1.6 1.6 3-3.1"/>',
  notion: '<rect x="2" y="2" width="12" height="12" rx="2.5"/><path d="M5.5 11V5l5 6V5"/>',
  clock: '<circle cx="8" cy="8" r="6"/><path d="M8 4.8V8l2.3 1.4"/>',
  flag: '<path d="M3.5 14V2.5M3.5 3h8L10 6l1.5 3h-8"/>',
  check: '<path d="M3.5 8.5l3 3 6-7"/>',
  close: '<path d="M4 4l8 8M12 4l-8 8"/>',
  note: '<path d="M3 3h10v10H3z"/><path d="M5.5 6h5M5.5 8.5h5M5.5 11h3"/>',
  play: '<path d="M5 3.2v9.6L12.5 8z" fill="currentColor"/>',
  stop: '<rect x="4" y="4" width="8" height="8" rx="1.5" fill="currentColor"/>',
  time: '<circle cx="8" cy="9" r="5.5"/><path d="M8 6.2V9l2 1.2M6.5 1.8h3M8 1.8v1.7"/>',
  insights: '<path d="M2.5 13.5h11"/><path d="M4.5 11V8M8 11V4.5M11.5 11V6.5"/>',
  review: '<path d="M13 8a5 5 0 1 1-1.5-3.6"/><path d="M13 2.5v2.8h-2.8"/><path d="M6 8.2l1.5 1.5L10.5 7"/>',
  link: '<path d="M6.5 9.5l3-3"/><path d="M7.5 4.5l1-1a2.5 2.5 0 0 1 3.5 3.5l-1 1M8.5 11.5l-1 1A2.5 2.5 0 0 1 4 9l1-1"/>',
  sparkle: '<path d="M8 1.8l1.4 3.6 3.6 1.4-3.6 1.4L8 11.8 6.6 8.2 3 6.8l3.6-1.4z"/><path d="M12.5 11.5l.6 1.4 1.4.6-1.4.6-.6 1.4-.6-1.4-1.4-.6 1.4-.6z"/>',
  sync: '<path d="M13 6.5A5 5 0 0 0 3.8 5M3 9.5A5 5 0 0 0 12.2 11"/><path d="M3.5 2.5V5H6M12.5 13.5V11H10"/>',
  warn: '<path d="M8 2.2L14.3 13H1.7z"/><path d="M8 6.5v3M8 11.3v.2"/>',
  ok: '<circle cx="8" cy="8" r="6"/><path d="M5.5 8.2l1.7 1.7 3.3-3.6"/>',
  pause: '<circle cx="8" cy="8" r="6"/><path d="M6.5 5.8v4.4M9.5 5.8v4.4"/>',
};
export const icon = (name) => `<svg class="ic" viewBox="0 0 16 16" aria-hidden="true">${ICONS[name]}</svg>`;

/* 125 → "2h 5m"; also used for axis ticks ("2h"). */
export function hours(mins, short = false) {
  const m = Math.round(mins || 0);
  if (short) return m >= 60 ? `${+(m / 60).toFixed(1)}h` : `${m}m`;
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}
/* Seconds since `start` as 0:12:05 */
export function clockText(startIso, now = new Date()) {
  const s = Math.max(0, Math.floor((now - new Date(startIso)) / 1000));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}
export function download(name, text, type) {
  const blob = new Blob([text], { type });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
