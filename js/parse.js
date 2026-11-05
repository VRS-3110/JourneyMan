// JourneyMan — dates and the quick-add parser. No DOM here, so it runs in Node tests too.
// Dates are local calendar days stored as 'YYYY-MM-DD' strings.

import { parseRepeatAt } from './recurrence.js';

const pad = (n) => String(n).padStart(2, '0');

export function toISO(d) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}
export function fromISO(iso) {
  const [y, m, d] = iso.split('-').map(Number);
  return new Date(y, m - 1, d);
}
export function todayISO(now = new Date()) {
  return toISO(now);
}
export function addDays(iso, n) {
  const d = fromISO(iso);
  d.setDate(d.getDate() + n);
  return toISO(d);
}
export function daysBetween(fromIso, toIso) {
  return Math.round((fromISO(toIso) - fromISO(fromIso)) / 864e5);
}
export function weekday(iso) {
  return fromISO(iso).getDay(); // 0 = Sunday
}
export function nextMonday(today) {
  const wd = weekday(today);
  return addDays(today, ((8 - wd) % 7) || 7);
}

const WEEKDAYS = [
  ['sunday', 'sun'], ['monday', 'mon'], ['tuesday', 'tue', 'tues'], ['wednesday', 'wed'],
  ['thursday', 'thu', 'thur', 'thurs'], ['friday', 'fri'], ['saturday', 'sat'],
];
const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];

function weekdayIndex(word) {
  return WEEKDAYS.findIndex((names) => names.includes(word));
}
function monthIndex(word) {
  if (word.length < 3) return -1;
  const i = MONTHS.indexOf(word.slice(0, 3));
  if (i < 0) return -1;
  const full = ['january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october', 'november', 'december'][i];
  return full.startsWith(word) || word === 'sept' ? i : -1;
}
function validDate(y, m, d) {
  const dt = new Date(y, m, d);
  return dt.getFullYear() === y && dt.getMonth() === m && dt.getDate() === d;
}
/* The next time this day and month come round, today included. */
function nextDayMonth(today, m, d) {
  const t = fromISO(today);
  let y = t.getFullYear();
  if (!validDate(y, m, d)) return null;
  if (new Date(y, m, d) < t) y += 1;
  return validDate(y, m, d) ? toISO(new Date(y, m, d)) : null;
}

/* Reads a date starting at tokens[i]. Returns { iso, used } or null. */
export function parseDateAt(tokens, i, today) {
  const w = (k) => (tokens[i + k] || '').toLowerCase().replace(/[,.]$/, '');
  const t = w(0), t1 = w(1), t2 = w(2);
  if (t === 'today' || t === 'tonight') return { iso: today, used: 1 };
  if (t === 'tomorrow' || t === 'tmr' || t === 'tmrw') return { iso: addDays(today, 1), used: 1 };
  if (t === 'next' && t1 === 'week') return { iso: nextMonday(today), used: 2 };
  if (t === 'in' && /^\d{1,3}$/.test(t1)) {
    const n = Number(t1);
    if (/^(day|days)$/.test(t2)) return { iso: addDays(today, n), used: 3 };
    if (/^(week|weeks)$/.test(t2)) return { iso: addDays(today, 7 * n), used: 3 };
  }
  const wd = weekdayIndex(t);
  if (wd >= 0) {
    const ahead = ((wd - weekday(today) + 7) % 7) || 7; // the coming one, never today
    return { iso: addDays(today, ahead), used: 1 };
  }
  let m = t.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const [y, mo, d] = [Number(m[1]), Number(m[2]) - 1, Number(m[3])];
    return validDate(y, mo, d) ? { iso: t, used: 1 } : null;
  }
  const dayNum = (s) => { const x = s.match(/^(\d{1,2})(st|nd|rd|th)?$/); return x ? Number(x[1]) : null; };
  // "5 dec" / "5th december"
  if (dayNum(t) && monthIndex(t1) >= 0) {
    const iso = nextDayMonth(today, monthIndex(t1), dayNum(t));
    return iso ? { iso, used: 2 } : null;
  }
  // "dec 5" / "december 5th"
  if (monthIndex(t) >= 0 && dayNum(t1)) {
    const iso = nextDayMonth(today, monthIndex(t), dayNum(t1));
    return iso ? { iso, used: 2 } : null;
  }
  return null;
}

