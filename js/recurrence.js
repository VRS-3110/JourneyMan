// JourneyMan — repeating tasks. No DOM.
//
// A rule: { unit: 'day' | 'week' | 'month' | 'year', every: n, days?: [0–6] (weekly, 0 = Sunday),
//           dom?: day of month (monthly / yearly), month?: 0–11 (yearly),
//           afterDone?: true (next one counts from when you finish), until?: 'YYYY-MM-DD' }
// Dates are local 'YYYY-MM-DD' strings, like the rest of the app.

import { addDays, daysBetween, weekday, fromISO, toISO } from './parse.js';

const WEEKDAY_WORDS = [
  ['sunday', 'sun', 'sundays'], ['monday', 'mon', 'mondays'], ['tuesday', 'tue', 'tues', 'tuesdays'], ['wednesday', 'wed', 'wednesdays'],
  ['thursday', 'thu', 'thur', 'thurs', 'thursdays'], ['friday', 'fri', 'fridays'], ['saturday', 'sat', 'saturdays'],
];
const DAY_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const dayIndex = (w) => WEEKDAY_WORDS.findIndex((names) => names.includes(w));

/* Monday of the week holding `iso` (same convention as the reports). */
function mondayOf(iso) {
  return addDays(iso, -((weekday(iso) + 6) % 7));
}
const daysInMonth = (y, m) => new Date(y, m + 1, 0).getDate();
/* `iso` moved by n months, landing on day `dom` (or the month's last day if it's shorter). */
function addMonths(iso, n, dom) {
  const d = fromISO(iso);
  const total = d.getFullYear() * 12 + d.getMonth() + n;
  const y = Math.floor(total / 12), m = total % 12;
  return toISO(new Date(y, m, Math.min(dom || d.getDate(), daysInMonth(y, m))));
}

/*
  Reads a repeat phrase starting at tokens[i] (the word after "every", or a single word like "daily").
  Returns { rule, used } or null. Handles: every day / 3 days / weekday / weekend / week / other week /
  2 weeks / mon wed fri / mon and thu / week on tue / month / year; daily, weekly, monthly, yearly, weekdays.
*/
export function parseRepeatAt(tokens, i, { afterEvery = true } = {}) {
  const w = (k) => (tokens[i + k] || '').toLowerCase().replace(/[,.]$/, '');
  if (!afterEvery) {
    const single = { daily: { unit: 'day', every: 1 }, weekly: { unit: 'week', every: 1 }, fortnightly: { unit: 'week', every: 2 },
      monthly: { unit: 'month', every: 1 }, yearly: { unit: 'year', every: 1 }, annually: { unit: 'year', every: 1 },
      weekdays: { unit: 'week', every: 1, days: [1, 2, 3, 4, 5] } }[w(0)];
    return single ? { rule: { ...single }, used: 1 } : null;
  }
  let k = 0, every = 1;
  if (w(0) === 'other') { every = 2; k = 1; } else if (/^\d{1,2}$/.test(w(0))) { every = Number(w(0)); k = 1; }
  const unit = w(k);
  if (/^days?$/.test(unit)) return { rule: { unit: 'day', every }, used: k + 1 };
  if (/^weekdays?$/.test(unit) && every === 1) return { rule: { unit: 'week', every: 1, days: [1, 2, 3, 4, 5] }, used: k + 1 };
  if (/^weekends?$/.test(unit) && every === 1) return { rule: { unit: 'week', every: 1, days: [6, 0] }, used: k + 1 };
  if (/^(months?)$/.test(unit)) return { rule: { unit: 'month', every }, used: k + 1 };
  if (/^(years?)$/.test(unit)) return { rule: { unit: 'year', every }, used: k + 1 };
  const listFrom = (start) => {
    const days = [];
    let j = start;
    for (;;) {
      const t = w(j);
      if (t === 'and' || t === '&') { j++; continue; }
      const d = dayIndex(t);
      if (d < 0) break;
      if (!days.includes(d)) days.push(d);
      j++;
    }
    return { days, end: j };
  };
  if (/^weeks?$/.test(unit)) {
    if (w(k + 1) === 'on') {
      const { days, end } = listFrom(k + 2);
      if (days.length) return { rule: { unit: 'week', every, days: days.sort() }, used: end };
    }
    return { rule: { unit: 'week', every }, used: k + 1 };
  }
  const { days, end } = listFrom(k);
  if (days.length) return { rule: { unit: 'week', every, days: days.sort() }, used: end };
  return null;
}