/* "3pm", "3:30pm", "15:00" → "15:00". */
export function parseTime(token) {
  const s = (token || '').toLowerCase();
  let m = s.match(/^(\d{1,2})(?::(\d{2}))?(am|pm)$/);
  if (m) {
    let h = Number(m[1]) % 12;
    if (m[3] === 'pm') h += 12;
    const min = Number(m[2] || 0);
    return h < 24 && min < 60 && Number(m[1]) <= 12 ? `${pad(h)}:${pad(min)}` : null;
  }
  m = s.match(/^(\d{1,2}):(\d{2})$/);
  if (m && Number(m[1]) < 24 && Number(m[2]) < 60) return `${pad(Number(m[1]))}:${m[2]}`;
  return null;
}

/* "~30m", "~1h", "~1h30m", "~1.5h", "~45" → minutes. */
export function parseEstimate(token) {
  const m = (token || '').toLowerCase().match(/^~(\d+(?:\.\d+)?)(h|hr|hrs|m|min|mins)?(?:(\d+)(m|min|mins)?)?$/);
  if (!m) return null;
  const n = Number(m[1]);
  const unit = m[2] || 'm';
  let mins = unit.startsWith('h') ? n * 60 : n;
  if (m[3]) {
    if (!unit.startsWith('h')) return null;
    mins += Number(m[3]);
  }
  mins = Math.round(mins);
  return mins > 0 && mins <= 24 * 60 ? mins : null;
}

export function slugify(s) {
  return String(s).toLowerCase().normalize('NFKD').replace(/[^\p{L}\p{N}]+/gu, '-').replace(/^-+|-+$/g, '');
}

/* Finds a project or area by its slug, or by a unique slug prefix. */
export function findByName(list, name) {
  const slug = slugify(name);
  if (!slug) return null;
  const exact = list.find((x) => slugify(x.name) === slug);
  if (exact) return exact;
  const starts = list.filter((x) => slugify(x.name).startsWith(slug));
  return starts.length === 1 ? starts[0] : null;
}

/* A date right after one of these words is part of the task's text. */
const TEXT_BEFORE = new Set(['about', 'for', 'of', 'the', 'this', 'last', 'from', 'since', 'until', 'till', 'before', 'after', 'during', 're']);

const TAG = /^[#@][\p{L}][\p{L}\p{N}_-]*$/u;

/* ---------- Notion links ---------- */
const NOTION_URL = /^https?:\/\/(?:www\.)?(?:notion\.so|app\.notion\.com|[\w-]+\.notion\.site)\/\S*$/i;
export function isNotionUrl(s) {
  return NOTION_URL.test(String(s || '').trim());
}
/* The 32-character page id inside any Notion link. */
export function notionPageId(url) {
  const m = String(url || '').replace(/-/g, '').match(/([0-9a-f]{32})(?![0-9a-f])/i);
  return m ? m[1].toLowerCase() : null;
}
/* A notion:// link opens the page in the Notion Mac app; falls back to the web link. */
export function notionAppUrl(url) {
  const id = notionPageId(url);
  return id ? `notion://www.notion.so/${id}` : String(url || '').replace(/^https?:\/\//i, 'notion://');
}

/*
  Quick-add syntax:
    #project   @area   ~30m (estimate)   ! !! !!! (priority)
    today, tomorrow, mon…sun, next week, in 3 days, dec 5, 2026-12-05   → when you'll do it
    due fri / by dec 5                                                    → deadline
    3pm / 15:00 after a date (or alone, meaning today)                    → time
    \word keeps a word as text, e.g. "Buy \sun cream"
    a pasted Notion link is attached to the task
    every day / every mon wed fri / every 2 weeks / every month / daily / weekly / weekdays → repeats
*/
export function parseQuickAdd(text, { today = todayISO(), projects = [], areas = [] } = {}) {
  const tokens = String(text).trim().split(/\s+/).filter(Boolean);
  const out = {
    title: '', projectId: null, areaId: null, newProject: null, newArea: null,
    when: null, time: null, deadline: null, estimate: null, priority: 0, notionUrl: null, repeat: null,
  };
  const keep = [];
  let datePhrase = null; // the words that set "when", in case a later date replaces them
  for (let i = 0; i < tokens.length; i++) {
    const tok = tokens[i];
    const low = tok.toLowerCase();
    if (tok.startsWith('\\') && tok.length > 1) { keep.push(tok.slice(1)); continue; }
    if (isNotionUrl(tok)) { out.notionUrl = tok; continue; }

    if (TAG.test(tok)) {
      const name = tok.slice(1);
      if (tok[0] === '#') {
        const p = findByName(projects, name);
        if (p) { out.projectId = p.id; out.newProject = null; } else { out.newProject = name.replace(/[-_]+/g, ' '); out.projectId = null; }
      } else {
        const a = findByName(areas, name);
        if (a) { out.areaId = a.id; out.newArea = null; } else { out.newArea = name.replace(/[-_]+/g, ' '); out.areaId = null; }
      }
      continue;
    }
    const est = parseEstimate(tok);
    if (est != null) { out.estimate = est; continue; }
    if (/^!{1,3}$/.test(tok)) { out.priority = tok.length; continue; }
    if (/^!([1-3])$/.test(tok)) { out.priority = Number(tok[1]); continue; }

    // Repeats: "every mon wed", "every 2 weeks", "daily"… (before dates, so "every fri" isn't read as a date)
    if (low === 'every' && i + 1 < tokens.length) {
      const r = parseRepeatAt(tokens, i + 1);
      if (r) { out.repeat = r.rule; i += r.used; continue; }
    }
    const single = parseRepeatAt(tokens, i, { afterEvery: false });
    if (single) { out.repeat = single.rule; continue; }

    if ((low === 'due' || low === 'by') && i + 1 < tokens.length) {
      const d = parseDateAt(tokens, i + 1, today);
      if (d) { out.deadline = d.iso; i += d.used; continue; }
    }
    // A date phrase, with an optional "on"/"at" before it and a time after it.
    // If a line has two, the last one wins and the earlier one goes back into the title:
    // "Plan next week sun" → "Plan next week", on Sunday.
    const prefixed = (low === 'on' || low === 'at') && i + 1 < tokens.length && parseDateAt(tokens, i + 1, today);
    const start = prefixed ? i + 1 : i;
    const d = prefixed || parseDateAt(tokens, i, today);
    if (d && !prefixed && TEXT_BEFORE.has((tokens[i - 1] || '').toLowerCase())) {
      // "about next week", "for monday": part of what the task says, not when to do it
      keep.push(...tokens.slice(i, i + d.used));
      i += d.used - 1;
      continue;
    }
    if (d) {
      const words = tokens.slice(i, start + d.used);
      i = start + d.used - 1;
      const t = parseTime(tokens[i + 1]);
      if (t) { words.push(tokens[i + 1]); i += 1; }
      const loneTime = !datePhrase && out.time; // "Meeting 3pm tomorrow": the time still applies
      if (datePhrase) keep.splice(datePhrase.at, 0, datePhrase.words.join(' '));
      datePhrase = { at: keep.length, words };
      out.when = d.iso;
      out.time = t || loneTime || null;
      continue;
    }
    // "at" before a time is part of the phrase, not the title
    if (low === 'at' && parseTime(tokens[i + 1]) && !out.time) continue;
    const t = parseTime(tok);
    if (t && !out.time) {
      out.time = t;
      if (!out.when) out.when = today;
      continue;
    }
    keep.push(tok);
  }
  out.title = keep.join(' ');
  return out;
}

/* 90 → "1h 30m" */
export function formatMinutes(mins) {
  if (mins == null || !isFinite(mins)) return '';
  const m = Math.round(mins);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60), r = m % 60;
  return r ? `${h}h ${r}m` : `${h}h`;
}

const DAY_NAMES = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/* A friendly date: "Today", "Tomorrow", "Fri", "Fri 14 Nov", "14 Nov 2027". */
export function formatDay(iso, today = todayISO()) {
  if (!iso) return '';
  const diff = daysBetween(today, iso);
  if (diff === 0) return 'Today';
  if (diff === 1) return 'Tomorrow';
  if (diff === -1) return 'Yesterday';
  const d = fromISO(iso);
  const base = `${DAY_NAMES[d.getDay()]} ${d.getDate()} ${MONTH_NAMES[d.getMonth()]}`;
  if (diff > 1 && diff < 7) return DAY_NAMES[d.getDay()];
  return d.getFullYear() === fromISO(today).getFullYear() ? base : `${base} ${d.getFullYear()}`;
}