/* Fills in what a rule needs from its first date (day of month, month of year). */
export function anchorRule(rule, firstDate) {
  const r = { every: 1, ...rule };
  const d = fromISO(firstDate);
  if (r.unit === 'month' && !r.dom) r.dom = d.getDate();
  if (r.unit === 'year') { if (!r.dom) r.dom = d.getDate(); if (r.month == null) r.month = d.getMonth(); }
  if (r.unit === 'week' && r.every > 1 && !r.anchor) r.anchor = mondayOf(firstDate);
  return r;
}

/* Does `date` match the rule? (used for the first occurrence) */
function matches(rule, date) {
  if (rule.unit === 'week' && rule.days && rule.days.length) return rule.days.includes(weekday(date));
  return true;
}

/* The first date for a new repeating task: today if the rule allows it, else the next matching day. */
export function firstOccurrence(rule, today) {
  if (matches(rule, today)) return today;
  return nextOccurrence(anchorRule(rule, today), today);
}

/* The first date strictly after `from` that the rule produces, or null once past `until`. */
export function nextOccurrence(rule, from) {
  const n = Math.max(1, rule.every || 1);
  let next = null;
  if (rule.unit === 'day') next = addDays(from, n);
  else if (rule.unit === 'week') {
    if (rule.days && rule.days.length) {
      const base = rule.anchor || mondayOf(from);
      for (let i = 1; i <= 7 * (n + 1); i++) {
        const d = addDays(from, i);
        const weeks = Math.round(daysBetween(base, mondayOf(d)) / 7);
        if (((weeks % n) + n) % n === 0 && rule.days.includes(weekday(d))) { next = d; break; }
      }
    } else next = addDays(from, 7 * n);
  } else if (rule.unit === 'month') next = addMonths(from, n, rule.dom);
  else if (rule.unit === 'year') {
    const d = fromISO(from);
    const y = d.getFullYear() + n;
    const m = rule.month ?? d.getMonth();
    next = toISO(new Date(y, m, Math.min(rule.dom || d.getDate(), daysInMonth(y, m))));
  }
  if (next && rule.until && next > rule.until) return null;
  return next;
}

/* Every date the rule produces after `from`, up to and including `to` (at most `limit`). */
export function occurrencesBetween(rule, from, to, limit = 60) {
  const out = [];
  let d = from;
  while (out.length < limit) {
    d = nextOccurrence(rule, d);
    if (!d || d > to) break;
    out.push(d);
  }
  return out;
}

const ordinal = (n) => n + (n % 10 === 1 && n !== 11 ? 'st' : n % 10 === 2 && n !== 12 ? 'nd' : n % 10 === 3 && n !== 13 ? 'rd' : 'th');

/* "Every Mon, Wed, Fri" · "Every 2 weeks" · "Every month on the 5th" · "… after done" · "… until 1 Dec" */
export function describeRepeat(rule, { short = false } = {}) {
  if (!rule) return '';
  const n = rule.every || 1;
  let s;
  if (rule.unit === 'day') s = n === 1 ? 'Every day' : `Every ${n} days`;
  else if (rule.unit === 'week') {
    const days = rule.days || [];
    const list = [...days].sort((a, b) => ((a + 6) % 7) - ((b + 6) % 7)).map((d) => DAY_SHORT[d]).join(', ');
    if (days.length === 5 && [1, 2, 3, 4, 5].every((d) => days.includes(d)) && n === 1) s = 'Every weekday';
    else if (days.length) s = n === 1 ? `Every ${list}` : `Every ${n} weeks on ${list}`;
    else s = n === 1 ? 'Every week' : `Every ${n} weeks`;
  } else if (rule.unit === 'month') s = `${n === 1 ? 'Every month' : `Every ${n} months`}${rule.dom && !short ? ` on the ${ordinal(rule.dom)}` : ''}`;
  else s = `${n === 1 ? 'Every year' : `Every ${n} years`}${rule.dom && rule.month != null && !short ? ` on ${rule.dom} ${MONTHS[rule.month]}` : ''}`;
  if (rule.afterDone) s += short ? ' after done' : ', counted from when you finish';
  if (rule.until && !short) s += ` until ${Number(rule.until.slice(8))} ${MONTHS[Number(rule.until.slice(5, 7)) - 1]}`;
  return s;
}
